import { Q } from '@nozbe/watermelondb'
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AudioBufferQueueSourceNode,
} from 'react-native-audio-api'
import { database } from '../db'
import { Order, orderStatusLabel } from '../db/models/order'
import { OrderDocument } from '../db/models/order-document'
import { OrderScan } from '../db/models/order-scan'
import { FormTemplate } from '../db/models/form-template'
import { Project } from '../db/models/project'
import { Room } from '../db/models/room'
import { findByOrderNumber } from '../orders'
import {
  addOrderMember,
  findColleagueByName,
  getCurrentUser,
  getOrderMembers,
  isOrderMember,
  listMyOrders,
  type CurrentUser,
} from '../order-access'
import { syncQuietly } from '../db/sync'
import { TimeEntry } from '../db/models/time-entry'
import { finnAktivitet } from '../activities'
import { OrderExtra, type TilleggPrising } from '../db/models/order-extra'
import { Quote } from '../db/models/quote'
import { resolveTemplate, listAllTemplates, type TemplateCatalogEntry } from '../forms/resolve'
import { startVoiceFill, applyVoiceFill, type VoiceFillEntry } from '../forms/voice-fill'
import { emitVoiceLevel } from './voice-level'
import { isEchoCancelledMicAvailable, startEchoCancelledMic } from '../../modules/ampex-splat'
import { getPreferredVoice } from './voice-prefs'
import { Reminder } from '../db/models/reminder'
import { AssistantNote } from '../db/models/assistant-note'
import {
  spenningsfall,
  lastStroem,
  vernKarakteristikk,
  koordinerKabelVern,
  kortslutningEnde,
  regnUt,
  VARMEKABEL_VEILEDNING,
} from '../elektro'
import { getForecast } from '../weather'
import { computeProjectProgress, progressToSpokenContext } from '../project-progress'
import { fetchLiveToken } from './gemini-client'
import type { VoiceRouteContext } from './voice-drafts'
import { sokVareVerktoy, taUtMateriellVerktoy, leggTilMateriellVerktoy } from './materiell-tools'
import { nyttTilbudVerktoy, tilbudslinjeVerktoy, tilbudssumVerktoy } from './tilbud-tools'

// Gemini Live: rå PCM16 little-endian begge veier — 16kHz opp, 24kHz ned
// (dokumentert format, ikke valgbart). 100ms-chunks opp gir ~3,2KB per melding:
// lav nok latens for samtale, få nok meldinger til at JS-tråden ikke drukner.
const INPUT_SAMPLE_RATE = 16000
const INPUT_CHUNK_FRAMES = 1600
const OUTPUT_SAMPLE_RATE = 24000

// Ephemeral tokens har sin EGEN WS-metode: BidiGenerateContentConstrained på
// v1alpha, med rå (u-URL-enkodet) token i ?access_token= — vanlige BidiGenerateContent
// + API-nøkkel-kanalene svarer bare 1008 «unregistered caller» på tokens. Fasit er
// googleapis/js-genai src/live.ts (apiKey.startsWith('auth_tokens/')-grenen).
const LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'

// Google Søk-grounding har EGEN dagskvote — når den er tom avviser Google HELE økten ved
// setup (close 1011, «exceeded your current quota»). Feilsøkt 2026-08-13: alle økter døde
// «stille» en hel dag fordi søkeverktøyet sto i setup. Når det skjer: koble til på nytt
// uten søk og husk det en halvtime — assistenten virker alltid, søk kommer tilbake selv.
let searchQuotaBlockedUntil = 0

export type LiveStage = 'connecting' | 'active'

export type LiveSessionCallbacks = {
  onStage: (stage: LiveStage) => void
  /** Økten er over — uansett årsak. `error` satt hvis den døde unaturlig. */
  onEnd: (error?: string) => void
  /** Modellen slo opp en ordre som finnes lokalt — UI kan tilby navigasjon. */
  onOrderFound?: (order: Order) => void
  /** Modellen er ferdig å fylle et skjemautkast — UI navigerer til skjemaet for verifisering. */
  onOpenForm?: (orderId: string, templateId: string) => void
  /** Guide-navigasjon: modellen åpner en skjerm direkte (f.eks. ordren den nettopp opprettet). */
  onNavigate?: (path: string) => void
}

const SYSTEM_INSTRUCTION = `Du er Ampex-assistenten — en stemmestyrt hjelper for norske elektrikere ute på jobb.
Svar ALLTID på norsk, kort og muntlig: én til to setninger, som en kollega over skulderen, ikke som en manual.
Brukeren kan snakke hvilken som helst dialekt — forstå den, men SNAKK SELV ALLTID standard østnorsk (Oslo-mål,
bokmål) med klar, nøytral norsk uttale — som en norsk nyhetsoppleser. Ikke speil brukerens dialekt, og gli aldri
over i utenlandsk aksent eller gebrokken uttale.

DU VET KUN DET VERKTØYENE RETURNERER. Aldri dikt opp innhold — ikke bilder, dokumenter, datoer eller detaljer
verktøyet ikke ga deg. Mangler du data eller verktøy for noe, si det rett ut i stedet for å gjette.

TILGANG: Full informasjon om en ordre (dokumentasjon, beskrivelse, kunde) får du KUN når brukeren er med på ordren.
For andres ordrer får du bare «visittkortet» (nummer, tittel, hvem som er med) — del aldri mer enn det, og tilby å
melde brukeren på ordren (bli_med_pa_ordre) hvis de vil vite mer.

ENDRINGER (opprette ordre, melde på ordre, føre timer, starte skjema): gjenta først høyt hva du skal gjøre og vent
på et tydelig ja fra brukeren FØR du kaller verktøyet.

SKJEMAER/DOKUMENTASJON: Brukeren kan be deg fylle ut dokumentasjon på en ordre de er med på, f.eks. «jeg trenger
risikovurdering for denne ordren, jeg har gjort X og Y». Flyten er ALLTID:
1. Velg riktig mal fra listen under, si hvilken du foreslår og HVORFOR, og vent på ja.
2. Kall start_skjema — du får feltene og hva som alt er forhåndsutfylt fra ordren.
3. Fyll det brukeren allerede har fortalt med fyll_skjemafelt (kort begrunnelse per felt). For choice-felt MÅ
   verdien være ordrett ett av alternativene.
4. Spør målrettede oppfølgingsspørsmål KUN om required-felt som mangler — ett-to spørsmål av gangen, ikke forhør.
   Sjekkliste-punkter (choice-felt, typisk Ja/Nei/Ikke aktuelt) tar du som korte muntlige ja/nei-spørsmål i naturlig
   rekkefølge («Er anlegget spenningsprøvd? … Og jordfeilbryter testet?») og fyller svarene fortløpende. Fritekst-felt
   formulerer du fra det brukeren har fortalt — les kort opp hva du skrev hvis brukeren ber om det.
5. Når alt er fylt (eller brukeren vil stoppe): kall vis_skjema og si at de MÅ se over og fullføre i appen selv.

GUIDET GJENNOMGANG — den andre måten. Ber brukeren om å gå GJENNOM skjemaet («kan vi ta risikoskjemaet punkt for
punkt», «spør meg om hvert punkt»), gjelder punkt 4 IKKE. Da vil de ha hele skjemaet, i rekkefølge, og du holder
tråden:
- Si hvor mange punkt det er FØR du begynner («Elleve punkt. Vi tar dem i rekkefølge.»). Uten et tall vet ikke
  brukeren om dette tar ett minutt eller ti, og da avbryter de.
- ETT punkt av gangen, lest slik det står. For klikklister leser du alternativene: «Ja, nei, eller ikke aktuelt?»
  Ikke gjett hva de mener — verdien MÅ være ordrett ett av alternativene.
- Kvitter kort og gå videre: «Ja. Punkt fire: …» Ingen småprat mellom punktene. Det er dét som gjør en
  gjennomgang utholdelig i stedet for uendelig.
- Ta ALLE punktene, ikke bare de påkrevde — det er dét de ba om. Punkt som alt er fylt fra ordren nevner du i
  forbifarten («Adressen er alt fylt inn») og går videre.
- «Hopp over», «tilbake» og «stopp» skal virke når som helst. Ved stopp: si hvor langt dere kom.
- Tabellfelt kan du ikke fylle. Si det når du kommer dit, og gå videre — ikke la det stoppe gjennomgangen.
Fyll fortløpende med fyll_skjemafelt, ikke alt til slutt: brytes samtalen, skal svarene være lagret.
Du kan ALDRI fullføre/signere et skjema — det gjør mennesket i appen. Du kan heller ikke lage nye maler.
Mallisten (inkl. firmaets egne skjemaer) står nederst i instruksene — velg alltid derfra.

TILLEGGSARBEID: nevner brukeren noe kunden ikke bestilte opprinnelig, bruk foresla_tillegg med en gang. Det registreres som foreslått — si at kunden må godkjenne før det kan faktureres. TIMEFØRING: foer_timer fører timer på en ordre brukeren er med på (bekreft antall timer høyt først). Oppgi aktivitet når den nevnes — den avgjør timeprisen. Notatet er synlig på fakturaen. mine_timer
oppsummerer brukerens førte timer.

MATERIELL OG VARER: Dette er det du kan som ingen andre — ikke bare snakke om jobben, men GJØRE den.
- «Jeg tok ti downlights fra bilen» → ta_ut_materiell med en gang. Uttaket havner i kurven til det plasseres.
- «Sett tre meter PFXP på ordre 42» → legg_til_materiell. Krever at brukeren er med på ordren.
- «Hva koster en jordfeilautomat på 16?» eller et el-nummer lest av en eske → sok_vare.
To ærlighetsregler du ALDRI bryter, fordi begge handler om penger:
1. Er prisen merket listepris, SI at det er grossistens katalogpris og ikke firmaets — den er for høy, og
   dekningsbidraget blir feil. Be dem importere en P4-fil for riktige priser.
2. Gir et uttak negativ beholdning, si det høyt. Enten er noe ikke registrert, eller så er tallet feil.
Les opp de to-tre mest relevante treffene, aldri hele lista. Er billigste grossist merkbart billigere, nevn det —
det er hele poenget: ingen grossists eget system kan si «bestill hos den andre».

TILBUD: Et tilbud blir til på vei hjem fra befaring — brukeren husker rommet nå, ikke om en time.
Flyten: nytt_tilbud først, så én legg_til_tilbudslinje per ting han ramser opp, så tilbudssum av deg selv når
lista ser ferdig ut. Materiell og aktiviteter slås opp i kartoteket, så «tolv downlights og åtte timer montasje»
blir ekte beløp — du skal IKKE spørre om pris når varen finnes. Les summen og dekningsbidraget høyt: det er det
eneste tidspunktet det tallet kan endre noe. Er dekningsbidraget negativt, si det rett ut.
Du kan ALDRI sende et tilbud — det er en bindende pris ut til en kunde, og mennesket trykker. Kall vis_tilbud og
si at de ser over og sender selv.

GJØR DET DU BLIR BEDT OM — MEN SI FRA HVIS DET FINNES EN BEDRE VEI.
Ber brukeren om noe, gjør du DET. Du omdefinerer aldri oppgaven fordi du selv liker en annen framgangsmåte bedre.
Men ser du en kortere eller sikrere vei, sier du det i ÉN setning før du setter i gang — og så gjør du som de sa
hvis de ikke tar imot: «Vi kan ta alle elleve, men ni av dem er alt fylt fra ordren — skal jeg bare ta de to som
mangler?» Forslaget kommer først, ikke etter at du har gjort noe annet enn det de ba om.
Reglene for det: ett forslag, ikke tre. Bare når det er en REELL forskjell i tid eller risiko — ikke som en vane.
Blir det avslått, nevner du det ikke igjen i samme samtale. Og en advarsel som handler om penger eller
dokumentasjon (listepris, negativ beholdning, negativt dekningsbidrag) er ikke et forslag: den sier du uansett.

VÆR EN GUIDE, IKKE ET INTERVJU: Åpne ting på skjermen (vis_ordre, vis_skjema) i stedet for å bare snakke om dem.
Når du oppretter eller endrer noe: bruk ALT brukeren allerede har sagt uten å spørre om det på nytt — nevner de
kunde, adresse eller at «vi er to på jobben», fyller du/legger du til uten videre (legg_til_medlem for kolleger).
Vær ENGASJERT rundt handlinger: etter en opprettelse er ETT naturlig, konkret oppfølgingstilbud bra («Skal jeg
sette dato eller legge til noe i beskrivelsen?») — men aldri en spørsmålsrekke, og et nei eller stillhet betyr
ferdig. Bruk skjønn som en erfaren prosjektleder for hva som faktisk er verdt å spørre om.

HUKOMMELSE: Når brukeren avslører noe VARIG om seg selv (preferanser, fast makker, favorittgrossist, hvordan de
liker beskrivelser), tilby å huske det: «Vil du at jeg husker det til senere?» — og kall husk_notat KUN ved ja.
Bruk det du alt husker naturlig i samtalen uten å lese notatene høyt.

ALDRI MAS: Hvis brukeren ikke svarer direkte på noe du spurte om eller tilbød, er svaret NEI — slipp det
umiddelbart og følg brukerens nye spor. Gjenta ALDRI et spørsmål eller tilbud brukeren har hoppet over, og
ikke kom tilbake til det senere i samtalen med mindre brukeren selv tar det opp.

FAGKALKULASJONER: Bruk ALLTID verktøyene for tallsvar — aldri hoderegning på tall en montør skal bygge etter:
varmekabel_cc (senteravstand), spenningsfall (Cu/Al, temp), last_stroem (kW→A), vern_karakteristikk (B/C/D-
utløseområder), koordiner_kabel_vern (Ib≤In≤Iz-sjekk), kortslutning_ende (utløsersjekk, veiledende), regn_ut
(alt annet, med sqrt/trig). Iz (strømføringsevne) skal ALLTID komme fra produsentens datablad eller NEK-tabell —
søk den opp på nett hvis brukeren ikke har den, og si hvilken kilde du fant. Oppgi forutsetningene kort når du
leser opp resultater, og minn om at dimensjoneringsBESLUTNINGEN ligger hos fagansvarlig. Du kan også søke på
nett når brukeren spør om noe utenfor appen — produktdata, forskrifter, priser; si kort at du sjekker.

Tenk samtidig som elektriker/prosjektleder/HR når det er NATURLIG i situasjonen: risikovurdering før arbeid starter,
sluttkontroll/samsvarserklæring når jobben meldes ferdig, timeføring når økta rundes av. Foreslå én ting, aldri mas.
Væravhengig arbeid (varmekabler ute, arbeid uten tak, graving): sjekk_vaer FØR du hjelper med å planlegge dato — og
er varselet dårlig, foreslå en bedre dag og tilby en påminnelse (opprett_paaminnelse) på den.

Prosjekter kan slås opp på navn, så "hvordan ligger Løkkeveien an?" fungerer uansett skjerm. Les opp fremdrift som
hele tall og nevn bare de mest relevante fagfeltene/rommene — ikke ramse opp alt.`

// Google-søk (grounding) AV VED KILDEN (2026-08-13): groundingen har egen kvote, og når
// den er tom/utilgjengelig avviser Google HELE økten ved setup (1011 «exceeded your
// current quota») — assistenten var stum en hel dag. Slå på igjen ved å sette true NÅR
// nøkkelen beviselig har grounding-kvote (test: scratchpad ws-test3.js variant 'full').
// Retry-uten-søk i onclose står som sikkerhetsnett for når den slås på igjen.
const ENABLE_GOOGLE_SEARCH = false

const TOOL_DECLARATIONS = [
  // Server-side Google-søk (grounding) — «kan du sjekke på nett…» virker uten
  // klientkode; modellen søker selv og svarer med kildegrunnlag.
  ...(ENABLE_GOOGLE_SEARCH ? [{ googleSearch: {} }] : []),
  {
    functionDeclarations: [
      {
        name: 'finn_ordre',
        description:
          'Slår opp en ordre ut fra ordrenummeret brukeren sa. Er brukeren med på ordren får du alt; ellers kun visittkortet (nummer, tittel, hvem som er med).',
        parameters: {
          type: 'OBJECT',
          properties: { ordrenummer: { type: 'INTEGER', description: 'Ordrenummeret brukeren sa, som heltall.' } },
          required: ['ordrenummer'],
        },
      },
      {
        name: 'ordre_dokumentasjon',
        description:
          'Henter FAKTISK dokumentasjon på en ordre brukeren er med på: utfylte/påbegynte skjemaer og 3D-skanninger. Bruk denne når brukeren spør hva som er dokumentert — aldri gjett.',
        parameters: {
          type: 'OBJECT',
          properties: { ordrenummer: { type: 'INTEGER' } },
          required: ['ordrenummer'],
        },
      },
      {
        name: 'bli_med_pa_ordre',
        description:
          'Melder brukeren på en eksisterende ordre slik at de får full tilgang til den. Krev muntlig bekreftelse fra brukeren først.',
        parameters: {
          type: 'OBJECT',
          properties: { ordrenummer: { type: 'INTEGER' } },
          required: ['ordrenummer'],
        },
      },
      {
        name: 'opprett_ordre',
        description:
          'Oppretter en ny ordre. Krev muntlig bekreftelse på tittelen først. Brukeren blir automatisk med på ordren. Ordrenummer tildeles av serveren ved synk — ikke finn på ett.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tittel: { type: 'STRING', description: 'Kort tittel, f.eks. «Bytte sikringsskap, Løkkeveien 12».' },
            kundenavn: { type: 'STRING' },
            adresse: { type: 'STRING' },
            beskrivelse: { type: 'STRING' },
          },
          required: ['tittel'],
        },
      },
      {
        name: 'prosjekt_status',
        description:
          'Henter ferdig utregnet fremdrift (per rom, per fagfelt) for et prosjekt. Oppgi prosjektnavn hvis brukeren nevnte ett; uten navn brukes prosjektet brukeren står i. Tallene er fasit — ikke regn selv.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prosjektnavn: {
              type: 'STRING',
              description: 'Navnet (eller deler av navnet) på prosjektet brukeren sa. Utelat for å bruke prosjektet på skjermen.',
            },
          },
        },
      },
      {
        name: 'varmekabel_cc',
        description:
          'Regner ut senteravstand (c/c) for varmekabel, og med kabelens effekt oppgitt også W/m² med sjekk mot veiledende spenn. Bruk ALLTID denne for c/c — aldri hoderegning. Spør etter FRITT areal (fratrukket skap/badekar/toalett).',
        parameters: {
          type: 'OBJECT',
          properties: {
            areal_m2: { type: 'NUMBER', description: 'FRITT oppvarmet areal i m² (fratrukket faste installasjoner).' },
            kabellengde_m: { type: 'NUMBER' },
            kabel_W: { type: 'NUMBER', description: 'Kabelens merkeeffekt i watt (valgfri — gir W/m²-sjekk).' },
          },
          required: ['areal_m2', 'kabellengde_m'],
        },
      },
      {
        name: 'varmekabel_ohm',
        description:
          'Forventet resistans for varmekabel til sluttkontroll/feilsøking: merkeeffekt (og spenning) inn → nominell ohm med vanlig toleranse (−5/+10 %). Bruk ved måling av kabel før/etter støp.',
        parameters: {
          type: 'OBJECT',
          properties: {
            kabel_W: { type: 'NUMBER' },
            spenning_V: { type: 'NUMBER', description: 'Standard 230.' },
          },
          required: ['kabel_W'],
        },
      },
      {
        name: 'spenningsfall',
        description:
          'Regner ut spenningsfall (kobber ELLER aluminium, valgfri ledertemperatur, reaktans inkluderes automatisk ≥50mm²). Bruk ALLTID denne for spenningsfall. Én-veis lengde.',
        parameters: {
          type: 'OBJECT',
          properties: {
            lengde_m: { type: 'NUMBER', description: 'Kabellengde én vei, i meter.' },
            stroem_A: { type: 'NUMBER' },
            tverrsnitt_mm2: { type: 'NUMBER' },
            system: { type: 'STRING', description: '«enfase» (230V, standard) eller «trefase» (400V).' },
            spenning_V: { type: 'NUMBER' },
            cosphi: { type: 'NUMBER', description: 'Standard 1.0.' },
            materiale: { type: 'STRING', description: '«cu» (standard) eller «al».' },
            ledertemp_C: { type: 'NUMBER', description: 'Ledertemperatur; 20 standard, ~70 for fullastet PVC-kabel.' },
          },
          required: ['lengde_m', 'stroem_A', 'tverrsnitt_mm2'],
        },
      },
      {
        name: 'last_stroem',
        description: 'Merkestrøm fra effekt (motor/last): kW → A, med cosφ og virkningsgrad.',
        parameters: {
          type: 'OBJECT',
          properties: {
            kW: { type: 'NUMBER' },
            spenning_V: { type: 'NUMBER' },
            cosphi: { type: 'NUMBER', description: 'Motor typisk 0.85.' },
            virkningsgrad: { type: 'NUMBER', description: 'Motor typisk 0.9.' },
            system: { type: 'STRING', description: '«trefase» (standard) eller «enfase».' },
          },
          required: ['kW'],
        },
      },
      {
        name: 'vern_karakteristikk',
        description: 'IEC 60898-fakta for automatsikring: magnetisk utløseområde (B/C/D) og termiske grenser for gitt In.',
        parameters: {
          type: 'OBJECT',
          properties: { karakteristikk: { type: 'STRING', description: 'B, C eller D.' }, In: { type: 'NUMBER' } },
          required: ['karakteristikk', 'In'],
        },
      },
      {
        name: 'koordiner_kabel_vern',
        description:
          'Sjekker NEK 400-koordinering: Ib ≤ In ≤ Iz og I2 ≤ 1.45·Iz. Iz skal komme fra produsentens datablad eller NEK-tabell (søk den opp ved behov) — ALDRI gjettes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            belastning_Ib_A: { type: 'NUMBER' },
            vern_In_A: { type: 'NUMBER' },
            kabel_Iz_A: { type: 'NUMBER', description: 'Korrigert strømføringsevne fra datablad/tabell.' },
          },
          required: ['belastning_Ib_A', 'vern_In_A', 'kabel_Iz_A'],
        },
      },
      {
        name: 'kortslutning_ende',
        description:
          'VEILEDENDE kortslutningsstrøm i enden av en kurs gitt Ik ved tavla — for å sjekke at vernet løser momentant. Ikke FEBDOK-erstatning.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ik_start_A: { type: 'NUMBER', description: 'Ik ved kursens start (fra tavledok/FEBDOK).' },
            lengde_m: { type: 'NUMBER' },
            tverrsnitt_mm2: { type: 'NUMBER' },
            spenning_V: { type: 'NUMBER', description: 'Standard 230.' },
            materiale: { type: 'STRING', description: '«cu» (standard) eller «al».' },
          },
          required: ['ik_start_A', 'lengde_m', 'tverrsnitt_mm2'],
        },
      },
      {
        name: 'regn_ut',
        description:
          'Eksakt kalkulator for alle andre tallsvar. Uttrykk med tall, + - * / ^ ( ) og sqrt/sin/cos/tan/asin/acos/atan/log/abs/pi (radianer). Bruk denne i stedet for hoderegning.',
        parameters: {
          type: 'OBJECT',
          properties: { uttrykk: { type: 'STRING' } },
          required: ['uttrykk'],
        },
      },
      {
        name: 'husk_notat',
        description:
          'Lagrer noe varig om brukeren (preferanser, arbeidsvaner, fast makker) i din hukommelse for FREMTIDIGE samtaler. Bruk KUN etter at brukeren har sagt ja til «vil du at jeg husker dette?».',
        parameters: {
          type: 'OBJECT',
          properties: { innhold: { type: 'STRING', description: 'Én kort setning, f.eks. «Foretrekker Elektroskandia som grossist».' } },
          required: ['innhold'],
        },
      },
      {
        name: 'glem_notat',
        description: 'Sletter et husket notat om brukeren. Id-ene står i systeminstruksens hukommelsesliste.',
        parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] },
      },
      {
        name: 'opprett_paaminnelse',
        description:
          'Lager en personlig påminnelse for brukeren, f.eks. «ta med varmekabler i morgen». Kan knyttes til en ordre. Forfalte/dagens påminnelser leses opp ved øktstart.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tittel: { type: 'STRING' },
            dato: { type: 'STRING', description: 'ÅÅÅÅ-MM-DD' },
            tid: { type: 'STRING', description: 'TT:MM, valgfri — standard 07:00.' },
            ordrenummer: { type: 'INTEGER' },
            notat: { type: 'STRING' },
          },
          required: ['tittel', 'dato'],
        },
      },
      {
        name: 'mine_paaminnelser',
        description: 'Lister brukerens åpne påminnelser (id, tittel, når). Bruk id-en med paaminnelse_utfort.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'paaminnelse_utfort',
        description: 'Markerer en påminnelse som utført. Id fra mine_paaminnelser.',
        parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] },
      },
      {
        name: 'sjekk_vaer',
        description:
          'Henter værvarsel (min/maks-temperatur og nedbør per dag, inntil 4 dager) for et sted i Norge — bruk ordreadressen eller stedet brukeren sa. Bruk dette til å vurdere væravhengig arbeid: varmekabler ute, arbeid uten tak, graving.',
        parameters: {
          type: 'OBJECT',
          properties: { sted: { type: 'STRING', description: 'Adresse eller stedsnavn i Norge.' } },
          required: ['sted'],
        },
      },
      {
        name: 'legg_til_medlem',
        description:
          'Legger en kollega (samme firma) til på en ordre brukeren selv er med på, slik at kollegaen får tilgang. Oppgi navnet brukeren sa. Bekreft muntlig først.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            navn: { type: 'STRING', description: 'Kollegaens navn (eller del av det).' },
          },
          required: ['ordrenummer', 'navn'],
        },
      },
      {
        name: 'vis_ordre',
        description: 'Åpner en ordre brukeren er med på direkte på skjermen. Bruk denne for å guide — ikke bare fortell, VIS.',
        parameters: {
          type: 'OBJECT',
          properties: { ordrenummer: { type: 'INTEGER' } },
          required: ['ordrenummer'],
        },
      },
      {
        name: 'oppdater_ordre',
        description:
          'Oppdaterer felter på en ordre brukeren er med på — f.eks. legge til/endre beskrivelse, kunde, telefon, adresse eller planlagt dato. Send kun feltene som skal endres. Bekreft muntlig først. Beskrivelse ERSTATTER eksisterende tekst — bygg videre på den gamle hvis brukeren legger til.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            beskrivelse: { type: 'STRING' },
            kundenavn: { type: 'STRING' },
            telefon: { type: 'STRING' },
            adresse: { type: 'STRING' },
            planlagt_dato: { type: 'STRING', description: 'ÅÅÅÅ-MM-DD' },
          },
          required: ['ordrenummer'],
        },
      },
      {
        name: 'start_skjema',
        description:
          'Åpner/oppretter et dokumentasjonsutkast på en ordre brukeren er med på, med prefill fra ordren. Returnerer alle felt med nåværende verdier og hvilke required-felt som mangler. Bekreft malvalget muntlig først.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            mal_id: { type: 'STRING', description: 'Mal-id fra listen i instruksene, f.eks. «ampex.risikovurdering».' },
          },
          required: ['ordrenummer', 'mal_id'],
        },
      },
      {
        name: 'fyll_skjemafelt',
        description:
          'Skriver feltverdier inn i skjemautkastet — kun det brukeren faktisk har sagt eller bekreftet. Avviste felt kommer tilbake med begrunnelse.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            mal_id: { type: 'STRING' },
            felter: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  key: { type: 'STRING' },
                  verdi: { type: 'STRING' },
                  begrunnelse: { type: 'STRING', description: 'Én kort setning: hva brukeren sa som ga denne verdien.' },
                },
                required: ['key', 'verdi', 'begrunnelse'],
              },
            },
          },
          required: ['ordrenummer', 'mal_id', 'felter'],
        },
      },
      {
        name: 'vis_skjema',
        description:
          'Åpner skjemautkastet på skjermen så brukeren kan se over, rette og fullføre selv. Kall denne til slutt i utfyllingsflyten.',
        parameters: {
          type: 'OBJECT',
          properties: { ordrenummer: { type: 'INTEGER' }, mal_id: { type: 'STRING' } },
          required: ['ordrenummer', 'mal_id'],
        },
      },
      {
        name: 'foer_timer',
        description:
          'Fører timer på en ordre brukeren er med på. Bekreft antall timer og ordre muntlig først. Dato er valgfri (standard i dag). ' +
          'Ble det ikke sagt hva som ble gjort, IKKE spør før du fører — før timene først, så tilby kommentaren etterpå med utfyll_timenotat. ' +
          'Timene er det viktige; kommentaren er en bonus, og et spørsmål i veien kan koste begge deler hvis samtalen brytes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            timer: { type: 'NUMBER', description: 'Antall timer, f.eks. 7.5.' },
            notat: { type: 'STRING', description: 'Hva som ble gjort. SYNLIG på fakturaen til kunden.' },
            aktivitet: { type: 'STRING', description: 'F.eks. Montasje, Feilsøking, Service, Kjøring. Avgjør timeprisen.' },
            dato: { type: 'STRING', description: 'ÅÅÅÅ-MM-DD hvis ikke i dag.' },
          },
          required: ['ordrenummer', 'timer'],
        },
      },
      {
        name: 'utfyll_timenotat',
        description:
          'Legger en kommentar på timene du nettopp førte — hva som faktisk ble gjort. Kommentaren står PÅ FAKTURAEN til kunden. ' +
          'Treffer bare din egen føring på den ordren i dag, og bare hvis den ikke alt har en kommentar. Kall den rett etter foer_timer.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER', description: 'Ordren timene ble ført på.' },
            notat: { type: 'STRING', description: 'Kort, i montørens egne ord. F.eks. «Byttet sikringsskap og kursfortegnelse».' },
          },
          required: ['ordrenummer', 'notat'],
        },
      },
      {
        name: 'foresla_tillegg',
        description:
          'Registrerer tilleggsarbeid — arbeid kunden IKKE bestilte opprinnelig. '
          + 'Bruk når brukeren nevner noe ekstra som må gjøres eller som kunden har bedt om underveis. '
          + 'Registreres alltid som FORESLÅTT; godkjenning skjer på skjermen med navnet på den som sa ja. '
          + 'Si tilbake at det må godkjennes før det kan faktureres.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'INTEGER' },
            tittel: { type: 'STRING', description: 'Kort: «To ekstra stikk på soverommet».' },
            beskrivelse: { type: 'STRING' },
            prising: {
              type: 'STRING',
              description: '«fastpris» når en pris er avtalt, «medgatt» når det faktureres etter timer og materiell. Standard medgatt.',
            },
            pris: { type: 'NUMBER', description: 'Kroner eks. mva. Kun ved fastpris.' },
          },
          required: ['ordrenummer', 'tittel'],
        },
      },
      {
        name: 'mine_timer',
        description: 'Oppsummerer brukerens førte timer siste 7 dager, per ordre.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'mine_prosjekter',
        description: 'Lister alle prosjekter med navn, kunde og status. Bruk når brukeren spør hvilke prosjekter som finnes, eller når et prosjektnavn ikke ga treff.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'mine_ordrer',
        description: 'Lister ordrer (nyeste først, maks 20) med ordrenummer, tittel, kunde og status. Bruk når brukeren spør hva som ligger av ordrer eller hva som pågår.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'sok_vare',
        description:
          'Søker i varekartoteket. Bruk når brukeren spør hva noe koster, hvor det er billigst, eller om vi har noe på lager. '
          + 'Godtar el-nummer, EAN/strekkode, produsent, typebetegnelse eller vanlig navn. Les opp de mest relevante, ikke alle.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sok: { type: 'STRING', description: 'Det brukeren sa — el-nummer, navn, produsent eller en kombinasjon.' },
          },
          required: ['sok'],
        },
      },
      {
        name: 'ta_ut_materiell',
        description:
          'Registrerer et uttak fra lager eller bil. Uttaket havner i kurven til det plasseres på en ordre. '
          + 'Bruk når brukeren sier at han TAR eller HAR TATT noe. Er lokasjonen uklar og firmaet har flere, spør før du kaller.',
        parameters: {
          type: 'OBJECT',
          properties: {
            vare: { type: 'STRING', description: 'Varen slik brukeren beskrev den, eller el-nummeret.' },
            antall: { type: 'NUMBER', description: 'Antall i varens enhet (stk, meter).' },
            lokasjon: { type: 'STRING', description: 'Navn på lager eller bil. Utelates når brukeren ikke sa noe — da brukes hans egen bil.' },
          },
          required: ['vare', 'antall'],
        },
      },
      {
        name: 'legg_til_materiell',
        description:
          'Legger materiell rett på en ordre, med pris fra varekartoteket. Krever at brukeren er med på ordren. '
          + 'Bruk når brukeren sier at noe er BRUKT eller skal PÅ en bestemt ordre.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ordrenummer: { type: 'NUMBER', description: 'Ordrenummeret.' },
            vare: { type: 'STRING', description: 'Varen slik brukeren beskrev den, eller el-nummeret.' },
            antall: { type: 'NUMBER', description: 'Antall i varens enhet.' },
          },
          required: ['ordrenummer', 'vare', 'antall'],
        },
      },
      {
        name: 'nytt_tilbud',
        description:
          'Oppretter et tilbud. Bruk når brukeren vil prise en jobb han ikke har fått ennå — typisk på vei hjem fra befaring. '
          + 'Legg linjer på etterpå med legg_til_tilbudslinje.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tittel: { type: 'STRING', description: 'Hva tilbudet gjelder, f.eks. «Nytt sikringsskap Storgata 4».' },
            kunde: { type: 'STRING', description: 'Kundens navn hvis brukeren nevnte den. Slås opp i kunderegisteret.' },
            gyldig_dager: { type: 'NUMBER', description: 'Antall dager tilbudet skal være gyldig. Standard 30.' },
          },
          required: ['tittel'],
        },
      },
      {
        name: 'legg_til_tilbudslinje',
        description:
          'Legger én linje på et tilbud. Materiell slås opp i varekartoteket så prisen blir ekte; arbeid slås opp mot '
          + 'aktiviteten så timeprisen blir riktig. «tekst» er en overskrift eller et forbehold uten beløp. '
          + 'Kall én gang per linje — brukeren ramser dem gjerne opp etter hverandre.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tilbudsnummer: { type: 'NUMBER', description: 'Nummeret på tilbudet.' },
            art: { type: 'STRING', enum: ['materiell', 'arbeid', 'tekst'], description: 'Standard materiell.' },
            beskrivelse: { type: 'STRING', description: 'Varen, aktiviteten eller teksten slik brukeren sa den.' },
            antall: { type: 'NUMBER', description: 'Antall — stk/meter for materiell, timer for arbeid. Standard 1.' },
            pris: { type: 'NUMBER', description: 'Kun når brukeren OPPGIR en pris. Ellers hentes den fra kartoteket.' },
            rabatt: { type: 'NUMBER', description: 'Rabatt i prosent på linja, hvis nevnt.' },
          },
          required: ['tilbudsnummer', 'beskrivelse'],
        },
      },
      {
        name: 'tilbudssum',
        description:
          'Leser opp hva tilbudet summerer til, og dekningsbidraget. Bruk når brukeren spør hva det blir, '
          + 'og av deg selv når linjene ser ut til å være ferdige.',
        parameters: {
          type: 'OBJECT',
          properties: { tilbudsnummer: { type: 'NUMBER' } },
          required: ['tilbudsnummer'],
        },
      },
      {
        name: 'vis_tilbud',
        description: 'Åpner tilbudet på skjermen, så brukeren kan se over og sende det selv.',
        parameters: {
          type: 'OBJECT',
          properties: { tilbudsnummer: { type: 'NUMBER' } },
          required: ['tilbudsnummer'],
        },
      },
    ],
  },
]

// RNs WebSocket kan levere binære rammer; Live-APIet sender JSON i dem.
const utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Float32-samples [-1,1] → PCM16LE → base64. Ingen Buffer i RN, derfor håndrullet. */
function floatToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    const v = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    const int = v | 0
    bytes[i * 2] = int & 0xff
    bytes[i * 2 + 1] = (int >> 8) & 0xff
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += BASE64_CHARS[b0 >> 2]
    out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '='
  }
  return out
}

type ProjectMatch =
  | { kind: 'one'; project: Project }
  | { kind: 'ambiguous'; candidates: Project[] }
  | { kind: 'none' }

/**
 * Talegjenkjent prosjektnavn er sjelden ordrett likt DB-navnet («løkkeveien» vs
 * «Løkkeveien 12, Hansen»). Prosjektlisten er liten og lokal, så vi matcher raust:
 * eksakt > navnet starter med det sagte > det sagte inngår i navn/kunde. Flere
 * treff sendes tilbake til modellen som kandidater — DEN spør brukeren, ikke vi.
 */
async function resolveProjectByName(spoken: string): Promise<ProjectMatch> {
  const q = spoken.toLowerCase()
  const projects = await database.get<Project>('projects').query().fetch()

  const exact = projects.filter(p => p.name.toLowerCase() === q)
  if (exact.length === 1) return { kind: 'one', project: exact[0] }

  const starts = projects.filter(p => p.name.toLowerCase().startsWith(q))
  const contains = projects.filter(
    p => p.name.toLowerCase().includes(q) || (p.customerName ?? '').toLowerCase().includes(q),
  )
  const candidates = starts.length > 0 ? starts : contains
  if (candidates.length === 1) return { kind: 'one', project: candidates[0] }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.slice(0, 5) }
  return { kind: 'none' }
}

const BASE64_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < BASE64_CHARS.length; i++) table[BASE64_CHARS.charCodeAt(i)] = i
  return table
})()

/** Base64 med PCM16LE → Float32-samples [-1,1]. Ren JS — ingen bridge-rundtur per chunk. */
function pcm16Base64ToFloat32(b64: string): Float32Array {
  let len = b64.length
  while (len > 0 && b64.charCodeAt(len - 1) === 61) len-- // strip '='
  const byteCount = Math.floor((len * 3) / 4)
  const bytes = new Uint8Array(byteCount)
  let o = 0
  for (let i = 0; i + 3 < len; i += 4) {
    const a = BASE64_LOOKUP[b64.charCodeAt(i)]
    const b = BASE64_LOOKUP[b64.charCodeAt(i + 1)]
    const c = BASE64_LOOKUP[b64.charCodeAt(i + 2)]
    const d = BASE64_LOOKUP[b64.charCodeAt(i + 3)]
    bytes[o++] = (a << 2) | (b >> 4)
    if (o < byteCount) bytes[o++] = ((b & 15) << 4) | (c >> 2)
    if (o < byteCount) bytes[o++] = ((c & 3) << 6) | d
  }
  // Rest på 2/3 tegn (uten padding) — forekommer ikke fra Gemini, men vær robust.
  const rem = len % 4
  if (rem >= 2) {
    const i = len - rem
    const a = BASE64_LOOKUP[b64.charCodeAt(i)]
    const b = BASE64_LOOKUP[b64.charCodeAt(i + 1)]
    if (o < byteCount) bytes[o++] = (a << 2) | (b >> 4)
    if (rem === 3 && o < byteCount) {
      const c = BASE64_LOOKUP[b64.charCodeAt(i + 2)]
      bytes[o++] = ((b & 15) << 4) | (c >> 2)
    }
  }
  const samples = new Float32Array(byteCount >> 1)
  for (let i = 0; i < samples.length; i++) {
    const v = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
    samples[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000
  }
  return samples
}

// ÉN delt AudioContext for hele appens levetid — IKKE ny per økt. Per-økt
// create/close lekket native audio-enheter når close() hang på en kontekst
// skadet av audio-avbrudd (bakgrunnsstrøm): etter et par økter var iOS-lyden
// så wedged at kun omstart av telefonen hjalp («virker bare etter reboot»).
let sharedAudioContext: AudioContext | null = null
function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })
  return sharedAudioContext
}

// Samtale-fortsettelse: Live-APIets sessionResumption gir oss handles underveis;
// ny økt innen vinduet gjenopptar HELE samtalekonteksten («fortsett der vi slapp»
// etter at brukeren la på med rist). Modul-skopet — overlever LiveSession-instanser.
const RESUME_WINDOW_MS = 10 * 60_000
let lastResumeHandle: { handle: string; at: number } | null = null

// Global kø for iOS-audiosesjonens av/på: aktivering som overlapper forrige økts
// deaktivering kan «lykkes» mot en døende sesjon — økten kobler til, men mikrofon
// og høyttaler er døde og stumme (legg-på → rist-på-nytt-feilen). Retry hjelper
// ikke, for den døde aktiveringen KASTER ikke. Køen gjør overlapp fysisk umulig.
let audioSessionQueue: Promise<unknown> = Promise.resolve()
function queueAudioSessionActivity(active: boolean): Promise<void> {
  const run = async () => {
    try {
      await AudioManager.setAudioSessionActivity(active)
    } catch {
      if (!active) return // deaktivering som feiler er ufarlig
      await new Promise(r => setTimeout(r, 400))
      await AudioManager.setAudioSessionActivity(true)
    }
  }
  const next = audioSessionQueue.then(run, run)
  audioSessionQueue = next
  return next as Promise<void>
}

function wsDataToString(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer && utf8Decoder) return utf8Decoder.decode(data)
  return null
}

/**
 * Én sanntidssamtale med Gemini Live: mikrofon-PCM streames opp over WebSocket,
 * modellens tale streames ned og spilles fortløpende. Avbrytelse (barge-in) og
 * tur-taking håndteres av serverens VAD — vi gjør ingen egen stillhetsdeteksjon,
 * i motsetning til det gamle opptak-og-send-løpet i voice-session.tsx.
 *
 * Verktøykall (ordreoppslag, prosjektstatus) kjøres HER, klientsidig mot lokal
 * WatermelonDB (regel 2) — modellen ser aldri rå tabelldata, kun svaret på det
 * konkrete spørsmålet.
 */
export class LiveSession {
  private ws: WebSocket | null = null
  private recorder: AudioRecorder | null = null
  private audioContext: AudioContext | null = null
  private queueNode: AudioBufferQueueSourceNode | null = null
  private callbacks: LiveSessionCallbacks
  private routeContext: VoiceRouteContext
  private ended = false
  private gotSetupComplete = false
  private receivedModelAudio = false
  private user: CurrentUser | null = null
  private templateCatalog: TemplateCatalogEntry[] = []
  private earpiece = false
  private dueReminders: string[] = []
  private userNotes: { id: string; content: string }[] = []
  // Jitter-buffer + koalescering: Gemini streamer lyden i mange små, ujevne
  // chunks. Enkeltvis i spillekøen gir de hørbare kutt ved hver buffergrense og
  // underrun midt i setninger. Vi samler derfor rå samples i JS og sender FÅ,
  // STORE buffere til køen: første flush etter ~450ms (jitter-pute per tur),
  // deretter i ~250ms-bolker.
  private pendingFloats: Float32Array[] = []
  private pendingSamples = 0
  private primed = false
  // Nivå-gate: react-native-audio-api har INGEN ekkokansellering (voiceChat-
  // modusen setter bare AVAudioSession-mode, aldri setVoiceProcessingEnabled), så
  // mikrofonen hører høyttaleren og serverens VAD «avbryter» modellen midt i ordet.
  // Mens modellen snakker slipper vi derfor kun HØY mikrofonlyd gjennom (snakk
  // høyt/tett på telefonen for å avbryte) — ekkoet fra høyttaleren ligger lavere.
  // Én høy chunk åpner gaten i en «hangover»-periode så resten av ytringen flyter
  // til serveren og gir ekte barge-in. Terskelen trenger felttuning (jf. rist).
  private playbackEndsAtMs = 0
  private micSub: { remove: () => void } | null = null
  private resumedConversation = false

  constructor(routeContext: VoiceRouteContext, callbacks: LiveSessionCallbacks) {
    this.routeContext = routeContext
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    // Zombie-vakt via globalThis (overlever Metro Fast Refresh, i motsetning til
    // modul-variabler): en hot-update midt i en økt remounter provideren (stage →
    // idle, liveRef → null) mens den GAMLE økten lever videre frakoblet — hun
    // «nekter å stoppe», og neste rist starter økt nr. 2 oppå. Én økt, alltid.
    const g = globalThis as { __ampexLiveSession?: LiveSession }
    if (g.__ampexLiveSession && g.__ampexLiveSession !== this) {
      console.log('Live: stopper foreldreløs økt (hot reload?)')
      try {
        g.__ampexLiveSession.stop()
      } catch {}
    }
    g.__ampexLiveSession = this

    this.callbacks.onStage('connecting')

    // Rolle/navn inn i systeminstruksen + varm cache for verktøyenes tilgangssjekker.
    this.user = await getCurrentUser()
    // Skjemakatalogen (bundlede + firmaets publiserte maler) hentes ved øktstart —
    // slik «kan» modellen firmaets egne skjemaer uten ny kode per firma.
    this.templateCatalog = await listAllTemplates().catch(() => [])
    // Hukommelsen om denne montøren inn i instruksen (id-er med, så glem_notat virker).
    if (this.user) {
      this.userNotes = await database
        .get<AssistantNote>('assistant_notes')
        .query(Q.where('user_id', this.user.id), Q.sortBy('created_at', Q.asc))
        .fetch()
        .then(rows => rows.map(n => ({ id: n.id, content: n.content })))
        .catch(() => [])
    }
    // Forfalte/dagens påminnelser inn i instruksen — assistenten nevner dem i åpningen.
    if (this.user) {
      const endOfDay = new Date()
      endOfDay.setHours(23, 59, 59, 999)
      this.dueReminders = await database
        .get<Reminder>('reminders')
        .query(Q.where('user_id', this.user.id), Q.where('status', 'open'), Q.where('due_at', Q.lte(endOfDay.getTime())), Q.sortBy('due_at', Q.asc))
        .fetch()
        .then(rows => rows.map(r => r.title))
        .catch(() => [])
    }

    await this.connectSocket()
  }

  /**
   * Tokenhenting + WS-oppkobling. Egen metode fordi avvisning ved setup prøves på
   * nytt med færre antakelser — ferske engangs-tokens per forsøk. Stigen:
   *
   *   1. låst token + Google-søk
   *   2. låst token, uten søk        (kvoten på grounding er den vanlige synderen)
   *   3. ULÅST token, uten søk       (låsen selv er det siste vi mistenker)
   *
   * Trinn 3 finnes fordi en sikkerhetsherding som kan slå ut stemmen i felt ikke
   * er en herding. Vi kommer ikke lenger ned enn hit: er tokenet alt ulåst, er
   * problemet et annet, og da skal feilen SIES, ikke skjules bak flere forsøk.
   */
  private async connectSocket(opts?: { ulaast?: boolean }): Promise<void> {
    const auth = await fetchLiveToken({ ulaast: opts?.ulaast })
    if (!auth) {
      this.finish('Fikk ikke koblet til AI-tjenesten.')
      return
    }
    if (this.ended) return
    const useSearch = Date.now() >= searchQuotaBlockedUntil

    const voice = (await getPreferredVoice().catch(() => null)) ?? auth.voice
    console.log(`Live: kobler til (modell ${auth.model}, stemme ${voice ?? 'standard'})`)
    const ws = new WebSocket(`${LIVE_WS_URL}?access_token=${auth.token}`)
    this.ws = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      const resume =
        lastResumeHandle && Date.now() - lastResumeHandle.at < RESUME_WINDOW_MS
          ? { handle: lastResumeHandle.handle }
          : {}
      this.resumedConversation = 'handle' in resume
      if (this.resumedConversation) console.log('Live: gjenopptar forrige samtale')
      ws.send(
        JSON.stringify({
          setup: {
            sessionResumption: resume,
            model: `models/${auth.model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                languageCode: 'nb-NO',
                // Personlig valg (Meg-fanen) vinner over firmastandarden fra serveren.
                ...(voice ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } : {}),
              },
            },
            systemInstruction: { parts: [{ text: this.buildSystemInstruction() }] },
            tools: useSearch ? TOOL_DECLARATIONS : TOOL_DECLARATIONS.filter(t => !('googleSearch' in t)),
          },
        }),
      )
    }
    ws.onmessage = event => {
      const text = wsDataToString(event.data)
      if (!text) return
      try {
        this.handleServerMessage(JSON.parse(text))
      } catch (e) {
        console.warn('Live: klarte ikke tolke servermelding:', e)
      }
    }
    ws.onerror = (e: any) => {
      console.warn('Live: WS-feil:', e?.message ?? e)
      this.finish('Mistet forbindelsen til AI-tjenesten.')
    }
    ws.onclose = (e: any) => {
      // Lukking FØR setupComplete = Google avviste økten (feil modell, ugyldig
      // token, avvist setup-melding) — close-koden/-grunnen er eneste spor vi får.
      console.warn(`Live: WS lukket (code=${e?.code}, reason=${e?.reason || 'ingen'})`)
      if (!this.gotSetupComplete && useSearch && !this.ended) {
        // Avvist ved setup med søkeverktøyet på: mest sannsynlig grounding-kvoten (1011),
        // men RN-WebSocket MASKERER server-close-koder — så vi prøver på nytt uten søk
        // UANSETT kode (selv-begrensende: neste forsøk har useSearch=false). Feilsøkt
        // 2026-08-13: kode-sjekk på 1011 traff aldri, retryen fyrte ikke.
        console.warn('Live: avvist ved setup — prøver på nytt uten Google-søk')
        searchQuotaBlockedUntil = Date.now() + 30 * 60_000
        void this.connectSocket()
        return
      }
      // Siste trinn: søket er alt av, og tokenet var LÅST. Da er låsen den eneste
      // antakelsen vi har igjen å fjerne. Ett forsøk, aldri flere — auth.laast er
      // false neste gang, så dette kan ikke bli en løkke.
      if (!this.gotSetupComplete && auth.laast && !this.ended) {
        console.warn('Live: avvist med låst token — prøver ulåst én gang')
        void this.connectSocket({ ulaast: true })
        return
      }
      // Kode + grunn inn i meldingen: i Release finnes ingen konsoll — assistenten
      // LESER feilen høyt, og det er eneste diagnosekanal i felt (TTS-loggtrikset).
      const detail = [e?.code, typeof e?.reason === 'string' ? e.reason.slice(0, 60) : '']
        .filter(Boolean).join(' — ')
      // Tokenet er låst til modell + lydmodus. Avvises oppsettet, er låsen den
      // mest sannsynlige nye årsaken — si det, ellers står operatøren og gjetter
      // mellom kvote, modellnavn og lås. Nødbryter: GEMINI_LIVE_UNLOCK=1.
      // Kom vi hit uten setupComplete, er BÅDE søket og låsen alt prøvd fjernet.
      // Da er årsaken noe annet — modellnavn, kvote eller nøkkel — og det er den
      // beskjeden som hjelper, ikke en peker mot låsen vi nettopp utelukket.
      const laasHint = !this.gotSetupComplete && !auth.laast ? ' Prøvd både med og uten låst token.' : ''
      this.finish(this.gotSetupComplete ? undefined : `AI-tjenesten avviste tilkoblingen${detail ? ` (${detail})` : ''}.${laasHint}`)
    }
  }

  /** Avslutt fra brukerens side (rist igjen / knapp). Trygg å kalle flere ganger. */
  stop(): void {
    this.finish()
  }


  private buildSystemInstruction(): string {
    const ctx = this.routeContext
    const screenInfo =
      ctx.screen === 'prosjekt'
        ? `Brukeren står inne på et prosjekt — prosjekt_status uten navn gjelder dette prosjektet.`
        : ctx.screen === 'ordre'
          ? 'Brukeren står på ordrelisten.'
          : 'Brukeren er et sted i appen uten spesiell kontekst.'
    const userInfo = this.user
      ? `BRUKER: ${this.user.name || 'ukjent navn'} (rolle: ${this.user.role || 'ukjent'}). Du handler alltid PÅ VEGNE AV denne brukeren og kan aldri gjøre mer enn rollen deres tillater.`
      : ''
    const catalog =
      this.templateCatalog.length > 0
        ? `\nTILGJENGELIGE SKJEMAMALER (bruk mal_id ordrett):\n${this.templateCatalog.map(t => `- ${t.id}: ${t.name} (${t.source})`).join('\n')}`
        : ''
    const reminders =
      this.dueReminders.length > 0
        ? `\nPÅMINNELSER SOM FORFALLER I DAG/ER FORFALT — nevn dem kort i din FØRSTE replikk: ${this.dueReminders.join('; ')}`
        : ''
    const notes =
      this.userNotes.length > 0
        ? `\nHUKOMMELSE OM BRUKEREN (bruk naturlig, ikke les opp; slett med glem_notat om brukeren ber om det):\n${this.userNotes.map(n => `- [${n.id}] ${n.content}`).join('\n')}`
        : ''
    return `${SYSTEM_INSTRUCTION}\n\n${userInfo}\nNÅVÆRENDE SKJERM: ${screenInfo}${catalog}${reminders}${notes}`
  }

  /** Telefon-mot-øret: rut lyden til ørehøyttaleren (privat, som en samtale) i stedet for speaker. */
  setEarpiece(on: boolean): void {
    if (this.earpiece === on) return
    this.earpiece = on
    if (this.audioContext) this.applyAudioSessionOptions()
  }

  private applyAudioSessionOptions(): void {
    // iosMode 'default', IKKE 'voiceChat': voiceChat legger telefonsamtale-
    // prosessering på UTGANGEN (dumpt/tett «tett nese»-klang på modellens stemme).
    // Vi trodde den ga ekkokansellering, men biblioteket aktiverer aldri det
    // (se nivå-gate-kommentaren) — modusen var kun kostnad, null gevinst.
    // playAndRecord UTEN defaultToSpeaker ruter til ørehøyttaleren — det er hele
    // earpiece-bryteren.
    // duckOthers: bakgrunnslyd (musikk/strøm) dempes under økten i stedet for en
    // sesjons-dragkamp der den andre appen til slutt STJELER sesjonen og dreper
    // både mikrofon og avspilling midt i økten.
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: this.earpiece
        ? ['allowBluetoothHFP', 'duckOthers']
        : ['defaultToSpeaker', 'allowBluetoothHFP', 'duckOthers'],
    })
  }

  private async startAudio(): Promise<void> {
    this.applyAudioSessionOptions()
    // Blir sesjonen likevel avbrutt (innkommende anrop, annen app tar over):
    // observer avbrudd og TA SESJONEN TILBAKE aktivt — uten dette døde økten
    // stille når en bakgrunnsstrøm spilte, og lyd/mikrofon kom aldri tilbake.
    try {
      AudioManager.observeAudioInterruptions(true)
      AudioManager.activelyReclaimSession(true)
    } catch {}
    await queueAudioSessionActivity(true)
    console.log('Live: audiosesjon aktiv')

    this.audioContext = getSharedAudioContext()
    // VEKK konteksten — ALLTID, deterministisk: den delte konteksten sovner når
    // forrige økts audiosesjon deaktiveres. Økt nr. 2+ var ellers PERFEKT i loggen
    // (tilkoblet, mottok lyd) men helt stum — enqueue mot en sovende kontekst
    // feiler lydløst. finish() suspenderer eksplisitt; her gjenopplives den.
    await this.audioContext.resume().catch(() => {})
    console.log(`Live: audiokontekst ${this.audioContext.state}`)
    this.queueNode = this.audioContext.createBufferQueueSource()
    this.queueNode.connect(this.audioContext.destination)
    // start(0, 0), IKKE start(): react-native-audio-api 0.13.2 har default offset=-1
    // som sentinel og validerer så offset >= 0 — argumentløst kall kaster alltid
    // RangeError. Eksplisitt 0-offset er semantisk likt og passerer valideringen.
    this.queueNode.start(0, 0)

    // Primærvei (iOS device): ekko-kansellert mikrofon (AmpexMicModule.swift,
    // Apples VoiceProcessingIO — samme som Gemini-appen). Hennes stemme trekkes
    // fra i HARDWARE → ingen selv-avbrytelse, full dupleks, naturlig barge-in.
    // Chunkene er ferdig PCM16@16kHz base64 — rett i realtimeInput.
    //
    // MERK at dette er et FORSØK, ikke en tilgjengelighetssjekk.
    // `isEchoCancelledMicAvailable` sier bare at modulen er KOMPILERT INN, ikke
    // at den virker her: på simulatoren er den kompilert inn, men
    // `setVoiceProcessingEnabled(true)` kaster fordi VoiceProcessingIO ikke
    // finnes der. Før 2026-08-20 drepte det hele økten med «Fikk ikke startet
    // mikrofonen» — fallbacken under, som står der NETTOPP for simulator, ble
    // aldri nådd. Nå faller vi gjennom på enhver feil, ikke bare på fravær.
    if (isEchoCancelledMicAvailable) {
      try {
        this.micSub = await startEchoCancelledMic(({ base64, rms }) => {
          if (this.ended || this.ws?.readyState !== WebSocket.OPEN) return
          emitVoiceLevel({ level: rms, modelSpeaking: Date.now() < this.playbackEndsAtMs })
          this.ws.send(
            JSON.stringify({
              realtimeInput: { audio: { mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data: base64 } },
            }),
          )
        })
        console.log('Live: ekko-kansellert mikrofon aktiv')
        return
      } catch (e) {
        // Ingen AEC her — modellen vil høre seg selv. Fallbacken under demper det
        // ved å holde mikrofonen døv mens hun snakker. Dårligere, men i live.
        console.warn('Live: ekko-kansellert mikrofon utilgjengelig, faller tilbake:', e)
        this.micSub?.remove()
        this.micSub = null
      }
    }
    {
      // Fallback (simulator/Android, og enhver enhet der VoiceProcessingIO
      // svikter): bibliotekets recorder har ingen
      // AEC — mikrofonen holdes DØV mens modellen snakker, ellers avbryter hennes
      // egen høyttalerlyd henne (felt-målt 0.21–0.26 RMS, samme område som rop).
      const recorder = new AudioRecorder()
      this.recorder = recorder
      recorder.onAudioReady(
        { sampleRate: INPUT_SAMPLE_RATE, bufferLength: INPUT_CHUNK_FRAMES, channelCount: 1 },
        ({ buffer }) => {
          if (this.ended || this.ws?.readyState !== WebSocket.OPEN) return
          const samples = buffer.getChannelData(0)
          const now = Date.now()
          let sum = 0
          for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
          const rms = Math.sqrt(sum / samples.length)
          emitVoiceLevel({ level: rms, modelSpeaking: now < this.playbackEndsAtMs })
          if (now < this.playbackEndsAtMs + 200) return
          const base64 = floatToPcm16Base64(samples)
          this.ws.send(
            JSON.stringify({
              realtimeInput: { audio: { mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`, data: base64 } },
            }),
          )
        },
      )
      recorder.onError(e => console.warn('Live: opptaksfeil:', e))
      await recorder.start()
    }
  }

  private handleServerMessage(msg: Record<string, any>): void {
    if (msg.setupComplete) {
      this.gotSetupComplete = true
      console.log('Live: setup OK — starter mikrofon')
      this.callbacks.onStage('active')
      this.startAudio()
        .then(() => console.log('Live: mikrofon streamer'))
        .catch(e => {
          console.warn('Live: mikrofonstart feilet:', e)
          this.finish('Fikk ikke startet mikrofonen.')
        })
      // Modellen venter ELLERS stille på at brukeren snakker først — uten en hørbar
      // hilsen virker økten død og brukeren rister den i senk. Tekst-turn her gir
      // umiddelbar talerespons og beviser samtidig hele lydkjeden ned til høyttaler.
      this.ws?.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: this.resumedConversation
                      ? 'Brukeren tok opp igjen samtalen deres. IKKE hils på nytt — fortsett der dere slapp med én kort setning.'
                      : `Økten har akkurat startet (klokka er ${new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}). ` +
                        'Hils KORT og rolig med riktig tid på døgnet — «God morgen», «God ettermiddag», «God kveld» — pluss ' +
                        'maks en HALV setning til (navnet, eller en forfalt påminnelse hvis det finnes). Ikke ramse opp hva du ' +
                        'kan, ikke lange tilbud — bare vær klar. Eksempel: «God morgen, Tormod.»',
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        }),
      )
      return
    }

    const content = msg.serverContent
    if (content) {
      if (content.interrupted) {
        // Barge-in: brukeren snakket i munnen på modellen — kutt avspillingen NÅ.
        // (Logges også for å skille ekte/falske avbrytelser fra avspillingshakk:
        // hyppige avbrudd her mens brukeren er STILLE = mikrofonen hører høyttaleren.)
        console.log('Live: avbrutt (barge-in)')
        this.pendingFloats = []
        this.pendingSamples = 0
        this.primed = false
        this.playbackEndsAtMs = 0
        this.queueNode?.clearBuffers()
      }
      const parts: Record<string, any>[] = content.modelTurn?.parts ?? []
      for (const part of parts) {
        const inline = part.inlineData
        if (inline?.data && typeof inline.data === 'string') {
          if (!this.receivedModelAudio) {
            this.receivedModelAudio = true
            console.log('Live: mottar lyd fra modellen')
          }
          this.enqueueAudio(inline.data)
        }
      }
      if (content.turnComplete) {
        // Kort ytring som aldri nådde buffer-terskelen: spill det vi har. Og
        // nullstill primingen så NESTE tur også får jitter-pute foran seg.
        this.flushPending()
        this.primed = false
      }
    }

    if (msg.toolCall?.functionCalls) {
      this.handleToolCalls(msg.toolCall.functionCalls)
    }

    // Fortløpende gjenopptagelses-handles — nyeste vinner, brukes av NESTE økt.
    const update = msg.sessionResumptionUpdate
    if (update?.resumable && typeof update.newHandle === 'string' && update.newHandle) {
      lastResumeHandle = { handle: update.newHandle, at: Date.now() }
    }
  }

  private static readonly JITTER_BUFFER_MS = 450
  private static readonly COALESCE_MS = 250

  private enqueueAudio(base64: string): void {
    const samples = pcm16Base64ToFloat32(base64)
    if (samples.length === 0) return
    this.pendingFloats.push(samples)
    this.pendingSamples += samples.length
    const pendingMs = this.pendingSamples / (OUTPUT_SAMPLE_RATE / 1000)
    if (!this.primed) {
      if (pendingMs < LiveSession.JITTER_BUFFER_MS) return
      this.primed = true
    } else if (pendingMs < LiveSession.COALESCE_MS) {
      return
    }
    this.flushPending()
  }

  private flushPending(): void {
    if (this.ended || !this.audioContext || !this.queueNode || this.pendingSamples === 0) return
    const merged = new Float32Array(this.pendingSamples)
    let offset = 0
    for (const chunk of this.pendingFloats) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingFloats = []
    this.pendingSamples = 0
    try {
      const buffer = this.audioContext.createBuffer(1, merged.length, OUTPUT_SAMPLE_RATE)
      buffer.copyToChannel(merged, 0)
      this.queueNode.enqueueBuffer(buffer)
      // Bokfør når avspillingen (samlet kø) er ferdig — styrer mikrofon-gaten over.
      const durationMs = merged.length / (OUTPUT_SAMPLE_RATE / 1000)
      this.playbackEndsAtMs = Math.max(Date.now(), this.playbackEndsAtMs) + durationMs
    } catch (e) {
      console.warn('Live: klarte ikke legge lyd i kø:', e)
    }
  }

  private async handleToolCalls(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]): Promise<void> {
    const responses = []
    for (const call of calls) {
      const response = await this.runTool(call.name ?? '', call.args ?? {})
      responses.push({ id: call.id, name: call.name, response })
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
    }
  }

  /** Felles oppslag + medlemssjekk for ordre-verktøyene. */
  private async resolveOrder(
    args: Record<string, unknown>,
  ): Promise<{ order: Order; n: number; member: boolean; user: CurrentUser } | { feil: string; funnet?: boolean }> {
    const n = typeof args.ordrenummer === 'number' ? args.ordrenummer : NaN
    if (!Number.isInteger(n)) return { feil: 'Ordrenummer mangler eller er ikke et tall.' }
    const user = await getCurrentUser()
    if (!user) return { feil: 'Ingen innlogget bruker.' }
    const order = await findByOrderNumber(n)
    if (!order) return { feil: `Fant ingen ordre med nummer ${n}.`, funnet: false }
    return { order, n, member: await isOrderMember(order, user.id), user }
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      if (name === 'finn_ordre') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        const { order, n, member, user } = resolved
        const members = await getOrderMembers(order.id)
        const memberNames = members.map(m => m.userName || 'ukjent navn')
        if (!member) {
          // Visittkortet — og IKKE mer. Innhold (kunde, adresse, beskrivelse,
          // dokumentasjon) er forbeholdt de som er med på ordren.
          return {
            funnet: true,
            du_er_med: false,
            ordrenummer: n,
            tittel: order.title,
            medlemmer: memberNames,
            beskjed: 'Brukeren er IKKE med på ordren — del kun dette, og tilby bli_med_pa_ordre for full tilgang.',
          }
        }
        this.callbacks.onOrderFound?.(order)
        return {
          funnet: true,
          du_er_med: true,
          ordrenummer: n,
          tittel: order.title,
          status: orderStatusLabel[order.status] ?? order.status,
          kunde: order.customerName ?? undefined,
          adresse: order.address ?? undefined,
          beskrivelse: order.description ?? undefined,
          medlemmer: memberNames.length > 0 ? memberNames : [user.name || 'deg'],
          beskjed: 'Appen viser en snarvei til ordren nå.',
        }
      }
      if (name === 'ordre_dokumentasjon') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) {
          return { feil: 'Brukeren er ikke med på denne ordren og kan ikke se dokumentasjonen. Tilby bli_med_pa_ordre.' }
        }
        const [docs, scans, templates] = await Promise.all([
          database.get<OrderDocument>('order_documents').query(Q.where('order_id', resolved.order.id)).fetch(),
          database.get<OrderScan>('order_scans').query(Q.where('order_id', resolved.order.id)).fetch(),
          database.get<FormTemplate>('form_templates').query().fetch(),
        ])
        // Malnavn må slås opp i BEGGE kilder. `form_templates` inneholder kun
        // firmaets egne; et dokument fylt fra en Ampex-mal har id 'ampex.*' og
        // ble tidligere rapportert som «Ukjent skjema» — altså alle
        // sluttkontroller og samsvarserklæringer. Katalogen dekker begge.
        const templateTitle = new Map<string, string>([
          ...this.templateCatalog.map(t => [t.id, t.name] as [string, string]),
          ...templates.map(t => [t.id, t.title] as [string, string]),
        ])
        return {
          skjemaer: docs.map(d => ({
            tittel: templateTitle.get(d.templateId) ?? 'Ukjent skjema',
            status: d.status === 'fullfort' ? 'fullført' : 'utkast',
          })),
          skanninger: scans.map(s => ({ tittel: s.title, type: s.kind })),
          beskjed:
            docs.length === 0 && scans.length === 0
              ? 'Ingen dokumentasjon på ordren ennå — si det ærlig.'
              : 'Dette er ALT som finnes — ikke legg til noe selv.',
        }
      }
      if (name === 'bli_med_pa_ordre') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (resolved.member) return { ok: true, beskjed: 'Brukeren er allerede med på ordren.' }
        await addOrderMember(resolved.order.id, resolved.user)
        return { ok: true, beskjed: `Brukeren er nå med på ordre ${resolved.n} og har full tilgang.` }
      }
      if (name === 'opprett_ordre') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        if (!tittel) return { feil: 'Tittel mangler.' }
        const created = await database.write(async () =>
          database.get<Order>('orders').create(o => {
            o.title = tittel
            o.customerName = typeof args.kundenavn === 'string' && args.kundenavn.trim() ? args.kundenavn.trim() : null
            o.address = typeof args.adresse === 'string' && args.adresse.trim() ? args.adresse.trim() : null
            o.description = typeof args.beskrivelse === 'string' && args.beskrivelse.trim() ? args.beskrivelse.trim() : null
            o.status = 'mottatt'
            o.assignedTo = user.id
          }),
        )
        await addOrderMember(created.id, user)
        syncQuietly() // ordrenummer settes av server-trigger ved synk
        // Guide-adferd: ÅPNE ordren direkte i stedet for å tilby en snarvei.
        this.callbacks.onNavigate?.(`/(app)/ordre/${created.id}`)
        return {
          opprettet: true,
          tittel,
          beskjed:
            'Ordren er opprettet, brukeren er med på den, og den vises på skjermen nå. Ordrenummer kommer ved synk — ikke finn på ett. Ikke start et intervju — spør kun hvis noe viktig åpenbart mangler.',
        }
      }
      if (name === 'prosjekt_status') {
        const navn = typeof args.prosjektnavn === 'string' ? args.prosjektnavn.trim() : ''
        let project: Project | null = null
        if (navn) {
          const match = await resolveProjectByName(navn)
          if (match.kind === 'none') {
            return { feil: `Fant ikke noe prosjekt som ligner på «${navn}». Bruk mine_prosjekter for å se hva som finnes.` }
          }
          if (match.kind === 'ambiguous') {
            return { flertydig: true, kandidater: match.candidates.map(p => p.name), beskjed: 'Flere prosjekter matcher — spør brukeren hvilket de mener.' }
          }
          project = match.project
        } else if (this.routeContext.screen === 'prosjekt') {
          project = await database.get<Project>('projects').find(this.routeContext.projectId).catch(() => null)
        }
        if (!project) {
          return { feil: 'Ingen prosjektnavn oppgitt og brukeren står ikke i et prosjekt — spør hvilket prosjekt de mener.' }
        }
        const rooms = await database.get<Room>('rooms').query(Q.where('project_id', project.id)).fetch()
        return {
          prosjekt: project.name,
          kunde: project.customerName ?? undefined,
          status: project.status,
          fremdrift: progressToSpokenContext(computeProjectProgress(rooms)),
        }
      }
      if (name === 'varmekabel_cc') {
        const areal = typeof args.areal_m2 === 'number' ? args.areal_m2 : NaN
        const lengde = typeof args.kabellengde_m === 'number' ? args.kabellengde_m : NaN
        if (!(areal > 0) || !(lengde > 0)) return { feil: 'Areal og kabellengde må være positive tall.' }
        const cc = (areal * 100) / lengde
        const kabelW = typeof args.kabel_W === 'number' && args.kabel_W > 0 ? args.kabel_W : null
        return {
          cc_cm: Math.round(cc * 10) / 10,
          ...(kabelW ? { effekt_W_per_m2: Math.round(kabelW / areal), effekt_W_per_m: Math.round((kabelW / lengde) * 10) / 10 } : {}),
          veiledende_effektbehov: VARMEKABEL_VEILEDNING,
          beskjed:
            'c/c = areal × 100 / kabellengde. Rund av NEDOVER til nærmeste hele/halve cm i praksis — produsentens leggeanvisning (min/maks c/c og maks W/m for gulvtypen) gjelder. Sjekk W/m² mot veiledningsspennet for rommet.',
        }
      }
      if (name === 'varmekabel_ohm') {
        const W = typeof args.kabel_W === 'number' ? args.kabel_W : NaN
        if (!(W > 0)) return { feil: 'Merkeeffekt må være et positivt tall.' }
        const U = typeof args.spenning_V === 'number' && args.spenning_V > 0 ? args.spenning_V : 230
        const nominal = (U * U) / W
        return {
          nominell_ohm: Math.round(nominal * 10) / 10,
          toleranseomraade_ohm: `${Math.round(nominal * 0.95 * 10) / 10} – ${Math.round(nominal * 1.1 * 10) / 10}`,
          forutsetninger: `R = U²/P ved ${U}V, vanlig produsenttoleranse −5/+10 % — sjekk databladet`,
          beskjed: 'Mål også isolasjonsresistans (megging) før og etter støp — ohmsjekken alene fanger ikke skadet isolasjon.',
        }
      }
      if (name === 'spenningsfall') {
        const L = typeof args.lengde_m === 'number' ? args.lengde_m : NaN
        const I = typeof args.stroem_A === 'number' ? args.stroem_A : NaN
        const A = typeof args.tverrsnitt_mm2 === 'number' ? args.tverrsnitt_mm2 : NaN
        if (!(L > 0) || !(I > 0) || !(A > 0)) return { feil: 'Lengde, strøm og tverrsnitt må være positive tall.' }
        return {
          ...spenningsfall({
            lengde_m: L,
            stroem_A: I,
            tverrsnitt_mm2: A,
            system: args.system === 'trefase' ? 'trefase' : 'enfase',
            spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
            cosphi: typeof args.cosphi === 'number' ? args.cosphi : undefined,
            materiale: args.materiale === 'al' ? 'al' : 'cu',
            ledertemp_C: typeof args.ledertemp_C === 'number' ? args.ledertemp_C : undefined,
          }),
          beskjed: 'NEK 400 anbefaler ≤ 4 % totalt fra tilknytning til forbruk (veiledende) — vurder mot resten av kursen.',
        }
      }
      if (name === 'last_stroem') {
        const kW = typeof args.kW === 'number' ? args.kW : NaN
        if (!(kW > 0)) return { feil: 'kW må være et positivt tall.' }
        return lastStroem({
          kW,
          spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
          cosphi: typeof args.cosphi === 'number' ? args.cosphi : undefined,
          virkningsgrad: typeof args.virkningsgrad === 'number' ? args.virkningsgrad : undefined,
          system: args.system === 'enfase' ? 'enfase' : 'trefase',
        })
      }
      if (name === 'vern_karakteristikk') {
        const In = typeof args.In === 'number' ? args.In : NaN
        if (!(In > 0)) return { feil: 'In må være et positivt tall.' }
        return vernKarakteristikk(typeof args.karakteristikk === 'string' ? args.karakteristikk : '', In)
      }
      if (name === 'koordiner_kabel_vern') {
        const Ib = typeof args.belastning_Ib_A === 'number' ? args.belastning_Ib_A : NaN
        const In = typeof args.vern_In_A === 'number' ? args.vern_In_A : NaN
        const Iz = typeof args.kabel_Iz_A === 'number' ? args.kabel_Iz_A : NaN
        if (!(Ib > 0) || !(In > 0) || !(Iz > 0)) return { feil: 'Ib, In og Iz må være positive tall.' }
        return koordinerKabelVern({ belastning_Ib_A: Ib, vern_In_A: In, kabel_Iz_A: Iz })
      }
      if (name === 'kortslutning_ende') {
        const ik = typeof args.ik_start_A === 'number' ? args.ik_start_A : NaN
        const L = typeof args.lengde_m === 'number' ? args.lengde_m : NaN
        const A = typeof args.tverrsnitt_mm2 === 'number' ? args.tverrsnitt_mm2 : NaN
        if (!(ik > 0) || !(L > 0) || !(A > 0)) return { feil: 'Ik, lengde og tverrsnitt må være positive tall.' }
        return kortslutningEnde({
          ik_start_A: ik,
          lengde_m: L,
          tverrsnitt_mm2: A,
          spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
          materiale: args.materiale === 'al' ? 'al' : 'cu',
        })
      }
      if (name === 'regn_ut') {
        return regnUt(typeof args.uttrykk === 'string' ? args.uttrykk : '')
      }
      if (name === 'husk_notat') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const innhold = typeof args.innhold === 'string' ? args.innhold.trim() : ''
        if (!innhold) return { feil: 'Innhold mangler.' }
        await database.write(async () => {
          await database.get<AssistantNote>('assistant_notes').create(n => {
            n.userId = user.id
            n.content = innhold
          })
        })
        return { ok: true, beskjed: 'Husket — gjelder fra neste samtale også.' }
      }
      if (name === 'glem_notat') {
        const id = typeof args.id === 'string' ? args.id : ''
        const note = await database.get<AssistantNote>('assistant_notes').find(id).catch(() => null)
        if (!note) return { feil: 'Fant ikke notatet.' }
        await database.write(async () => {
          await note.destroyPermanently()
        })
        return { ok: true }
      }
      if (name === 'opprett_paaminnelse') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        const dato = typeof args.dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dato) ? args.dato : null
        if (!tittel || !dato) return { feil: 'Tittel eller dato mangler/ugyldig.' }
        const tid = typeof args.tid === 'string' && /^\d{2}:\d{2}$/.test(args.tid) ? args.tid : '07:00'
        const dueAt = new Date(`${dato}T${tid}:00`)
        let orderId: string | null = null
        if (typeof args.ordrenummer === 'number') {
          const order = await findByOrderNumber(args.ordrenummer)
          orderId = order?.id ?? null
        }
        await database.write(async () => {
          await database.get<Reminder>('reminders').create(r => {
            r.userId = user.id
            r.title = tittel
            r.dueAt = dueAt
            r.orderId = orderId
            r.note = typeof args.notat === 'string' && args.notat.trim() ? args.notat.trim() : null
            r.status = 'open'
          })
        })
        return { ok: true, beskjed: `Påminnelse «${tittel}» satt til ${dato} kl. ${tid}.` }
      }
      if (name === 'mine_paaminnelser') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const reminders = await database
          .get<Reminder>('reminders')
          .query(Q.where('user_id', user.id), Q.where('status', 'open'), Q.sortBy('due_at', Q.asc))
          .fetch()
        return {
          paaminnelser: reminders.map(r => ({
            id: r.id,
            tittel: r.title,
            naar: r.dueAt.toISOString().slice(0, 16).replace('T', ' kl. '),
            notat: r.note ?? undefined,
          })),
        }
      }
      if (name === 'paaminnelse_utfort') {
        const id = typeof args.id === 'string' ? args.id : ''
        const reminder = await database.get<Reminder>('reminders').find(id).catch(() => null)
        if (!reminder) return { feil: 'Fant ikke påminnelsen.' }
        await database.write(async () => {
          await reminder.update(r => { r.status = 'done' })
        })
        return { ok: true }
      }
      if (name === 'sjekk_vaer') {
        const sted = typeof args.sted === 'string' ? args.sted.trim() : ''
        if (!sted) return { feil: 'Sted mangler.' }
        const result = await getForecast(sted)
        if (!result.ok) return { feil: result.feil }
        return {
          sted: result.sted,
          varsel: result.dager,
          beskjed: 'Temperaturer i °C, nedbør i mm per dag. Vurder selv mot arbeidet (f.eks. varmekabler krever normalt tørt og ikke sterk kulde) — og si tallene kort.',
        }
      }
      if (name === 'legg_til_medlem') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren må selv være med på ordren for å legge til andre.' }
        const navn = typeof args.navn === 'string' ? args.navn.trim() : ''
        if (!navn) return { feil: 'Navn mangler.' }
        const match = await findColleagueByName(navn)
        if (match.kind === 'offline') return { feil: 'Får ikke slått opp kolleger uten nett akkurat nå.' }
        if (match.kind === 'none') return { feil: `Fant ingen kollega som ligner på «${navn}».` }
        if (match.kind === 'ambiguous') {
          return { flertydig: true, kandidater: match.candidates, beskjed: 'Flere kolleger matcher — spør hvem brukeren mener.' }
        }
        await addOrderMember(resolved.order.id, match.colleague)
        return { ok: true, beskjed: `${match.colleague.name} er lagt til på ordre ${resolved.n}.` }
      }
      if (name === 'vis_ordre') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — kan ikke åpne den. Tilby bli_med_pa_ordre.' }
        this.callbacks.onNavigate?.(`/(app)/ordre/${resolved.order.id}`)
        return { ok: true, beskjed: `Ordre ${resolved.n} vises på skjermen nå.` }
      }
      if (name === 'oppdater_ordre') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — kan ikke endre den.' }
        const scheduled =
          typeof args.planlagt_dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.planlagt_dato)
            ? new Date(args.planlagt_dato)
            : null
        const endret: string[] = []
        await database.write(async () => {
          await resolved.order.update(o => {
            if (typeof args.beskrivelse === 'string' && args.beskrivelse.trim()) { o.description = args.beskrivelse.trim(); endret.push('beskrivelse') }
            if (typeof args.kundenavn === 'string' && args.kundenavn.trim()) { o.customerName = args.kundenavn.trim(); endret.push('kunde') }
            if (typeof args.telefon === 'string' && args.telefon.trim()) { o.customerPhone = args.telefon.trim(); endret.push('telefon') }
            if (typeof args.adresse === 'string' && args.adresse.trim()) { o.address = args.adresse.trim(); endret.push('adresse') }
            if (scheduled) {
              o.scheduledAt = scheduled
              if (o.status === 'mottatt') o.status = 'planlagt' // samme regel som ordre/ny.tsx
              endret.push('planlagt dato')
            }
          })
        })
        if (endret.length === 0) return { feil: 'Ingen gyldige felter å oppdatere.' }
        syncQuietly()
        return { ok: true, oppdatert: endret }
      }
      if (name === 'start_skjema' || name === 'fyll_skjemafelt' || name === 'vis_skjema') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) {
          return { feil: 'Brukeren er ikke med på ordren — dokumentasjon krever medlemskap. Tilby bli_med_pa_ordre.' }
        }
        const template = typeof args.mal_id === 'string' ? await resolveTemplate(args.mal_id) : undefined
        if (!template) {
          return { feil: `Ukjent mal-id. Gyldige: ${this.templateCatalog.map(t => t.id).join(', ')}.` }
        }
        if (name === 'start_skjema') {
          const state = await startVoiceFill(resolved.order, template)
          return { mal: template.name, ...state }
        }
        if (name === 'fyll_skjemafelt') {
          const entries = Array.isArray(args.felter)
            ? (args.felter as VoiceFillEntry[]).filter(
                e => e && typeof e.key === 'string' && typeof e.verdi === 'string',
              )
            : []
          if (entries.length === 0) return { feil: 'Ingen gyldige felter å fylle.' }
          const result = await applyVoiceFill(resolved.order, template, entries)
          return { ...result }
        }
        this.callbacks.onOpenForm?.(resolved.order.id, template.id)
        return { ok: true, beskjed: 'Skjemaet vises på skjermen nå — be brukeren se over, rette og fullføre selv.' }
      }
      if (name === 'sok_vare') {
        return sokVareVerktoy(typeof args.sok === 'string' ? args.sok : '')
      }
      if (name === 'ta_ut_materiell') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        return taUtMateriellVerktoy(args as { vare?: string; antall?: number; lokasjon?: string }, user.id)
      }
      if (name === 'legg_til_materiell') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        // Samme sperre som resten: materiell føres kun på ordrer brukeren er med på.
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren. Tilby bli_med_pa_ordre først.' }
        return leggTilMateriellVerktoy(args as { vare?: string; antall?: number }, resolved.order.id, resolved.n)
      }
      if (name === 'nytt_tilbud') {
        return nyttTilbudVerktoy(args as { tittel?: string; kunde?: string; gyldig_dager?: number })
      }
      if (name === 'legg_til_tilbudslinje') {
        return tilbudslinjeVerktoy(args as Parameters<typeof tilbudslinjeVerktoy>[0])
      }
      if (name === 'tilbudssum') {
        return tilbudssumVerktoy(args.tilbudsnummer)
      }
      if (name === 'vis_tilbud') {
        const n = typeof args.tilbudsnummer === 'number' ? args.tilbudsnummer : NaN
        if (!Number.isInteger(n)) return { feil: 'Tilbudsnummer mangler.' }
        const [q] = await database.get<Quote>('quotes').query(Q.where('quote_number', n)).fetch()
        if (!q) return { feil: `Fant ingen tilbud med nummer ${n}.` }
        this.callbacks.onNavigate?.(`/(app)/tilbud/${q.id}`)
        return { ok: true, beskjed: `Tilbud ${n} vises på skjermen nå.` }
      }
      if (name === 'foer_timer') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — timer føres kun på egne ordrer.' }
        const hours = typeof args.timer === 'number' ? args.timer : NaN
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { feil: 'Antall timer må være mellom 0 og 24.' }
        const day = typeof args.dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dato) ? new Date(args.dato) : new Date()
        day.setHours(0, 0, 0, 0)
        // Uten aktivitet har timene ingen pris, og linja faller ut av
        // fakturagrunnlaget som «mangler pris». Standardaktiviteten er montasje,
        // fordi det er det en elektriker gjør mesteparten av dagen.
        const aktivitet = typeof args.aktivitet === 'string' && args.aktivitet.trim()
          ? await finnAktivitet(args.aktivitet)
          : await finnAktivitet('Montasje')
        await database.write(async () => {
          await database.get<TimeEntry>('time_entries').create(e => {
            e.orderId = resolved.order.id
            e.userId = resolved.user.id
            e.userName = resolved.user.name
            e.date = day
            e.hours = hours
            e.note = typeof args.notat === 'string' && args.notat.trim() ? args.notat.trim() : null
            e.activityId = aktivitet?.id ?? null
          })
        })
        const fikkNotat = typeof args.notat === 'string' && !!args.notat.trim()
        return {
          ok: true,
          beskjed: `Førte ${hours} timer på ordre ${resolved.n}${aktivitet ? ` som ${aktivitet.name.toLowerCase()}` : ''}.`,
          ...(aktivitet ? {} : { advarsel: 'Fant ingen aktivitet — timene får ingen pris før aktivitet er satt.' }),
          // Kommentaren står på FAKTURAEN til kunden og er ofte det eneste hun
          // leser. Montøren tilbyr den aldri selv — så assistenten spør, ÉN gang,
          // og bare når den mangler.
          ...(fikkNotat ? {} : {
            oppfolging: 'Timene er ført uten kommentar. Spør kort om hva som ble gjort, og bruk utfyll_timenotat. Godtar de ikke, la det ligge — ikke mas.',
          }),
        }
      }
      if (name === 'utfyll_timenotat') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        const notat = typeof args.notat === 'string' ? args.notat.trim() : ''
        if (!notat) return { feil: 'Tom kommentar — ingenting å legge til.' }

        /*
         * Bare DIN egen føring, bare på den ordren, bare i dag, og bare hvis den
         * ikke alt har en kommentar.
         *
         * Uten de fire grensene kunne assistenten skrive over en kollegas
         * beskrivelse av hva HAN gjorde — og den teksten står på fakturaen til
         * kunden. En kommentar som er feil er verre enn ingen kommentar.
         */
        const idag = new Date(); idag.setHours(0, 0, 0, 0)
        const mine = await database.get<TimeEntry>('time_entries')
          .query(
            Q.where('order_id', resolved.order.id),
            Q.where('user_id', resolved.user.id),
            Q.where('date', Q.gte(idag.getTime())),
            Q.sortBy('created_at', Q.desc),
          ).fetch()
        const foring = mine.find(e => !e.note)
        if (!foring) {
          return { feil: 'Fant ingen timeføring fra deg på den ordren i dag uten kommentar fra før. Før timene først.' }
        }
        await database.write(async () => { await foring.update(e => { e.note = notat }) })
        syncQuietly()
        return { ok: true, beskjed: `La kommentaren på timene: «${notat}»` }
      }
      if (name === 'foresla_tillegg') {
        const resolved = await this.resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — tillegg registreres kun på egne ordrer.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        if (!tittel) return { feil: 'Tillegget må ha en kort tittel.' }
        const prising: TilleggPrising = args.prising === 'fastpris' ? 'fastpris' : 'medgatt'
        const pris = typeof args.pris === 'number' && args.pris > 0 ? args.pris : null
        if (prising === 'fastpris' && pris == null) {
          return { feil: 'Fastpris krever et beløp. Spør om prisen, eller registrer som etter medgått.' }
        }
        await database.write(async () => {
          await database.get<OrderExtra>('order_extras').create(x => {
            x.orderId = resolved.order.id
            x.title = tittel
            x.description = typeof args.beskrivelse === 'string' && args.beskrivelse.trim() ? args.beskrivelse.trim() : null
            x.pricing = prising
            x.price = prising === 'fastpris' ? pris : null
            x.vatType = 'hoy'
            // ALLTID foreslått. AI-en kan ikke godkjenne på kundens vegne —
            // det er nettopp godkjenningen som er verdien i denne raden.
            x.status = 'foreslatt'
          })
        })
        return {
          ok: true,
          beskjed: `Registrerte «${tittel}» som tilleggsarbeid på ordre ${resolved.n}, foreslått.`,
          maa_godkjennes: 'Si til brukeren at tillegget må godkjennes av kunden før det kan faktureres, '
            + 'og at navnet på den som sier ja må registreres på skjermen.',
        }
      }
      if (name === 'mine_timer') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const since = Date.now() - 7 * 24 * 60 * 60 * 1000
        const entries = await database
          .get<TimeEntry>('time_entries')
          .query(Q.where('user_id', user.id), Q.where('date', Q.gte(since)))
          .fetch()
        const orders = await database.get<Order>('orders').query().fetch()
        const orderName = new Map(orders.map(o => [o.id, o.orderNumber ? `ordre ${o.orderNumber}` : o.title]))
        return {
          totalt_timer: entries.reduce((sum, e) => sum + e.hours, 0),
          foeringer: entries.map(e => ({
            ordre: orderName.get(e.orderId) ?? 'ukjent ordre',
            dato: e.date.toISOString().slice(0, 10),
            timer: e.hours,
            notat: e.note ?? undefined,
          })),
        }
      }
      if (name === 'mine_prosjekter') {
        const projects = await database.get<Project>('projects').query().fetch()
        return {
          prosjekter: projects.map(p => ({ navn: p.name, kunde: p.customerName ?? undefined, status: p.status })),
        }
      }
      if (name === 'mine_ordrer') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const orders = await listMyOrders(user.id)
        return {
          ordrer: orders.map(o => ({
            ordrenummer: o.orderNumber ?? undefined,
            tittel: o.title,
            kunde: o.customerName ?? undefined,
            status: orderStatusLabel[o.status] ?? o.status,
          })),
          beskjed: 'Dette er kun ordrene brukeren selv er med på.',
        }
      }
      return { feil: `Ukjent verktøy: ${name}` }
    } catch (e) {
      return { feil: e instanceof Error ? e.message : 'ukjent feil' }
    }
  }

  private finish(error?: string): void {
    if (this.ended) return
    this.ended = true
    // Alle øktdødsfall skal ha en logglinje — tause avslutninger kostet oss timer.
    console.log(`Live: økt avsluttet${error ? ` (${error})` : ''}`)
    const g = globalThis as { __ampexLiveSession?: LiveSession }
    if (g.__ampexLiveSession === this) g.__ampexLiveSession = undefined
    this.pendingFloats = []
    this.pendingSamples = 0
    emitVoiceLevel({ level: 0, modelSpeaking: false })

    try {
      this.micSub?.remove()
    } catch {}
    this.micSub = null
    try {
      this.recorder?.clearOnAudioReady()
      this.recorder?.stop()
    } catch {}
    this.recorder = null

    // Konteksten er DELT og lukkes aldri (se getSharedAudioContext) — kun økt-
    // noden stoppes/kobles fra. Avbrudds-observasjon og reclaim slås av så
    // biblioteket ikke fortsetter å kjempe om sesjonen etter at vi ga den fra oss.
    try {
      this.queueNode?.stop(0)
      ;(this.queueNode as unknown as { disconnect?: () => void })?.disconnect?.()
    } catch {}
    // Eksplisitt suspend → neste økts resume() er en deterministisk vekking i
    // stedet for gjetting på state-flagget (som kan være usynkront med native).
    void this.audioContext?.suspend().catch(() => {})
    this.queueNode = null
    this.audioContext = null
    try {
      AudioManager.observeAudioInterruptions(false)
      AudioManager.activelyReclaimSession(false)
    } catch {}
    void queueAudioSessionActivity(false)

    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close()
      } catch {}
    }

    this.callbacks.onEnd(error)
  }
}

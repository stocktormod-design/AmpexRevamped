// AI-en i læretid — samtalen som skriver loggen, og utspørringen etterpå.
//
//   se       leser bildene ÉN gang: typeskilt, merking, tekst på tegninger
//   samtale  neste replikk i samtalen om dagen hans (lib/laeretid/samtale.ts)
//   skriv    loggen, skrevet av samtalen, notatene og instruksen
//   lag      quizspørsmål av det han sa (lib/laeretid/quiz.ts)
//   vurder   holder svaret hans?
//
// ── Hva som skjer her, og hva som IKKE skjer her ────────────────────────────
//
// Modellen formulerer og leser. HVILKE spørsmål samtalen må innom bestemmes av
// klienten (`gjennomgang()`), og det modellen svarer vaskes der før noe lagres:
// en NEK-påstand erstattes med en ren henvisning (`paastaarNek()`), et
// punktnummer som ikke står i kartet slettes. For quizen gjelder det samme: Den bestemmer ikke hvilke regler som
// gjelder — at runde 2 aldri tar et kryss, at det kommer ett dytt om dagen, at
// en del-id må finnes i læreplanen — det er ren logikk i lib/laeretid/quiz.ts,
// selvtestet i `npm run verify:laeretid`, og klienten vasker det som kommer
// herfra med `vaskForslag()` før noe lagres.
//
// Funksjonen er en TYNN proxy, som ai-voice: den lagrer ingenting. Loggen,
// målene og NEK-kartet sendes sammensatt fra klienten, som har dem lokalt
// (regel 2). Svarene hans går gjennom modellen og tilbake — aldri til en tabell
// noen andre kan lese. Se «Det ærlige løftet om quizsvarene» i docs/LAERLING.md.
//
// ── Modell ──────────────────────────────────────────────────────────────────
//
// Pro skriver loggen: den holder seg tettest til det han sa, og det skjer én
// gang per logg. Quiz og retting går på Flash: 28.09.2026 rettet Flash, Pro og
// Flash-Lite de samme seks svarene (tre gode, tre feil i kjernen) — alle 6/6 —
// og Flash-quizen fulgte reglene like godt som Pro, til en femtedel av prisen.
// Flash-Lite brøt reglene i quizen (gjengi i stedet for hvorfor, tema han ikke
// nevnte). Halvriktige svar er IKKE testet ennå — det er der modellene skilles.
//
// Modellnavnet er IKKE hardkodet. 27.09.2026 svarte Google 404 på
// gemini-2.5-flash («no longer available to new users») — et fast navn råtner i
// stillhet. Uten LAERETID_MODELL spør funksjonen Google hvilke modeller nøkkelen
// har, og tar nyeste pro, ellers nyeste flash. Vil du låse den:
//   supabase secrets set LAERETID_MODELL=<navn>
//
// Nøkkelen er den samme GEMINI_API_KEY som ai-voice bruker, og den MÅ være
// betalt tier — gratis-tier lar Google trene på inndata.
//
//   supabase functions deploy laeretid-ai
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

const MODELL = Deno.env.get('LAERETID_MODELL') ?? ''
/** Samtalen er mange korte turer — der teller ventetiden mer enn dybden. */
const RASK_MODELL = Deno.env.get('LAERETID_RASK_MODELL') ?? ''
/**
 * Sterk modell får et minutt, rask 45 sekunder. Svarer ikke den sterke i tide,
 * prøves den raske én gang — en logg fra flash er bedre enn ingen logg
 * (27.09.2026: gemini-3.1-pro-preview brukte over 45 s på å skrive én logg).
 * Sum holder seg under Supabase sin grense på 150 s per kall. 28.09.2026: med
 * de skjerpede reglene tenkte Pro 5 000 tokens og brukte over 60 s på to av
 * fem logger — da skrev Flash dem, med flest feil. Derfor 95 s.
 */
const TIMEOUT_MS: Record<'sterk' | 'rask', number> = { sterk: 95_000, rask: 45_000 }
/**
 * Øvre grense per forespørsel. `skriv` bærer læreplanen, malen og NEK-kartet
 * (~18k tegn) i tillegg til dagen, så den får mer. Mer enn dette er ikke en
 * logg, det er misbruk av proxyen.
 */
const MAKS_TEGN = 120_000

type Del = { id: string; navn: string }
type Maal = { nr: number; etikett: string; tekst: string; deler: Del[] }
type Logg = {
  tittel: string | null
  arbeidsdato: string | null
  instruks: string | null
  innhold: string | null
  notater: { tid: string | null; notat: string }[]
  /** Tidspunkt for bilder han ikke skrev notat til. */
  utenNotat?: string[]
  /** Det han har svart i samtalen, ordrett. */
  svar?: string[]
  /** Det modellen så på bildene (`se`). Støtte om utstyret — ikke hans ord. */
  bildene?: { tid: string | null; beskrivelse: string }[]
}

type Paakrevd = 'utfort-selv' | 'hva-ble-maalt' | 'kabeltype' | 'mestring' | 'bilde-uten-notat' | 'materiell' | 'risiko' | 'vurdering'
const PAAKREVD: Paakrevd[] = ['utfort-selv', 'hva-ble-maalt', 'kabeltype', 'mestring', 'bilde-uten-notat', 'materiell', 'risiko', 'vurdering']

/** Malen loggen skal følge, slik klienten sender den (lib/laeretid/mal.ts). */
type MalSeksjon = {
  id: string
  tittel: string
  slag: 'tekst' | 'tabell' | 'bilder'
  hjelp: string
  kolonner?: string[]
  faste?: string[]
}

type SamtaleForesporsel = {
  mode: 'samtale'
  logg: Logg
  meldinger: { rolle: 'laerling' | 'bot'; tekst: string }[]
  /**
   * Det som gjenstår på avhørslista, i rekkefølgen det SKAL spørres — bestemt av
   * klienten (`gjennomgang()`), ikke av modellen. Tom = ferdig.
   */
  gjenstaar: { punkt: Paakrevd; hvorfor: string; forsok: number }[]
  nek: { punkt: string; side: number; naar: string }[]
  /**
   * Nøkkelspørsmål boten selv kan stille når lista er tom — bare hvis loggen
   * ellers måtte gjette. 0 eller mangler = ingen. Taket settes av klienten.
   */
  ekstra?: number
  /** Malen loggen skal fylles i — de smarte spørsmålene sikter mot hullene i den. */
  mal?: { navn: string; seksjoner: MalSeksjon[] }
}

type SeForesporsel = {
  mode: 'se'
  instruks: string | null
  /** Signerte GET-lenker til hans egne bilder i R2. */
  bilder: { id: string; url: string; tid: string | null; notat: string | null }[]
}

type SkrivForesporsel = {
  mode: 'skriv'
  logg: Logg
  meldinger: { rolle: 'laerling' | 'bot'; tekst: string }[]
  maal: Maal[]
  /** Hans egne preferanser for hvordan loggen skal lyde. Profil, ikke fag. */
  tone: string | null
  /** Malen som SKAL følges, seksjon for seksjon. */
  mal: { navn: string; seksjoner: MalSeksjon[] }
  /** NEK-kartet: hvor ting står, aldri hva. */
  nek: { punkt: string; side: number; naar: string }[]
  /** Alle bildene i tidsrekkefølge. Modellen skriver bildeteksten og velger rekkefølgen i loggen. */
  bilder?: { nr: number; tid: string | null; notat: string | null; beskrivelse: string | null }[]
}

type LagForesporsel = {
  mode: 'lag'
  runde: 1 | 2
  logg: Logg
  maal: Maal[]
  /** Runde 2 og repetisjon: det han allerede er spurt om, og hva han svarte. */
  tidligere?: { tekst: string; svar: string | null; vurdering: string | null }[]
  /** Læringsprofilen: nivået hans per del (0 ny … 3 sterk), med hva det betyr for spørsmålet. */
  nivaa?: { maalNr: number; delId: string; nivaa: number; hint: string }[]
}

type VurderForesporsel = {
  mode: 'vurder'
  runde: 1 | 2
  /** Jobben spørsmålet handler om. Mangler for teorispørsmål. */
  logg?: Logg
  /** Teoritemaet, når spørsmålet er teori. */
  tema?: { navn: string; stikkord: string }
  sporsmaal: string
  svar: string
  maal: { etikett: string; tekst: string; delNavn: string }
  nek: { punkt: string; naar: string }[]
}

type TeoriForesporsel = {
  mode: 'teori'
  tema: { id: string; navn: string; stikkord: string }
  /** Nivået hans på temaet (0 ny … 3 sterk) og hva det betyr for spørsmålene. */
  nivaa: number
  hint: string
  /** Det han er spurt om før i temaet, så spørsmålene ikke gjentar seg. */
  tidligere: { tekst: string; svar: string | null; vurdering: string | null }[]
  antall: number
}

// ── Reglene modellen får ────────────────────────────────────────────────────

const FELLES = `Du jobber for en elektrikerlærling i Norge. Han dokumenterer
arbeidsdagene sine mot kompetansemålene i læreplanen, og på den muntlige delen
av fagprøven spør sensor ham ut om nøyaktig dette arbeidet. Du er øvingen på den
samtalen.

Tonen: voksen, faglig og kort. Han gjør farlig arbeid, han er ikke et barn. Ingen
utropstegn, ingen skryt, ingen emoji. Skriv norsk bokmål.

Loggen er HANS påstander. Instruksen og notatene hans er primærkilde. Finn aldri
på arbeid, utstyr, mål eller kabeltyper som ikke står der.`

const LAG_RUNDE_1 = `${FELLES}

Oppgave: lag spørsmål om det han gjorde i dag, så vi ser at han forsto det han
gjorde. Spørsmålene avgjør om et kompetansemål krysses av.

Regler:
- Hvert spørsmål tar utgangspunkt i noe HAN har sagt eller notert. Sa han «skjermen ble
  jordet i tavla», spør du hvorfor bare i én ende. Spør aldri om noe han ikke
  påstår.
- Loggteksten er skrevet av assistenten. Står noe BARE der og ikke i hans egne
  ord eller notater, spør du ikke om det, og du skriver aldri «du oppgir …» om det.
- Spør om HVORFOR og HVORDAN, ikke om å gjengi hva han gjorde.
- Tabellene i loggen (risikovurdering, vurdering) er fylt ut av assistenten, ikke
  av ham. Si aldri «du skriver i risikovurderingen …». Spør heller rett ut om
  risikoen i jobben: «Hvordan sikrer du mot innkobling når …?»
- Det skal kunne besvares i én eller to setninger, muntlig i formen. Gjerne
  «forklar det som om du forklarer det til en ny lærling».
- Ett spørsmål per del av et kompetansemål, forskjellige deler. Velg mål og del
  BARE fra lista du får, med nøyaktig nr og del-id.
- Velg de delene loggen faktisk redegjør for, ikke de den bare nevner.
- Ikke spør om noe han skriver at han så andre gjøre som om han gjorde det selv.
- Hvert spørsmål slutter med spørsmålstegn og er ett spørsmål, ikke tre.
- Lag inntil tre.`

const LAG_RUNDE_2 = `${FELLES}

Oppgave: det har gått noen dager. Lag ETT spørsmål som sjekker om det han lærte
fortsatt sitter. Dette er formen fagprøven har.

Regler:
- Samme tema som tidligere spørsmål, men en annen vinkel — ikke det samme
  spørsmålet omformulert. Bommet han sist, spør om kjernen i det han bommet på.
- Knytt det fortsatt til jobben han gjorde, ikke til en lærebok.
- Kan besvares i én eller to setninger. Slutter med spørsmålstegn.
- Velg mål og del BARE fra lista du får, med nøyaktig nr og del-id.`

const TEORI = `Du lager øvingsspørsmål i elektroteori for en elektrikerlærling i Norge som
øver til fagprøven. Norsk bokmål. Voksen og kort, som en god instruktør.

Regler:
- Hold deg innenfor temaet og stikkordene. Ett spørsmål = én ting.
- Spørsmålet skal kunne besvares med én eller to setninger, eller et kort
  regnestykke med tall (oppgi tallene). Ingen flervalg.
- Knytt det til noe en elektriker møter på jobb når det går: en varmeovn, en
  kurs på bad, en motor som løser ut C-automaten.
- Tilpass vanskelighetsgraden til NIVÅET hans. Nivå 0–1: grunnbegreper og enkle
  tall. Nivå 2: bruk det på en situasjon. Nivå 3: grensetilfeller og feilsøking.
- Ikke gjenta et spørsmål han har fått før. Bommet han, spør om kjernen igjen fra
  en annen vinkel.
- Siter aldri NEK, og si aldri hva NEK krever. Teori, fysikk og produktkunnskap
  er greit å spørre om.
- Hvert spørsmål slutter med spørsmålstegn.`

const VURDER = `${FELLES}

Oppgave: vurder svaret hans på ett spørsmål.

Regler:
- «bestatt» når svaret viser at han forstår kjernen, selv om ordene er
  upresise, skrevet på dialekt eller med skrivefeil. Muntlig form er meningen.
- «stroket» når svaret er feil i kjernen, bare gjentar hva han gjorde uten
  hvorfor, eller når han sier at han ikke vet eller husker. Å si «vet ikke» er
  ærlig og helt greit — men det er ikke et bestått.
- tilbakemelding: én eller to setninger direkte til ham. Ved stryk: hva som
  mangler, uten å moralisere. Ved bestått: bare det som eventuelt kan skjerpes,
  eller tomt.
- fasit: hva et godt svar inneholder, på to til fire setninger, i egne ord.
- nek: punktnummeret i NEK 400 der han kan etterprøve dette, valgt BARE fra
  lista du får. Passer ingen, sett null. Siter aldri tekst fra NEK.`

const SAMTALE = `Du hjelper en elektrikerlærling i Norge med å dokumentere en arbeidsdag.
Han skriver ikke loggen selv — du skriver den senere, av det han forteller deg nå.
Derfor er jobben din å få fram fakta, ikke å skrive pent.

Han vil ikke bruke tid på dette. Spør BARE om punktene i GJENSTÅR, aldri om noe
annet, og aldri et oppfølgingsspørsmål han ikke må svare på. Loggen fylles ut av
det han alt har sagt; forståelsen sjekkes i en quiz etterpå, ikke her.

Om et bilde uten notat: spør hva han ville få med på bildet — ikke hva det viser.
Bruk tidspunktet: «Bildet 13:22 — hva ville du få med der?»

Tonen: som en erfaren kollega. Voksen, kort, konkret. Én ting om gangen. Ingen
utropstegn, ingen emoji, ingen skryt, ingen oppsummering av det han nettopp sa.
Norsk bokmål. Maks tre korte setninger. Et spørsmål slutter med spørsmålstegn.
Ikke fortell ham hva som er riktig eller feil — du henter fakta, du retter ikke.

Du får:
- instruksen og notatene hans (primærkilde — de slår alt annet),
- samtalen så langt,
- GJENSTÅR: punktene som ikke er besvart, i den rekkefølgen de skal spørres om,
  med grunnen. Du velger ikke selv hva som skal spørres om, du formulerer det.

Slik svarer du:
1. dekker: hvilke punkter i GJENSTÅR hans SISTE melding faktisk besvarer. «Jeg husker ikke» ER et svar og dekker punktet. Et vagt svar som
   ikke sier noe om punktet dekker det ikke. Er det ingen melding fra ham ennå,
   er lista tom.
2. melding: det du sier nå. Still spørsmålet om det FØRSTE punktet i GJENSTÅR
   som ikke er i dekker, knyttet til det han faktisk har fortalt (bruk hans ord
   om jobben). Er det spurt om før, still det annerledes og mer konkret. Er alt
   dekket, si kort at du har det du trenger og at han kan få loggen skrevet.

Rekkverk — disse brytes aldri:
- Finn aldri på arbeid, utstyr, kabeltyper, mål eller verdier. Gjett aldri.
- Skill alltid mellom det HAN gjorde og det han så andre gjøre.
- Du kan hvor ting står i NEK 400, ikke hva som står der. Si ALDRI hva NEK
  krever, tillater eller sier, heller ikke omtrent. Når et spørsmål hans eller
  et tema i jobben hører hjemme i normen, gi ham punktnummeret fra lista i
  feltet nek og be ham slå det opp og fortelle deg med egne ord. Å finne fram i
  boka er en del av fagprøven. Si det slik: «Slå opp punkt 522 på side 193».
  Å forklare det med egne ord er frivillig — mas ikke om det.
  Det heter punkt, ikke del.
- Spør han deg om fag, svar ikke med fasiten. Pek ham til NEK-punktet eller til
  faglig leder, og gå tilbake til punktet.
- Er han usikker, skal det stå at han ikke husker — aldri at noe ikke ble gjort.
- Ikke svar på noe som ikke handler om jobben og loggen. Styr kort tilbake.
- Sett nek til null når du ikke peker på et punkt.`

const SE = `Du ser på ett bilde en elektrikerlærling i Norge tok på jobb. Beskrivelsen
brukes senere til å skrive loggen hans og til å spørre ham om det som ikke synes.

Skriv på norsk bokmål, kort og saklig, 1–3 setninger:
- Hva bildet viser: utstyr, installasjonen, arbeidssteget (åpen boks med ledere,
  ferdig montert, merking, tegning, verktøy).
- Norske fagord: DIP-bryter (aldri «svitsj»), rekkeklemme, jordleder, armatur.
- Tekst du faktisk kan lese: typebetegnelse, produsent, adresse/merking, kabeltekst,
  normer og data på typeskilt, romnavn og nummer på en tegning. Skriv det ordrett.
- Det du ikke kan lese sikkert, skriver du ikke. Gjett aldri produsent, type eller
  kabeltype ut fra utseende alene. Si heller «ser ut som».
- Aldri hvem som gjorde arbeidet, hvorfor, eller om det er riktig utført.

bildetekst: en kort bildetekst til loggen, 4–10 ord, som sier hva bildet
dokumenterer: «Sirene 1009 åpnet, loop koblet inn og ut», «Plantegning med
plassering av 1009». Ingen «bildet viser», ingen hvem, ingen vurdering.`

const EKSTRA = `
SMARTE SPØRSMÅL: Når alt i GJENSTÅR er dekket (også av hans siste melding), skal du
sørge for at MALEN kan fylles ut sant og faglig. Du har inntil EKSTRA spørsmål igjen.
Ett spørsmål per tur, høyst to ting som hører sammen, kort nok til å svares på mobil.

Gå i denne rekkefølgen og hopp over det du alt vet (fra bildene, notatene, svarene):

0. HVOR — vet du ikke hvor jobben var (anlegg, sted) og for hvem, spør om det
   først, i ett kort spørsmål. Oppdraget i loggen starter med det.
   AVVIK — nevner han noe som var feil, ødelagt, skal returneres eller ble gjort
   om (også i et bildenotat), spør hva som var galt og hva som ble gjort med det.
   Det er «Kan noe gå galt»-raden i risikovurderingen og en god ting å skrive om.
1. HVORFOR — inntil TRE spørsmål, ett per tur, om det HAN gjorde med egne hender
   (det han sa i første svar og det bildene viser av hans arbeid). Tenk som
   sensor på fagprøven: hva i akkurat de operasjonene er farlig eller lett å
   gjøre feil, og må kunne begrunnes? PEN-lederen når han koblet et inntak,
   tiltrekkingsmoment når han skrudde aluminium eller betongskruer, armering når
   han boret, kabler i ett lag når han la på stige, PE ubrutt når han koblet
   gjennom, laststyring når han satte den opp. Det faglig tyngste først. Aldri
   hvorfor om et valg andre tok (montørens vern, byggets kabelkrav) eller om et
   tall han ikke kan vite — det som skiller en fagarbeider fra en som bare gjør som han blir bedt om:
   verktøyvalg (båndsag og ikke vinkelsliper på galvanisert bro), rekkefølge
   (børste før fett på aluminium), kabelvalg (halogenfri, skjermet), vernvalg
   (jordfeil type B til lader), hvordan skjerm/PE avsluttes, hvorfor det måles tre
   ganger, hvorfor det ble flyttet et hull. Spør rett ut: «Hvorfor børstet du
   aluminiumslederne før du fettet dem?» Svaret hans ER begrunnelsen i loggen.
   Vet han ikke, er det greit — ikke mas. Har han svart «husker ikke» eller «vet
   ikke» på et hvorfor, still ikke flere hvorfor: tre blanke på rad gjør bare
   samtalen lang. Et hvorfor
   er bare verdt et spørsmål når svaret blir en setning i «Utførelse med
   begrunnelser»: ikke spør hvorfor om noe som bare var slik (byggets krav,
   det som var på bilen) eller om hvordan et produkt er laget. «Hvorfor måtte
   armaturene adresseres?» er et dårlig spørsmål — svaret er «fordi produsenten
   laget det sånn». Spør heller om HANS del av det: hva han satte og hvordan han
   visste at det var riktig, eller hva som går galt om det gjøres feil: «Hvilken
   adresse satte du, og hvordan visste du at den var riktig?», «Hva skjer om to
   armaturer får samme adresse?». Aldri «måtte».
2. RISIKO — la ham BEKREFTE, ikke list opp. Gå stille gjennom risikopunktene i
   malen og si kort hvilke du mener gjelder denne jobben, med grunnen i ett ord,
   og spør om det stemmer eller om noe mangler: «Jeg setter risiko på høyde
   (stige), støv og støy (boring i betong), andre fag i rommet og trangt rom
   (kjeller). Stemmer det, og hva hadde du på av verneutstyr?» Ett svar fra ham
   fyller da hele tabellen. Foreslå bare det bildene eller hans ord viser —
   gjett aldri at noe var spenningsatt, og ta aldri med et merke han ikke sa.
   Høyst tre risikoer, og bare RISIKOER — utkobling er et tiltak, ikke en risiko.
   Ikke boring, stige eller andre fag før han eller bildene har vist det (hull i
   veggen kan være gamle). Men montering høyt på vegg (over kabelbro, i tak) er
   arbeid i høyden: ta det med og spør hva han sto på, uten å gjette utstyret.
   Tenk på: spenning og utkobling, andre fag, flere
   personer, eksisterende anlegg (armering, rør, kabler), høyde, trange rom,
   avfall og kapp, noe som gikk galt.
3. KONTROLL OG RESULTAT. Når noe ble koblet: hva ble målt eller testet, og av hvem.
   Når en kurs ble laget: hvilket vern. Ved feilsøking: hva ble tiltaket etterpå
   (reparert, frakoblet, rapport, kunden varslet).
4. EGENVURDERING. Gikk det som planlagt, og hva lærte han eller var fornøyd med.

Rekkefølge når budsjettet er trangt: ett hvorfor, risiko, kontroll (når det
gjelder), egenvurdering — og så de to andre hvorfor-spørsmålene hvis det er rom.
Ikke ferdig før 1, 2 og 4 er spurt om — og 3 når noe ble koblet, målt eller
feilsøkt. Bruk aldri et spørsmål på noe han nettopp sa (sa han «en holdt, en
festa», er arbeidsdelingen besvart). Knytt spørsmålet
til det du ser og det han har sagt, med hans ord og det som står på bildene.

SPRÅKET: slik en erfaren elektriker snakker på jobb, ikke som et skjema. Korte,
vanlige ord: DIP-bryter (aldri «svitsj»), armatur, kurs, tavle, jordleder. Ett
spørsmål på høyst ca. 20 ord, og ikke en innledende påstand før spørsmålet
utover det risikoforslaget trenger. Bruk hans ord om jobben, ikke dine.

Spør aldri om småting som ikke endrer loggen (hva kabelen ble festet med, stige
eller gardintrapp, hvilken kabel som gikk videre et annet sted). Spør aldri om noe
som står på bildene eller som han har svart på. Anta ikke utstyr i spørsmålet
(«brukte du rullestillaset») — spør åpent. Er alt dekket, sett ferdig til true
og si kort at du har det du trenger.`

const SKRIV = `Du fyller ut en arbeidslogg for en elektrikerlærling i Norge, i jeg-form, i
MALEN han leverer til opplæringskontoret. Malen er fast: samme seksjoner, samme
overskrifter, samme faste tabellrader, i samme rekkefølge. Du endrer aldri malen,
du fyller den ut. Loggen skal lyde som ham: faglig og konkret, ikke luftig.
Norsk bokmål.

Kilder, i rangert rekkefølge: instruksen hans, notatene til bildene, svarene
hans i samtalen. Assistentens meldinger i samtalen er SPØRSMÅL og FORSLAG, aldri
fakta: foreslo den en risiko eller et merke og han sa nei, rettet eller ikke
svarte på det, skriver du det ikke. Det er hans svar som gjelder. Bruk BARE det som står der. Fra det assistenten så på bildene
bruker du bare to ting: typebetegnelse/produsent på det HAN sa han monterte
(«sirena» → «Autronica BBR-230/IP»), og merking han laget (adresse, kursnummer).
Ingenting annet fra bildene: ikke gjenstander den tolket («krympeforgrening»,
«endehetter», «strekkavlastning», «rullestillas»), ikke tilfeldig tekst i
bakgrunnen (etiketter, malingsspann), ikke verktøy han ikke nevnte. Sier han noe
annet enn bildet, gjelder det han sa.

Regler — disse brytes aldri:
- Et valg er hans bare når han sa at han valgte. Var det byggets krav, montørens
  valg eller beskrivelsen, skriv det slik («Bygget krever halogenfri kabel, fordi …»).
- Verneutstyr er det han har PÅ seg (sko, hansker, briller, hørselsvern, hjelm,
  maske). Spenningstester og utkobling er tiltak mot spenning, ikke verneutstyr.
- Utførelse med begrunnelser: skriv hva han gjorde i rekkefølge, og for hvert valg
  han begrunnet, skriv begrunnelsen hans rett etter («Jeg børstet lederne før jeg
  fettet dem, fordi …»). Det er det faglig leder leser etter. Begrunnelser han
  ikke ga, skriver du ikke — og at han ikke husket hvorfor, hører ikke hjemme i
  utførelsen (det er quizen som sjekker forståelsen).
- Skriv bare det han har sagt. Legg aldri til arbeid, utstyr, materiell,
  verdier, målinger eller kabeltyper han ikke nevnte.
- Det han gjorde selv skrives som hans. Det han så andre gjøre skrives tydelig
  som det: «selve koblingen i skapet gjorde montøren, men …». Aldri passiv form
  som skjuler hvem («det ble kontrollert at»).
- Husker han ikke noe, skriv «jeg husker ikke», aldri at noe ikke ble gjort.
- Sier han selv at han IKKE brukte noe han burde (støvmaske, fallsikring), skriv
  det ærlig i risikovurderingen og under det som burde vært gjort annerledes.
  Det er læring, ikke noe å skjule.
- Spenningsmåling er funksjonskontroll. Skriv aldri «sluttkontroll» om en måling
  med mindre han sa at isolasjon og kontinuitet ble målt.
- NEK: skriv aldri hva normen krever. Har han selv slått opp og forklart noe med
  egne ord, bruk hans forklaring og oppgi punktnummeret. Ellers ingen NEK.
- Legg aldri til en grunn eller hensikt han ikke sa («for god kontakt», «for å
  sikre …»). Skriv hva han gjorde; begrunnelsene er hans eller NEK-oppdraget.
- Tekst på en tegning (romnavn, kabelkjeller, trafo) sier hvor utstyret står på
  planen, ikke hvilke forhold han jobbet under.
- Står det ikke i kildene, skriv «Ikke oppgitt.» i stedet for et generelt tiltak
  som «standard verneutstyr». Unntaket er risikotiltak for en risiko som tydelig
  følger av jobben, som står under.
- Ingen egenskaper eller årsaker han ikke sa. Sa han «returneres grunnet rust», er
  det det som står — ikke «gamle rustne armaturer». Alder, tilstand og årsak er
  hans å si.
- Ingen tankestrek i løpende tekst. Ingen ordrenummer fra andre firma.
- Følg preferansene hans i «tone» når de ikke strider mot reglene over.

Slik fyller du malen (feltet seksjoner, én oppføring per seksjon i malen, med
seksjonens id):
- Tekstseksjon: tekst er innholdet, korte avsnitt. rader er tom.
- Tabell med faste rader: rader har NØYAKTIG én rad per fast punkt, i malens
  rekkefølge. celler er kolonnene i rekkefølge (ikke punktteksten selv).
  HVER rad skal fylles ut — ingen tomme rader. Lærlingen skal ikke fylle ut noe
  selv. Ja/nei-kolonnen er «Ja» eller «Nei».
  · Risikovurdering: punktene spør om BEHOV og RISIKO i jobben, ikke om hva han
    gjorde — det er en vurdering av jobben. Ja når jobben tydelig innebærer det
    (han nevnte det, eller det følger av arbeidet — graving ved siden av
    maskiner, arbeid i skap med spenning, stige/lift, to personer på jobben,
    kapp og emballasje, boring i betong). Verneutstyr er Ja på praktisk talt all
    montasje (vernesko, hansker; briller og hørselsvern ved boring). Skriv
    risikoen konkret for akkurat denne jobben, og tiltaket han sa; sa han ikke
    noe, det vanlige tiltaket for akkurat den risikoen. Sa han at anlegget var
    spenningsløst, frakoblet eller låst, er AUS-punktet Nei («Ikke relevant.»);
    utkoblingen står da under «Kan oppdraget påvirke eksisterende anlegg». Nei når punktet ikke gjelder jobben; skriv da «Ikke
    relevant.» i de andre cellene. Ukjent er ikke det samme som Nei.
    «Kan noe gå galt, utover nevnte punkter?» er Ja når noe faktisk gikk galt
    eller var nær (en skrue som knakk, en kabel som ble for kort, en feil som
    ble funnet) — skriv hva og hva han gjorde med det.
  · Vurdering av arbeidet: svar ut fra det han sa. Sa han ikke noe om problemer,
    gikk arbeidet som planlagt (Ja). Endringer, ekstra tid og ting som gikk galt
    han nevnte skal med (en kabel som ble for kort er en endring, «to timer,
    lengre enn tenkt» er uforutsett tidsforbruk). «Fungerte alt» og «Ble kunden
    fornøyd» er Ja med mindre han sa noe annet; er noe ikke testet ennå, skriv
    det i hva/hvorfor-cellen i stedet for å svare Nei. «Hva gjorde du
    bra og hvorfor?» og «Har du lært noe» fylles BARE fra hans ord; sa han «vet
    ikke» eller ingenting, skriv «Ikke oppgitt.» og aldri en lærdom du fant på.
    Problem og tiltak skrives bare når det fantes et problem; ellers «Ikke
    relevant.».
  · Vedlegg: «Skjema for risikovurdering» er Ja (den står i loggen). Resten er Nei
    med mindre han nevnte dokumentet.
  Du finner aldri på arbeid, materiell, målinger eller hvem som gjorde hva.
- Tabell uten faste rader (materielliste): én rad per ting han nevnte.
  «Etter behov» når antallet ikke er sagt.
- Bildeseksjon: hopp over (bildene legges inn fra appen). Bildetekstene skrives i
  feltet bildetekster, se under.

nekPunkter: malens utførelse skal ha «henvisning til forskrifter». Du skriver
ALDRI hva NEK sier. Du peker: for hvert valg i jobben som bør begrunnes med
normen (forlegning, vern, jording, fuktige rom, dimensjonering …), velg punktet
fra NEK-lista og skriv i «hva» én kort setning om HVA han skal begrunne, som et
oppdrag til ham — f.eks. «Hvorfor jordkabelen ligger i rør der den går inn i
skapet». Ikke svaret, bare spørsmålet. Henvisningen står i loggen uansett; han
kan velge å forklare med egne ord etter å ha slått opp. To til fire punkter er
normalt. Bare punkter som faktisk gjelder jobben.

belegg: de delene av kompetansemålene loggen faktisk REDEGJØR for (ikke bare
nevner). Velg bare fra lista, nøyaktig nr og del-id. utfortSelv er true bare når
han selv gjorde det. Fire til åtte mål er normalt; heller færre enn flere.

tittel: kort, hva jobben var. Ingen dato.

bildetekster: én for HVERT bilde i BILDENE, og lista er rekkefølgen bildene står
i loggen. Det er det faglig leder leser under bildet.
- Rekkefølge: arbeidsgangen. Som regel tidspunktet, MEN bilder av ferdig resultat
  («ferdig produkt», «slik ble det») står til slutt, og bilder av utgangspunktet
  («det gamle», «her skal det opp») først — også når de ble tatt midt i jobben.
- Har bildet notat: notatet er hans, og teksten er notatet hans gjort ferdig —
  rett skrivefeil, gjør det til en hel, ryddig setning med fagord, og knytt det
  til jobben med det han sa i samtalen («Dette er eksempel på ferdig produkt» →
  «Ferdig montert ledelys over kabelbroen»). Ingen nye fakta: står det ikke i
  notatet, samtalen eller som lesbar tekst på bildet, skriver du det ikke. Er
  notatet allerede godt, la det stå nesten likt.
- Uten notat: hva bildet dokumenterer I JOBBEN, med hans ord fra samtalen
  knyttet til det assistenten så: «PE-lederen fra tilførselen, før den ble koblet
  i jordklemmen», «Gessler MLB10 satt til adresse 11». Vet du ikke hva det
  dokumenterer, bare det som synes («Kabelstige med ny kabel lagt inn»).
- Én eller to setninger, 4–25 ord. Aldri hvem som gjorde det når han ikke sa det,
  aldri en vurdering, ingen «bildet viser».`

// ── Svarformer ──────────────────────────────────────────────────────────────

const LAG_SKJEMA = {
  type: 'OBJECT',
  properties: {
    sporsmaal: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          maalNr: { type: 'INTEGER' },
          delId: { type: 'STRING' },
          tekst: { type: 'STRING' },
        },
        required: ['maalNr', 'delId', 'tekst'],
      },
    },
  },
  required: ['sporsmaal'],
}

const VURDER_SKJEMA = {
  type: 'OBJECT',
  properties: {
    vurdering: { type: 'STRING', enum: ['bestatt', 'stroket'] },
    tilbakemelding: { type: 'STRING' },
    fasit: { type: 'STRING' },
    nek: { type: 'STRING', nullable: true },
  },
  required: ['vurdering', 'tilbakemelding', 'fasit'],
}

const SAMTALE_SKJEMA = {
  type: 'OBJECT',
  properties: {
    dekker: { type: 'ARRAY', items: { type: 'STRING', enum: PAAKREVD } },
    melding: { type: 'STRING' },
    nek: { type: 'STRING', nullable: true },
    ferdig: { type: 'BOOLEAN' },
  },
  required: ['dekker', 'melding'],
}

const SKRIV_SKJEMA = {
  type: 'OBJECT',
  properties: {
    tittel: { type: 'STRING' },
    seksjoner: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          tekst: { type: 'STRING' },
          rader: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { celler: { type: 'ARRAY', items: { type: 'STRING' } } },
              required: ['celler'],
            },
          },
        },
        required: ['id'],
      },
    },
    nekPunkter: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { punkt: { type: 'STRING' }, hva: { type: 'STRING' } },
        required: ['punkt', 'hva'],
      },
    },
    belegg: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          maalNr: { type: 'INTEGER' },
          delId: { type: 'STRING' },
          utfortSelv: { type: 'BOOLEAN' },
        },
        required: ['maalNr', 'delId', 'utfortSelv'],
      },
    },
    bildetekster: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { nr: { type: 'INTEGER' }, tekst: { type: 'STRING' } },
        required: ['nr', 'tekst'],
      },
    },
  },
  required: ['tittel', 'seksjoner', 'nekPunkter', 'belegg'],
}

const SE_SKJEMA = {
  type: 'OBJECT',
  properties: { bildetekst: { type: 'STRING' }, beskrivelse: { type: 'STRING' } },
  required: ['bildetekst', 'beskrivelse'],
}

/** Svarte han «husker ikke» på et hvorfor? Da er det ikke mer å hente der. */
function bomPaaHvorfor(meldinger: { rolle: 'laerling' | 'bot'; tekst: string }[]): boolean {
  return meldinger.some((m, i) => m.rolle === 'laerling'
    && /\b(husker ikke|vet ikke|aner ikke|veit ikke|husker ikkje)\b/i.test(m.tekst)
    && meldinger[i - 1]?.rolle === 'bot' && /\bhvorfor\b/i.test(meldinger[i - 1].tekst))
}

function base64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

// ── Kontekst ────────────────────────────────────────────────────────────────

function loggTekst(l: Logg): string {
  const deler = [
    `Tittel: ${l.tittel ?? '(uten)'}`,
    `Arbeidsdato: ${l.arbeidsdato ?? '(ukjent)'}`,
    `Hans egen instruks (primærkilde):\n${l.instruks?.trim() || '(tom)'}`,
  ]
  if (l.notater.length > 0) {
    deler.push('Notater han skrev til bildene, i tidsrekkefølge:\n' +
      l.notater.map(n => `- ${n.tid ?? '??:??'} ${n.notat}`).join('\n'))
  }
  if (l.utenNotat?.length) deler.push(`Bilder uten notat, tatt: ${l.utenNotat.join(', ')}`)
  if (l.bildene?.length) {
    deler.push('Det assistenten så på bildene (om utstyret — ikke hans ord):\n' +
      l.bildene.map(b => `- ${b.tid ?? '??:??'} ${b.beskrivelse}`).join('\n'))
  }
  if (l.svar?.length) deler.push('Det han har sagt i samtalen, ordrett:\n' + l.svar.map(x => `- ${x}`).join('\n'))
  if (l.innhold?.trim()) deler.push(`Loggteksten (skrevet av assistenten, ikke hans ord):\n${l.innhold.trim()}`)
  return deler.join('\n\n')
}

function malTekst(seksjoner: MalSeksjon[]): string {
  return seksjoner.map(s => {
    const hode = `- id "${s.id}" · ${s.tittel} (${s.slag}): ${s.hjelp}`
    if (s.slag !== 'tabell') return hode
    const kol = `\n    kolonner: ${(s.kolonner ?? []).join(' | ')}`
    const faste = s.faste?.length
      ? '\n    faste rader:\n' + s.faste.map((f, i) => `      ${i + 1}. ${f}`).join('\n')
      : '\n    (ingen faste rader)'
    return hode + kol + faste
  }).join('\n')
}

function maalTekst(maal: Maal[]): string {
  return maal.map(m =>
    `${m.nr} (${m.etikett}): ${m.tekst}\n` +
    m.deler.map(d => `   del-id "${d.id}": ${d.navn}`).join('\n'),
  ).join('\n')
}

// ── Gemini ──────────────────────────────────────────────────────────────────

const valgt: Record<'sterk' | 'rask', string | null> = { sterk: null, rask: null }


/** Versjonen i navnet som tall: gemini-3.8-pro → 3.8. Ukjent → 0. */
function versjon(navn: string): number {
  const m = navn.match(/gemini-(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}

/**
 * Nyeste pro nøkkelen har tilgang til, ellers nyeste flash. Varianter for lyd,
 * bilde, tale, live og «lite» hoppes over: de er laget for noe annet enn å
 * vurdere et svar.
 */
async function velgModell(apiKey: string, slag: 'sterk' | 'rask', tvunget: string | null): Promise<string> {
  if (tvunget) return tvunget
  if (slag === 'sterk' && MODELL) return MODELL
  if (slag === 'rask' && RASK_MODELL) return RASK_MODELL
  if (valgt[slag]) return valgt[slag]!
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!res.ok) throw new Error(`fikk ikke modellista: ${res.status}`)
  const json = await res.json()
  const navn: string[] = (json.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: any) => String(m.name).replace(/^models\//, ''))
    .filter((n: string) => /^gemini-\d/.test(n))
    .filter((n: string) => !/lite|live|audio|tts|image|vision|embed|thinking-exp|computer/i.test(n))
  const beste = (slag: string) => navn
    .filter(n => n.includes(`-${slag}`))
    // Stabil før preview/exp på samme versjon.
    .sort((a, b) => versjon(b) - versjon(a) || Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)))[0]
  const funnet = slag === 'sterk' ? beste('pro') ?? beste('flash') : beste('flash') ?? beste('pro')
  if (!funnet) throw new Error('ingen brukbar Gemini-modell på nøkkelen')
  valgt[slag] = funnet
  console.log(`[laeretid-ai] ${slag}: ${funnet}`)
  return funnet
}

type Del_ = { text: string } | { inlineData: { mimeType: string; data: string } }

async function gemini(
  apiKey: string, system: string, bruker: string | Del_[], skjema: Record<string, unknown>,
  slag: 'sterk' | 'rask' = 'sterk',
  tvunget: string | null = null,
): Promise<Record<string, unknown>> {
  try {
    return await enRunde(apiKey, system, bruker, skjema, slag, tvunget)
  } catch (err) {
    const tidsavbrudd = err instanceof Error && err.name === 'AbortError'
    if (slag !== 'sterk' || !tidsavbrudd) throw err
    console.warn('[laeretid-ai] sterk modell brukte for lang tid — prøver rask')
    return enRunde(apiKey, system, bruker, skjema, 'rask', tvunget)
  }
}

async function enRunde(
  apiKey: string, system: string, bruker: string | Del_[], skjema: Record<string, unknown>,
  slag: 'sterk' | 'rask',
  tvunget: string | null,
): Promise<Record<string, unknown>> {
  const modell = await velgModell(apiKey, slag, tvunget)
  const kontroll = new AbortController()
  const tidsavbrudd = setTimeout(() => kontroll.abort(), TIMEOUT_MS[slag])
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modell}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: typeof bruker === 'string' ? [{ text: bruker }] : bruker }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { responseMimeType: 'application/json', responseSchema: skjema },
        }),
        signal: kontroll.signal,
      },
    )
    if (!res.ok) {
      const tekst = await res.text().catch(() => '')
      // Modellen kan forsvinne mens instansen lever. Glem valget, så neste
      // kall spør på nytt.
      if (res.status === 404) valgt[slag] = null
      throw new Error(`Gemini (${modell}) svarte ${res.status}: ${tekst.slice(0, 300)}`)
    }
    const json = await res.json()
    const tekst = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof tekst !== 'string') throw new Error('tomt svar fra Gemini')
    const ut = JSON.parse(tekst)
    // Hva kallet kostet, så klienten (og testskript) kan regne kroner.
    ut._bruk = { modell, ...(json?.usageMetadata ?? {}) }
    return ut
  } finally {
    clearTimeout(tidsavbrudd)
  }
}

// ── Inngang ─────────────────────────────────────────────────────────────────

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx: any) => {
    const raa = await req.text()
    if (raa.length > MAKS_TEGN) return Response.json({ ok: false, error: 'for stor forespørsel' })
    let body: LagForesporsel | VurderForesporsel | SamtaleForesporsel | SkrivForesporsel | TeoriForesporsel | SeForesporsel
    try { body = JSON.parse(raa) } catch { return Response.json({ ok: false, error: 'ugyldig forespørsel' }) }

    // Bare lærlinger. RLS på laeretid_laerling slipper bare egen rad gjennom,
    // så dette er også sjekken på at det er ham selv som spør.
    const { data: { user } } = await ctx.supabase.auth.getUser()
    if (!user) return Response.json({ ok: false, error: 'ikke innlogget' })
    const { data: laerling } = await ctx.supabase
      .from('laeretid_laerling').select('id').eq('id', user.id).is('deleted_at', null).maybeSingle()
    if (!laerling) return Response.json({ ok: false, error: 'ikke lærling' })

    // Modell låst for dette ene kallet — bare for testbrukere (@ampex.no), til å
    // sammenligne modeller på samme logg.
    const onsket = (body as { modell?: unknown }).modell
    const tvunget = typeof onsket === 'string' && /^gemini-[\d.]+-(pro|flash|flash-lite)(-preview)?$/.test(onsket)
      && (user.email ?? '').endsWith('@ampex.no') ? onsket : null

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return Response.json({ ok: false, error: 'AI ikke konfigurert' })
    const ai = (system: string, bruker: string | Del_[], skjema: Record<string, unknown>, slag: 'sterk' | 'rask' = 'sterk') =>
      gemini(apiKey, system, bruker, skjema, slag, tvunget)

    try {
      if (body.mode === 'se') {
        // Bare hans egne bilder: lenken må peke på R2 og under hans egen mappe.
        // Ellers kunne funksjonen brukes til å hente hva som helst fra nettet.
        const lovlig = (u: string) => {
          try {
            const url = new URL(u)
            return url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com')
              && url.pathname.includes(`/laerling/${user.id}/laeretid/`)
          } catch { return false }
        }
        const bilder = (body.bilder ?? []).slice(0, 30).filter(b => typeof b?.id === 'string' && lovlig(b.url))
        const beskriv = async (b: SeForesporsel['bilder'][number]) => {
          const res = await fetch(b.url)
          if (!res.ok) { console.warn(`[laeretid-ai] se: fikk ikke bildet (${res.status})`); return null }
          const data = base64(new Uint8Array(await res.arrayBuffer()))
          const ut = await ai(SE, [
            { text: [
              body.instruks?.trim() ? `Jobben, med hans ord: ${body.instruks.trim()}` : '',
              b.notat?.trim() ? `Notatet hans til bildet: ${b.notat.trim()}` : '',
            ].filter(Boolean).join('\n') || 'Beskriv bildet.' },
            { inlineData: { mimeType: res.headers.get('content-type')?.startsWith('image/') ? res.headers.get('content-type')! : 'image/jpeg', data } },
          ], SE_SKJEMA, 'rask')
          return {
            id: b.id,
            bildetekst: typeof ut.bildetekst === 'string' ? ut.bildetekst.trim() : '',
            beskrivelse: typeof ut.beskrivelse === 'string' ? ut.beskrivelse.trim() : '',
            bruk: ut._bruk,
          }
        }
        // Fire om gangen: nok til at ti bilder tar et par runder, lite nok til å
        // holde minnet nede når hvert bilde er noen MB.
        const ut: { id: string; bildetekst: string; beskrivelse: string; bruk: unknown }[] = []
        for (let i = 0; i < bilder.length; i += 4) {
          const runde = await Promise.all(bilder.slice(i, i + 4).map(b => beskriv(b).catch(err => { console.warn('[laeretid-ai] se feilet:', err); return null })))
          for (const r of runde) if (r?.beskrivelse) ut.push(r)
        }
        return Response.json({
          ok: true,
          beskrivelser: ut.map(({ id, bildetekst, beskrivelse }) => ({ id, bildetekst, beskrivelse })),
          bruk: ut.map(r => r.bruk),
        })
      }

      if (body.mode === 'samtale') {
        const samtale = body.meldinger.map(m => `${m.rolle === 'bot' ? 'Du' : 'Han'}: ${m.tekst}`).join('\n')
        const bruker = [
          loggTekst({ ...body.logg, svar: undefined, innhold: null }),
          `Samtalen så langt:\n${samtale || '(ingenting ennå — du åpner)'}`,
          body.gjenstaar.length > 0
            ? 'GJENSTÅR:\n' + body.gjenstaar.map(g =>
                `- ${g.punkt}: ${g.hvorfor}${g.forsok > 0 ? ` (spurt ${g.forsok} gang(er) før)` : ''}`).join('\n')
            : 'GJENSTÅR: ingenting. Alt er besvart.',
          (body.ekstra ?? 0) > 0 ? `EKSTRA: ${body.ekstra} smarte spørsmål igjen.` : '',
          `NEK-punkter du kan peke på (punkt, side, når):\n${body.nek.map(n => `${n.punkt}, side ${n.side}: ${n.naar}`).join('\n')}`,
          (body.ekstra ?? 0) > 0 && body.mal
            ? `MALEN («${body.mal.navn}») som skal fylles:\n${malTekst(body.mal.seksjoner)}`
            : '',
        ].filter(Boolean).join('\n\n')
        const ekstra = (body.ekstra ?? 0) > 0
        const ut = await ai(ekstra ? SAMTALE + EKSTRA : SAMTALE, bruker, SAMTALE_SKJEMA, 'rask')
        const dekker: Paakrevd[] = Array.isArray(ut.dekker) ? ut.dekker.filter((d: unknown) => PAAKREVD.includes(d as Paakrevd)) : []
        const listaFerdig = body.gjenstaar.every(g => dekker.includes(g.punkt))
        // Egenvurderingen er det faglig leder leser for mestring og læring, og
        // modellen hoppet over den i 6 av 10 rollespilte logger (28.09.2026).
        // Er den ikke spurt om, spørres den — senest med det siste smarte spørsmålet.
        // «Som planlagt» alene teller ikke: det er læring og mestring som manglet.
        const hvorforStilt = [...body.meldinger.filter(m => m.rolle === 'bot').map(m => m.tekst), String(ut.melding ?? '')]
          .filter(t => /\bhvorfor\b/i.test(t)).length
        const harEgenvurdering = body.meldinger.some(m => m.rolle === 'bot' && /lær|fornøyd|mestr/i.test(m.tekst))
          || (typeof ut.melding === 'string' && /lær|fornøyd|mestr/i.test(ut.melding))
        if (ekstra && !harEgenvurdering && listaFerdig && (ut.ferdig !== false || body.ekstra === 1)) {
          ut.melding = 'Siste spørsmål: gikk jobben som planlagt, eller ble noe endret underveis? Og hva lærte du eller var mest fornøyd med?'
          ut.ferdig = false
        } else if (ekstra && listaFerdig && ut.ferdig !== false && hvorforStilt < 3 && !bomPaaHvorfor(body.meldinger)) {
          // Modellen ga seg etter ett–to hvorfor i rollespillene, selv med rom til
          // flere (30.09.2026). Begrunnelsene er det som skiller loggen fra en
          // beskrivelse, så den får én sjanse til å stille det tyngste som mangler.
          const igjen = await ai(SAMTALE + EKSTRA + `

DU SA DEG FERDIG, men har bare stilt ${hvorforStilt} hvorfor-spørsmål. Still nå ETT
hvorfor-spørsmål om det faglig tyngste valget i jobben som ikke er spurt om. Finnes
det virkelig ikke noe mer å begrunne, sett ferdig til true.`, bruker, SAMTALE_SKJEMA, 'rask')
          if (igjen.ferdig === false && typeof igjen.melding === 'string' && igjen.melding.trim()) {
            ut.melding = igjen.melding
            ut.ferdig = false
          }
        }
        return Response.json({
          ok: true,
          bruk: ut._bruk,
          dekker,
          melding: typeof ut.melding === 'string' ? ut.melding.trim() : '',
          nek: typeof ut.nek === 'string' && body.nek.some(n => n.punkt === ut.nek) ? ut.nek : null,
          // Uten ekstra-rom er samtalen ferdig når lista er tom, uansett hva modellen sier.
          ferdig: listaFerdig && (!ekstra || ut.ferdig !== false),
        })
      }

      if (body.mode === 'skriv') {
        const samtale = body.meldinger.map(m => `${m.rolle === 'bot' ? 'Assistent' : 'Han'}: ${m.tekst}`).join('\n')
        const bruker = [
          loggTekst({ ...body.logg, svar: undefined, innhold: null }),
          `Samtalen:\n${samtale}`,
          `Hans preferanser (tone): ${body.tone?.trim() || '(ingen)'}`,
          `MALEN («${body.mal.navn}»), seksjon for seksjon:\n${malTekst(body.mal.seksjoner)}`,
          `NEK-punkter du kan peke på (punkt, side, når):\n${(body.nek ?? []).map(n => `${n.punkt}, side ${n.side}: ${n.naar}`).join('\n')}`,
          `Kompetansemålene du kan velge fra:\n${maalTekst(body.maal)}`,
          body.bilder?.length
            ? 'BILDENE, i tidsrekkefølge:\n' + body.bilder.map(b => `- nr ${b.nr}, ${b.tid ?? '??:??'}: `
              + (b.notat?.trim() ? `notatet hans: «${b.notat.trim()}». ` : 'uten notat. ')
              + `Assistenten så: ${b.beskrivelse?.trim() || '(ikke lest)'}`).join('\n')
            : '',
        ].filter(Boolean).join('\n\n')
        const ut = await ai(SKRIV, bruker, SKRIV_SKJEMA)
        // Tilbake som { id: tekst | rader }. Klienten tvinger det inn i malens
        // form med vaskUtfylling() — her pakkes det bare om.
        const utfylling: Record<string, string | string[][]> = {}
        for (const sk of Array.isArray(ut.seksjoner) ? ut.seksjoner as any[] : []) {
          if (typeof sk?.id !== 'string') continue
          const mal = body.mal.seksjoner.find(m => m.id === sk.id)
          if (!mal) continue
          utfylling[sk.id] = mal.slag === 'tabell'
            ? (Array.isArray(sk.rader) ? sk.rader.map((r: any) => Array.isArray(r?.celler) ? r.celler : []) : [])
            : (typeof sk.tekst === 'string' ? sk.tekst : '')
        }
        // Bare punkter fra kartet. Begrunnelsen står tom — den er hans.
        utfylling._nek = (Array.isArray(ut.nekPunkter) ? ut.nekPunkter as any[] : [])
          .filter(n => typeof n?.punkt === 'string' && typeof n?.hva === 'string' && (body.nek ?? []).some(k => k.punkt === n.punkt))
          .map(n => [n.punkt, n.hva.trim(), ''])
        return Response.json({
          ok: true,
          bruk: ut._bruk,
          tittel: typeof ut.tittel === 'string' ? ut.tittel.trim() : '',
          utfylling,
          belegg: Array.isArray(ut.belegg) ? ut.belegg : [],
          // Bare til bilder som fantes og ikke har notat: hans notat røres aldri.
          bildetekster: (Array.isArray(ut.bildetekster) ? ut.bildetekster as any[] : [])
            // Rekkefølgen er modellens; bare bilder som fantes, hvert én gang.
            .filter((t, i, alle) => typeof t?.tekst === 'string' && t.tekst.trim()
              && body.bilder?.some(b => b.nr === t.nr) && alle.findIndex(x => x?.nr === t.nr) === i)
            .map(t => ({ nr: t.nr, tekst: t.tekst.trim() })),
        })
      }

      if (body.mode === 'lag') {
        const tidligere = (body.tidligere ?? []).map(t =>
          `- Spurt: ${t.tekst}\n  Svarte: ${t.svar ?? '(ikke svart)'}\n  Vurdert: ${t.vurdering ?? '—'}`,
        ).join('\n')
        const bruker = [
          loggTekst(body.logg),
          `Kompetansemålene du kan velge fra:\n${maalTekst(body.maal)}`,
          tidligere ? `Det han er spurt om før:\n${tidligere}` : '',
          body.nivaa?.length
            ? 'NIVÅET HANS per del — tilpass vanskelighetsgraden til dette, og velg heller delene med lavest nivå:\n'
              + body.nivaa.map(n => `- ${n.maalNr}/${n.delId}: nivå ${n.nivaa}. ${n.hint}`).join('\n')
            : '',
        ].filter(Boolean).join('\n\n')
        const ut = await ai(body.runde === 1 ? LAG_RUNDE_1 : LAG_RUNDE_2, bruker, LAG_SKJEMA, 'rask')
        return Response.json({ ok: true, bruk: ut._bruk, sporsmaal: Array.isArray(ut.sporsmaal) ? ut.sporsmaal : [] })
      }

      if (body.mode === 'teori') {
        const tidligere = body.tidligere.map(t =>
          `- Spurt: ${t.tekst}\n  Svarte: ${t.svar ?? '(ikke svart)'}\n  Vurdert: ${t.vurdering ?? '—'}`).join('\n')
        const bruker = [
          `TEMA: ${body.tema.navn}\nStikkord: ${body.tema.stikkord}`,
          `NIVÅET HANS: ${body.nivaa}. ${body.hint}`,
          tidligere ? `Det han er spurt om før i temaet:\n${tidligere}` : '',
          `Lag ${Math.min(Math.max(body.antall, 1), 5)} spørsmål.`,
        ].filter(Boolean).join('\n\n')
        const skjema = {
          type: 'OBJECT',
          properties: { sporsmaal: { type: 'ARRAY', items: { type: 'STRING' } } },
          required: ['sporsmaal'],
        }
        const ut = await ai(TEORI, bruker, skjema, 'rask')
        return Response.json({
          ok: true,
          bruk: ut._bruk,
          sporsmaal: (Array.isArray(ut.sporsmaal) ? ut.sporsmaal : []).filter((x: unknown) => typeof x === 'string'),
        })
      }

      if (body.mode === 'vurder') {
        const bruker = [
          body.logg ? loggTekst(body.logg) : `Teorispørsmål om ${body.tema?.navn ?? 'elektrofag'}. Stikkord: ${body.tema?.stikkord ?? ''}`,
          `Kompetansemål ${body.maal.etikett}: ${body.maal.tekst}\nDel: ${body.maal.delNavn}`,
          `Spørsmålet: ${body.sporsmaal}`,
          `Svaret hans, ordrett: ${body.svar}`,
          `NEK-punkter du kan henvise til:\n${body.nek.map(n => `${n.punkt}: ${n.naar}`).join('\n')}`,
        ].join('\n\n')
        const ut = await ai(VURDER, bruker, VURDER_SKJEMA, 'rask')
        const vurdering = ut.vurdering === 'bestatt' ? 'bestatt' : 'stroket'
        const nek = typeof ut.nek === 'string' && body.nek.some(n => n.punkt === ut.nek) ? ut.nek : null
        return Response.json({
          ok: true,
          bruk: ut._bruk,
          vurdering,
          tilbakemelding: typeof ut.tilbakemelding === 'string' ? ut.tilbakemelding : '',
          fasit: { tekst: typeof ut.fasit === 'string' ? ut.fasit : '', nek },
        })
      }

      return Response.json({ ok: false, error: 'ukjent mode' })
    } catch (err) {
      console.error('[laeretid-ai] feilet:', err)
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'ukjent feil' })
    }
  }),
}

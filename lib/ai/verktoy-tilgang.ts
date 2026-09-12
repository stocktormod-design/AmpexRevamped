/**
 * Hvilke verktøy assistenten får kalle for hvilken rolle.
 * Ren logikk, ingen database. Selvtestes i `npm run verify:verktoy-tilgang`.
 *
 * ── Hvorfor dette ikke er `kontor-tilgang.ts` ───────────────────────────────
 *
 * Fristelsen er å gjenbruke den matrisen. Det ville vært feil: der har `montor`
 * og `laerling` TOMME rettighetslister, fordi den styrer hvem som slipper inn
 * på KONTORFLATEN. Brukt her ville den sperret en montør fra å opprette en
 * ordre — altså fra jobben sin. To flater, to spørsmål, to matriser.
 *
 * ── Hva denne er, og ikke er ────────────────────────────────────────────────
 *
 * **Den er ikke sikkerhetsmodellen.** Sannheten ligger i RLS,
 * `krev_faglig_godkjenning` og `kan_godkjenne_faglig()`. Denne matrisen finnes
 * fordi appen er offline-first, og det skaper et hull ingen RLS kan dekke:
 *
 *   Verktøykallene skriver til lokal WatermelonDB. RLS ser ingenting før
 *   `watermelon_push` kjører — kanskje timer senere, i en kjeller uten dekning.
 *
 * Uten en lokal sperre sier assistenten «ordren er opprettet», brukeren hører
 * det, går videre, og avvisningen kommer som en synkfeil lenge etterpå. Et
 * avslag som kommer tre timer for sent er ikke en tilgangskontroll — det er en
 * overraskelse. Denne matrisen er høfligheten; basen er fortsatt sannheten.
 *
 * ── Om lærlingen ────────────────────────────────────────────────────────────
 *
 * En lærling har de samme FELTrettighetene som en montør. Han fører timer,
 * oppretter ordrer og fyller skjemaer — det er slik man lærer faget, og en app
 * som nekter ham det er en app han ikke kan bruke på jobb.
 *
 * Det han ikke har, er det som har handelsmessig eller juridisk konsekvens
 * utad: markere fakturert, sende til Fiken eller Tripletex, fryse til arkiv.
 * Ikke fordi han ikke er til å stole på, men fordi de handlingene binder
 * firmaet, og fordi de er vanskelige å gjøre om.
 *
 * Faglig godkjenning står bevisst IKKE i denne matrisen. Den eies av
 * `company_settings.faglig_ansvarlig` og besvares av `kan_godkjenne_faglig()`
 * — en navngitt person, ikke en rolle. Se `lib/approvals.ts`.
 */

import type { Rolle } from '../kontor-tilgang'

export type Verktoyrett =
  /** Opprette en ordre. */
  | 'ordre.opprett'
  /** Melde seg selv på en ordre. */
  | 'ordre.bli_med'
  /** Endre tittel, beskrivelse, adresse på en ordre man er med på. */
  | 'ordre.endre'
  /** Føre egne timer. */
  | 'timer.egne'
  /** Føre timer på andre. Lønnsgrunnlag for noen andre enn deg selv. */
  | 'timer.andre'
  /** Starte og fylle dokumentasjonsskjema. */
  | 'skjema.fyll'
  /** Registrere måleverdier på en kurs. */
  | 'maaling.registrer'
  /** Føre materiell og tillegg. */
  | 'materiell.for'
  /** Opprette og endre tilbud. */
  | 'tilbud.skriv'
  /** Markere en ordre som fakturert. */
  | 'faktura.marker'
  /** Sende noe ut av firmaet: Fiken, Tripletex, e-post til kunde. */
  | 'eksport.send'
  /** Fryse en ordre til arkiv. Irreversibelt. */
  | 'arkiv.frys'
  /** Opprette en kunde i registeret. Alle i felt — kunden dukker opp når ordren gjør det. */
  | 'kunde.opprett'
  /** Endre firmaets registre: timetyper (aktiviteter) med timepris. */
  | 'register.endre'

const FELT: Verktoyrett[] = [
  'ordre.opprett',
  'ordre.bli_med',
  'ordre.endre',
  'timer.egne',
  'skjema.fyll',
  'maaling.registrer',
  'materiell.for',
  'kunde.opprett',
]

const MATRISE: Record<Rolle, Verktoyrett[]> = {
  owner: [...FELT, 'timer.andre', 'tilbud.skriv', 'faktura.marker', 'eksport.send', 'arkiv.frys', 'register.endre'],
  admin: [...FELT, 'timer.andre', 'tilbud.skriv', 'faktura.marker', 'eksport.send', 'arkiv.frys', 'register.endre'],
  // Installatøren er den faglig ansvarlige. Han skal kunne alt i felt, og han
  // eier det som går ut av huset.
  installator: [...FELT, 'timer.andre', 'tilbud.skriv', 'faktura.marker', 'eksport.send', 'arkiv.frys', 'register.endre'],
  // Basen leder jobben og fører timer på laget sitt, men fakturerer ikke og
  // sender ingenting ut. Skillet følger `kontor-tilgang.ts`, der basen heller
  // ikke ser firmaets samlede timeliste.
  bas: [...FELT, 'timer.andre', 'tilbud.skriv'],
  montor: [...FELT],
  laerling: [...FELT],
  // Regnskapsføreren er ikke i felt. Han fører ikke timer og oppretter ikke
  // ordrer — han markerer fakturert og sender til regnskapssystemet.
  regnskapsforer: ['faktura.marker', 'eksport.send'],
}

/** Har rollen denne retten? Ukjent rolle får nei. */
export function harVerktoyrett(rolle: string | null | undefined, rett: Verktoyrett): boolean {
  if (!rolle) return false
  const rettigheter = MATRISE[rolle as Rolle]
  return Array.isArray(rettigheter) && rettigheter.includes(rett)
}

/** Alle rettigheter for en rolle. Tom liste for ukjent rolle. */
export function verktoyrettigheter(rolle: string | null | undefined): Verktoyrett[] {
  if (!rolle) return []
  return MATRISE[rolle as Rolle] ?? []
}

/**
 * Handlinger som ALDRI skal kunne skje på stemme alene, uansett rolle.
 *
 * Handsfree i bil betyr en ulåst telefon i en holder. Alle i kupeen kan
 * snakke, og assistenten kan ikke høre forskjell. For alt som forlater firmaet
 * eller ikke kan gjøres om, er et fysisk trykk den eneste kvitteringen på at
 * det var brukeren selv som ville det.
 */
const KREVER_TRYKK: Verktoyrett[] = ['faktura.marker', 'eksport.send', 'arkiv.frys']

export function kreverFysiskTrykk(rett: Verktoyrett): boolean {
  return KREVER_TRYKK.includes(rett)
}

export type Avgjorelse =
  | { tillatt: true }
  | { tillatt: false; grunn: 'rolle' | 'krever_trykk'; beskjed: string }

/**
 * Avgjørelsen assistenten får tilbake.
 *
 * `beskjed` er skrevet TIL MODELLEN, ikke til brukeren, og den sier hva den
 * ikke skal gjøre. Uten den siste setningen prøver en hjelpsom modell gjerne
 * en omvei — den kaller et annet verktøy, eller foreslår at brukeren gjør det
 * selv på en måte som omgår sperren.
 */
export function kanKalle(rolle: string | null | undefined, rett: Verktoyrett): Avgjorelse {
  if (!harVerktoyrett(rolle, rett)) {
    return {
      tillatt: false,
      grunn: 'rolle',
      beskjed:
        `Rollen «${rolle ?? 'ukjent'}» har ikke lov til dette. Si det kort til brukeren, ` +
        'foreslå hvem i firmaet som kan gjøre det, og forsøk ingen annen vei rundt.',
    }
  }
  if (kreverFysiskTrykk(rett)) {
    return {
      tillatt: false,
      grunn: 'krever_trykk',
      beskjed:
        'Dette kan ikke gjøres med stemmen. Si at det ligger klart i appen og må bekreftes ' +
        'med et trykk når bilen står stille. Ikke spør om å få gjøre det likevel.',
    }
  }
  return { tillatt: true }
}

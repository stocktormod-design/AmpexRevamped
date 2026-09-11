// GENERERT AV tools/bygg-regnskap-funksjon.ts — IKKE REDIGER.
// Kilden er lib/accounting/adapter.ts. Endrer du den, kjør `npm run bygg:regnskap` på nytt,
// ellers deployer vi et annet regnestykke enn det appen viser.

import type { Fakturagrunnlag, MvaType } from '../invoicing.ts'

/**
 * Regnskapsadapter — ett grensesnitt, flere systemer.
 *
 * Uten dette havner Fiken-spesifikke felt spredd gjennom ordremodellen, og
 * adapter nummer to blir en omskriving i stedet for en fil.
 *
 * Prinsipper som gjelder alle implementasjoner:
 *  - Ampex utsteder aldri en faktura. Vi lager utkast. Mennesket trykker.
 *  - Regnskapssystemet eier fakturanummer og kunderegister når det er koblet.
 *  - Feil i integrasjonen skal aldri blokkere feltarbeid. Dette laget kalles
 *    som etterprosess, aldri i veien for montøren.
 */

/**
 * ── Hvem eier hva ───────────────────────────────────────────────────────────
 *
 * Undersøkt 20. august mot SpeedyCraft × Tripletex, som er den modne norske
 * referansen (Tripletex' egne integrasjonssider + Devincos support):
 *
 *   Tripletex → SpeedyCraft:  ansatte, produkter, leverandører
 *   SpeedyCraft → Tripletex:  timer
 *   TOVEIS:                   prosjekter, kunder
 *
 * Mønsteret er riktig i hovedsak: **regnskapet eier registrene, feltsystemet
 * eier arbeidet.** Det er den eneste delingen som gir én sannhet per ting.
 *
 * Men vi kopierer IKKE toveis på kunder. Toveis kundesynk mellom to systemer
 * som begge kan opprette en kunde er nettopp der duplikatene oppstår — og en
 * duplisert kunde betyr faktura til feil part. Derfor:
 *
 *   REGNSKAPET EIER:  kunder, ansatte, aktiviteter/lønnsarter, kontoplan
 *   AMPEX EIER:       ordre, timer, materiell, dokumentasjon, tilbud, signatur
 *
 * Oppretter montøren en kunde i felt, opprettes den i regnskapet FØRST og
 * `external_id` hentes tilbake. Kunden finnes ikke «i Ampex» før den har en ID
 * der ute. Det er ett ekstra nettkall ved sjeldne hendelser, mot en klasse feil
 * som er dyr og vanskelig å rydde opp i.
 *
 * Uten nett: kunden lages lokalt uten `external_id`, og ordren kan arbeides på —
 * men fakturagrunnlaget sier fra at den ikke kan sendes før koblingen er gjort.
 * Det er samme mønster som listepris kontra nettopris: bygg videre, men si
 * tydelig fra om hva som mangler.
 */
export type Regnskapssystem = 'fiken' | 'tripletex'

export type KundeUt = {
  navn: string
  erBedrift: boolean
  orgNr?: string | null
  epost?: string | null
  telefon?: string | null
  adresse?: string | null
  postnummer?: string | null
  poststed?: string | null
  /** Vår lokale ID — legges ved slik at svaret kan kobles tilbake. */
  lokalId: string
}

export type FakturautkastUt = {
  lokalOrdreId: string
  ordrenummer: number | null
  tittel: string
  /** Ekstern kunde-ID i regnskapssystemet. Må være synket først. */
  kundeEksternId: string
  /** Ordredato — brukes som fakturadato på utkastet. */
  dato: Date
  /** Antall dager til forfall. */
  forfallsdager: number
  grunnlag: Fakturagrunnlag
  /** Fri tekst øverst på fakturaen, f.eks. adressen jobben ble utført på. */
  ordreTekst?: string | null
}

export type AdapterResultat<T> =
  | { ok: true; verdi: T }
  | { ok: false; feil: string; kanProvesIgjen: boolean }

export interface Regnskapsadapter {
  readonly system: Regnskapssystem
  readonly navn: string

  /** Speiler kunden opp og returnerer ekstern ID. Idempotent på `lokalId`. */
  synkKunde(kunde: KundeUt): Promise<AdapterResultat<string>>

  /** Lager fakturaUTKAST. Returnerer utkast-ID. Utsteder aldri. */
  opprettFakturautkast(utkast: FakturautkastUt): Promise<AdapterResultat<string>>

  /** Status på et utkast/faktura. Brukes til å vise «betalt» i appen. */
  hentFakturastatus(eksternId: string): Promise<AdapterResultat<Fakturastatus>>
}

export type Fakturastatus = 'utkast' | 'sendt' | 'betalt' | 'forfalt' | 'kreditert' | 'ukjent'

/**
 * MVA-oversettelse. Ampex' domenetyper er nøytrale; hvert system har sine
 * strenger, og de er ikke like. Feil her gir feil mva på ekte penger, så
 * tabellen står eksplisitt i stedet for å gjettes med en `toUpperCase()`.
 */
export const MVA_FIKEN: Record<MvaType, string> = {
  hoy: 'HIGH',
  middels: 'MEDIUM',
  lav: 'LOW',
  fritatt: 'EXEMPT',
}

export const MVA_TRIPLETEX: Record<MvaType, string> = {
  hoy: '3',      // Utgående 25 %
  middels: '31', // Utgående 15 %
  lav: '32',     // Utgående 12 %
  fritatt: '5',  // Fritatt
}

import type { Fakturagrunnlag, MvaType } from '../invoicing'

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

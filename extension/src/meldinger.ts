/** Meldingene mellom siden, popupen og bakgrunnen. */

export type Pris = {
  grossist: string
  pris: number
  /** Grossistens listepris, ikke firmaets — sammenlignes aldri med en nettopris. */
  erListepris: boolean
  utgaar: boolean
  lagerfort: boolean | null
}

export type Vare = {
  elnummer: string
  navn: string | null
  enhet: string
  produktId: string | null
  /** Stigende, som i appens prisbilde. */
  priser: Pris[]
  /** Grossisten prisbildet tør å kalle billigst, eller null. */
  billigste: string | null
}

export type Foresporsel =
  | { type: 'status' }
  | { type: 'logginn'; epost: string; passord: string }
  | { type: 'loggut' }
  | { type: 'vare'; elnummer: string }
  | { type: 'legg'; elnummer: string; grossist: string; antall: number; navn: string | null; enhet: string; produktId: string | null }

export type Svar =
  | { ok: true; epost: string | null; vare?: Vare; linjer?: number }
  | { ok: false; feil: string }

export function spor(f: Foresporsel): Promise<Svar> {
  return chrome.runtime.sendMessage(f)
}

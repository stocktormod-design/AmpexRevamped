/**
 * Tilbud — fra linjer til pris.
 *
 * Samme prinsipp som lib/invoicing.ts: regnestykket ligger i rene funksjoner
 * uten database, slik at det kan selvtestes (`npm run verify:quoting`), og
 * penger regnes i **øre som heltall**.
 *
 * Et tilbud er ikke en faktura, og modellen skal ikke late som. Tre forskjeller
 * styrer designet:
 *
 *   1. Et tilbud har RABATT per linje. En faktura har det ikke — der er prisen
 *      allerede avtalt. Rabatten er dessuten det kunden husker, så den må stå
 *      igjen på linja og ikke smøres inn i enhetsprisen.
 *   2. Et tilbud har FRITEKSTLINJER uten beløp: mellomoverskrifter, forbehold,
 *      «leveres uten stillas». De teller null, men de er halve dokumentet.
 *   3. Et tilbud har DEKNINGSBIDRAG som skal ses FØR det sendes, ikke etter.
 *      Det er det eneste tidspunktet tallet kan endre noe.
 */
import {
  fraOre, linjebelopOre, mvaBelopOre, somMvaType, tilOre,
  type MvaType,
} from './invoicing'

export type TilbudslinjeArt =
  | 'materiell' // vare, evt. fra varekartoteket
  | 'arbeid'    // timer/aktivitet priset på forhånd
  | 'tekst'     // overskrift eller forbehold — ingen beløp

export type TilbudslinjeInn = {
  id: string
  art: TilbudslinjeArt
  beskrivelse: string
  antall?: number | null
  enhet?: string | null
  enhetsprisKr?: number | null
  kostprisKr?: number | null
  /** 0–100. Vises på linja fordi det er den kunden husker. */
  rabattProsent?: number | null
  mvaType?: string | null
  elnummer?: string | null
}

export type Tilbudslinje = {
  id: string
  art: TilbudslinjeArt
  beskrivelse: string
  antall: number
  enhet: string
  enhetsprisOre: number
  rabattProsent: number
  mva: MvaType
  /** Beløp før rabatt — trengs for å kunne vise «du sparer X». */
  bruttoLinjeOre: number
  rabattOre: number
  nettoOre: number
  mvaOre: number
  totalOre: number
  kostOre: number | null
  elnummer?: string | null
}

export type Tilbudssum = {
  linjer: Tilbudslinje[]
  nettoOre: number
  mvaOre: number
  bruttoOre: number
  rabattOre: number
  kostOre: number
  /** Dekningsbidrag i øre og prosent av netto. null når ingen kost er kjent. */
  dbOre: number | null
  dbProsent: number | null
  mvaFordeling: { mva: MvaType; nettoOre: number; mvaOre: number }[]
}

/** 0 utenfor 0–100, ellers verdien. En «rabatt» på 150 % er alltid en tastefeil. */
export function somRabatt(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  if (v <= 0) return 0
  return v > 100 ? 100 : v
}

/**
 * Nettobeløp for én linje. Avrunding skjer ÉN gang, etter rabatten — ikke
 * først på linjebeløpet og så på rabatten. To avrundinger på samme linje gir
 * et øre som ikke stemmer med det kunden kan regne ut selv av tallene på arket.
 */
export function linjeNettoOre(antall: number, enhetsprisOre: number, rabattProsent: number): number {
  const rabatt = somRabatt(rabattProsent)
  return Math.round(antall * enhetsprisOre * (1 - rabatt / 100))
}

function normaliser(l: TilbudslinjeInn): Tilbudslinje {
  const mva = somMvaType(l.mvaType)
  if (l.art === 'tekst') {
    return {
      id: l.id, art: 'tekst', beskrivelse: l.beskrivelse,
      antall: 0, enhet: '', enhetsprisOre: 0, rabattProsent: 0, mva,
      bruttoLinjeOre: 0, rabattOre: 0, nettoOre: 0, mvaOre: 0, totalOre: 0, kostOre: null,
    }
  }
  const antall = typeof l.antall === 'number' && Number.isFinite(l.antall) ? l.antall : 0
  const enhetsprisOre = typeof l.enhetsprisKr === 'number' ? tilOre(l.enhetsprisKr) : 0
  const rabattProsent = somRabatt(l.rabattProsent)
  const bruttoLinjeOre = linjebelopOre(antall, enhetsprisOre)
  const nettoOre = linjeNettoOre(antall, enhetsprisOre, rabattProsent)
  const mvaOre = mvaBelopOre(nettoOre, mva)
  return {
    id: l.id,
    art: l.art,
    beskrivelse: l.beskrivelse,
    antall,
    enhet: l.enhet ?? (l.art === 'arbeid' ? 't' : 'stk'),
    enhetsprisOre,
    rabattProsent,
    mva,
    bruttoLinjeOre,
    rabattOre: bruttoLinjeOre - nettoOre,
    nettoOre,
    mvaOre,
    totalOre: nettoOre + mvaOre,
    kostOre: typeof l.kostprisKr === 'number' ? linjebelopOre(antall, tilOre(l.kostprisKr)) : null,
    elnummer: l.elnummer ?? null,
  }
}

/** Summerer tilbudet. Rekkefølgen på linjene er brukerens — den røres ikke. */
export function byggTilbudssum(input: TilbudslinjeInn[]): Tilbudssum {
  const linjer = input.map(normaliser)

  let nettoOre = 0, mvaOre = 0, rabattOre = 0, kostOre = 0
  let harKost = false
  const perMva = new Map<MvaType, { nettoOre: number; mvaOre: number }>()

  for (const l of linjer) {
    nettoOre += l.nettoOre
    mvaOre += l.mvaOre
    rabattOre += l.rabattOre
    if (l.kostOre !== null) { kostOre += l.kostOre; harKost = true }
    if (l.art === 'tekst') continue
    const bucket = perMva.get(l.mva) ?? { nettoOre: 0, mvaOre: 0 }
    bucket.nettoOre += l.nettoOre
    bucket.mvaOre += l.mvaOre
    perMva.set(l.mva, bucket)
  }

  const dbOre = harKost ? nettoOre - kostOre : null
  return {
    linjer,
    nettoOre,
    mvaOre,
    bruttoOre: nettoOre + mvaOre,
    rabattOre,
    kostOre,
    dbOre,
    // Dekningsbidrag i prosent av SALGSPRIS, som i faget — ikke påslag på kost.
    dbProsent: dbOre !== null && nettoOre > 0 ? Math.round((dbOre / nettoOre) * 1000) / 10 : null,
    mvaFordeling: [...perMva.entries()]
      .map(([mva, v]) => ({ mva, ...v }))
      .sort((a, b) => b.nettoOre - a.nettoOre),
  }
}

/* ── Status og livsløp ────────────────────────────────────────────────── */

export type TilbudStatus = 'utkast' | 'sendt' | 'akseptert' | 'avslatt' | 'utlopt'

export const tilbudStatusLabel: Record<TilbudStatus, string> = {
  utkast: 'Utkast',
  sendt: 'Sendt',
  akseptert: 'Akseptert',
  avslatt: 'Avslått',
  utlopt: 'Utløpt',
}

export function somTilbudStatus(v: string | null | undefined): TilbudStatus {
  return v === 'sendt' || v === 'akseptert' || v === 'avslatt' || v === 'utlopt' ? v : 'utkast'
}

/**
 * «Utløpt» lagres ALDRI som status i basen — det er en funksjon av dato, og en
 * rad som må skrives om ved midnatt trenger en jobb ingen har skrevet. Den
 * regnes ut i visningen i stedet.
 *
 * Et akseptert eller avslått tilbud utløper ikke: avgjørelsen er tatt.
 */
export function effektivStatus(status: TilbudStatus, gyldigTil: number | null, naa: number): TilbudStatus {
  if (status !== 'sendt' || gyldigTil === null) return status
  return naa > gyldigTil ? 'utlopt' : 'sendt'
}

/** Et tilbud kan endres så lenge kunden ikke har sett det eller svart. */
export function kanRedigeres(status: TilbudStatus): boolean {
  return status === 'utkast'
}

/** Kroner ut, for felt som redigeres i kroner. */
export const oreTilKroner = fraOre

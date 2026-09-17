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
  fraOre, linjebelopOre, linjeNettoOre, mvaBelopOre, somMvaType, somRabatt, tilOre,
  type MvaType,
} from './invoicing'

// Rabattregelen bor i lib/invoicing.ts sammen med resten av pengematematikken —
// tilbudet og fakturaen MÅ runde likt, ellers spriker det kunden ble lovet fra
// det kunden får. Re-eksporteres her fordi tilbudslaget er der de brukes.
export { linjeNettoOre, somRabatt }

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
  /** Området linja hører til. null/ukjent = rett i tilbudet. */
  omradeId?: string | null
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
  omradeId: string | null
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
function normaliser(l: TilbudslinjeInn): Tilbudslinje {
  const mva = somMvaType(l.mvaType)
  if (l.art === 'tekst') {
    return {
      id: l.id, art: 'tekst', beskrivelse: l.beskrivelse,
      antall: 0, enhet: '', enhetsprisOre: 0, rabattProsent: 0, mva,
      bruttoLinjeOre: 0, rabattOre: 0, nettoOre: 0, mvaOre: 0, totalOre: 0, kostOre: null,
      omradeId: l.omradeId ?? null,
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
    omradeId: l.omradeId ?? null,
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

/* ── Påslag ───────────────────────────────────────────────────────────── */

/**
 * Påslag i prosent av KOST — «hva legger vi på inn-prisen».
 *
 * Ikke det samme som dekningsbidrag, som er av SALGSPRIS. 100 kr kjøpt inn og
 * solgt for 150 er 50 % påslag og 33 % DB. Begge tallene er riktige, og begge
 * brukes i faget: påslaget er det man taster inn, DB er det man tjener.
 *
 * Regnes per enhet og FØR rabatt, fordi det er slik det tastes: prisen settes
 * av kost + påslag, og rabatten gis etterpå — den er noe kunden får, ikke noe
 * som endrer hva varen kostet oss.
 */
export function paslagProsent(kostOre: number | null | undefined, prisOre: number): number | null {
  if (kostOre === null || kostOre === undefined || kostOre <= 0) return null
  return Math.round(((prisOre - kostOre) / kostOre) * 1000) / 10
}

/** Salgspris i øre fra kost og påslag. Negativt påslag er lov — det er et varsel, ikke en feil. */
export function prisFraPaslagOre(kostOre: number, paslagProsent: number): number {
  if (!Number.isFinite(kostOre) || !Number.isFinite(paslagProsent)) return 0
  return Math.max(0, Math.round(kostOre * (1 + paslagProsent / 100)))
}

/* ── Områder ──────────────────────────────────────────────────────────── */

/**
 * Et område i tilbudet: «Stue», «1. etasje», «Utvendig».
 *
 * Montøren deler uansett opp tilbudet — i dag med tekstlinjer som overskrifter.
 * Forskjellen på en overskrift og et område er at området SUMMERER: kunden som
 * spør «hva koster bare kjøkkenet» får svaret uten at noen regner for hånd, og
 * han som skal kutte 20 000 ser hvilket rom pengene ligger i.
 */
export type Omrade = {
  id: string
  /** Bygg → etasje → rom. null = øverste nivå. */
  forelderId: string | null
  navn: string
  sortOrder: number
}

export type OmradeSum = {
  id: string
  navn: string
  /** 0 = øverste nivå. Visningen rykker inn etter dette. */
  niva: number
  /** Linjene som ligger DIREKTE her, i brukerens rekkefølge. */
  linjer: Tilbudslinje[]
  /** Egne linjer PLUSS alle underområders — det er tallet kunden spør om. */
  nettoOre: number
  mvaOre: number
  bruttoOre: number
  /** null når ingen linje i området har kjent kost. */
  kostOre: number | null
  dbOre: number | null
  dbProsent: number | null
  /** Linjer i hele grenen, underområder medregnet. */
  antallLinjer: number
}

export type TilbudsInnhold = {
  /**
   * Linjer uten område. De ligger FØRST: et tilbud uten områder skal se ut
   * nøyaktig som før, og en linje skal aldri bli usynlig fordi området den
   * pekte på ble slettet.
   */
  utenOmrade: Tilbudslinje[]
  /** Områdene i visningsrekkefølge — dybde først, barn rett under forelder. */
  omrader: OmradeSum[]
}

/**
 * Forelderpekere uten ringer. En peker til et område som ikke finnes (slettet),
 * eller en ring (A under B under A), gjør området til et rotområde.
 *
 * Samme vern som tegningsmappene (lib/tegning-tre.ts, `verify:tegning-tre`):
 * en ring henger visningen for alltid, den viser ikke bare feil tall.
 */
function forelderUtenRing(omrader: Omrade[]): Map<string, string | null> {
  const kjent = new Map(omrader.map(o => [o.id, o]))
  const ut = new Map<string, string | null>()
  for (const o of omrader) {
    const start = o.forelderId && kjent.has(o.forelderId) ? o.forelderId : null
    let p: string | null = start
    const sett = new Set<string>([o.id])
    let ring = false
    while (p) {
      if (sett.has(p)) { ring = true; break }
      sett.add(p)
      const neste = kjent.get(p)!.forelderId
      p = neste && kjent.has(neste) ? neste : null
    }
    ut.set(o.id, ring ? null : start)
  }
  return ut
}

/**
 * Deler linjene i områder. Regnestykket er alt gjort av `byggTilbudssum` —
 * dette flytter bare på de ferdige linjene og ruller sammen.
 *
 * Garantien selvtesten holder den til: SUMMEN AV ALLE OMRÅDENE PÅ ØVERSTE NIVÅ
 * PLUSS LINJENE UTEN OMRÅDE ER LIK TILBUDETS SUM. Ingen linje telles to ganger,
 * ingen faller ut.
 */
export function grupperTilbud(linjer: Tilbudslinje[], omrader: Omrade[]): TilbudsInnhold {
  const kjent = new Set(omrader.map(o => o.id))
  const forelder = forelderUtenRing(omrader)

  const egne = new Map<string, Tilbudslinje[]>()
  const utenOmrade: Tilbudslinje[] = []
  for (const l of linjer) {
    if (l.omradeId && kjent.has(l.omradeId)) {
      const bunke = egne.get(l.omradeId) ?? []
      bunke.push(l)
      egne.set(l.omradeId, bunke)
    } else {
      // Ukjent område = slettet område. Linja hører hjemme i tilbudet igjen,
      // ikke i et hull. Penger som forsvinner fra en sum er verre enn rot.
      utenOmrade.push(l)
    }
  }

  const barn = new Map<string | null, Omrade[]>()
  for (const o of omrader) {
    const nokkel = forelder.get(o.id) ?? null
    const bunke = barn.get(nokkel) ?? []
    bunke.push(o)
    barn.set(nokkel, bunke)
  }
  // Stabil rekkefølge: brukerens sortOrder, så id — to områder med samme tall
  // skal ikke bytte plass mellom to renders.
  for (const bunke of barn.values()) {
    bunke.sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  const ut: OmradeSum[] = []
  function gaa(o: Omrade, niva: number): OmradeSum {
    const mine = egne.get(o.id) ?? []
    const rad: OmradeSum = {
      id: o.id,
      navn: o.navn,
      niva,
      linjer: mine,
      nettoOre: 0, mvaOre: 0, bruttoOre: 0,
      kostOre: null, dbOre: null, dbProsent: null,
      antallLinjer: mine.length,
    }
    ut.push(rad)

    let kost = 0
    let harKost = false
    for (const l of mine) {
      rad.nettoOre += l.nettoOre
      rad.mvaOre += l.mvaOre
      if (l.kostOre !== null) { kost += l.kostOre; harKost = true }
    }
    for (const b of barn.get(o.id) ?? []) {
      const under = gaa(b, niva + 1)
      rad.nettoOre += under.nettoOre
      rad.mvaOre += under.mvaOre
      rad.antallLinjer += under.antallLinjer
      if (under.kostOre !== null) { kost += under.kostOre; harKost = true }
    }
    rad.bruttoOre = rad.nettoOre + rad.mvaOre
    rad.kostOre = harKost ? kost : null
    rad.dbOre = harKost ? rad.nettoOre - kost : null
    rad.dbProsent = rad.dbOre !== null && rad.nettoOre > 0
      ? Math.round((rad.dbOre / rad.nettoOre) * 1000) / 10
      : null
    return rad
  }
  for (const rot of barn.get(null) ?? []) gaa(rot, 0)

  return { utenOmrade, omrader: ut }
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

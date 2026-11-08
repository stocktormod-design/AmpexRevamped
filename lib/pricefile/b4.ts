/**
 * EFO/NELFO Bestilling 4.0 — bestillingsfila (B4) vi sender til grossisten.
 *
 * Spec: E-NBestilling 4.0, rev. 2004-06-18 (EFO/NELFO, speilet hos Brødrene Dahl).
 * Søster av `efo-nelfo.ts`, som leser V4/P4 — samme regler, motsatt vei:
 *
 *   - tegnseparert tekst, semikolon mellom felt, INGEN avsluttende semikolon
 *     (som fixturen V4_eksempel.txt), poster skilles med CR+LF
 *   - tegnsett Windows ANSI (CP1252) — IKKE UTF-8
 *   - filnavn begynner alltid med `B4`
 *   - én BH-hodepost, så BL-linjene, BT-fritekst rett etter posten den gjelder,
 *     BA-alternativer sist under linja
 *   - `Ant` har 2 implisitte desimaler: 12,5 m skrives `1250`
 *
 * REN FUNKSJON: ingen database, ingen nett. Inn kommer en bestilling, ut kommer
 * tekst, bytes og filnavn — eller en liste med feil som sier hvorfor den ikke
 * kan sendes. Utsending (sFTP eller e-post) ligger et annet sted.
 *
 * Feltregelen: identifikatorer (BestNr, KundeNr, VareNr) som er for lange er en
 * FEIL — en avkuttet kundenummer er en bestilling til feil kunde. Fritekst som er
 * for lang (navn, varetekst, adresse) kortes ned stille; et avkuttet gatenavn
 * leverer fortsatt riktig.
 */

export type B4VareMerke = 'ukjent' | 'elnummer' | 'ean' | 'produsent' | 'nrf'

export type B4Part = {
  /** 9 siffer. Skrives `NO<orgnr>MVA` (eller uten MVA når `mvaPliktig` er false). */
  orgnr: string
  mvaPliktig?: boolean
  firmanavn?: string
  adresse1?: string
  adresse2?: string
  postnr?: string
  poststed?: string
  landkode?: string
}

export type B4Kontakt = {
  navn?: string
  telefon?: string
  mobil?: string
  epost?: string
}

/** Hvor varene skal. `standard` = kjøpers vanlige leveringsadresse hos grossisten. */
export type B4Levering =
  | { type: 'standard' }
  | { type: 'hent'; lager?: string }
  | { type: 'adresse'; navn: string; adresse1: string; adresse2?: string; postnr: string; poststed: string; landkode?: string }

export type B4Linje = {
  vareMerke: B4VareMerke
  vareNr: string
  tekst: string
  tekst2?: string
  /** I prisenheter, f.eks. 12.5 (meter). Maks 2 desimaler. */
  antall: number
  /** UN CommonCode som i prisfila: PCE, MTR, LTR, KGM … */
  prisEnhet: string
  kjoperVareNr?: string
  /** ÅÅÅÅ-MM-DD, bare når linja avviker fra bestillingens dato. */
  leveringsdato?: string
  referanse?: string
  delLevering?: boolean
  alternativTillatt?: boolean
  alternativer?: { vareMerke: B4VareMerke; vareNr: string }[]
  fritekst?: string
}

export type B4Bestilling = {
  /** Kjøpers bestillingsnummer, unikt. Maks 10 tegn. */
  bestNr: string
  /** Kjøpers kundenummer hos grossisten. Påkrevd. */
  kundeNr: string
  kjoper: B4Part
  kontakt?: B4Kontakt
  selger?: B4Part
  /** Ampex-ordren varene er til (KOrdNr) — kommer tilbake på fakturaen. */
  ordreNr?: string
  prosjektNr?: string
  avtale?: { type: 'rabatt' | 'tilbud' | 'prosjekt'; id: string }
  kjopersRef?: string
  /** Tekst på pakkelappen. */
  merket?: string
  /** Til transportør / ordrebehandler. */
  melding?: string
  /** ÅÅÅÅ-MM-DD */
  leveringsdato?: string
  levering?: B4Levering
  /** Hvordan grossisten skal bekrefte. Standard: C4-fil (`4`). */
  bekreftelse?: 'efonelfo' | 'epost' | 'sms'
  /** Standard `3` (håndholdt enhet). Kontoret bruker `8`. */
  opprinnelse?: 'telefon-app' | 'kontor'
  fritekst?: string
  linjer: B4Linje[]
}

export type B4Resultat =
  | { ok: true; tekst: string; bytes: Uint8Array; filnavn: string }
  | { ok: false; feil: string[] }

const VARE_MERKE: Record<B4VareMerke, string> = {
  ukjent: '0', elnummer: '1', ean: '2', produsent: '3', nrf: '4',
}

/** Montørens enhet → prisfilas CommonCode, når linja ikke har prisenheten fra prisfila. */
export const PRIS_ENHET: Record<string, string> = {
  stk: 'PCE', m: 'MTR', l: 'LTR', kg: 'KGM',
}

/**
 * CP1252 0x80–0x9F. Resten av 0x00–0xFF er likt Unicode (latin1), som dekker æøå.
 * Tegn utenfor blir `?` — en bestilling skal aldri feile på et emoji i en merknad.
 */
const CP1252_HOYT: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

export function kodAnsi(tekst: string): Uint8Array {
  const ut: number[] = []
  for (const tegn of tekst) {
    const k = tegn.codePointAt(0)!
    if (k < 0x80 || (k >= 0xa0 && k <= 0xff)) ut.push(k)
    else ut.push(CP1252_HOYT[k] ?? 0x3f)
  }
  return Uint8Array.from(ut)
}

/** Semikolon og linjeskift er forbudt inne i felt. */
function rens(s: string | undefined | null): string {
  return (s ?? '').replace(/;/g, ',').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

function kort(s: string | undefined | null, maks: number): string {
  return rens(s).slice(0, maks)
}

function dato(s: string | undefined): string {
  return s ? s.replace(/-/g, '') : ''
}

/** Deler fritekst i BT-poster à maks 30 tegn, på ordgrenser der det går. */
function friteksPoster(tekst: string | undefined, prefiks: string): string[] {
  const ord = rens(tekst).split(' ').filter(Boolean)
  const poster: string[] = []
  let linje = ''
  for (const o of ord) {
    if (o.length > 30) {
      if (linje) { poster.push(linje); linje = '' }
      for (let i = 0; i < o.length; i += 30) poster.push(o.slice(i, i + 30))
      continue
    }
    const ny = linje ? `${linje} ${o}` : o
    if (ny.length > 30) { poster.push(linje); linje = o } else linje = ny
  }
  if (linje) poster.push(linje)
  return poster.map(p => `${prefiks};${p}`)
}

export function foretaksId(part: B4Part): string {
  return `NO${part.orgnr.replace(/\D/g, '')}${part.mvaPliktig === false ? '' : 'MVA'}`
}

/** Antall med 2 implisitte desimaler. 12.5 → "1250". */
export function antallFelt(antall: number): string {
  return String(Math.round(antall * 100))
}

export function validerB4(b: B4Bestilling): string[] {
  const feil: string[] = []
  const id = (navn: string, verdi: string | undefined, maks: number, paakrevd: boolean) => {
    const v = rens(verdi)
    if (!v) { if (paakrevd) feil.push(`${navn} mangler`); return }
    if (v.length > maks) feil.push(`${navn} «${v}» er lengre enn ${maks} tegn`)
  }
  id('Bestillingsnummer', b.bestNr, 10, true)
  id('Kundenummer hos grossisten', b.kundeNr, 10, true)
  id('Ordrenummer', b.ordreNr, 10, false)
  id('Prosjektnummer', b.prosjektNr, 10, false)
  if (b.avtale) id('Avtale-id', b.avtale.id, 10, true)
  if (!/^\d{9}$/.test(b.kjoper.orgnr.replace(/\D/g, ''))) feil.push(`Kjøpers orgnr «${b.kjoper.orgnr}» er ikke 9 siffer`)
  if (b.selger && !/^\d{9}$/.test(b.selger.orgnr.replace(/\D/g, ''))) feil.push(`Grossistens orgnr «${b.selger.orgnr}» er ikke 9 siffer`)
  if (b.leveringsdato && !/^\d{4}-\d{2}-\d{2}$/.test(b.leveringsdato)) feil.push(`Leveringsdato «${b.leveringsdato}» er ikke ÅÅÅÅ-MM-DD`)
  if (b.bekreftelse === 'epost' && !b.kontakt?.epost) feil.push('Bekreftelse på e-post krever kontaktens e-post')
  if (b.bekreftelse === 'sms' && !b.kontakt?.mobil) feil.push('Bekreftelse på SMS krever kontaktens mobil')
  if (b.levering?.type === 'adresse') {
    const l = b.levering
    if (!rens(l.navn) || !rens(l.adresse1) || !rens(l.postnr) || !rens(l.poststed)) feil.push('Leveringsadressen mangler navn, adresse, postnr eller poststed')
  }
  if (b.linjer.length === 0) feil.push('Bestillingen har ingen linjer')
  if (b.linjer.length > 9999) feil.push('Mer enn 9999 linjer i én bestilling')
  b.linjer.forEach((l, i) => {
    const hvor = `Linje ${i + 1} (${rens(l.tekst) || l.vareNr})`
    id(`${hvor}: varenummer`, l.vareNr, 14, true)
    if (l.vareMerke === 'elnummer' && !/^\d{7}$/.test(rens(l.vareNr))) feil.push(`${hvor}: el-nummer «${l.vareNr}» er ikke 7 siffer`)
    if (l.vareMerke === 'ean' && !/^\d{8,14}$/.test(rens(l.vareNr))) feil.push(`${hvor}: EAN «${l.vareNr}» er ikke 8–14 siffer`)
    if (!rens(l.tekst)) feil.push(`${hvor}: varetekst mangler`)
    if (!(l.antall > 0)) feil.push(`${hvor}: antall må være over 0`)
    else if (Math.abs(l.antall * 100 - Math.round(l.antall * 100)) > 1e-6) feil.push(`${hvor}: antall ${l.antall} har mer enn 2 desimaler`)
    else if (antallFelt(l.antall).length > 9) feil.push(`${hvor}: antall ${l.antall} er for stort`)
    if (!/^[A-Z0-9]{1,3}$/.test(rens(l.prisEnhet))) feil.push(`${hvor}: prisenhet «${l.prisEnhet}» er ikke en CommonCode (PCE, MTR …)`)
    if (l.leveringsdato && !/^\d{4}-\d{2}-\d{2}$/.test(l.leveringsdato)) feil.push(`${hvor}: leveringsdato er ikke ÅÅÅÅ-MM-DD`)
    l.alternativer?.forEach(a => id(`${hvor}: alternativ varenummer`, a.vareNr, 14, true))
  })
  return feil
}

export function skrivB4(b: B4Bestilling, naa: Date = new Date()): B4Resultat {
  const feil = validerB4(b)
  if (feil.length > 0) return { ok: false, feil }

  const k = b.kjoper
  const s = b.selger
  const lev = b.levering ?? { type: 'standard' }
  const adr = lev.type === 'adresse' ? lev : null
  const kt = b.kontakt ?? {}

  const bh = [
    'BH', 'EFONELFO', '4.0',
    s ? foretaksId(s) : '',
    foretaksId(k),
    rens(b.bestNr),
    rens(b.kundeNr),
    b.avtale ? { rabatt: 'R', tilbud: 'T', prosjekt: 'P' }[b.avtale.type] : '',
    b.avtale ? rens(b.avtale.id) : '',
    rens(b.ordreNr),
    '', // KundAvd
    rens(b.prosjektNr),
    '', '', // KLagerMrk, KLager
    '', lev.type === 'hent' ? kort(lev.lager, 14) : '', // SLagerMrk, SLager
    '', // EksternRef
    kort(b.kjopersRef, 25),
    kort(b.merket, 25),
    { efonelfo: '4', epost: 'E', sms: 'S' }[b.bekreftelse ?? 'efonelfo'],
    '', // TransportMåte — må avtales
    kort(b.melding ?? (lev.type === 'hent' ? 'Hentes' : ''), 25),
    dato(b.leveringsdato),
    b.opprinnelse === 'kontor' ? '8' : '3',
    '', // LAdrLok
    kort(adr?.navn, 35), kort(adr?.adresse1, 35), kort(adr?.adresse2, 35),
    kort(adr?.postnr, 9), kort(adr?.poststed, 35), adr ? kort(adr.landkode ?? 'NO', 2) : '',
    kort(k.firmanavn, 35), kort(k.adresse1, 35), kort(k.adresse2, 35),
    kort(k.postnr, 9), kort(k.poststed, 35), kort(k.landkode ?? 'NO', 2),
    kort(kt.navn, 35), kort(kt.telefon, 15), kort(kt.mobil, 15), '', kort(kt.epost, 60), '',
    kort(s?.firmanavn, 35), kort(s?.adresse1, 35), kort(s?.adresse2, 35),
    kort(s?.postnr, 9), kort(s?.poststed, 35), s ? kort(s.landkode ?? 'NO', 2) : '',
  ]
  if (bh.length !== 49) throw new Error(`BH har ${bh.length} felt, spec sier 49`)

  const poster: string[] = [bh.join(';'), ...friteksPoster(b.fritekst, 'BT')]

  b.linjer.forEach((l, i) => {
    const bl = [
      'BL', String(i + 1), rens(b.bestNr),
      VARE_MERKE[l.vareMerke], rens(l.vareNr),
      kort(l.tekst, 30), kort(l.tekst2, 30),
      antallFelt(l.antall), rens(l.prisEnhet),
      kort(l.kjoperVareNr, 25), dato(l.leveringsdato), kort(l.referanse, 25),
      l.delLevering === false ? 'N' : '',
      l.alternativTillatt === false ? 'N' : '',
    ]
    if (bl.length !== 14) throw new Error(`BL har ${bl.length} felt, spec sier 14`)
    poster.push(bl.join(';'))
    poster.push(...friteksPoster(l.fritekst, 'BT'))
    for (const a of l.alternativer ?? []) poster.push(['BA', VARE_MERKE[a.vareMerke], rens(a.vareNr)].join(';'))
  })

  const tekst = poster.join('\r\n') + '\r\n'
  const stempel = naa.toISOString().replace(/\D/g, '').slice(0, 14)
  const filnavn = `B4_${rens(b.bestNr).replace(/[^A-Za-z0-9-]/g, '')}_${stempel}.txt`
  return { ok: true, tekst, bytes: kodAnsi(tekst), filnavn }
}

/**
 * Egenskaper ut av varenavnet: farge, IP-klasse, leder, spenning, strøm,
 * utløsekarakteristikk, jordfeilstrøm, poler, effekt, lumen, fargetemperatur.
 *
 * Grossistenes standardfil har ingen egne felt for dette (Solar V4: 0 %
 * typebetegnelse, 0 % bilde, 0 % ETIM), men navnet har det ofte:
 * «PFXP 3G2,5 ER 300/500V», «iC60 RCBO 2P 20A B 30MA JFA», «Dobbel stikkontakt
 * sort», «URBINO 53W 6050lm 3000K». EFObasen har feltene ordentlig, men koster
 * 29 412 kr i året og forbyr videreformidling (docs/KONKURRENTANALYSE.md).
 *
 * **Dette er en tolkning, ikke fasit.** Den skal hellere si ingenting enn
 * noe feil: et mål som «200x200x130» er ikke en kabel, og «D300» på en
 * downlight er ikke en D-automat på 300 A. Derfor er hver regel strammet inn
 * mot det som faktisk står i katalogen, og selvtesten (`npm run
 * verify:egenskaper`) holder den mot ekte navn — også dem den skal la være.
 */

export type Egenskaper = {
  farge?: string
  /** «IP44», «IP2X», «IP69K». */
  ip?: string
  /** Leder slik elektrikeren sier det: «3G2,5», «4×16», «2×1,5/1,5», «4×2×0,5», «25 mm²». */
  leder?: string
  /** «300/500 V», «1 kV», «230 V», «24 VDC». */
  spenning?: string
  /** Merkestrøm i ampere. */
  stromA?: number
  /** Utløsekarakteristikk med merkestrøm: «C16», «B20». */
  kurve?: string
  /** Jordfeilstrøm i milliampere. */
  jordfeilMa?: number
  /** «1P», «2P», «3P+N», «4P+J». */
  poler?: string
  effektW?: number
  lumen?: number
  kelvin?: number
}

/**
 * Ordgrense som forstår æ, ø og å: `\b` i JavaScript gjør ikke det, så
 * «Grå» og «Lysblå» ble aldri funnet med vanlige ordgrenser.
 */
const ord = (kjerne: string) => new RegExp(`(?<![\\p{L}\\d])(?:${kjerne})(?![\\p{L}\\d])`, 'iu')

const FARGER: [RegExp, string][] = [
  [ord('gul\\s?/\\s?gr[øo]nn'), 'Gul/grønn'],
  [ord('antrasitt'), 'Antrasitt'],
  [ord('lysbl[åa]'), 'Lysblå'],
  [ord('hvit'), 'Hvit'],
  [ord('sort|svart'), 'Sort'],
  [ord('gr[åa]'), 'Grå'],
  [ord('s[øo]lv'), 'Sølv'],
  [ord('krom'), 'Krom'],
  [ord('messing'), 'Messing'],
  [ord('r[øo]d'), 'Rød'],
  [ord('bl[åa]'), 'Blå'],
  [ord('gr[øo]nn'), 'Grønn'],
  [ord('gul'), 'Gul'],
  [ord('brun'), 'Brun'],
  [ord('beige'), 'Beige'],
  [ord('oransje'), 'Oransje'],
]

/** Tverrsnittene som faktisk finnes (mm²). Et tall utenfor lista er et mål, ikke en leder. */
const TVERRSNITT = new Set([0.14, 0.2, 0.25, 0.34, 0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630])

/** Spenningene som finnes på varer. «MP-956 V» er en modellkode, ikke 956 volt. */
const SPENNINGER = new Set([6, 12, 24, 36, 42, 48, 60, 110, 120, 125, 127, 208, 220, 230, 240, 250, 277, 380, 400, 415, 440, 450, 480, 500, 600, 690, 750, 1000])

/** Ord som sier at varen er en vernekomponent — der «C16» betyr en automat. */
const VERN = /(automat|jordfeil|rcbo|\bjfa\b|\bmcb\b|\bvern\b|sikr|\bFAZ\b|\biC60|\bS20\d|\bS30\d|\bDS20\d|5SY|5SV)/i

function tall(s: string): number {
  return Number(s.replace(',', '.'))
}

function komma(n: number): string {
  return String(n).replace('.', ',')
}

export function egenskaperFraNavn(navn: string): Egenskaper {
  const ut: Egenskaper = {}
  const n = ` ${navn} `

  // Farge: første treff i fast rekkefølge (antrasitt før grå, lysblå før blå), eller RAL-kode.
  for (const [re, farge] of FARGER) if (re.test(n)) { ut.farge = farge; break }
  if (!ut.farge) {
    const ral = /\bRAL\s?(\d{4})\b/i.exec(n)
    if (ral) ut.farge = `RAL ${ral[1]}`
  }

  const ip = /\bIP\s?(\d{2}K?|\dX|X\d)\b/i.exec(n)
  if (ip) ut.ip = `IP${ip[1].toUpperCase()}`

  // Leder. G-form er alltid en kabel («3G2,5»). X-form bare når tverrsnittet
  // finnes og ingen tredje dimensjon følger («200x200x130» er en boks).
  const g = /\b(\d{1,2})\s?G\s?(\d{1,3}(?:[.,]\d{1,2})?)\b/i.exec(n)
  const par = /\b(\d{1,2})\s?[x×]\s?2\s?[x×]\s?(\d(?:[.,]\d{1,2})?)\b/i.exec(n)
  const x = /\b(\d{1,2})\s?[x×]\s?(\d{1,3}(?:[.,]\d{1,2})?)(?:\s?\/\s?(\d{1,3}(?:[.,]\d{1,2})?))?(?!\s?[x×]\s?\d|[\d.,]|\s?mm\b(?!²|2))/i.exec(n)
  if (g && TVERRSNITT.has(tall(g[2]))) ut.leder = `${g[1]}G${g[2].replace('.', ',')}`
  else if (par && TVERRSNITT.has(tall(par[2]))) ut.leder = `${par[1]}×2×${par[2].replace('.', ',')}`
  // «2X0,5M» på en varmematte er et mål: en bokstav rett etter tallet (utenom «mm») betyr ikke leder.
  else if (x && Number(x[1]) <= 61 && TVERRSNITT.has(tall(x[2])) && !/^(A\b|[a-zæøå](?!m))/i.test(n.slice((x.index ?? 0) + x[0].length))) {
    ut.leder = `${x[1]}×${x[2].replace('.', ',')}${x[3] ? `/${x[3].replace('.', ',')}` : ''}`
  } else {
    const mm = /\b(\d{1,3}(?:[.,]\d{1,2})?)\s?mm[²2]/i.exec(n)
    if (mm && TVERRSNITT.has(tall(mm[1]))) ut.leder = `${mm[1].replace('.', ',')} mm²`
  }

  // Spenning.
  const vv = /\b(\d{3})\/(\d{3})\s?V\b/i.exec(n)
  const kv = /\b(\d(?:[.,]\d)?)\s?kV\b/i.exec(n)
  const v = /(?<![\d-])(\d{1,4})\s?V(AC|DC)?\b/i.exec(n)
  if (vv) ut.spenning = `${vv[1]}/${vv[2]} V`
  else if (kv) ut.spenning = `${kv[1].replace('.', ',')} kV`
  else if (v && SPENNINGER.has(Number(v[1]))) ut.spenning = `${v[1]} ${v[2] ? `V${v[2].toUpperCase()}` : 'V'}`

  // Kurve og merkestrøm — bare på vernekomponenter.
  if (VERN.test(n)) {
    const k1 = /\b([BCD])\s?(\d{1,3}(?:[.,]\d)?)\s?A?\b/.exec(n)
    const k2 = /\b(\d{1,3}(?:[.,]\d)?)\s?A\s([BCD])\b/.exec(n)
    const k3 = /\b(\d{1,3})\s?A\/([BCD])\b/.exec(n)
    const kurve = k1 && tall(k1[2]) <= 125 ? { k: k1[1], a: tall(k1[2]) }
      : k2 && tall(k2[1]) <= 125 ? { k: k2[2], a: tall(k2[1]) }
      : k3 && tall(k3[1]) <= 125 ? { k: k3[2], a: tall(k3[1]) } : null
    if (kurve) { ut.kurve = `${kurve.k}${komma(kurve.a)}`; ut.stromA = kurve.a }
  }
  if (ut.stromA === undefined) {
    const a = /(?:^|[\s,/(x×])(\d{1,4}(?:[.,]\d)?)\s?A\b/i.exec(n)
    if (a && tall(a[1]) > 0 && tall(a[1]) <= 6300) ut.stromA = tall(a[1])
  }

  const ma = /\b(\d{2,4})\s?mA\b/i.exec(n)
  if (ma) ut.jordfeilMa = Number(ma[1])

  // «10KA3+N-POL»: polantallet kan stå klistret til ordet foran, men aldri til et siffer.
  const p = /(?<!\d)(\d)(\+N)?\s?-?\s?(?:P|POL)(\+J)?\b/i.exec(n)
  if (p) ut.poler = `${p[1]}P${p[2] ? '+N' : ''}${p[3] ? '+J' : ''}`

  const kw = /\b(\d{1,3}(?:[.,]\d{1,2})?)\s?kW\b/i.exec(n)
  const w = /\b(\d{1,4}(?:[.,]\d)?)\s?W\b/.exec(n)
  if (kw) ut.effektW = Math.round(tall(kw[1]) * 1000)
  else if (w) ut.effektW = tall(w[1])

  const lm = /\b(\d{2,6})\s?lm\b/i.exec(n)
  if (lm) ut.lumen = Number(lm[1])

  // Fargetemperatur: «3000K», «4K», eller lysfarge-kode «/830» (3000 K), «/927» (2700 K).
  const k4 = /\b(\d{4})\s?K\b/.exec(n)
  const kKort = /\b(\d(?:[.,]\d)?)\s?K\b/.exec(n)
  const kode = /\/[89](27|30|35|40|50|65)\b/.exec(n)
  if (k4 && Number(k4[1]) >= 1800 && Number(k4[1]) <= 7000) ut.kelvin = Number(k4[1])
  else if (kKort && tall(kKort[1]) >= 2 && tall(kKort[1]) <= 6.5) ut.kelvin = Math.round(tall(kKort[1]) * 1000)
  else if (kode) ut.kelvin = Number(kode[1]) * 100

  return ut
}

/** Egenskapene som korte merkelapper, i fast rekkefølge: «Hvit · IP44 · 16 A». */
export function egenskapTekster(e: Egenskaper): string[] {
  return [
    e.farge,
    e.ip,
    e.leder,
    e.spenning,
    e.kurve ?? (e.stromA !== undefined ? `${komma(e.stromA)} A` : undefined),
    e.jordfeilMa !== undefined ? `${e.jordfeilMa} mA` : undefined,
    e.poler,
    e.effektW !== undefined ? (e.effektW >= 1000 ? `${komma(e.effektW / 1000)} kW` : `${komma(e.effektW)} W`) : undefined,
    e.lumen !== undefined ? `${e.lumen} lm` : undefined,
    e.kelvin !== undefined ? `${e.kelvin} K` : undefined,
  ].filter((t): t is string => !!t)
}

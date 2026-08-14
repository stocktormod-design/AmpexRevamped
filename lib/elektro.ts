// Elektrofaglig kalkulasjonsbibliotek for AI-assistenten (lib/ai/live-session.ts).
// KUN fysikk-formler og IEC-fakta — INGEN innbakt NEK-tabellfasit: NEK 400s
// strømføringsevne-tabeller er opphavsrettsbeskyttet OG feil verdi = farlig
// dimensjonering. Iz hentes fra produsentens datablad (assistenten kan søke) og
// mates inn i koordineringssjekken. Alt merkes «veiledende» — fagansvarlig avgjør.

const RHO_20 = { cu: 0.0175, al: 0.0282 } // Ω·mm²/m ved 20°C
const ALPHA = 0.004 // resistans-temperaturkoeffisient per °C (Cu/Al ≈ likt)
// Induktiv reaktans ~0.08 Ω/km er standard antagelse for kabler ≥50mm² der
// resistiv formel alene undervurderer fallet.
const X_PER_M = 0.00008

export type SpenningsfallInput = {
  lengde_m: number
  stroem_A: number
  tverrsnitt_mm2: number
  system?: 'enfase' | 'trefase'
  spenning_V?: number
  cosphi?: number
  materiale?: 'cu' | 'al'
  ledertemp_C?: number
}

export function spenningsfall(input: SpenningsfallInput) {
  const trefase = input.system === 'trefase'
  const U = input.spenning_V && input.spenning_V > 0 ? input.spenning_V : trefase ? 400 : 230
  const cosphi = input.cosphi && input.cosphi > 0 && input.cosphi <= 1 ? input.cosphi : 1
  const materiale = input.materiale === 'al' ? 'al' : 'cu'
  const temp = input.ledertemp_C && input.ledertemp_C >= 20 && input.ledertemp_C <= 120 ? input.ledertemp_C : 20
  const rho = RHO_20[materiale] * (1 + ALPHA * (temp - 20))
  const sinphi = Math.sqrt(Math.max(0, 1 - cosphi * cosphi))
  const r = rho / input.tverrsnitt_mm2 // Ω/m
  const x = input.tverrsnitt_mm2 >= 50 ? X_PER_M : 0
  const perM = r * cosphi + x * sinphi
  const deltaU = (trefase ? Math.sqrt(3) : 2) * perM * input.lengde_m * input.stroem_A
  return {
    spenningsfall_V: round2(deltaU),
    spenningsfall_prosent: round2((deltaU / U) * 100),
    forutsetninger: `${materiale === 'al' ? 'aluminium' : 'kobber'} ved ${temp}°C, ${trefase ? 'trefase √3-formel' : 'enfase 2L-formel'}, cosφ=${cosphi}${x > 0 ? ', inkl. reaktans 0.08 Ω/km' : ''}, ${U}V`,
  }
}

/** Merkestrøm for motor/last fra effekt. */
export function lastStroem(input: { kW: number; spenning_V?: number; cosphi?: number; virkningsgrad?: number; system?: 'enfase' | 'trefase' }) {
  const trefase = input.system !== 'enfase'
  const U = input.spenning_V && input.spenning_V > 0 ? input.spenning_V : trefase ? 400 : 230
  const cosphi = input.cosphi && input.cosphi > 0 && input.cosphi <= 1 ? input.cosphi : 1
  const eta = input.virkningsgrad && input.virkningsgrad > 0 && input.virkningsgrad <= 1 ? input.virkningsgrad : 1
  const I = (input.kW * 1000) / ((trefase ? Math.sqrt(3) : 1) * U * cosphi * eta)
  return {
    stroem_A: round2(I),
    forutsetninger: `${U}V ${trefase ? 'trefase' : 'enfase'}, cosφ=${cosphi}, η=${eta}`,
  }
}

/** IEC 60898-fakta: magnetisk utløseområde per karakteristikk + termiske grenser. */
export function vernKarakteristikk(karakteristikk: string, In: number) {
  const k = karakteristikk.trim().toUpperCase()
  const ranges: Record<string, [number, number]> = { B: [3, 5], C: [5, 10], D: [10, 20] }
  const range = ranges[k]
  if (!range) return { feil: 'Kjenner kun B, C og D (IEC 60898).' }
  return {
    karakteristikk: k,
    magnetisk_utloesning: `${range[0]}–${range[1]} × In = ${round2(range[0] * In)}–${round2(range[1] * In)} A`,
    sikker_momentan_utloesning_A: round2(range[1] * In),
    termisk: `holder 1.13×In (${round2(1.13 * In)} A) i ≥1t, løser ut ved 1.45×In (${round2(1.45 * In)} A) innen 1t`,
  }
}

/** NEK 400 433.1-koordinering: Ib ≤ In ≤ Iz og I2 ≤ 1.45·Iz. Iz FRA PRODUSENT/TABELL — aldri gjettet. */
export function koordinerKabelVern(input: { belastning_Ib_A: number; vern_In_A: number; kabel_Iz_A: number }) {
  const { belastning_Ib_A: Ib, vern_In_A: In, kabel_Iz_A: Iz } = input
  const krav1 = Ib <= In
  const krav2 = In <= Iz
  const I2 = 1.45 * In
  const krav3 = I2 <= 1.45 * Iz // ekvivalent med krav2 for MCB, eksplisitt for tydelighet
  return {
    ok: krav1 && krav2 && krav3,
    krav: [
      `Ib ≤ In: ${Ib} ≤ ${In} → ${krav1 ? 'OK' : 'FEIL'}`,
      `In ≤ Iz: ${In} ≤ ${Iz} → ${krav2 ? 'OK' : 'FEIL'}`,
      `I2 ≤ 1.45·Iz: ${round2(I2)} ≤ ${round2(1.45 * Iz)} → ${krav3 ? 'OK' : 'FEIL'}`,
    ],
    viktig: 'Iz må være korrigert for forlegningsmetode, omgivelsestemperatur og gruppering (produsentens datablad / NEK 400 tab 52).',
  }
}

/**
 * Forenklet kortslutningsstrøm i enden av en kabel, gitt Ik ved starten.
 * Rent resistivt sløyfetillegg (2·ρ·L/A) — VEILEDENDE, for utløsersjekk av
 * automatsikringer på vanlige forbrukerkurser; FEBDOK-klasse beregning er det ikke.
 */
export function kortslutningEnde(input: { ik_start_A: number; lengde_m: number; tverrsnitt_mm2: number; spenning_V?: number; materiale?: 'cu' | 'al' }) {
  const U = input.spenning_V && input.spenning_V > 0 ? input.spenning_V : 230
  const materiale = input.materiale === 'al' ? 'al' : 'cu'
  if (!(input.ik_start_A > 0)) return { feil: 'Ik ved start må være > 0.' }
  const zStart = U / input.ik_start_A
  const zKabel = (2 * RHO_20[materiale] * input.lengde_m) / input.tverrsnitt_mm2
  const ikEnde = U / (zStart + zKabel)
  return {
    ik_ende_A: Math.round(ikEnde),
    forutsetninger: `${U}V sløyfe, ${materiale === 'al' ? 'aluminium' : 'kobber'} 20°C, rent resistivt tillegg — veiledende`,
    beskjed: 'Sjekk at Ik i enden ≥ vernets sikre momentanutløsning (vern_karakteristikk).',
  }
}

/** Trygg uttrykkskalkulator: tall/operatorer + navngitte funksjoner via whitelist. */
export function regnUt(uttrykk: string): { svar: number } | { feil: string } {
  const cleaned = uttrykk.replace(/,/g, '.').replace(/\s/g, '')
  // Whitelist: tall, operatorer og eksplisitt godkjente funksjonsnavn — ingenting annet.
  const utenFunksjoner = cleaned.replace(/sqrt|sin|cos|tan|asin|acos|atan|log10|log|abs|pi/g, '')
  if (!cleaned || !/^[0-9+\-*/().^%]*$/.test(utenFunksjoner)) {
    return { feil: 'Kun tall, + - * / ^ ( ) og funksjonene sqrt/sin/cos/tan/asin/acos/atan/log/abs/pi er tillatt. Trigonometri i radianer.' }
  }
  const js = cleaned
    .replace(/\^/g, '**')
    .replace(/\b(sqrt|sin|cos|tan|asin|acos|atan|abs|log10|log)\b/g, 'Math.$1')
    .replace(/\bpi\b/g, 'Math.PI')
    .replace(/Math\.log10/g, 'Math.log10')
  try {
    const value = new Function(`"use strict"; return (${js})`)() as number
    if (typeof value !== 'number' || !Number.isFinite(value)) return { feil: 'Uttrykket ga ikke et tall.' }
    return { svar: value }
  } catch {
    return { feil: 'Ugyldig uttrykk.' }
  }
}

// Veiledende effektbehov varmekabel — bransjevanlige spenn (produsentuavhengig).
// Data, ikke fasit: produsentens leggeanvisning gjelder.
export const VARMEKABEL_VEILEDNING = {
  'bad/våtrom gulvvarme': '130–160 W/m² (støp), komfort',
  'oppholdsrom gulvvarme': '60–100 W/m²',
  'frostsikring rør': '10 W/m ved ≤ -25°C (dobles ved uisolert)',
  'takrenne/nedløp': '30–40 W/m',
  'utendørs areal (rampe/trapp)': '250–350 W/m²',
} as const

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

import { DEMO_BILDER } from './demo-bilder'

/**
 * Demokatalog — et sortiment stort nok til å BLA i, uten en eneste ekte fil.
 *
 * **Hvorfor den finnes:** Ampex er systemleverandør, ikke elektrofirma. Vi har
 * ingen kundeforhold hos noen grossist, og en prisfil tilhører alltid et
 * kundefirma. Uten noe i kartoteket er hverken søket, varekortet eller
 * prissammenligningen mulig å se — og de er ferdig bygget.
 *
 * **Dette er oppdiktede data.** El-numrene, prisene og rabattene er funnet på.
 * Produsentnavnene er ekte, fordi en katalog uten dem ikke ligner noe. Alt
 * merkes `source_system = 'demo'` og kan fjernes med ett trykk.
 *
 * **Hvorfor den bygges i kode og ikke ligger som tekst:** et sortiment på
 * flere hundre varer i EFO-format er nesten en megabyte tekst i appbunten. En
 * kompakt beskrivelse av seriene og variantaksene er noen kilobyte, og gir
 * flere varer. Filene bygges deterministisk — ingen `Math.random`, så samme
 * katalog hver gang.
 *
 * Filene går gjennom `parseEfoNelfo` og `importerPrisfil` som alt annet. Det
 * er hele poenget: demoen prøver systemet, ikke en snarvei rundt det.
 *
 * **Hva den IKKE beviser:** at parseren leser en ekte fil riktig. Den er
 * generert mot spesifikasjonen av samme hode som skrev parseren, så en
 * feiltolkning ville stått begge steder.
 *
 * Den ekte veien til et fullt kartotek er en **V4** — grossistens fulle
 * sortiment til listepris. Den inneholder ingenting konfidensielt og er derfor
 * langt lettere å få enn en P4. Se `docs/GROSSIST_INTEGRASJON.md`.
 */

export { DEMO_BILDER }

/** Markeres på hver importerte rad, så demodata alltid kan skilles ut og fjernes. */
export const DEMO_KILDE = 'demo'

type Serie = {
  /** Grossistens rabattgruppe. Rabatt forhandles per gruppe, ikke per vare. */
  gruppe: string
  /** Substantivet varen skal grupperes på. */
  navn: string
  /** Fast tekst etter navnet, før variantene. */
  etterledd?: string
  fabrikat: string
  type: string
  /** Variantakser. Alle kombinasjoner blir hver sin vare — som et ekte sortiment. */
  akser: string[][]
  /** Utfyllende tekst (betegnelse2). */
  under?: string
  enhet: 'stk' | 'm'
  /** Listepris for første variant, og hvor mye hvert steg legger på. */
  pris: number
  steg: number
  pakning: number
  bilde: keyof typeof DEMO_BILDER
  /** Første el-nummer i serien. Videre varer teller oppover. */
  elFra: number
}

const SERIER: Serie[] = [
  // ── Kabel ────────────────────────────────────────────────────────────────
  { gruppe: '4260', navn: 'Installasjonskabel', fabrikat: 'NEXANS', type: 'PFXP', under: 'halogenfri',
    akser: [['2G1,5', '3G1,5', '3G2,5', '4G1,5', '4G2,5', '5G1,5', '5G2,5', '5G4', '5G6'], ['500V']],
    enhet: 'm', pris: 12.9, steg: 7.4, pakning: 100, bilde: 'kabel', elFra: 1451000 },
  { gruppe: '4260', navn: 'Installasjonskabel', etterledd: 'skjermet', fabrikat: 'NEXANS', type: 'PFSP', under: 'halogenfri',
    akser: [['3G1,5', '3G2,5', '4G1,5', '5G2,5'], ['500V']],
    enhet: 'm', pris: 21.4, steg: 9.8, pakning: 100, bilde: 'kabel', elFra: 1451100 },
  { gruppe: '4260', navn: 'Jordkabel', fabrikat: 'NEXANS', type: 'TFXP',
    akser: [['2G6', '4G6', '4G10', '4G16', '4G25']],
    enhet: 'm', pris: 34.5, steg: 18.2, pakning: 50, bilde: 'kabel', elFra: 1452200 },
  { gruppe: '4260', navn: 'Jordledning', fabrikat: 'DRAKA', type: 'RK', under: 'gul/grønn',
    akser: [['1,5', '2,5', '4', '6', '10', '16']],
    enhet: 'm', pris: 4.9, steg: 3.6, pakning: 100, bilde: 'kabel', elFra: 1452100 },
  { gruppe: '4260', navn: 'Signalkabel', fabrikat: 'DRAKA', type: 'KABELFLEX', under: 'parsnodd',
    akser: [['2x0,5', '4x0,5', '8x0,5', '2x0,8']],
    enhet: 'm', pris: 8.4, steg: 4.1, pakning: 100, bilde: 'kabel', elFra: 1453000 },

  // ── Vern ─────────────────────────────────────────────────────────────────
  { gruppe: '5310', navn: 'Automatsikring', fabrikat: 'ABB', type: 'S201', under: 'kortslutningsvern',
    akser: [['1P', '3P'], ['6A', '10A', '13A', '16A', '20A', '25A', '32A'], ['B', 'C']],
    enhet: 'stk', pris: 89, steg: 14, pakning: 12, bilde: 'automat', elFra: 1622100 },
  { gruppe: '5310', navn: 'Jordfeilautomat', fabrikat: 'ABB', type: 'DS201', under: 'type A, 30 mA',
    akser: [['1P+N'], ['10A', '13A', '16A', '20A', '25A', '32A'], ['B', 'C']],
    enhet: 'stk', pris: 698, steg: 46, pakning: 1, bilde: 'jordfeil', elFra: 1622000 },
  { gruppe: '5310', navn: 'Jordfeilautomat', fabrikat: 'SCHNEIDER', type: 'iDPN', under: 'type A, 30 mA',
    akser: [['1P+N'], ['10A', '16A', '20A', '25A'], ['B', 'C']],
    enhet: 'stk', pris: 724, steg: 52, pakning: 1, bilde: 'jordfeil', elFra: 1623000 },
  { gruppe: '5310', navn: 'Jordfeilbryter', fabrikat: 'ABB', type: 'F204', under: 'type B',
    akser: [['2P', '4P'], ['25A', '40A', '63A'], ['30mA', '300mA']],
    enhet: 'stk', pris: 1840, steg: 320, pakning: 1, bilde: 'jordfeil', elFra: 1624000 },
  { gruppe: '5310', navn: 'Overspenningsvern', fabrikat: 'DEHN', type: 'DV M TT', under: 'klasse II',
    akser: [['2P', '4P'], ['255V']],
    enhet: 'stk', pris: 2980, steg: 410, pakning: 1, bilde: 'automat', elFra: 1625000 },

  // ── Installasjonsmateriell ───────────────────────────────────────────────
  { gruppe: '6120', navn: 'Stikkontakt', etterledd: '2-pol jord', fabrikat: 'ELKO', type: 'PLUS',
    akser: [['1-veis', '2-veis'], ['IP20', 'IP44'], ['infelt', 'utenpå'], ['Hvit', 'Antrasitt']],
    enhet: 'stk', pris: 128, steg: 22, pakning: 10, bilde: 'stikk', elFra: 1730100 },
  { gruppe: '6120', navn: 'Stikkontakt', etterledd: '2-pol jord', fabrikat: 'SCHNEIDER', type: 'EXXACT',
    akser: [['1-veis'], ['IP20', 'IP44'], ['infelt', 'utenpå'], ['Hvit', 'Sort']],
    enhet: 'stk', pris: 142, steg: 24, pakning: 10, bilde: 'stikk', elFra: 1731000 },
  { gruppe: '6120', navn: 'Bryter', fabrikat: 'ELKO', type: 'PLUS',
    akser: [['1-pol', '2-pol', 'toveis', 'kryss'], ['trykk', 'vippe'], ['Hvit', 'Antrasitt']],
    enhet: 'stk', pris: 104, steg: 19, pakning: 10, bilde: 'bryter', elFra: 1730200 },
  { gruppe: '6120', navn: 'Dimmer', fabrikat: 'ELKO', type: 'PLUS', under: 'LED universal',
    akser: [['100W', '250W', '400W'], ['trykk/vri', 'trykk'], ['Hvit', 'Antrasitt']],
    enhet: 'stk', pris: 645, steg: 88, pakning: 1, bilde: 'bryter', elFra: 1730300 },
  { gruppe: '6120', navn: 'Bevegelsessensor', fabrikat: 'ELKO', type: 'PLUS', under: 'PIR',
    akser: [['innendørs', 'utendørs'], ['IP20', 'IP55'], ['Hvit']],
    enhet: 'stk', pris: 890, steg: 140, pakning: 1, bilde: 'bryter', elFra: 1730400 },

  // ── Belysning ────────────────────────────────────────────────────────────
  { gruppe: '7040', navn: 'Downlight', fabrikat: 'SG', type: 'JUNISTAR', under: 'dimbar',
    akser: [['LED 6W', 'LED 8W', 'LED 10W'], ['2700K', '3000K', '4000K'], ['IP44', 'IP65'], ['Hvit', 'Børstet stål']],
    enhet: 'stk', pris: 448, steg: 42, pakning: 1, bilde: 'downlight', elFra: 1841000 },
  { gruppe: '7040', navn: 'LED-armatur', fabrikat: 'GLAMOX', type: 'I65', under: 'industri',
    akser: [['600mm', '1200mm', '1500mm'], ['20W', '30W', '45W'], ['IP65']],
    enhet: 'stk', pris: 980, steg: 165, pakning: 1, bilde: 'armatur', elFra: 1841400 },
  { gruppe: '7040', navn: 'LED-panel', fabrikat: 'GLAMOX', type: 'PANEL', under: 'innfelt/nedhengt',
    akser: [['300x1200', '600x600'], ['28W', '36W', '44W'], ['3000K', '4000K']],
    enhet: 'stk', pris: 1290, steg: 195, pakning: 1, bilde: 'panel', elFra: 1841600 },
  { gruppe: '7040', navn: 'Utelampe', fabrikat: 'SG', type: 'ORLANDO',
    akser: [['LED 9W', 'LED 12W'], ['IP54', 'IP65'], ['med sensor', 'uten sensor'], ['Sort', 'Galvanisert']],
    enhet: 'stk', pris: 790, steg: 120, pakning: 1, bilde: 'downlight', elFra: 1841800 },

  // ── Bokser, kanal, bro ───────────────────────────────────────────────────
  { gruppe: '6510', navn: 'Koblingsboks', fabrikat: 'SCHNEIDER', type: 'MURETTA',
    akser: [['80x80', '100x100', '130x130'], ['IP54', 'IP65'], ['Grå']],
    enhet: 'stk', pris: 74, steg: 26, pakning: 25, bilde: 'boks', elFra: 1955000 },
  { gruppe: '6510', navn: 'Apparatboks', fabrikat: 'ELKO', type: 'AB',
    akser: [['1-roms', '2-roms', '3-roms'], ['gips', 'mur'], ['infelt']],
    enhet: 'stk', pris: 29, steg: 11, pakning: 50, bilde: 'boks', elFra: 1955200 },
  { gruppe: '6510', navn: 'Kabelkanal', fabrikat: 'LEGRAND', type: 'DLP',
    akser: [['25x25', '40x40', '60x40', '80x50'], ['Hvit', 'Grå']],
    enhet: 'm', pris: 48, steg: 24, pakning: 50, bilde: 'kanal', elFra: 1955400 },
  { gruppe: '6510', navn: 'Kabelbro', fabrikat: 'OBO', type: 'MKS', under: 'varmforsinket',
    akser: [['100mm', '200mm', '300mm'], ['3 meter']],
    enhet: 'm', pris: 168, steg: 62, pakning: 3, bilde: 'kanal', elFra: 1955600 },
  { gruppe: '6510', navn: 'Kabelklemme', fabrikat: 'OBO', type: 'QUICK',
    akser: [['12mm', '16mm', '20mm', '25mm'], ['Hvit', 'Grå']],
    enhet: 'stk', pris: 3.4, steg: 1.2, pakning: 100, bilde: 'kanal', elFra: 1955800 },

  // ── Fordeling ────────────────────────────────────────────────────────────
  { gruppe: '5820', navn: 'Sikringsskap', fabrikat: 'EATON', type: 'KLV', under: 'med dør',
    akser: [['12 mod', '24 mod', '36 mod', '48 mod'], ['IP30', 'IP44'], ['infelt', 'utenpå']],
    enhet: 'stk', pris: 2480, steg: 480, pakning: 1, bilde: 'skap', elFra: 2066000 },
  { gruppe: '5820', navn: 'Fordelingsskinne', fabrikat: 'ABB', type: 'PS3', under: 'kam',
    akser: [['1-fas', '3-fas'], ['12 mod', '24 mod', '56 mod']],
    enhet: 'stk', pris: 248, steg: 74, pakning: 1, bilde: 'skap', elFra: 2066400 },
  { gruppe: '5820', navn: 'Rekkeklemme', fabrikat: 'WAGO', type: 'TOPJOB',
    akser: [['2,5mm²', '4mm²', '6mm²', '10mm²'], ['grå', 'blå']],
    enhet: 'stk', pris: 12.4, steg: 4.8, pakning: 100, bilde: 'skap', elFra: 2066600 },

  // ── Varme ────────────────────────────────────────────────────────────────
  { gruppe: '7710', navn: 'Varmekabel', fabrikat: 'NEXANS', type: 'TXLP', under: 'for støp',
    akser: [['10W/m', '17W/m'], ['50m', '100m', '150m', '200m']],
    enhet: 'stk', pris: 3480, steg: 1180, pakning: 1, bilde: 'varme', elFra: 2177000 },
  { gruppe: '7710', navn: 'Varmekabelmatte', fabrikat: 'NEXANS', type: 'MILLIMAT', under: 'for flis',
    akser: [['100W/m²'], ['2m²', '4m²', '6m²', '8m²', '10m²']],
    enhet: 'stk', pris: 1980, steg: 640, pakning: 1, bilde: 'varme', elFra: 2177200 },
  { gruppe: '7710', navn: 'Termostat', etterledd: 'gulvvarme', fabrikat: 'OJ ELECTRONICS', type: 'UWG4',
    akser: [['med føler', 'med romføler'], ['Wi-Fi', 'uten Wi-Fi'], ['Hvit']],
    enhet: 'stk', pris: 1640, steg: 280, pakning: 1, bilde: 'termostat', elFra: 2177400 },

  // ── Sikkerhet og lading ──────────────────────────────────────────────────
  { gruppe: '8130', navn: 'Røykvarsler', fabrikat: 'ELOTEC', type: 'ORION', under: 'seriekoblbar',
    akser: [['optisk', 'termisk'], ['230V', 'batteri'], ['med backup', 'uten backup']],
    enhet: 'stk', pris: 468, steg: 74, pakning: 1, bilde: 'varsler', elFra: 2288000 },
  { gruppe: '8130', navn: 'Komfyrvakt', fabrikat: 'SIEMENS', type: 'CG', under: 'trådløs',
    akser: [['16A', '25A'], ['med strømsensor', 'med kamera']],
    enhet: 'stk', pris: 2180, steg: 340, pakning: 1, bilde: 'varsler', elFra: 2288200 },
  { gruppe: '8130', navn: 'Ladeboks', fabrikat: 'ZAPTEC', type: 'GO2', under: 'lastbalansering',
    akser: [['7,4kW', '22kW'], ['type 2'], ['med RFID', 'uten RFID']],
    enhet: 'stk', pris: 9800, steg: 1400, pakning: 1, bilde: 'lader', elFra: 2288400 },
  { gruppe: '8130', navn: 'Ladeboks', fabrikat: 'DEFA', type: 'POWER', under: 'lastbalansering',
    akser: [['7,4kW', '22kW'], ['type 2'], ['med kabel', 'uten kabel']],
    enhet: 'stk', pris: 10400, steg: 1600, pakning: 1, bilde: 'lader', elFra: 2288600 },

  // ── Motorvern og verktøy ─────────────────────────────────────────────────
  { gruppe: '5310', navn: 'Motorvernbryter', fabrikat: 'ABB', type: 'MS132',
    akser: [['0,4-0,63A', '1-1,6A', '4-6,3A', '10-16A', '20-25A']],
    enhet: 'stk', pris: 890, steg: 130, pakning: 1, bilde: 'motor', elFra: 1626000 },
  { gruppe: '9010', navn: 'Avisoleringstang', fabrikat: 'KNIPEX', type: 'MULTISTRIP',
    akser: [['0,2-6mm²', '0,03-10mm²']],
    enhet: 'stk', pris: 1240, steg: 380, pakning: 1, bilde: 'verktoy', elFra: 2400000 },
  { gruppe: '9010', navn: 'Skrutrekker', fabrikat: 'WERA', type: 'KRAFTFORM', under: 'VDE 1000V',
    akser: [['PZ1', 'PZ2', '3,5mm', '5,5mm'], ['isolert']],
    enhet: 'stk', pris: 168, steg: 28, pakning: 1, bilde: 'verktoy', elFra: 2400200 },
]

/** Alle kombinasjoner av variantaksene, i rekkefølge. */
function kombinasjoner(akser: string[][]): string[][] {
  return akser.reduce<string[][]>((ut, akse) => ut.flatMap(r => akse.map(v => [...r, v])), [[]])
}

export type Demovare = {
  elnummer: string
  betegnelse: string
  betegnelse2: string | null
  enhet: 'stk' | 'm'
  listepris: number
  pakning: number
  gruppe: string
  fabrikat: string
  type: string
  bilde: string
  /** Hver 40. vare er merket utgått, så «utgått»-tilfellet finnes i demoen. */
  utgaar: boolean
}

/** Hele sortimentet, bygget av seriene. Deterministisk — ingen tilfeldighet. */
export function demovarer(): Demovare[] {
  const ut: Demovare[] = []
  for (const s of SERIER) {
    const komb = kombinasjoner(s.akser)
    komb.forEach((variant, i) => {
      const el = String(s.elFra + i)
      const deler = [s.navn, s.etterledd, ...variant].filter(Boolean) as string[]
      ut.push({
        elnummer: el,
        betegnelse: deler.join(' '),
        betegnelse2: s.under ?? null,
        enhet: s.enhet,
        // Prisen stiger jevnt gjennom serien — større dimensjon koster mer.
        listepris: Math.round((s.pris + i * s.steg) * 100) / 100,
        pakning: s.pakning,
        gruppe: s.gruppe,
        fabrikat: s.fabrikat,
        type: s.type,
        bilde: s.bilde,
        utgaar: ut.length % 40 === 39,
      })
    })
  }
  return ut
}

/**
 * Rabatt per grossist per rabattgruppe.
 *
 * Rabatt forhandles per GRUPPE, ikke per vare — det er derfor rabattgruppe
 * finnes i formatet i det hele tatt. Ingen grossist er billigst på alt; det er
 * hele grunnen til at sammenligning er verdt noe.
 */
const RABATT: Record<string, Record<string, number>> = {
  Onninen: { '4260': 38, '5310': 44, '6120': 41, '7040': 35, '6510': 46, '5820': 33, '7710': 30, '8130': 28, '9010': 22 },
  Solar: { '4260': 42, '5310': 40, '6120': 44, '7040': 38, '6510': 41, '5820': 37, '7710': 26, '8130': 31, '9010': 25 },
  Ahlsell: { '4260': 36, '5310': 42, '6120': 39, '7040': 41, '6510': 44, '5820': 35, '7710': 33, '8130': 26, '9010': 28 },
}

/** Hver grossist mangler noen serier — som i virkeligheten. */
const HOPPER_OVER: Record<string, number> = { Onninen: 7, Solar: 11, Ahlsell: 13 }

function desimal(x: number, d: number): string {
  return String(Math.round(x * 10 ** d))
}

/** Bygger én P4-fil i EFO/NELFO 4.0-format for én grossist. */
export function byggDemofil(grossist: string): string {
  const rabatter = RABATT[grossist] ?? RABATT.Onninen
  const hopp = HOPPER_OVER[grossist] ?? 7
  const linjer = [
    `PH;EFONELFO;4.0;NO91122334${grossist.length}MVA;NO999888777MVA;10042;20260801;20261231;NOK;AVT-${grossist.slice(0, 3).toUpperCase()}-2026;${grossist} Norge AS;Postboks 1;;0150;OSLO;NO`,
  ]
  demovarer().forEach((v, i) => {
    if (i % hopp === 0) return // denne grossisten fører ikke varen
    const rabatt = rabatter[v.gruppe] ?? 30
    linjer.push([
      'PL', '1', v.elnummer, v.betegnelse, v.betegnelse2 ?? '',
      v.enhet === 'm' ? '2' : '1', v.enhet === 'm' ? 'MTR' : 'PCE', v.enhet === 'm' ? 'meter' : 'stk',
      desimal(v.listepris, 2), desimal(1, 4), '20260801', v.utgaar ? '3' : '0',
      '', v.gruppe, v.fabrikat, v.type, i % 9 === 0 ? 'N' : 'J',
      desimal(v.pakning, 4), desimal(rabatt, 2), 'B',
    ].join(';'))
    // Verdiene kan ALDRI inneholde semikolon — formatet er semikolonseparert,
    // og parseren ville splittet dem. Derfor ligger bildene utenfor fila.
    linjer.push(`PX;VEKT;${(0.04 + (i % 37) * 0.09).toFixed(3)}`)
    if (v.enhet === 'stk') linjer.push(`PX;DIMENSJON;${50 + (i % 90)}x${35 + (i % 55)}x${18 + (i % 40)} mm`)
    linjer.push(`PA;2;70${v.elnummer}${String(i % 10)}${String((i * 7) % 10)};V;`)
    if (i % 3 === 0) linjer.push(`PA;4;${2000000 + i};V;`)
    if (v.pakning > 1) linjer.push(`PA;1;${v.elnummer};P;${desimal(v.pakning, 4)}`)
  })
  return linjer.join('\n') + '\n'
}

export type DemoFil = { grossist: string; innhold: string }

/** De tre demofilene. Bygges på forespørsel — de ligger ikke i appbunten som tekst. */
export function demoFiler(): DemoFil[] {
  return Object.keys(RABATT).map(grossist => ({ grossist, innhold: byggDemofil(grossist) }))
}

/** El-nummer → piktogramnøkkel, for å sette bilder etter importen. */
export function demoBildeFor(elnummer: string): string | null {
  const v = demovarer().find(x => x.elnummer === elnummer)
  return v ? DEMO_BILDER[v.bilde] ?? null : null
}

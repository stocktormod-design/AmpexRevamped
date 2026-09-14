import * as FileSystem from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'
import { useEffect, useState } from 'react'
import { signedR2Url } from './drawings-storage'

/**
 * Den FELLES varekatalogen på telefonen.
 *
 * Én SQLite-fil per grossist, bygget av `tools/bygg-katalog.ts` fra en
 * standard V4-varefil, lagt i R2 under `katalog/<grossist>.sqlite` og lastet
 * ned hit. Den inneholder VAREN — el-nummer, navn, fabrikat, type, EAN, NRF,
 * pakning, bilde, FDV, HMS — og ALDRI pris. Prisen er firmaets egen og ligger
 * i `product_prices` (synket per firma). Se docs/GROSSIST_INTEGRASJON.md,
 * «Katalog felles, pris privat».
 *
 * ── Hvorfor en fil på disk og ikke rader i WatermelonDB ───────────────────
 *
 * Solars fil har 126 739 varer. Som rader i `products` ville de synkes ned til
 * hver telefon i hvert firma (43 MB × firmaer × enheter i Postgres), og et
 * søk med LIKE over `search_text` leser hele tabellen. Her åpner expo-sqlite
 * fila direkte, minnekartlegger den, og FTS5-indeksen svarer på under fem
 * millisekunder uten at noe lastes inn i JS. Fila er den samme for alle, så
 * den lastes ned én gang og deles ikke gjennom synken.
 *
 * Offline: ligger fila på disk, virker søket i kjelleren.
 */

export type Katalogvare = {
  grossist: string
  elnummer: string
  navn: string
  fabrikat: string | null
  type: string | null
  rabattgruppe: string | null
  ean: string | null
  nrf: string | null
  enhet: string
  salgspakning: number | null
  /** true/false når grossisten oppgir det, null når koden ikke er i bruk. */
  lagerfort: boolean | null
  utgaar: boolean
  erstattesAv: string | null
  bilde: string | null
  fdv: string | null
  hms: string | null
  efobase: string | null
  kategori: string | null
  ekstra: Record<string, string>
}

export type Katalogstatus = {
  grossist: string
  /** Fila ligger på disk og kan søkes i. */
  finnes: boolean
  antall: number | null
  /** Når grossistens fil ble bygget om til katalog (ISO). */
  generert: string | null
  lasterNed: boolean
  feil: string | null
}

/** Skjemaversjonen byggeren skriver i `meta.format`. Ukjent versjon åpnes ikke. */
const KJENT_FORMAT = '1'

/** Standardgrossisten. Flere kommer når vi har flere standardfiler. */
export const STANDARD_GROSSIST = 'solar'

type Manifest = {
  format: string
  grossist: string
  kilde_sha256: string
  generert: string
  antall: string
  bytes: number
}

const SQLITE_MAPPE = FileSystem.documentDirectory + 'SQLite/'
const filnavn = (g: string) => `katalog-${g}.sqlite`
const manifestSti = (g: string) => `${SQLITE_MAPPE}katalog-${g}.json`

const apne = new Map<string, Promise<SQLite.SQLiteDatabase>>()
const status = new Map<string, Katalogstatus>()
const lyttere = new Set<() => void>()
let pågår: Promise<Katalogstatus> | null = null

function varsle() { for (const l of lyttere) l() }

function settStatus(g: string, endring: Partial<Katalogstatus>) {
  const naa = status.get(g) ?? { grossist: g, finnes: false, antall: null, generert: null, lasterNed: false, feil: null }
  status.set(g, { ...naa, ...endring })
  varsle()
}

async function lesLokaltManifest(g: string): Promise<Manifest | null> {
  try {
    const info = await FileSystem.getInfoAsync(manifestSti(g))
    if (!info.exists) return null
    return JSON.parse(await FileSystem.readAsStringAsync(manifestSti(g))) as Manifest
  } catch {
    return null
  }
}

async function lukk(g: string) {
  const p = apne.get(g)
  apne.delete(g)
  if (p) { try { (await p).closeAsync() } catch { /* alt lukket */ } }
}

async function db(g: string): Promise<SQLite.SQLiteDatabase> {
  let p = apne.get(g)
  if (!p) {
    // Skrivebeskyttet: fila eies av byggeren, telefonen leser bare.
    p = SQLite.openDatabaseAsync(filnavn(g))
    apne.set(g, p)
  }
  return p
}

/**
 * Sørg for at katalogen ligger lokalt og er den nyeste.
 *
 * Manifestet (`katalog/<g>.json`) er lite og hentes hver gang; selve fila
 * (43 MB for Solar) hentes bare når sha-en i manifestet er en annen enn den
 * vi har. Uten nett: det som ligger på disk gjelder, og søket virker.
 */
export async function sikreKatalog(g: string = STANDARD_GROSSIST): Promise<Katalogstatus> {
  if (pågår) return pågår
  pågår = (async () => {
    const lokalt = await lesLokaltManifest(g)
    const fil = await FileSystem.getInfoAsync(SQLITE_MAPPE + filnavn(g))
    const harFil = fil.exists && (fil.size ?? 0) > 0
    settStatus(g, { finnes: harFil && !!lokalt, antall: lokalt ? Number(lokalt.antall) : null, generert: lokalt?.generert ?? null, feil: null })

    let fjernt: Manifest | null = null
    try {
      const svar = await fetch(await signedR2Url(`katalog/${g}.json`, 'get'))
      if (svar.ok) fjernt = (await svar.json()) as Manifest
    } catch {
      // Uten nett: behold det vi har.
    }
    if (!fjernt || fjernt.format !== KJENT_FORMAT) return status.get(g)!
    if (harFil && lokalt && lokalt.kilde_sha256 === fjernt.kilde_sha256) return status.get(g)!

    settStatus(g, { lasterNed: true })
    try {
      const mappe = await FileSystem.getInfoAsync(SQLITE_MAPPE)
      if (!mappe.exists) await FileSystem.makeDirectoryAsync(SQLITE_MAPPE, { intermediates: true })
      // Til en midlertidig fil først: et avbrutt nedlast skal ikke ødelegge
      // katalogen som virket.
      const tmp = SQLITE_MAPPE + filnavn(g) + '.ny'
      const dl = await FileSystem.downloadAsync(await signedR2Url(`katalog/${g}.sqlite`, 'get'), tmp)
      if (dl.status >= 300) throw new Error(`Nedlasting feilet (${dl.status})`)
      await lukk(g)
      await FileSystem.moveAsync({ from: tmp, to: SQLITE_MAPPE + filnavn(g) })
      await FileSystem.writeAsStringAsync(manifestSti(g), JSON.stringify(fjernt))
      settStatus(g, { finnes: true, antall: Number(fjernt.antall), generert: fjernt.generert, lasterNed: false, feil: null })
    } catch (e) {
      settStatus(g, { lasterNed: false, feil: e instanceof Error ? e.message : String(e) })
    }
    return status.get(g)!
  })()
  try { return await pågår } finally { pågår = null }
}

export function katalogStatus(g: string = STANDARD_GROSSIST): Katalogstatus {
  return status.get(g) ?? { grossist: g, finnes: false, antall: null, generert: null, lasterNed: false, feil: null }
}

type Rad = {
  elnummer: string; navn: string; fabrikat: string | null; type: string | null; rabattgruppe: string | null
  ean: string | null; nrf: string | null; enhet: string; salgspakning: number | null; lagerfort: number | null
  utgaar: number; erstattes_av: string | null; bilde: string | null; fdv: string | null; hms: string | null
  efobase: string | null; kategori: string | null; ekstra: string | null
}

function tilVare(g: string, r: Rad): Katalogvare {
  let ekstra: Record<string, string> = {}
  if (r.ekstra) { try { ekstra = JSON.parse(r.ekstra) } catch { /* rå VX-felt, ikke kritisk */ } }
  return {
    grossist: g,
    elnummer: r.elnummer,
    navn: r.navn,
    fabrikat: r.fabrikat,
    type: r.type,
    rabattgruppe: r.rabattgruppe,
    ean: r.ean,
    nrf: r.nrf,
    enhet: r.enhet,
    salgspakning: r.salgspakning,
    lagerfort: r.lagerfort == null ? null : r.lagerfort === 1,
    utgaar: r.utgaar === 1,
    erstattesAv: r.erstattes_av,
    bilde: r.bilde,
    fdv: r.fdv,
    hms: r.hms,
    efobase: r.efobase,
    kategori: r.kategori,
    ekstra,
  }
}

const KOLONNER = 'v.elnummer, v.navn, v.fabrikat, v.type, v.rabattgruppe, v.ean, v.nrf, v.enhet, v.salgspakning, ' +
  'v.lagerfort, v.utgaar, v.erstattes_av, v.bilde, v.fdv, v.hms, v.efobase, v.kategori, v.ekstra'

/**
 * FTS5-spørringen: hvert ord som prefiks, i anførselstegn så «3G2,5» og
 * «PFXP-» ikke tolkes som operatorer. Anførselstegn i teksten dobles.
 */
export function ftsSporring(sok: string): string | null {
  const ord = sok.toLowerCase().split(/\s+/).map(o => o.replace(/"/g, '""').trim()).filter(o => o.length > 0)
  if (ord.length === 0) return null
  return ord.map(o => `"${o}"*`).join(' ')
}

/** Søk i katalogen. Tomt svar når fila ikke finnes lokalt — aldri et kast i UI-et. */
export async function sokKatalog(sok: string, maks = 30, g: string = STANDARD_GROSSIST): Promise<Katalogvare[]> {
  if (!katalogStatus(g).finnes) return []
  const q = ftsSporring(sok)
  if (!q) return []
  try {
    const d = await db(g)
    // El-nummer og EAN først: den som skriver 1234567 mener den varen.
    const rader = await d.getAllAsync<Rad>(
      `select ${KOLONNER} from sok join varer v on v.elnummer = sok.elnummer
       where sok match ?
       order by (v.elnummer = ?) desc, (v.ean = ?) desc, rank
       limit ?`,
      [q, sok.trim(), sok.trim(), maks],
    )
    return rader.map(r => tilVare(g, r))
  } catch (e) {
    // En ødelagt fil skal ikke låse søket: merk feilen, la firmaets varer stå.
    settStatus(g, { feil: e instanceof Error ? e.message : String(e) })
    return []
  }
}

export async function finnKatalogvare(elnummer: string, g: string = STANDARD_GROSSIST): Promise<Katalogvare | null> {
  if (!katalogStatus(g).finnes) return null
  try {
    const d = await db(g)
    const r = await d.getFirstAsync<Rad>(`select ${KOLONNER} from varer v where v.elnummer = ?`, [elnummer.trim()])
    return r ? tilVare(g, r) : null
  } catch {
    return null
  }
}

/**
 * Reaktivt katalogsøk til skjermene. Sørger for fila ved første bruk, venter
 * 120 ms etter siste tastetrykk, og svarer tomt under to tegn.
 */
export function useKatalogsok(sok: string, maks = 20, g: string = STANDARD_GROSSIST): { treff: Katalogvare[]; status: Katalogstatus } {
  const [treff, setTreff] = useState<Katalogvare[]>([])
  const [st, setSt] = useState<Katalogstatus>(() => katalogStatus(g))

  useEffect(() => {
    const lytt = () => setSt(katalogStatus(g))
    lyttere.add(lytt)
    void sikreKatalog(g)
    return () => { lyttere.delete(lytt) }
  }, [g])

  useEffect(() => {
    let levende = true
    if (sok.trim().length < 2 || !st.finnes) { setTreff([]); return }
    const t = setTimeout(() => {
      sokKatalog(sok, maks, g).then(r => { if (levende) setTreff(r) })
    }, 120)
    return () => { levende = false; clearTimeout(t) }
  }, [sok, maks, g, st.finnes])

  return { treff, status: st }
}

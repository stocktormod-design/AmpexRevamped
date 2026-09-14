/**
 * Bygg den FELLES varekatalogen: én V4 standard varefil → én SQLite-fil uten
 * priser.
 *
 *   npm run katalog:bygg -- <sti til V4-fil> [--grossist solar] [--ut .tmp/katalog]
 *
 * Bakgrunnen står i docs/GROSSIST_INTEGRASJON.md («Katalog felles, pris privat»,
 * 2026-09-11): varen er lik for alle som kjøper den, prisen er kundens. Fila
 * som bygges her inneholder derfor bare VAREN — el-nummer, betegnelse,
 * fabrikat, type, EAN, NRF, pakning, lager, erstatning, bilde/FDV/HMS,
 * EFObase-id og hele VX-bagasjen — og kan legges i R2 og lastes ned til hver
 * telefon. Nettopriser, rabatter og påslag går ALDRI inn her; de ligger i
 * firmaets egne tabeller (`product_prices`) og synkes per firma.
 *
 * Kilden er en V4 STANDARDFIL, aldri en kundes P4. Skriptet nekter å bygge
 * fra en fil med kjøperorgnr, kundenummer eller avtale-id: den inneholder da
 * kundens priser og er ikke ren å dele.
 *
 * Telefonen åpner fila med expo-sqlite og søker med FTS5 (prefiks per ord),
 * så et tastetrykk koster ett indeksoppslag og ikke en gjennomlesing av
 * 100 000 rader i JS. `search_text`-LIKE-en i `lib/products.ts` er det denne
 * erstatter for katalogvarer.
 *
 * Skriptet skriver også tallene som avgjør resten av planen: antall varer,
 * filstørrelse, komprimert størrelse. Skjemaet i appen skal ikke røres før de
 * tallene er sett (memory: «Ikke rør skjemaet før den ekte fila er talt opp»).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { dekodAnsi, parseEfoNelfo, type Vare } from '../lib/pricefile/efo-nelfo'
import { tilVarekort } from '../lib/pricefile/varekort'
import { utledKategori } from '../lib/product-category'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => any }

/** Skjemaversjon i fila. Appen nekter å åpne en fil den ikke kjenner. */
export const KATALOG_FORMAT = 1

function arg(navn: string, standard: string): string {
  const i = process.argv.indexOf(navn)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard
}

function main() {
  const fil = process.argv.slice(2).find(a => !a.startsWith('--') && existsSync(a))
  if (!fil) {
    console.error('Bruk: npm run katalog:bygg -- <V4-fil> [--grossist solar] [--ut .tmp/katalog]')
    process.exit(2)
  }
  const grossist = arg('--grossist', 'solar').toLowerCase()
  const utMappe = arg('--ut', '.tmp/katalog')
  mkdirSync(utMappe, { recursive: true })

  const t0 = Date.now()
  const bytes = new Uint8Array(readFileSync(fil))
  const tekst = dekodAnsi(bytes)
  const res = parseEfoNelfo(tekst)
  const h = res.hode

  console.log(`Fil:        ${fil} (${(bytes.length / 1e6).toFixed(1)} MB, ${tekst.split('\n').length} linjer)`)
  console.log(`Selger:     ${h.selgerNavn} (${h.selgerOrgnr}) · filtype ${h.filtype} · valuta ${h.valuta}`)
  console.log(`Varer:      ${res.varer.length} · avvik ${res.avvik.length}`)
  if (res.avvik.length) {
    for (const a of res.avvik.slice(0, 5)) console.log(`  avvik linje ${a.linje}: ${a.grunn}`)
    if (res.avvik.length > 5) console.log(`  … og ${res.avvik.length - 5} til`)
  }

  // ── Renhetsvakten ────────────────────────────────────────────────────────
  if (h.filtype !== 'vare' || h.kjoperOrgnr || h.kundeNr || h.avtaleId) {
    console.error(
      '\nNEKTER: dette er ikke en ren standardfil. ' +
      `filtype=${h.filtype} kjoperOrgnr=${h.kjoperOrgnr ?? '–'} kundeNr=${h.kundeNr ?? '–'} avtaleId=${h.avtaleId ?? '–'}. ` +
      'En kundes P4 inneholder kundens priser og skal aldri bli fellesfil.',
    )
    process.exit(1)
  }

  // ── Bygg ────────────────────────────────────────────────────────────────
  const utFil = join(utMappe, `${grossist}.sqlite`)
  if (existsSync(utFil)) unlinkSync(utFil)
  const db = new DatabaseSync(utFil)
  db.exec(`
    pragma journal_mode = off;
    pragma synchronous = off;
    pragma page_size = 4096;

    create table meta (nokkel text primary key, verdi text not null);

    -- VAREN. Ingen priskolonner, med vilje. Se toppen av fila.
    create table varer (
      elnummer      text primary key,
      navn          text not null,
      fabrikat      text,
      type          text,
      rabattgruppe  text,
      ean           text,
      nrf           text,
      enhet         text not null,
      salgspakning  integer,
      lagerfort     integer,            -- 1/0, null = ikke oppgitt
      utgaar        integer not null,   -- 1 når grossisten har merket den utgått
      erstattes_av  text,
      bilde         text,
      fdv           text,
      hms           text,
      efobase       text,
      kategori      text,
      ekstra        text                -- JSON: alle VX-felt
    ) without rowid;
    create index varer_ean on varer(ean) where ean is not null;
    create index varer_nrf on varer(nrf) where nrf is not null;
    create index varer_fabrikat on varer(fabrikat);
    create index varer_kategori on varer(kategori);

    -- Søket. Ett oppslag per tastetrykk; prefiks per ord («nex 3g2» → nex* 3g2*).
    -- unicode61 med remove_diacritics så «ø» og «o» ikke skiller, og
    -- tokenchars så el-nummer med bindestrek og typer som «3G2,5» holdes samlet.
    create virtual table sok using fts5(
      elnummer unindexed,
      tekst,
      tokenize = "unicode61 remove_diacritics 2 tokenchars '-.,/'"
    );
  `)

  const settVare = db.prepare(`
    insert or replace into varer
      (elnummer, navn, fabrikat, type, rabattgruppe, ean, nrf, enhet, salgspakning, lagerfort, utgaar,
       erstattes_av, bilde, fdv, hms, efobase, kategori, ekstra)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const settSok = db.prepare('insert into sok (elnummer, tekst) values (?, ?)')

  let tatt = 0
  let hoppet = 0
  const kategorier = new Map<string, number>()
  const sett = new Set<string>()

  db.exec('begin')
  for (const vare of res.varer) {
    const kort = tilVarekort(vare)
    if (!kort) { hoppet++; continue }
    // Samme el-nummer to ganger i fila (pakningsvarianter): første vinner,
    // resten ligger i VA-postene som alternativer.
    if (sett.has(kort.elnummer)) { hoppet++; continue }
    sett.add(kort.elnummer)

    const kategori = utledKategori(kort.navn)
    if (kategori) kategorier.set(kategori, (kategorier.get(kategori) ?? 0) + 1)
    const ekstra = Object.keys(kort.ekstra).length ? JSON.stringify(kort.ekstra) : null

    settVare.run(
      kort.elnummer, kort.navn, kort.fabrikat, kort.typeBetegnelse, kort.rabattGruppe, kort.ean, kort.nrf,
      enhet(vare), kort.salgspakning, vare.lagerfoert == null ? null : vare.lagerfoert ? 1 : 0,
      vare.status === 'utgaar' ? 1 : 0, kort.erstattesAv,
      kort.bildeUrl, kort.fdvUrl, kort.hmsUrl, kort.efobaseId, kategori, ekstra,
    )
    settSok.run(kort.elnummer, kort.sokeTekst)
    tatt++
  }

  const meta: Record<string, string> = {
    format: String(KATALOG_FORMAT),
    grossist,
    selger_navn: h.selgerNavn,
    selger_orgnr: h.selgerOrgnr,
    kildefil: basename(fil),
    kilde_sha256: createHash('sha256').update(bytes).digest('hex'),
    generert: new Date().toISOString(),
    antall: String(tatt),
  }
  const settMeta = db.prepare('insert into meta (nokkel, verdi) values (?, ?)')
  for (const [k, v] of Object.entries(meta)) settMeta.run(k, v)
  db.exec('commit')
  db.exec("insert into sok(sok) values ('optimize')")
  db.exec('vacuum')
  db.close()

  // ── Tallene ─────────────────────────────────────────────────────────────
  const stor = statSync(utFil).size
  const gz = gzipSync(readFileSync(utFil), { level: 9 }).length
  writeFileSync(join(utMappe, `${grossist}.json`), JSON.stringify({ ...meta, bytes: stor, gzip_bytes: gz }, null, 2))

  console.log(`\nSkrev:      ${utFil}`)
  console.log(`Varer inn:  ${tatt} (hoppet over ${hoppet}: uten el-nummer/EAN eller dublett)`)
  console.log(`Størrelse:  ${(stor / 1e6).toFixed(1)} MB på disk · ${(gz / 1e6).toFixed(1)} MB gzip`)
  console.log(`Kategorier: ${kategorier.size} · topp: ${[...kategorier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  console.log(`Tid:        ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  // ── Prøv søket, slik telefonen vil gjøre det ────────────────────────────
  const les = new DatabaseSync(utFil)
  const q = les.prepare(`
    select v.elnummer, v.navn, v.fabrikat
    from sok join varer v on v.elnummer = sok.elnummer
    where sok match ? order by rank limit 5
  `)
  for (const ord of ['kabel', 'nexans', 'downlight', 'sikring 16']) {
    const t = performance.now()
    const treff = q.all(ord.split(/\s+/).map(o => `"${o}"*`).join(' '))
    console.log(`  søk «${ord}»: ${treff.length} treff på ${(performance.now() - t).toFixed(2)} ms` +
      (treff[0] ? ` → ${treff[0].elnummer} ${treff[0].navn}` : ''))
  }
  les.close()
}

function enhet(v: Vare): string {
  return v.maaleEnhet === 'ukjent' ? 'stk' : v.maaleEnhet
}

main()

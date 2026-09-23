/**
 * Legg den felles varekatalogen inn i Supabase (`katalog_varer`), der kontoret
 * søker i den.
 *
 *   npm run katalog:til-supabase -- [--grossist solar] [--fra .tmp/katalog]
 *
 * Leser den ferdige katalogfila fra `npm run katalog:bygg` — den samme fila
 * telefonene får fra R2 — så kontoret og telefonen ser de samme varene. Ingen
 * priser: fila har ingen, og tabellen har ingen priskolonner. Prisen er
 * firmaets egen og ligger i `product_prices`.
 *
 * Upsert på el-nummer, i bolker. Varer som ikke er med i fila røres ikke —
 * grossisten merker utgåtte varer selv (`utgaar`), og vi sletter aldri (regel 5).
 *
 * Krever en Ampex-administrator: bare `ampex_admins` får skrive i tabellen
 * (RLS). Innloggingen leses fra miljøet, som i `katalog:publiser`:
 *
 *   AMPEX_ADMIN_EPOST=…  AMPEX_ADMIN_PASSORD=…  (i .env.local, aldri i repoet)
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => any }

const BOLK = 1000

function arg(navn: string, standard: string): string {
  const i = process.argv.indexOf(navn)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard
}

function lesEnv(): Record<string, string> {
  const ut: Record<string, string> = { ...process.env } as Record<string, string>
  for (const fil of ['.env', '.env.local']) {
    if (!existsSync(fil)) continue
    for (const linje of readFileSync(fil, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linje)
      if (m && !(m[1] in process.env)) ut[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return ut
}

type Rad = {
  elnummer: string; navn: string; fabrikat: string | null; type: string | null; rabattgruppe: string | null
  ean: string | null; nrf: string | null; enhet: string; salgspakning: number | null; lagerfort: number | null
  utgaar: number; erstattes_av: string | null; bilde: string | null; fdv: string | null; hms: string | null
  efobase: string | null; kategori: string | null
}

async function main() {
  const env = lesEnv()
  const grossist = arg('--grossist', 'solar').toLowerCase()
  const fra = arg('--fra', '.tmp/katalog')
  const fil = join(fra, `${grossist}.sqlite`)
  if (!existsSync(fil)) { console.error(`Mangler ${fil} — kjør npm run katalog:bygg først.`); process.exit(2) }

  const url = env.EXPO_PUBLIC_SUPABASE_URL
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const epost = env.AMPEX_ADMIN_EPOST
  const passord = env.AMPEX_ADMIN_PASSORD
  if (!url || !anon) { console.error('Mangler EXPO_PUBLIC_SUPABASE_URL/ANON_KEY.'); process.exit(2) }
  if (!epost || !passord) {
    console.error('Mangler AMPEX_ADMIN_EPOST og AMPEX_ADMIN_PASSORD i .env.local (en bruker i ampex_admins).')
    process.exit(2)
  }

  const db = new DatabaseSync(fil, { readOnly: true })
  const meta = Object.fromEntries((db.prepare('select nokkel, verdi from meta').all() as { nokkel: string; verdi: string }[]).map(r => [r.nokkel, r.verdi]))
  const rader = db.prepare('select * from varer').all() as Rad[]
  console.log(`${fil}: ${rader.length} varer (kilde-sha ${String(meta.sha256 ?? meta.kilde_sha256 ?? '?').slice(0, 12)})`)

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const inn = await sb.auth.signInWithPassword({ email: epost, password: passord })
  if (inn.error) { console.error('Innlogging feilet:', inn.error.message); process.exit(1) }
  console.log(`Innlogget som ${epost}`)

  const t0 = Date.now()
  for (let i = 0; i < rader.length; i += BOLK) {
    const bolk = rader.slice(i, i + BOLK).map(r => ({
      elnummer: r.elnummer,
      navn: r.navn,
      fabrikat: r.fabrikat,
      type: r.type,
      rabattgruppe: r.rabattgruppe,
      ean: r.ean,
      nrf: r.nrf,
      enhet: r.enhet || 'stk',
      salgspakning: r.salgspakning,
      lagerfort: r.lagerfort === null ? null : r.lagerfort === 1,
      utgaar: r.utgaar === 1,
      erstattes_av: r.erstattes_av,
      bilde: r.bilde,
      fdv: r.fdv,
      hms: r.hms,
      efobase: r.efobase,
      kategori: r.kategori,
      grossist,
      kilde_sha: meta.sha256 ?? meta.kilde_sha256 ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await sb.from('katalog_varer').upsert(bolk, { onConflict: 'elnummer' })
    if (error) throw new Error(`Bolk ${i / BOLK + 1} feilet: ${error.message}`)
    if ((i / BOLK) % 10 === 0) process.stdout.write(`  ${Math.min(i + BOLK, rader.length)} / ${rader.length}\n`)
  }
  console.log(`Ferdig: ${rader.length} varer på ${((Date.now() - t0) / 1000).toFixed(0)} s.`)
  await sb.auth.signOut()
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })

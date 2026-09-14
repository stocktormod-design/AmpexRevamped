/**
 * Legg den ferdige katalogen i R2, der telefonene henter den.
 *
 *   npm run katalog:publiser -- [--grossist solar] [--fra .tmp/katalog]
 *
 * Laster opp `<grossist>.sqlite` og `<grossist>.json` (manifestet med sha,
 * antall og tidspunkt) til `katalog/` i bøtta, gjennom den samme
 * `r2-sign`-funksjonen appen bruker. R2-nøklene finnes bare der.
 *
 * Krever en Ampex-administrator: `r2-sign` signerer PUT under `katalog/` bare
 * for brukere i `ampex_admins`, for det som ligger der vises for ALLE firmaer.
 * Innloggingen leses fra miljøet:
 *
 *   AMPEX_ADMIN_EPOST=…  AMPEX_ADMIN_PASSORD=…  (i .env.local, aldri i repoet)
 *
 * Rekkefølgen er sqlite først, manifest sist: en telefon som leser manifestet
 * skal aldri peke på en fil som ikke er ferdig lastet opp.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

async function main() {
  const env = lesEnv()
  const grossist = arg('--grossist', 'solar').toLowerCase()
  const fra = arg('--fra', '.tmp/katalog')
  const sqlite = join(fra, `${grossist}.sqlite`)
  const manifest = join(fra, `${grossist}.json`)
  for (const f of [sqlite, manifest]) {
    if (!existsSync(f)) { console.error(`Mangler ${f} — kjør npm run katalog:bygg først.`); process.exit(2) }
  }

  const url = env.EXPO_PUBLIC_SUPABASE_URL
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const epost = env.AMPEX_ADMIN_EPOST
  const passord = env.AMPEX_ADMIN_PASSORD
  if (!url || !anon) { console.error('Mangler EXPO_PUBLIC_SUPABASE_URL/ANON_KEY.'); process.exit(2) }
  if (!epost || !passord) {
    console.error('Mangler AMPEX_ADMIN_EPOST og AMPEX_ADMIN_PASSORD i .env.local (en bruker i ampex_admins).')
    process.exit(2)
  }

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const inn = await sb.auth.signInWithPassword({ email: epost, password: passord })
  if (inn.error) { console.error('Innlogging feilet:', inn.error.message); process.exit(1) }
  console.log(`Innlogget som ${epost}`)

  async function last(nokkel: string, sti: string, type: string) {
    const { data, error } = await sb.functions.invoke<{ url?: string; error?: string }>('r2-sign', {
      body: { key: nokkel, method: 'put', expiresIn: 3600 },
    })
    if (error || !data?.url) throw new Error(`r2-sign avviste ${nokkel}: ${error?.message ?? data?.error ?? 'ukjent'}`)
    const kropp = readFileSync(sti)
    const t0 = Date.now()
    const svar = await fetch(data.url, { method: 'PUT', body: kropp, headers: { 'Content-Type': type } })
    if (!svar.ok) throw new Error(`PUT ${nokkel} → ${svar.status} ${await svar.text()}`)
    console.log(`  ${nokkel}: ${(kropp.length / 1e6).toFixed(1)} MB på ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  }

  await last(`katalog/${grossist}.sqlite`, sqlite, 'application/vnd.sqlite3')
  await last(`katalog/${grossist}.json`, manifest, 'application/json')

  const m = JSON.parse(readFileSync(manifest, 'utf8')) as { antall: string; generert: string }
  console.log(`Publisert: ${grossist}, ${m.antall} varer, bygget ${m.generert}. Telefonene henter ved neste varesøk.`)
  await sb.auth.signOut()
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })

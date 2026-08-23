/**
 * Kopierer den delte regne- og adapterkoden inn i regnskap-funksjonen.
 *
 *   npm run bygg:regnskap
 *
 * ── Hvorfor et generert speil, og ikke en håndskrevet kopi ─────────────────
 *
 * Fakturagrunnlaget skal regnes ÉN gang, av `lib/invoicing.ts`. Det står i
 * `lib/accounting/adapter.ts` og i `desktop/src/lib/ordre-lager.ts`, og det er
 * ikke en stilpreferanse: to regnestykker på samme faktura er ett for mye, for
 * de spriker før eller siden, og da er spørsmålet hvilket av dem kunden fikk.
 *
 * Men en Supabase Edge Function kjører Deno, og Deno krever filendelse på
 * relative importer. Kildefilene bruker `from './adapter'` fordi resten av
 * prosjektet er TypeScript med node-oppslag — å skrive om dem til `.ts` ville
 * brutt de fjorten `verify:*`-skriptene, som kompilerer med `--outDir`.
 *
 * Derfor speiles filene hit med endelsene lagt på. Mappa er GENERERT: den skal
 * aldri redigeres for hånd, og den skal bygges på nytt før hver deploy. Endrer
 * noen `lib/invoicing.ts` uten å kjøre dette, deployer vi gammel regning — så
 * skriptet legger inn en advarsel øverst i hver fil om nettopp det.
 *
 * ── Hvorfor ikke bare la funksjonen ta imot grunnlaget fra klienten ────────
 *
 * Fordi da er det klienten som bestemmer hva kunden faktureres. Utkastet
 * godkjennes riktignok av et menneske inne i regnskapssystemet, så skaden er
 * begrenset — men «et menneske ser det nok» er ikke en kontroll, det er et håp.
 * Serveren regner selv, fra radene i basen.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Kjøres via npm, som alltid starter i prosjektroten. `__dirname` ville pekt
// inn i .tmp/, der den kompilerte kopien havner.
const ROT = process.cwd()
const MAAL = join(ROT, 'supabase', 'functions', 'regnskap', 'delt')

/** Kildefil → filnavn under `delt/`. Grafen er liten fordi invoicing.ts ikke importerer noe. */
const FILER: [string, string][] = [
  ['lib/invoicing.ts', 'invoicing.ts'],
  ['lib/accounting/adapter.ts', 'accounting/adapter.ts'],
  ['lib/accounting/fiken.ts', 'accounting/fiken.ts'],
  ['lib/accounting/tripletex.ts', 'accounting/tripletex.ts'],
]

const ADVARSEL = `// GENERERT AV tools/bygg-regnskap-funksjon.ts — IKKE REDIGER.
// Kilden er %KILDE%. Endrer du den, kjør \`npm run bygg:regnskap\` på nytt,
// ellers deployer vi et annet regnestykke enn det appen viser.

`

/**
 * Legger på `.ts` der Deno krever det.
 *
 * Treffer kun relative spesifikatorer (`./` og `../`) og lar npm/jsr-importer
 * være. Filer som allerede har endelse røres ikke, så skriptet er idempotent.
 */
function medEndelser(kode: string): string {
  return kode.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
    (helhet, foer, sti, etter) => (sti.endsWith('.ts') ? helhet : `${foer}${sti}.ts${etter}`),
  )
}

let skrevet = 0
for (const [kilde, maalnavn] of FILER) {
  const kode = readFileSync(join(ROT, kilde), 'utf-8')
  const ut = join(MAAL, maalnavn)
  mkdirSync(dirname(ut), { recursive: true })
  writeFileSync(ut, ADVARSEL.replace('%KILDE%', kilde) + medEndelser(kode), 'utf-8')
  console.log(`  ${kilde} → supabase/functions/regnskap/delt/${maalnavn}`)
  skrevet++
}

console.log(`\n${skrevet} filer speilet. Deploy funksjonen på nytt for at de skal gjelde.`)

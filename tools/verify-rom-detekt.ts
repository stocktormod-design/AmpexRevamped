/**
 * Selvtest for romdelingen (lib/rom-detekt.ts). Samme mønster som verify-kalender.
 *
 *   npm run verify:rom-detekt
 *
 * Tilfellet som kostet (Moskenes 2026-09-13): to rom side om side der skilleveggen
 * slutter 1,4 m før ytterveggen, så en åpen stripe binder rommene sammen. Før gikk
 * hele stripa til ett av rommene (60/40 i stedet for 50/50). Nå deler vegglinja
 * stripa, og arealpåskriftene avgjør hvem som får bitene.
 */
import { finnRom, STANDARD, type Segment } from '../lib/rom-detekt'

let feil = 0
function sjekk(navn: string, ok: boolean, detalj?: unknown) {
  if (!ok) { feil++; console.error(`✗ ${navn}`, detalj ?? '') } else console.log(`✓ ${navn}`)
}

const p = 56.69 // pt per meter ved 1:50
const seg: Segment[] = []
/** Vegg som strekpar 0,2 m fra hverandre (grå penn, tynn strek). */
function vegg(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L * 0.1, ny = dx / L * 0.1
  for (const f of [1, -1]) seg.push({ x0: (x0 + nx * f) * p, y0: (y0 + ny * f) * p, x1: (x1 + nx * f) * p, y1: (y1 + ny * f) * p, bredde: 0.26, farge: 0.4, lys: 0 })
}
// Yttervegger 10 × 8 m
vegg(0, 0, 10, 0); vegg(10, 0, 10, 8); vegg(10, 8, 0, 8); vegg(0, 8, 0, 0)
// Skillevegg ved x = 5 fra gulv til 6,6 m — 1,4 m åpen stripe mot ytterveggen
vegg(5, 0, 5, 6.6)
// Utstyr i venstre rom: en 6 m lang dobbeltlinje 0,3 m fra skilleveggen (fundamentkant)
vegg(4.6, 0.5, 4.6, 6.5)
// Påskrifter: begge rom er 40 m² (5 × 8)
const etiketter = [{ x: 2.5 * p, y: 3 * p, areal: 40 }, { x: 7.5 * p, y: 3 * p, areal: 40 }]

const rom = finnRom(seg, { ...STANDARD, ptPerM: p }, etiketter)
const m2 = (r: (typeof rom)[number]) => r.areal / (p * p)
const boks = (r: (typeof rom)[number]) => { const xs = r.polygon.map(q => q.x / p); return [Math.min(...xs), Math.max(...xs)] }
sjekk('To rom', rom.length === 2, rom.map(r => m2(r).toFixed(1)))
if (rom.length === 2) {
  const [a, b] = [...rom].sort((r, s) => boks(r)[0] - boks(s)[0])
  // Gulvareal (innsiden av 0,2 m vegger): (9,8 × 7,8 − 0,2 × 6,6) / 2 ≈ 37,5 m² hver.
  sjekk('Venstre rom er ≈ 37,5 m² (± 4)', Math.abs(m2(a) - 37.5) <= 4, m2(a).toFixed(1))
  sjekk('Høyre rom er ≈ 37,5 m² (± 4)', Math.abs(m2(b) - 37.5) <= 4, m2(b).toFixed(1))
  sjekk('Rommene er like store (± 3 m²) — stripa er delt, ikke gitt til ett av dem', Math.abs(m2(a) - m2(b)) <= 3, [m2(a).toFixed(1), m2(b).toFixed(1)])
  sjekk('Grensa går på vegglinja (x = 5 ± 0,2 m) — også i den åpne stripa', Math.abs(boks(a)[1] - 5) <= 0.2 && Math.abs(boks(b)[0] - 5) <= 0.2, [boks(a)[1].toFixed(2), boks(b)[0].toFixed(2)])
  sjekk('Utstyrskanten deler ikke venstre rom', boks(a)[0] < 0.5, boks(a)[0].toFixed(2))
}
// Uten påskrifter skal det fortsatt bli to rom (ingen krasj, ingen regresjon)
const uten = finnRom(seg, { ...STANDARD, ptPerM: p }, [])
sjekk('Uten påskrifter: fortsatt rom', uten.length >= 1, uten.length)

if (feil > 0) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nAlle påstander passerer.')

/**
 * Selvtest for symbolsøket (lib/symbol-detekt.ts). Samme mønster som verify-kalender.
 *
 *   npm run verify:symbol-detekt
 *
 * Feilen som koster her er en detektor som ikke blir funnet (montøren tror
 * rommet er dekket) eller et symbol som får feil type (feil komponent i
 * detektorlista). Tegningen bygges syntetisk her: en forklaring med fire
 * symboler, og en plan med kopier i annen skala, rotert, med kabler og
 * henvisningslinjer tvers gjennom, pluss en boks UTEN innhold som ikke skal
 * treffe. Den ekte brannplanen søket ble utviklet på er unntatt offentlighet
 * og ligger ikke i repoet.
 */
import { lesForklaring, finnSymboler, finnRektangler, klyng, type Strek, type Tekst } from '../lib/symbol-detekt'
import { komponenterFraStreker, kindFraEtikett } from '../lib/brann-symboler'

let feil = 0
function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) { feil++; console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`) }
  else console.log(`✓ ${navn}`)
}

// ── Symbolbyggere: gir streker i pt, med (x, y) som øvre venstre hjørne ──
const strek = (x0: number, y0: number, x1: number, y1: number, bredde = 0.7): Strek => ({ x0, y0, x1, y1, bredde })
function boks(x: number, y: number, w: number, h: number, bredde = 0.7): Strek[] {
  return [strek(x, y, x + w, y, bredde), strek(x + w, y, x + w, y + h, bredde), strek(x + w, y + h, x, y + h, bredde), strek(x, y + h, x, y, bredde)]
}
function sirkel(cx: number, cy: number, r: number, n = 12): Strek[] {
  const ut: Strek[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2
    ut.push(strek(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)))
  }
  return ut
}
/** Detektor: boks 10×16 med «!» (strek + prikk) og en sikksakk. */
function detektor(x: number, y: number): Strek[] {
  return [
    ...boks(x, y, 10, 16),
    strek(x + 3, y + 2, x + 3, y + 8), ...sirkel(x + 3, y + 10.5, 0.8, 6),
    strek(x + 6, y + 2, x + 8, y + 4), strek(x + 8, y + 4, x + 6, y + 6), strek(x + 6, y + 6, x + 8, y + 8),
    strek(x + 1, y + 12, x + 9, y + 12),
    strek(x + 2, y + 13, x + 4, y + 15), strek(x + 4, y + 15, x + 6, y + 13), strek(x + 6, y + 13, x + 8, y + 15),
  ]
}
/** Manuell melder: boks 12×12 med «!» og en sirkel. */
function melder(x: number, y: number): Strek[] {
  return [...boks(x, y, 12, 12), strek(x + 3, y + 2, x + 3, y + 8), ...sirkel(x + 3, y + 10, 0.7, 6), ...sirkel(x + 8, y + 6, 2.5), ...sirkel(x + 8, y + 6, 1)]
}
/** Sirene: pil mot høyre — en strek og en trekant. */
function sirene(x: number, y: number): Strek[] {
  return [strek(x, y + 5, x + 6, y + 5), strek(x + 6, y, x + 6, y + 10), strek(x + 6, y, x + 14, y + 5), strek(x + 14, y + 5, x + 6, y + 10)]
}
/** Summer: liten Y-glyf (4 × 5). */
function summer(x: number, y: number): Strek[] {
  return [strek(x, y, x + 2, y + 2.5), strek(x + 4, y, x + 2, y + 2.5), strek(x + 2, y + 2.5, x + 2, y + 5)]
}
function skaler(ss: Strek[], sx: number, sy: number, ox: number, oy: number): Strek[] {
  return ss.map(s => ({ ...s, x0: ox + (s.x0 - ox) * sx, x1: ox + (s.x1 - ox) * sx, y0: oy + (s.y0 - oy) * sy, y1: oy + (s.y1 - oy) * sy }))
}
function roter90(ss: Strek[], cx: number, cy: number): Strek[] {
  return ss.map(s => ({ ...s, x0: cx - (s.y0 - cy), y0: cy + (s.x0 - cx), x1: cx - (s.y1 - cy), y1: cy + (s.x1 - cx) }))
}
const tekst = (t: string, x: number, y: number, hoyde = 8): Tekst => ({ tekst: t, x, y, hoyde })

// ── Forklaringen (øverst til høyre, som på ekte tegninger) ──
const streker: Strek[] = []
const tekster: Tekst[] = []
tekster.push(tekst('SYMBOLFORKLARING', 1000, 30, 14))
streker.push(...detektor(1005, 50)); tekster.push(tekst('Multikriteriedetektor', 1040, 62))
streker.push(...melder(1005, 80)); tekster.push(tekst('Manuell melder', 1040, 92))
streker.push(...sirene(1005, 110)); tekster.push(tekst('Alarmsirene', 1040, 120))
streker.push(...boks(1004, 140, 18, 12)); tekster.push(tekst('ASD', 1006, 149, 7)); tekster.push(tekst('Aspirasjonsdetektor', 1040, 150))
streker.push(...summer(1150, 56)); tekster.push(tekst('Detektor med summer', 1165, 62))
tekster.push(tekst('I= Ionisk, MK = Multikriterie', 1165, 80))
tekster.push(tekst('ANVISNINGER', 1000, 220, 14))
// ── Planen ──
const plan: Strek[] = []
// 5 detektorer: to i full skala, to i 0,75, én i 0,7×0,95 (som på den ekte planen)
plan.push(...detektor(100, 100), ...detektor(300, 100))
plan.push(...skaler(detektor(100, 300), 0.75, 0.75, 100, 300), ...skaler(detektor(300, 300), 0.75, 0.75, 300, 300))
plan.push(...skaler(detektor(500, 300), 0.7, 0.95, 500, 300))
// én detektor med summer under (glyfen litt mindre, som i planen)
plan.push(...detektor(700, 100), ...skaler(summer(703, 118), 0.8, 0.8, 703, 118))
// 3 manuelle meldere, én i 0,65-skala
plan.push(...melder(100, 500), ...melder(300, 500), ...skaler(melder(500, 500), 0.65, 0.65, 500, 500))
// 3 sirener: to rotert 90°, én i full skala
plan.push(...sirene(100, 700), ...roter90(sirene(300, 700), 307, 705), ...roter90(sirene(500, 700), 507, 705))
// 2 ASD som tekst i boks
plan.push(...boks(700, 500, 14, 10)); tekster.push(tekst('ASD', 702, 508, 6))
plan.push(...boks(800, 500, 14, 10)); tekster.push(tekst('ASD', 802, 508, 6))
// Forstyrrelser: kabler (tykke) gjennom to detektorer, henvisningslinje gjennom én, og en tom boks
plan.push(strek(50, 108, 400, 108, 3.8), strek(305, 90, 305, 400, 3.8))
plan.push(strek(60, 320, 130, 290, 0.7), strek(130, 290, 135, 292, 0.7)) // pil «Under datagulv»
plan.push(...boks(700, 300, 10, 16)) // tom boks — ikke en detektor
plan.push(...boks(900, 100, 60, 40, 0.26), ...boks(20, 20, 960, 900, 0.99)) // vegger og ramme
streker.push(...plan)

// ── Hjelpefunksjoner ──
const rekt = finnRektangler(plan)
sjekk('Rektangler i planen (9 symbolbokser + tom boks + 2 ASD + vegg + ramme; sirenen har ingen)', rekt.length, 14)
sjekk('Klynging holder «!» sammen med boksen', klyng(detektor(0, 0)).length, 1)

// ── Forklaringen ──
const { maler, omraade } = lesForklaring(streker, tekster)
sjekk('Fire hovedsymboler og ett tillegg lest', maler.map(m => m.navn), ['Multikriteriedetektor', 'Detektor med summer', 'Manuell melder', 'Alarmsirene', 'Aspirasjonsdetektor'])
sjekk('Summer er tillegg (liten glyf), detektoren ikke', maler.map(m => m.tillegg), [false, true, false, false, false])
sjekk('ASD-symbolet kjenner sin egen tekst', maler.find(m => m.navn === 'Aspirasjonsdetektor')?.tekst, ['ASD'])
sjekk('Detektormalen er 10×16', (() => { const b = maler[0].boks; return [Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0)] })(), [10, 16])
sjekk('Forklaringen slutter før ANVISNINGER', omraade !== null && omraade.y1 < 220, true)

// ── Søket ──
const funn = finnSymboler(maler, streker, tekster, { utelat: omraade })
const antall = (t: string) => funn.filter(f => f.type === t).length
sjekk('Alle 6 detektorer funnet (to skalaer, anisotrop, kabel og pil gjennom)', antall('Multikriteriedetektor'), 6)
sjekk('Alle 3 manuelle meldere (én i 0,65)', antall('Manuell melder'), 3)
sjekk('Alle 3 sirener (to rotert)', antall('Alarmsirene'), 3)
sjekk('Begge ASD funnet som tekst', antall('Aspirasjonsdetektor'), 2)
sjekk('Ingenting i forklaringen selv', funn.filter(f => f.x > 990).length, 0)
sjekk('Tom boks er ikke en detektor', funn.some(f => Math.abs(f.x - 705) < 3 && Math.abs(f.y - 308) < 3), false)
sjekk('Ingen andre typer', funn.filter(f => !['Multikriteriedetektor', 'Manuell melder', 'Alarmsirene', 'Aspirasjonsdetektor'].includes(f.type)).length, 0)
sjekk('Summer funnet under riktig detektor, og bare der', funn.filter(f => f.tillegg).map(f => [Math.round(f.x), Math.round(f.y), f.tillegg]), [[705, 108, 'Detektor med summer']])
const anis = funn.find(f => Math.abs(f.x - 503.5) < 2 && f.type === 'Multikriteriedetektor')
sjekk('Anisotrop skala målt (0,7 × 0,95)', anis && [anis.sx, anis.sy].map(v => Math.round(v * 100) / 100), [0.7, 0.95])
const rot = funn.filter(f => f.type === 'Alarmsirene' && f.rot !== 0)
sjekk('Roterte sirener rapporterer rotasjon', rot.length, 2)
sjekk('Identisk kopi gir score nær 0 (avstandsfeltet er kvantisert til 0,5 pt)', funn.filter(f => f.type === 'Multikriteriedetektor' && f.score < 0.3).length >= 2, true)

// ── Hele veien til forslag ──
const svar = komponenterFraStreker({ segmenter: streker, tekster, breddePt: 1000, hoydePt: 950 })
sjekk('14 forslag, normalisert 0..1', [svar.forslag.length, svar.forslag.every(f => f.x > 0 && f.x < 1 && f.y > 0 && f.y < 1)], [14, true])
sjekk('Typer i registeret', svar.forslag.map(f => f.kind).sort(), ['melder', 'melder', 'melder', 'multi', 'multi', 'multi', 'multi', 'multi', 'multi', 'royk', 'royk', 'sirene', 'sirene', 'sirene'])
sjekk('Leserekkefølge: øverste rad først, venstre mot høyre', svar.forslag.slice(0, 3).map(f => Math.round(f.x * 1000)), [105, 305, 705])
sjekk('Tillegget følger med forslaget', svar.forslag.find(f => f.tillegg)?.etikett, 'Multikriteriedetektor')
sjekk('Uten forklaring: tomt svar, ikke krasj', komponenterFraStreker({ segmenter: plan, tekster: [], breddePt: 1000, hoydePt: 950 }).utenForklaring, true)
sjekk('Etikett → type', ['Multikriteriedetektor', 'Manuell melder', 'Alarmsirene', 'Brannsentral', 'Ex - zenerbarriere', 'Optisk røykdetektor', 'Sløyfe inn- utgangsenhet'].map(kindFraEtikett), ['multi', 'melder', 'sirene', 'sentral', 'annet', 'royk', 'annet'])

if (feil > 0) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nAlle påstander passerer.')

/**
 * Måler vektorveien til romdelingen (strekerFraPdf → finnRom, som `finnRomPaaTegning`) på
 * ekte PDF-plantegninger. Fasiten er tegningens egne arealpåskrifter («20,3 m²»): rommet
 * som inneholder påskriften skal ha omtrent det arealet.
 *
 *   node node_modules/.bin/jiti tools/rom-maal-vektor.ts <pdf…>
 *
 * Kjører hver side. Sider uten arealpåskrifter eller med under 200 streker hoppes over.
 * Målestokken leses av tittelfeltet («1:100»); uten den 1:50 som i appen.
 */
import * as fs from 'fs'
import { strekerFraPdf } from '../lib/rom-pdf-vektor'
import { finnRom, finnRomMedPaaskrifter, romPaaskrifter, arealFraTekst, STANDARD, type Rom } from '../lib/rom-detekt'
// Kopi av maalestokkFraTekst (lib/tegning-analyse.ts drar inn WatermelonDB).
function maalestokkFraTekst(tekster: { tekst: string }[]): number | null {
  for (const t of tekster) {
    const m = /(?:^|[^\d])1\s*:\s*(\d{2,4})(?!\d)/.exec(t.tekst)
    if (m) { const n = parseInt(m[1], 10); if (n >= 10 && n <= 2000) return n }
  }
  return null
}

const ptPerMeter = (m: number) => (1000 / m) / 25.4 * 72
const arealAv = arealFraTekst
function inni(x: number, y: number, P: { x: number; y: number }[]) {
  let inn = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > y) !== (P[j].y > y) && x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x) inn = !inn
  return inn
}

/** INN_veggMin=0.06 osv. overstyrer STANDARD for parametersøk. */
function overstyr(): Record<string, number> {
  const o: Record<string, number> = {}
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('INN_') && v) o[k.slice(4)] = k === 'INN_skravur' ? (v !== '0') as never : Number(v)
  return o
}

async function main() {
  let tot = 0, treff = 0, utenRom = 0, delt = 0
  for (const fil of process.argv.slice(2)) {
    const bytes = new Uint8Array(fs.readFileSync(fil))
    for (let side = 1; side <= 40; side++) {
      let l
      try { l = await strekerFraPdf(bytes, { side, medFyll: process.env.FYLL !== '0' }) } catch { break }
      const merker = romPaaskrifter(l.tekster).filter(t => (arealAv(t.tekst) ?? 0) >= 1 && (arealAv(t.tekst) ?? 0) < 400)
      if (l.segmenter.length < 200 || merker.length < 2) continue
      const t0 = Date.now()
      const etik = merker.map(m => ({ x: m.x, y: m.y, areal: arealAv(m.tekst) }))
      let mal = maalestokkFraTekst(l.tekster) ?? 50
      let rom: Rom[]
      if (process.env.KALIBRER === '0') rom = finnRom(l.segmenter, { ...STANDARD, ...overstyr(), ptPerM: ptPerMeter(mal) }, etik)
      else ({ rom, maalestokk: mal } = finnRomMedPaaskrifter(l.segmenter, etik, mal, overstyr()))
      const p = ptPerMeter(mal)
      if (process.env.DUMP) fs.writeFileSync(`${process.env.DUMP}/${fil.split('/').pop()}-s${side}.json`, JSON.stringify({ B: l.breddePt, H: l.hoydePt, seg: l.segmenter.map(s => [s.x0, s.y0, s.x1, s.y1, s.farge ?? 0, s.bredde ?? 0, s.lys ?? 0]), merker, rom: rom.map(r => r.polygon.map(q => [q.x, q.y])) }))
      let t = 0, h = 0, u = 0, d = 0
      const linjer: string[] = []
      // Påskrifter utenfor planen (arealtabell i tittelfeltet) er ingen fasit for et rom.
      const xs = rom.flatMap(r => r.polygon.map(q => q.x)), ys = rom.flatMap(r => r.polygon.map(q => q.y))
      const [bx0, bx1, by0, by1] = [Math.min(...xs) - p, Math.max(...xs) + p, Math.min(...ys) - p, Math.max(...ys) + p]
      for (const m of merker) {
        if (!(m.x > bx0 && m.x < bx1 && m.y > by0 && m.y < by1)) continue
        const fasit = arealAv(m.tekst)!
        const r = rom.filter(r => inni(m.x, m.y, r.polygon))
        const a = r.length ? r[0].areal / (p * p) : 0
        const ok = r.length > 0 && Math.abs(a - fasit) <= 0.1 * fasit
        // samme rom deler påskrift med en annen → slått sammen
        const sammen = r.length > 0 && merker.some(n => n !== m && inni(n.x, n.y, r[0].polygon))
        t++; if (ok) h++; if (!r.length) u++; if (sammen) d++
        if (!ok) linjer.push(`    ${m.tekst.padEnd(10)} fikk ${r.length ? a.toFixed(1) : '—'}${sammen ? ' (slått sammen)' : ''}`)
      }
      console.log(`${fil.split('/').pop()} s.${side} 1:${mal}: ${h}/${t} påskrifter treffer ±10 % · ${rom.length} rom funnet · ${u} uten rom · ${d} i sammenslåtte · ${Date.now() - t0} ms`)
      if (process.env.DETALJ) console.log(linjer.join('\n'))
      tot += t; treff += h; utenRom += u; delt += d
    }
  }
  console.log(`\nTOTALT: ${treff}/${tot} = ${(100 * treff / Math.max(tot, 1)).toFixed(1)} % · uten rom ${utenRom} · i sammenslåtte ${delt}`)
}
main()

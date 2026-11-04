/**
 * Måler romdelingen på rasterveien mot fasit-tegninger (CubiCasa5K m.fl.), utenfor appen.
 * Samme kall som `finnRomPaaTegning` sin rastervei: morkMaske → linjerFraMaske → finnRom.
 *
 *   node .tmp/rom-maal/tools/rom-maal.js <liste.json> <ut.json>
 *
 * liste.json: [{ id, rgba: sti til rå RGBA (W·H·4 byte), W, H, pxPerM }]
 * ut.json:    [{ id, ms, rom: [{ punkter: [[x,y]…] i piksler, areal: m² }] }]
 * Fasit og scoring ligger i tools/rom-maal-score.py.
 */
import * as fs from 'fs'
import { finnRom, finnRomIRaster, STANDARD } from '../lib/rom-detekt'
import { morkMaske, linjerFraMaske, veggRasterFraMaske, fjernUtenfor } from '../lib/rom-linjer'

// ROMVEI=piksel: veggene rett fra pikslene (veggRasterFraMaske). Ellers strekveien som i appen.
const VEI = process.env.ROMVEI ?? 'strek'
const tall = (n: string, d: number) => process.env[n] ? Number(process.env[n]) : d

type Inn = { id: string; rgba: string; W: number; H: number; pxPerM: number }
const liste: Inn[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const ut: unknown[] = []
for (const t of liste) {
  const t0 = Date.now()
  try {
    const px = new Uint8Array(fs.readFileSync(t.rgba))
    const { maske, lys } = morkMaske(px, t.W, t.H)
    const inn = { ...STANDARD, ptPerM: t.pxPerM }
    let rom
    if (VEI === 'piksel') {
      const r = veggRasterFraMaske(maske, t.W, t.H, t.pxPerM, inn.oppløsning, { lukk: tall('LUKK', 0.12), åpne: tall('AAPNE', 0.06), andel: tall('ANDEL', 0.3) })
      const vegg0 = r.vegg.slice() // finnRomIRaster rydder småvegger i r.vegg
      if (process.env.DUMP) fs.writeFileSync(`${process.env.DUMP}/${t.id}.vegg`, Buffer.concat([Buffer.from(Int32Array.from([r.W, r.H]).buffer), Buffer.from(vegg0)]))
      rom = finnRomIRaster(r, inn)
      if (tall('UTE', 1)) rom = fjernUtenfor(rom, { ...r, vegg: vegg0 }, Math.round(tall('HALVDOR', 0.5) / inn.oppløsning))
    } else {
      const seg = linjerFraMaske(maske, t.W, t.H, Math.max(3, Math.round(0.4 * t.pxPerM)), lys)
      rom = seg.length < 20 ? [] : finnRom(seg, inn)
    }
    ut.push({ id: t.id, ms: Date.now() - t0, rom: rom.map(r => ({ punkter: r.polygon.map(p => [p.x, p.y]), areal: r.areal / (t.pxPerM * t.pxPerM) })) })
  } catch (e) {
    ut.push({ id: t.id, ms: Date.now() - t0, feil: String(e), rom: [] })
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(ut))
console.log(`${ut.length} tegninger`)

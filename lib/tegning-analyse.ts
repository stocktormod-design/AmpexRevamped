/**
 * Analysen ved første opplasting (Tormod 2026-09-13: «bruk telefonens CPU på
 * hver initial opplast … etter det ligger det inne»). Kjøres ÉN gang per
 * tegning, på telefonen som har fila, og skriver vanlige rader:
 *
 *   - komponenter fra symbolforklaringen → fire_devices (source 'tegning')
 *   - rom fra strekene → rooms (målestokken leses av tittelfeltet, «1 : 50»)
 *   - stempel drawings.analyzed_at, så ingen annen telefon regner på nytt
 *
 * Tegningen leses én gang (native skanner på iOS, pdf.js ellers) og begge
 * søkene går på de samme strekene. Alt lokalt, ingenting lastes opp.
 * Regel 10: bare i forgrunn, aldri ved termisk tilstand «serious»/«critical»,
 * og søket slipper JS-tråden underveis så appen svarer imens.
 */

import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { syncQuietly } from './db/sync'
import { Drawing } from './db/models/drawing'
import { FireDevice } from './db/models/fire-device'
import { Room } from './db/models/room'
import { lesTegningsvektorer } from './brann-fra-tegning'
import { komponenterFraStrekerAsync } from './brann-symboler'
import { finnRomPaaTegning } from './rom-fra-tegning'
import { termiskTilstand } from '../modules/ampex-splat'
import { aiLogg } from './ai/ai-logg'

export type AnalyseSteg = 'leser' | 'komponenter' | 'rom' | 'lagrer'
export type AnalyseResultat =
  | { kind: 'ferdig'; komponenter: number; rom: number; symboltyper: number; maalestokk: number | null }
  | { kind: 'utsatt'; grunn: 'termisk' | 'pågår' }
  | { kind: 'feil'; melding: string }

const pågår = new Set<string>()

/** «1 : 50», «1:100», «M 1:50» i tittelfeltet → 50. Ingen → null (romdelingen bruker 50). */
export function maalestokkFraTekst(tekster: { tekst: string }[]): number | null {
  for (const t of tekster) {
    const m = /(?:^|[^\d])1\s*:\s*(\d{2,4})(?!\d)/.exec(t.tekst)
    if (m) { const n = parseInt(m[1], 10); if (n >= 10 && n <= 2000) return n }
  }
  return null
}

/**
 * Kjør analysen for én tegning. Idempotent: komponenter og rom som alt finnes
 * på tegningen hoppes over, så et avbrutt løp kan tas igjen.
 */
export async function analyserTegning(
  drawing: Drawing,
  localUri: string,
  userId: string | null,
  onSteg?: (steg: AnalyseSteg, andel: number) => void,
): Promise<AnalyseResultat> {
  if (pågår.has(drawing.id)) return { kind: 'utsatt', grunn: 'pågår' }
  if (termiskTilstand() >= 2) { aiLogg('[analyse] utsatt, termisk', termiskTilstand()); return { kind: 'utsatt', grunn: 'termisk' } }
  pågår.add(drawing.id)
  const t0 = Date.now()
  try {
    onSteg?.('leser', 0)
    const side = await lesTegningsvektorer(localUri)
    const maalestokk = maalestokkFraTekst(side.tekster)

    // 1) Komponenter fra forklaringen
    onSteg?.('komponenter', 0)
    const svar = await komponenterFraStrekerAsync(side, a => onSteg?.('komponenter', a))
    const iProsjektet = await database.get<FireDevice>('fire_devices').query(Q.where('project_id', drawing.projectId)).fetch()
    const paaTegningen = iProsjektet.filter(d => d.drawingId === drawing.id)
    const nyeKomponenter = svar.forslag.filter(f => !paaTegningen.some(d => Math.hypot(d.x - f.x, d.y - f.y) < 0.004))
    let maks = 0
    for (const d of iProsjektet) { const m = /^01\.(\d+)$/.exec(d.tag); if (m) maks = Math.max(maks, parseInt(m[1], 10)) }

    // 2) Rom fra strekene — bare hvis tegningen ikke alt har rom
    onSteg?.('rom', 0)
    const romFinnes = await database.get<Room>('rooms').query(Q.where('drawing_id', drawing.id)).fetchCount()
    let romforslag: Awaited<ReturnType<typeof finnRomPaaTegning>> = []
    if (romFinnes === 0) {
      try {
        romforslag = await finnRomPaaTegning(localUri, { streker: side, maalestokk: maalestokk ?? 50, sidebreddePt: side.breddePt })
      } catch (e) {
        aiLogg('[analyse] romdeling feilet', e instanceof Error ? e.message : String(e))
      }
    }
    romforslag.sort((a, b) => b.areal - a.areal)

    // 3) Skriv alt i én skriving, og stemple tegningen
    onSteg?.('lagrer', 0)
    await database.write(async () => {
      await database.batch(
        ...nyeKomponenter.map((f, i) => database.get<FireDevice>('fire_devices').prepareCreate(d => {
          d.projectId = drawing.projectId
          d.drawingId = drawing.id
          d.x = f.x; d.y = f.y
          d.kind = f.kind
          d.tag = `01.${String(maks + 1 + i).padStart(3, '0')}`
          d.note = [f.etikett, f.tillegg].filter(Boolean).join(' · ')
          d.source = 'tegning'
          d.createdBy = userId
        })),
        ...romforslag.map((f, i) => database.get<Room>('rooms').prepareCreate(r => {
          r.projectId = drawing.projectId
          r.drawingId = drawing.id
          r.plan = drawing.plan
          r.name = f.navn ?? `Rom ${i + 1}`
          r.shape = JSON.stringify({ points: f.punkter })
        })),
        drawing.prepareUpdate(d => { d.analyzedAt = new Date() }),
      )
    })
    syncQuietly()
    aiLogg('[analyse] ferdig', nyeKomponenter.length, 'komponenter', romforslag.length, 'rom', 'målestokk', maalestokk, (Date.now() - t0) + ' ms')
    return { kind: 'ferdig', komponenter: nyeKomponenter.length, rom: romforslag.length, symboltyper: svar.symboltyper.length, maalestokk }
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e)
    aiLogg('[analyse] feil', melding)
    return { kind: 'feil', melding }
  } finally {
    pågår.delete(drawing.id)
  }
}

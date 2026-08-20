import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from '../db'
import { Product } from '../db/models/product'
import { ProductPrice } from '../db/models/product-price'
import { syncQuietly } from '../db/sync'
import { parseEfoNelfo } from './efo-nelfo'
import { importerPrisfil, type ImportResultat } from './import'
import { demoBildeFor, demoFiler, DEMO_KILDE } from './demo-katalog'

/**
 * Demokatalog inn og ut.
 *
 * Ampex er systemleverandør, ikke elektrofirma — vi har ingen kundeforhold hos
 * noen grossist og får derfor ingen prisfil ved å be om vår egen. Uten en
 * pilotkunde eller en testfil fra grossisten står varekartoteket tomt, og da er
 * hverken søket, varekortet eller prissammenligningen mulig å se.
 *
 * Demokatalogen løser det: to oppdiktede P4-filer i ekte format, gjennom den
 * ekte parseren og den ekte importen. Ingen egen kodevei — det er hele poenget.
 * Ville vi hatt en snarvei som skrev rett i basen, ville demoen bevist noe annet
 * enn det systemet faktisk gjør.
 *
 * Alt merkes med `source_system = 'demo'` og kan fjernes med ett trykk. Fikk en
 * oppdiktet pris ligge igjen inn i en ekte faktura, ville det vært en pengefeil.
 */

export type DemoResultat = { grossist: string; resultat: ImportResultat }

export async function lastInnDemokatalog(): Promise<DemoResultat[]> {
  const ut: DemoResultat[] = []
  // Sekvensielt, ikke parallelt: den andre fila må se den førstes priser for å
  // kunne avgjøre hvem som er billigst.
  for (const fil of demoFiler()) {
    const parset = parseEfoNelfo(fil.innhold)
    const resultat = await importerPrisfil(parset, {
      grossist: fil.grossist,
      // Ingen påslagsregel: utsalgsprisen er bedriftens beslutning, også i en demo.
      kilde: DEMO_KILDE,
      inkluderUtgaatte: true,
    })
    ut.push({ grossist: fil.grossist, resultat })
  }
  await settDemobilder()
  return ut
}

/**
 * Setter piktogrammene, etter importen.
 *
 * De kan ikke ligge i filene: en `data:image/png;base64,…` inneholder semikolon,
 * og prisfilformatet er semikolonseparert — parseren splitter den og lagrer
 * «data:image/png». Ekte prisfiler har `https://`-URL-er i `BILDE`, som ikke har
 * det problemet, så dette er en demo-begrensning og ikke en mangel i formatet.
 */
async function settDemobilder(): Promise<void> {
  const varer = await database.get<Product>('products')
    .query(Q.where('source_system', DEMO_KILDE)).fetch()
  const med = varer
    .map(v => ({ v, bilde: v.imageUrl ? null : (v.elnummer ? demoBildeFor(v.elnummer) : null) }))
    .filter((x): x is { v: Product; bilde: string } => !!x.bilde)
  if (med.length === 0) return
  // Bolkvis: en batch med flere hundre store data-URI-er på én gang er en
  // unødvendig minnetopp på en telefon.
  const BOLK = 100
  for (let i = 0; i < med.length; i += BOLK) {
    const del = med.slice(i, i + BOLK)
    await database.write(async () => {
      await database.batch(...del.map(({ v, bilde }) => v.prepareUpdate(p => { p.imageUrl = bilde })))
    })
  }
}

/** Antall demo-varer i kartoteket. 0 = ingen demodata inne. */
export function useDemoAntall(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const sub = database.get<Product>('products')
      .query(Q.where('source_system', DEMO_KILDE))
      .observeCount()
      .subscribe(setN)
    return () => sub.unsubscribe()
  }, [])
  return n
}

/**
 * Fjerner demokatalogen.
 *
 * Soft delete (regel #5) også her: radene har vært synket, og en hard sletting
 * lokalt ville latt dem komme tilbake ved neste pull.
 *
 * Varer som er brukt på en ordre eller har lagerbevegelser røres IKKE — da er
 * de ikke lenger demodata, de er noe noen har tatt i bruk, og en ordrelinje som
 * peker på en slettet vare er verre enn en demovare til overs.
 */
export async function fjernDemodata(): Promise<{ fjernet: number; beholdt: number }> {
  const varer = await database.get<Product>('products').query(Q.where('source_system', DEMO_KILDE)).fetch()
  if (varer.length === 0) return { fjernet: 0, beholdt: 0 }

  const ider = varer.map(v => v.id)
  const brukt = new Set<string>()
  const BOLK = 500
  for (let i = 0; i < ider.length; i += BOLK) {
    const del = ider.slice(i, i + BOLK)
    const [bevegelser, materiell] = await Promise.all([
      database.get('stock_movements').query(Q.where('product_id', Q.oneOf(del))).fetch(),
      database.get('order_materials').query(Q.where('product_id', Q.oneOf(del))).fetch(),
    ])
    for (const r of bevegelser) brukt.add((r as unknown as { productId: string }).productId)
    for (const r of materiell) brukt.add((r as unknown as { productId: string }).productId)
  }

  const skalBort = varer.filter(v => !brukt.has(v.id))
  const priser = await database.get<ProductPrice>('product_prices')
    .query(Q.where('product_id', Q.oneOf(skalBort.map(v => v.id)))).fetch()

  await database.write(async () => {
    for (const r of priser) await r.markAsDeleted()
    for (const v of skalBort) await v.markAsDeleted()
  })
  syncQuietly()
  return { fjernet: skalBort.length, beholdt: varer.length - skalBort.length }
}

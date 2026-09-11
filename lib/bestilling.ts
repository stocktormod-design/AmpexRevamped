/**
 * Bestilling til grossist — og handlelista, som er det samme.
 *
 * FUNKSJON UTEN SKJERM. En bestilling i `utkast` ER handlelista: montøren
 * legger på det som mangler mens han står i bilen, og lista blir en bestilling
 * i det den sendes. To begreper ville betydd kopiering mellom dem, og noe å
 * glemme.
 *
 * `leggIHandleliste()` er inngangen for alt: den finner eller lager utkastet
 * for grossisten, slår sammen like varer, og returnerer linja. Et UI trenger
 * ikke vite om noe av det.
 *
 * Utsending (PDF på e-post til ordrekontoret) ligger i `lib/bestilling-send.ts`
 * fordi den snakker med nettet; alt her er database.
 */
import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import {
  PurchaseOrder, PurchaseOrderLine,
  type BestillingStatus,
} from './db/models/purchase-order'
import { Product } from './db/models/product'
import { supabase } from './supabase'

export type { BestillingStatus }
export { bestillingStatusLabel } from './db/models/purchase-order'

/* ── Handlelista (utkast) ──────────────────────────────────────────────────── */

/** Finner utkastet for grossisten, eller lager det. */
export async function hentEllerLagUtkast(grossist: string, opts: {
  ordreId?: string | null
  lokasjonId?: string | null
} = {}): Promise<PurchaseOrder> {
  const finnes = await database
    .get<PurchaseOrder>('purchase_orders')
    .query(Q.where('grossist', grossist), Q.where('status', 'utkast'))
    .fetch()
  if (finnes.length > 0) return finnes[0]

  return database.write(async () =>
    database.get<PurchaseOrder>('purchase_orders').create(b => {
      b.grossist = grossist
      b.status = 'utkast'
      b.orderId = opts.ordreId ?? null
      b.locationId = opts.lokasjonId ?? null
    }),
  )
}

export type Handlelinje = {
  beskrivelse: string
  antall?: number
  enhet?: string
  elnummer?: string | null
  produktId?: string | null
}

/**
 * Legger en vare i handlelista. Finnes samme el-nummer der fra før, ØKES
 * antallet i stedet for å lage en ny linje: to linjer med samme el-nummer i
 * en bestilling blir to leveranser hos grossisten.
 */
export async function leggIHandleliste(
  grossist: string,
  linje: Handlelinje,
  opts: { ordreId?: string | null; lokasjonId?: string | null } = {},
): Promise<PurchaseOrderLine> {
  const bestilling = await hentEllerLagUtkast(grossist, opts)
  const antall = linje.antall ?? 1

  const eksisterende = linje.elnummer
    ? await database
        .get<PurchaseOrderLine>('purchase_order_lines')
        .query(Q.where('purchase_order_id', bestilling.id), Q.where('elnummer', linje.elnummer))
        .fetch()
    : []

  if (eksisterende.length > 0) {
    const rad = eksisterende[0]
    await database.write(async () => rad.update(l => { l.antall = l.antall + antall }))
    return rad
  }

  const antallLinjer = await database
    .get<PurchaseOrderLine>('purchase_order_lines')
    .query(Q.where('purchase_order_id', bestilling.id))
    .fetchCount()

  return database.write(async () =>
    database.get<PurchaseOrderLine>('purchase_order_lines').create(l => {
      l.purchaseOrderId = bestilling.id
      l.productId = linje.produktId ?? null
      l.elnummer = linje.elnummer ?? null
      l.beskrivelse = linje.beskrivelse.trim()
      l.antall = antall
      l.enhet = linje.enhet ?? 'stk'
      l.mottattAntall = 0
      l.sortOrder = antallLinjer
    }),
  )
}

/** Snarvei: legg en vare fra kartoteket i lista, med navn og el-nummer med. */
export async function leggVareIHandleliste(
  grossist: string,
  vare: Product,
  antall = 1,
  opts: { ordreId?: string | null; lokasjonId?: string | null } = {},
): Promise<PurchaseOrderLine> {
  return leggIHandleliste(grossist, {
    beskrivelse: vare.name,
    elnummer: vare.elnummer,
    produktId: vare.id,
    antall,
  }, opts)
}

export async function endreAntall(linje: PurchaseOrderLine, antall: number): Promise<void> {
  if (antall <= 0) { await fjernLinje(linje); return }
  await database.write(async () => linje.update(l => { l.antall = antall }))
}

export async function fjernLinje(linje: PurchaseOrderLine): Promise<void> {
  await database.write(async () => linje.markAsDeleted())
}

export async function oppdaterBestilling(
  bestilling: PurchaseOrder,
  endring: Partial<{
    grossist: string; grossistEpost: string | null; kundenummer: string | null
    referanse: string | null; merknad: string | null
    ordreId: string | null; lokasjonId: string | null
  }>,
): Promise<void> {
  await database.write(async () =>
    bestilling.update(b => {
      if (endring.grossist !== undefined) b.grossist = endring.grossist
      if (endring.grossistEpost !== undefined) b.grossistEpost = endring.grossistEpost
      if (endring.kundenummer !== undefined) b.kundenummer = endring.kundenummer
      if (endring.referanse !== undefined) b.referanse = endring.referanse
      if (endring.merknad !== undefined) b.merknad = endring.merknad
      if (endring.ordreId !== undefined) b.orderId = endring.ordreId
      if (endring.lokasjonId !== undefined) b.locationId = endring.lokasjonId
    }),
  )
}

/* ── Livssyklus ────────────────────────────────────────────────────────────── */

/** Kastes når noen prøver å sende en tom bestilling. */
export class TomBestilling extends Error {
  constructor() {
    super('Bestillingen har ingen linjer.')
    this.name = 'TomBestilling'
  }
}

/**
 * Markerer bestillingen som sendt. Selve utsendingen ligger i
 * `lib/bestilling-send.ts` — denne skriver bare tilstanden, så en bestilling
 * som ble sendt uten dekning kan markeres når den faktisk gikk.
 */
export async function markerSendt(bestilling: PurchaseOrder): Promise<void> {
  const antall = await linjerFor(bestilling.id).fetchCount()
  if (antall === 0) throw new TomBestilling()
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  await database.write(async () =>
    bestilling.update(b => {
      b.status = 'sendt'
      b.sendtAt = new Date()
      b.sendtAv = bruker
    }),
  )
}

/**
 * Registrerer mottak. Uten `linjer` regnes alt som mottatt; med `linjer`
 * settes antallet per linje, slik at delvis leveranse ser riktig ut —
 * det er normalen, ikke unntaket.
 */
export async function registrerMottak(
  bestilling: PurchaseOrder,
  opts: { linjer?: { linje: PurchaseOrderLine; mottatt: number }[]; eksternOrdrenr?: string | null } = {},
): Promise<void> {
  const alle = await linjerFor(bestilling.id).fetch()
  await database.write(async () => {
    if (opts.linjer) {
      for (const { linje, mottatt } of opts.linjer) {
        await linje.update(l => { l.mottattAntall = Math.max(0, mottatt) })
      }
    } else {
      for (const l of alle) await l.update(x => { x.mottattAntall = x.antall })
    }
    await bestilling.update(b => {
      b.eksternOrdrenr = opts.eksternOrdrenr ?? b.eksternOrdrenr
      b.mottattAt = new Date()
      b.status = 'mottatt'
    })
  })
}

export async function avbrytBestilling(bestilling: PurchaseOrder): Promise<void> {
  await database.write(async () => bestilling.update(b => { b.status = 'avbrutt' }))
}

/* ── Lesing ────────────────────────────────────────────────────────────────── */

function linjerFor(bestillingId: string) {
  return database
    .get<PurchaseOrderLine>('purchase_order_lines')
    .query(Q.where('purchase_order_id', bestillingId), Q.sortBy('sort_order', Q.asc))
}

export function useBestillinger(status?: BestillingStatus): PurchaseOrder[] {
  const [rader, setRader] = useState<PurchaseOrder[]>([])
  useEffect(() => {
    const sub = database
      .get<PurchaseOrder>('purchase_orders')
      .query(...(status ? [Q.where('status', status)] : []))
      .observe()
      .subscribe(r => setRader([...r].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())))
    return () => sub.unsubscribe()
  }, [status])
  return rader
}

/** Handlelistene: ett utkast per grossist. */
export function useHandlelister(): PurchaseOrder[] {
  return useBestillinger('utkast')
}

export function useBestillingslinjer(bestillingId: string | null | undefined): PurchaseOrderLine[] {
  const [rader, setRader] = useState<PurchaseOrderLine[]>([])
  useEffect(() => {
    if (!bestillingId) { setRader([]); return }
    const sub = linjerFor(bestillingId).observe().subscribe(setRader)
    return () => sub.unsubscribe()
  }, [bestillingId])
  return rader
}

export async function hentLinjer(bestillingId: string): Promise<PurchaseOrderLine[]> {
  return linjerFor(bestillingId).fetch()
}

/** Bestillinger knyttet til én ordre — «hva er på vei til denne jobben». */
export function useBestillingerForOrdre(orderId: string | null | undefined): PurchaseOrder[] {
  const [rader, setRader] = useState<PurchaseOrder[]>([])
  useEffect(() => {
    if (!orderId) { setRader([]); return }
    const sub = database
      .get<PurchaseOrder>('purchase_orders')
      .query(Q.where('order_id', orderId))
      .observe()
      .subscribe(setRader)
    return () => sub.unsubscribe()
  }, [orderId])
  return rader
}

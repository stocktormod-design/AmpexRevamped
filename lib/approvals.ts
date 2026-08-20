import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Order } from './db/models/order'
import { OrderApproval, type Beslutning } from './db/models/order-approval'
import { OrderDocument } from './db/models/order-document'
import { OrderMaterial } from './db/models/order-material'
import { OrderSignature } from './db/models/order-signature'
import { TimeEntry } from './db/models/time-entry'
import { syncQuietly } from './db/sync'
import { supabase } from './supabase'
import { finnAvvik, sisteBeslutning, type Grunnlag, type Godkjenningsstatus } from './approvals-calc'

export { finnAvvik, sisteBeslutning, type Grunnlag, type Godkjenningsstatus }

/**
 * Faglig godkjenning.
 *
 * Sperren mot å fakturere uten godkjenning ligger i databasen (trigger
 * `krev_faglig_godkjenning`), ikke her. Dette laget handler om å gi faglig
 * ansvarlig et grunnlag å bestemme PÅ — og om å oppdage når en godkjenning har
 * gått ut på dato.
 */

async function hentGrunnlag(orderId: string, sumOre: number): Promise<Grunnlag> {
  const [order, materiell, timer, docs, signaturer] = await Promise.all([
    database.get<Order>('orders').find(orderId).catch(() => null),
    database.get<OrderMaterial>('order_materials').query(Q.where('order_id', orderId)).fetch(),
    database.get<TimeEntry>('time_entries').query(Q.where('order_id', orderId)).fetch(),
    database.get<OrderDocument>('order_documents').query(Q.where('order_id', orderId)).fetch(),
    database.get<OrderSignature>('order_signatures').query(Q.where('order_id', orderId)).fetch(),
  ])
  return {
    sumOre,
    timer: Math.round(timer.reduce((n, t) => n + t.hours, 0) * 100) / 100,
    antallMateriell: materiell.length,
    antallDokumenter: docs.length,
    antallFullforte: docs.filter(d => d.status === 'fullfort').length,
    antallSignaturer: signaturer.length,
    harKunde: !!order?.customerId,
  }
}

/** Ordre som venter på faglig ansvarlig: fakturaklare uten gjeldende godkjenning. */
export function useTilGodkjenning(): Order[] {
  const [rader, setRader] = useState<Order[]>([])
  useEffect(() => {
    const sub = database.get<Order>('orders')
      .query(Q.where('status', 'fakturaklar'), Q.sortBy('updated_at', Q.asc))
      .observeWithColumns(['status', 'title', 'customer_name'])
      .subscribe(async ordre => {
        if (ordre.length === 0) { setRader([]); return }
        const godkjenninger = await database.get<OrderApproval>('order_approvals')
          .query(Q.where('order_id', Q.oneOf(ordre.map(o => o.id)))).fetch()
        const godkjent = new Set(
          godkjenninger.filter(a => a.beslutning === 'godkjent').map(a => a.orderId),
        )
        setRader(ordre.filter(o => !godkjent.has(o.id)))
      })
    return () => sub.unsubscribe()
  }, [])
  return rader
}

export function useGodkjenninger(orderId: string | null | undefined): OrderApproval[] {
  const [rader, setRader] = useState<OrderApproval[]>([])
  useEffect(() => {
    if (!orderId) { setRader([]); return }
    const sub = database.get<OrderApproval>('order_approvals')
      .query(Q.where('order_id', orderId), Q.sortBy('besluttet_at', Q.desc))
      .observe().subscribe(setRader)
    return () => sub.unsubscribe()
  }, [orderId])
  return rader
}

/**
 * Kan innlogget bruker godkjenne faglig?
 *
 * Speiler `kan_godkjenne_faglig()` i databasen — men KUN for å vise/skjule
 * knapper. Sannheten ligger i RLS-policyen; denne er høflighet, ikke sikkerhet.
 */
export function useKanGodkjenne(): boolean {
  const [kan, setKan] = useState(false)
  useEffect(() => {
    let levende = true
    supabase.rpc('kan_godkjenne_faglig')
      .then(({ data }) => { if (levende) setKan(data === true) })
    return () => { levende = false }
  }, [])
  return kan
}

export type BeslutningInput = {
  orderId: string
  beslutning: Beslutning
  begrunnelse?: string | null
  /** Fakturagrunnlagets brutto i øre — det tallet han faktisk så på. */
  sumOre: number
}

/**
 * Registrer beslutningen.
 *
 * Ved avslag settes ordren tilbake til `pagaar`: den er ikke fakturaklar lenger,
 * og montøren skal se den blant sine aktive jobber igjen — ikke måtte lete etter
 * den i en liste over avviste.
 */
export async function registrerBeslutning(input: BeslutningInput): Promise<void> {
  const { data } = await supabase.auth.getUser()
  const bruker = data.user
  const meta = (bruker?.user_metadata ?? {}) as Record<string, unknown>
  const navn = ((meta.full_name ?? meta.name) as string | undefined)
    ?? bruker?.email?.split('@')[0]
    ?? 'Ukjent'

  const grunnlag = await hentGrunnlag(input.orderId, input.sumOre)
  const order = await database.get<Order>('orders').find(input.orderId)

  await database.write(async () => {
    await database.get<OrderApproval>('order_approvals').create(a => {
      a.orderId = input.orderId
      a.beslutning = input.beslutning
      a.godkjennerId = bruker?.id ?? null
      a.godkjennerNavn = navn
      a.begrunnelse = input.begrunnelse?.trim() || null
      a.sumOre = grunnlag.sumOre
      a.timer = grunnlag.timer
      a.antallMateriell = grunnlag.antallMateriell
      a.antallDokumenter = grunnlag.antallDokumenter
      a.antallSignaturer = grunnlag.antallSignaturer
      a.besluttetAt = new Date()
    })
    if (input.beslutning === 'avvist') {
      await order.update(o => { o.status = 'pagaar' })
    }
  })
  syncQuietly()
}

/** Grunnlaget for én ordre, til godkjenningsskjermen. */
export function useGrunnlag(orderId: string | null | undefined, sumOre: number): Grunnlag | null {
  const [g, setG] = useState<Grunnlag | null>(null)
  useEffect(() => {
    if (!orderId) { setG(null); return }
    let levende = true
    hentGrunnlag(orderId, sumOre).then(x => { if (levende) setG(x) })
    return () => { levende = false }
  }, [orderId, sumOre])
  return g
}

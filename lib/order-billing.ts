import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { combineLatest } from 'rxjs'
import { database } from './db'
import { Activity } from './db/models/activity'
import { Order } from './db/models/order'
import { OrderExtra } from './db/models/order-extra'
import { OrderMaterial } from './db/models/order-material'
import { TimeEntry } from './db/models/time-entry'
import { OrderApproval } from './db/models/order-approval'
import { syncQuietly } from './db/sync'
import {
  byggFakturagrunnlag, sisteFakturarunde, type Fakturagrunnlag, type GrunnlagValg,
  type MateriellInn, type TilleggInn, type TimeInn,
} from './invoicing'

/**
 * Kobler ordredataene til det rene regnestykket i `invoicing.ts`.
 * Alt leses fra lokal SQLite (regel 2) — ingen skjerm rører Supabase.
 */

function tilMateriellInn(m: OrderMaterial): MateriellInn {
  return {
    id: m.id,
    beskrivelse: m.description,
    antall: m.quantity,
    enhet: m.unit,
    elnummer: m.elnummer,
    enhetsprisKr: m.unitPrice,
    kostprisKr: m.costPrice,
    mvaType: m.vatType,
    rabattProsent: m.discountPercent,
    fakturerbar: m.billable,
    fakturertTid: m.invoicedAt?.getTime() ?? null,
  }
}

function tilTimeInn(t: TimeEntry, aktiviteter: Map<string, Activity>): TimeInn {
  const a = t.activityId ? aktiviteter.get(t.activityId) : undefined
  return {
    id: t.id,
    aktivitetId: t.activityId,
    aktivitetNavn: a?.name ?? null,
    aktivitetTimepris: a?.hourlyRate ?? null,
    aktivitetFakturerbar: a?.billable ?? null,
    aktivitetMva: a?.vatType ?? null,
    personId: t.userId,
    personNavn: t.userName,
    dato: t.date.getTime(),
    timer: t.hours,
    notat: t.note,
    fakturerbar: t.billable,
    fakturertTid: t.invoicedAt?.getTime() ?? null,
  }
}

function tilTilleggInn(x: OrderExtra): TilleggInn {
  return {
    id: x.id,
    tittel: x.title,
    beskrivelse: x.description,
    prising: x.pricing,
    prisKr: x.price,
    mvaType: x.vatType,
    status: x.status,
    godkjentAv: x.approvedBy,
    fakturertTid: x.invoicedAt?.getTime() ?? null,
  }
}

export function useFakturagrunnlag(orderId: string, valg: GrunnlagValg = {}): Fakturagrunnlag | null {
  const [grunnlag, setGrunnlag] = useState<Fakturagrunnlag | null>(null)
  const gruppering = valg.gruppering
  const inkluderFakturerte = valg.inkluderFakturerte
  useEffect(() => {
    if (!orderId) return
    const materiell$ = database.get<OrderMaterial>('order_materials')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observeWithColumns(['quantity', 'unit_price', 'discount_percent', 'cost_price', 'billable', 'invoiced_at', 'description'])
    const timer$ = database.get<TimeEntry>('time_entries')
      .query(Q.where('order_id', orderId), Q.sortBy('date', Q.asc))
      .observeWithColumns(['hours', 'activity_id', 'billable', 'invoiced_at', 'note'])
    const aktiviteter$ = database.get<Activity>('activities').query()
      .observeWithColumns(['name', 'hourly_rate', 'billable', 'vat_type'])
    const tillegg$ = database.get<OrderExtra>('order_extras')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observeWithColumns(['title', 'status', 'price', 'pricing', 'invoiced_at', 'approved_by'])
    const sub = combineLatest([materiell$, timer$, aktiviteter$, tillegg$]).subscribe(([m, t, a, x]) => {
      const aMap = new Map(a.map(y => [y.id, y]))
      setGrunnlag(byggFakturagrunnlag(
        m.map(tilMateriellInn),
        t.map(y => tilTimeInn(y, aMap)),
        { gruppering, inkluderFakturerte },
        x.map(tilTilleggInn),
      ))
    })
    return () => sub.unsubscribe()
  }, [orderId, gruppering, inkluderFakturerte])
  return grunnlag
}

/** Engangsuttrekk — for AI-verktøy og adaptere som ikke kan abonnere. */
export async function hentFakturagrunnlag(orderId: string, valg: GrunnlagValg = {}): Promise<Fakturagrunnlag> {
  const [materiell, timer, aktiviteter, tillegg] = await Promise.all([
    database.get<OrderMaterial>('order_materials').query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc)).fetch(),
    database.get<TimeEntry>('time_entries').query(Q.where('order_id', orderId), Q.sortBy('date', Q.asc)).fetch(),
    database.get<Activity>('activities').query().fetch(),
    database.get<OrderExtra>('order_extras').query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc)).fetch(),
  ])
  const aMap = new Map(aktiviteter.map(a => [a.id, a]))
  return byggFakturagrunnlag(
    materiell.map(tilMateriellInn),
    timer.map(t => tilTimeInn(t, aMap)),
    valg,
    tillegg.map(tilTilleggInn),
  )
}

/**
 * Merker linjene som fakturert og låser ordren.
 *
 * Kalles FØRST etter at regnskapssystemet har svart med en utkast-ID. Motsatt
 * rekkefølge ville låst linjene på en faktura som aldri ble opprettet, og da
 * finnes det ingen vei tilbake uten å redigere databasen for hånd.
 */
/**
 * Kastes når en ordre forsøkes fakturert uten faglig godkjenning.
 *
 * Sperren finnes ALLEREDE i databasen (trigger `krev_faglig_godkjenning`), og
 * det er den som gjelder. Men databasen ser først forsøket ved synk: uten denne
 * sjekken ville ordren blitt merket fakturert lokalt, sett riktig ut på
 * telefonen, og så stille nektet å synke. Bedre å stoppe før skrivingen.
 */
export class ManglerGodkjenning extends Error {
  constructor() {
    super('Ordren må godkjennes av faglig ansvarlig før den kan faktureres.')
    this.name = 'ManglerGodkjenning'
  }
}

export async function markerFakturert(
  order: Order,
  grunnlag: Fakturagrunnlag,
  eksternId: string | null,
): Promise<void> {
  const godkjent = await database.get<OrderApproval>('order_approvals')
    .query(Q.where('order_id', order.id), Q.where('beslutning', 'godkjent'))
    .fetchCount()
  if (godkjent === 0) throw new ManglerGodkjenning()

  const naa = new Date()
  const materiellIder = grunnlag.linjer.filter(l => l.kilde === 'materiell').flatMap(l => l.kildeIder)
  const timeIder = grunnlag.linjer.filter(l => l.kilde === 'timer').flatMap(l => l.kildeIder)
  const tilleggIder = grunnlag.linjer.filter(l => l.kilde === 'tillegg').flatMap(l => l.kildeIder)
  await database.write(async () => {
    const [materiell, timer, tillegg] = await Promise.all([
      materiellIder.length
        ? database.get<OrderMaterial>('order_materials').query(Q.where('id', Q.oneOf(materiellIder))).fetch()
        : Promise.resolve([]),
      timeIder.length
        ? database.get<TimeEntry>('time_entries').query(Q.where('id', Q.oneOf(timeIder))).fetch()
        : Promise.resolve([]),
      tilleggIder.length
        ? database.get<OrderExtra>('order_extras').query(Q.where('id', Q.oneOf(tilleggIder))).fetch()
        : Promise.resolve([]),
    ])
    await database.batch(
      ...materiell.map(m => m.prepareUpdate(x => { x.invoicedAt = naa })),
      ...timer.map(t => t.prepareUpdate(x => { x.invoicedAt = naa })),
      ...tillegg.map(x => x.prepareUpdate(y => { y.invoicedAt = naa })),
      order.prepareUpdate(o => {
        o.status = 'fakturert'
        o.invoicedAt = naa
        if (eksternId) o.invoiceExternalId = eksternId
      }),
    )
  })
  syncQuietly()
}

/**
 * Angrer SISTE fakturering. Finnes fordi et utkast kan slettes i regnskapet.
 *
 * Kun siste runde — ikke alt. En ordre kan faktureres flere ganger etter hvert
 * som det kommer på mer arbeid (linjer som alt er fakturert utelates fra neste
 * grunnlag). Tømte vi `invoiced_at` på alle linjene, ble forrige fakturas
 * linjer ufakturerte igjen og havnet på neste faktura — kunden betaler to
 * ganger for samme jobb, og ingenting i appen ville sagt fra.
 */
export async function angreFakturert(order: Order): Promise<void> {
  await database.write(async () => {
    const [materiell, timer, tillegg] = await Promise.all([
      database.get<OrderMaterial>('order_materials').query(Q.where('order_id', order.id)).fetch(),
      database.get<TimeEntry>('time_entries').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderExtra>('order_extras').query(Q.where('order_id', order.id)).fetch(),
    ])
    // Runden bestemmes på tvers av ALLE tre linjetypene: én fakturering ga dem
    // samme tidsstempel, og de skal angres sammen.
    const alle = [
      ...materiell.map(m => ({ rad: m as { invoicedAt: Date | null }, fakturertTid: m.invoicedAt?.getTime() ?? null })),
      ...timer.map(t => ({ rad: t as { invoicedAt: Date | null }, fakturertTid: t.invoicedAt?.getTime() ?? null })),
      ...tillegg.map(x => ({ rad: x as { invoicedAt: Date | null }, fakturertTid: x.invoicedAt?.getTime() ?? null })),
    ]
    const { runde, forrigeTid } = sisteFakturarunde(alle)
    const iRunden = new Set(runde.map(r => r.rad))

    await database.batch(
      ...materiell.filter(m => iRunden.has(m)).map(m => m.prepareUpdate(x => { x.invoicedAt = null })),
      ...timer.filter(t => iRunden.has(t)).map(t => t.prepareUpdate(x => { x.invoicedAt = null })),
      ...tillegg.filter(x => iRunden.has(x)).map(x => x.prepareUpdate(y => { y.invoicedAt = null })),
      order.prepareUpdate(o => {
        o.status = 'fakturaklar'
        // Finnes en tidligere runde, var ordren fakturert DA — og det skal ikke
        // viskes bort fordi den siste ble angret.
        o.invoicedAt = forrigeTid === null ? null : new Date(forrigeTid)
        o.invoiceExternalId = null
      }),
    )
  })
  syncQuietly()
}

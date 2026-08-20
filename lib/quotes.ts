import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Customer } from './db/models/customer'
import { Order } from './db/models/order'
import { OrderMaterial } from './db/models/order-material'
import { Quote, type BeslutningsMate } from './db/models/quote'
import { QuoteLine } from './db/models/quote-line'
import { syncQuietly } from './db/sync'
import { byggTilbudssum, kanRedigeres, type Tilbudssum, type TilbudslinjeArt } from './quoting'

/**
 * Tilbud mot databasen. Regnestykket ligger i `quoting.ts` og røres ikke her —
 * alt herfra leser/skriver KUN lokal SQLite (regel 2).
 */

/* ── Lesing ───────────────────────────────────────────────────────────── */

export function useTilbud(sok = ''): Quote[] {
  const [rows, setRows] = useState<Quote[]>([])
  useEffect(() => {
    const sub = database.get<Quote>('quotes')
      .query(Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['title', 'status', 'customer_name', 'valid_until', 'quote_number'])
      .subscribe(alle => {
        const q = sok.trim().toLowerCase()
        setRows(!q ? alle : alle.filter(t =>
          t.title.toLowerCase().includes(q)
          || (t.customerName ?? '').toLowerCase().includes(q)
          || String(t.quoteNumber ?? '').includes(q),
        ))
      })
    return () => sub.unsubscribe()
  }, [sok])
  return rows
}

export function useEttTilbud(id: string | null | undefined): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(null)
  useEffect(() => {
    if (!id) { setQuote(null); return }
    const sub = database.get<Quote>('quotes').findAndObserve(id).subscribe({
      next: setQuote,
      error: () => setQuote(null),
    })
    return () => sub.unsubscribe()
  }, [id])
  return quote
}

export function useTilbudslinjer(quoteId: string | null | undefined): QuoteLine[] {
  const [rows, setRows] = useState<QuoteLine[]>([])
  useEffect(() => {
    if (!quoteId) { setRows([]); return }
    const sub = database.get<QuoteLine>('quote_lines')
      .query(Q.where('quote_id', quoteId), Q.sortBy('sort_order', Q.asc))
      .observeWithColumns(['sort_order', 'description', 'quantity', 'unit_price', 'discount_percent', 'kind', 'vat_type', 'cost_price', 'unit'])
      .subscribe(setRows)
    return () => sub.unsubscribe()
  }, [quoteId])
  return rows
}

/** Tilbud + summen, i én strøm. Skjermen skal ikke måtte holde dem i takt selv. */
export function useTilbudssum(quoteId: string | null | undefined): Tilbudssum {
  const linjer = useTilbudslinjer(quoteId)
  const [sum, setSum] = useState<Tilbudssum>(() => byggTilbudssum([]))
  useEffect(() => { setSum(byggTilbudssum(linjer.map(l => l.somInn))) }, [linjer])
  return sum
}

/** Tilbudene knyttet til én kunde — vises på kundekortet. */
export function useKundensTilbud(customerId: string | null | undefined): Quote[] {
  const [rows, setRows] = useState<Quote[]>([])
  useEffect(() => {
    if (!customerId) { setRows([]); return }
    const sub = database.get<Quote>('quotes')
      .query(Q.where('customer_id', customerId), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setRows)
    return () => sub.unsubscribe()
  }, [customerId])
  return rows
}

/* ── Skriving ─────────────────────────────────────────────────────────── */

export type TilbudInput = {
  title: string
  description?: string | null
  customerId?: string | null
  projectId?: string | null
  validUntil?: Date | null
}

/** Standard gyldighet: 30 dager. Et tilbud uten frist er et tilbud uten slutt. */
export const GYLDIGHET_DAGER = 30

export function standardGyldighet(fra = new Date()): Date {
  return new Date(fra.getTime() + GYLDIGHET_DAGER * 24 * 60 * 60 * 1000)
}

export async function opprettTilbud(input: TilbudInput): Promise<string> {
  const kunde = input.customerId
    ? await database.get<Customer>('customers').find(input.customerId).catch(() => null)
    : null

  let id = ''
  await database.write(async () => {
    const q = await database.get<Quote>('quotes').create(t => {
      t.title = input.title.trim()
      t.description = input.description?.trim() || null
      t.customerId = input.customerId ?? null
      // Snapshot av kunden: tilbudet er et dokument som ble sendt, og skal
      // kunne leses uendret selv om kunderegisteret rettes etterpå.
      t.customerName = kunde?.name ?? null
      t.customerPhone = kunde?.phone ?? null
      t.address = kunde?.postalAddress ?? null
      t.projectId = input.projectId ?? null
      t.status = 'utkast'
      t.validUntil = input.validUntil ?? standardGyldighet()
      t.sentAt = null
      t.decidedAt = null
      t.orderId = null
    })
    id = q.id
  })
  syncQuietly()
  return id
}

export type TilbudPatch = Partial<{
  title: string
  description: string | null
  customerId: string | null
  validUntil: Date | null
}>

export async function oppdaterTilbud(quote: Quote, patch: TilbudPatch): Promise<void> {
  const kunde = patch.customerId
    ? await database.get<Customer>('customers').find(patch.customerId).catch(() => null)
    : null
  await database.write(async () => {
    await quote.update(t => {
      if (patch.title !== undefined) t.title = patch.title.trim()
      if (patch.description !== undefined) t.description = patch.description?.trim() || null
      if (patch.validUntil !== undefined) t.validUntil = patch.validUntil
      if (patch.customerId !== undefined) {
        t.customerId = patch.customerId
        if (kunde) {
          t.customerName = kunde.name
          t.customerPhone = kunde.phone
          t.address = kunde.postalAddress
        }
      }
    })
  })
  syncQuietly()
}

export type LinjeInput = {
  kind: TilbudslinjeArt
  description: string
  quantity?: number | null
  unit?: string | null
  unitPrice?: number | null
  costPrice?: number | null
  discountPercent?: number | null
  vatType?: string | null
  productId?: string | null
  activityId?: string | null
  elnummer?: string | null
}

export async function leggTilLinje(quoteId: string, input: LinjeInput): Promise<string> {
  const eksisterende = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', quoteId)).fetch()
  const neste = eksisterende.reduce((maks, l) => Math.max(maks, l.sortOrder), -1) + 1

  let id = ''
  await database.write(async () => {
    const l = await database.get<QuoteLine>('quote_lines').create(r => {
      r.quoteId = quoteId
      r.sortOrder = neste
      r.kind = input.kind
      r.description = input.description.trim()
      r.quantity = input.quantity ?? (input.kind === 'tekst' ? null : 1)
      r.unit = input.unit ?? (input.kind === 'arbeid' ? 't' : input.kind === 'tekst' ? null : 'stk')
      r.unitPrice = input.unitPrice ?? null
      r.costPrice = input.costPrice ?? null
      r.discountPercent = input.discountPercent ?? null
      r.vatType = input.vatType ?? null
      r.productId = input.productId ?? null
      r.activityId = input.activityId ?? null
      r.elnummer = input.elnummer ?? null
    })
    id = l.id
  })
  syncQuietly()
  return id
}

export async function oppdaterLinje(line: QuoteLine, patch: Partial<LinjeInput>): Promise<void> {
  await database.write(async () => {
    await line.update(r => {
      if (patch.description !== undefined) r.description = patch.description
      if (patch.quantity !== undefined) r.quantity = patch.quantity
      if (patch.unit !== undefined) r.unit = patch.unit
      if (patch.unitPrice !== undefined) r.unitPrice = patch.unitPrice
      if (patch.costPrice !== undefined) r.costPrice = patch.costPrice
      if (patch.discountPercent !== undefined) r.discountPercent = patch.discountPercent
      if (patch.vatType !== undefined) r.vatType = patch.vatType
      if (patch.kind !== undefined) r.kind = patch.kind
    })
  })
  syncQuietly()
}

/** Soft delete (regel #5) — markAsDeleted, aldri destroyPermanently. */
export async function slettLinje(line: QuoteLine): Promise<void> {
  await database.write(async () => { await line.markAsDeleted() })
  syncQuietly()
}

/**
 * Flytt en linje. Rekkefølgen er en del av dokumentet — «Kjøkken» skal stå over
 * kjøkkenlinjene — så den lagres, den utledes ikke.
 */
export async function flyttLinje(linjer: QuoteLine[], fra: number, til: number): Promise<void> {
  if (fra === til || fra < 0 || til < 0 || fra >= linjer.length || til >= linjer.length) return
  const rekke = [...linjer]
  const [flyttet] = rekke.splice(fra, 1)
  rekke.splice(til, 0, flyttet)
  await database.write(async () => {
    for (let i = 0; i < rekke.length; i++) {
      if (rekke[i].sortOrder === i) continue
      await rekke[i].update(r => { r.sortOrder = i })
    }
  })
  syncQuietly()
}

/* ── Livsløp ──────────────────────────────────────────────────────────── */

export async function markerSendt(quote: Quote): Promise<void> {
  if (quote.status !== 'utkast') return
  await database.write(async () => {
    await quote.update(t => {
      t.status = 'sendt'
      t.sentAt = new Date()
    })
  })
  syncQuietly()
}

/** Tilbake til utkast. Kun mulig så lenge kunden ikke har svart. */
export async function angreSendt(quote: Quote): Promise<void> {
  if (quote.status !== 'sendt') return
  await database.write(async () => {
    await quote.update(t => {
      t.status = 'utkast'
      t.sentAt = null
    })
  })
  syncQuietly()
}

export type SvarInput = {
  akseptert: boolean
  /** Hvem hos KUNDEN som svarte. */
  av?: string | null
  mate?: BeslutningsMate | null
  notat?: string | null
}

/**
 * Kundens svar.
 *
 * Ved «akseptert» opprettes ordren, og tilbudet og ordren peker på hverandre.
 * **Materiell-linjene kopieres inn som planlagt materiell** — det er det
 * montøren skal ha med seg i bilen. Arbeidslinjene kopieres IKKE: de er prisen,
 * ikke arbeidet, og timer skal registreres når de faktisk går med. Å opprette
 * åtte timer fordi noen priset åtte timer ville vært å finne opp lønn.
 *
 * Prisen fra tilbudet ligger fortsatt i tilbudet, koblet via `orders.quote_id`.
 */
export async function registrerSvar(quote: Quote, svar: SvarInput): Promise<string | null> {
  if (quote.status === 'akseptert' || quote.status === 'avslatt') return quote.orderId
  const naa = new Date()

  if (!svar.akseptert) {
    await database.write(async () => {
      await quote.update(t => {
        t.status = 'avslatt'
        t.decidedAt = naa
        t.decidedBy = svar.av?.trim() || null
        t.decisionMethod = svar.mate ?? null
        t.decisionNote = svar.notat?.trim() || null
      })
    })
    syncQuietly()
    return null
  }

  const linjer = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', quote.id), Q.sortBy('sort_order', Q.asc)).fetch()

  let orderId = ''
  await database.write(async () => {
    const order = await database.get<Order>('orders').create(o => {
      o.title = quote.title
      o.description = quote.description
      o.customerId = quote.customerId
      o.customerName = quote.customerName
      o.customerPhone = quote.customerPhone
      o.address = quote.address
      o.status = 'planlagt'
      o.quoteId = quote.id
    })
    orderId = order.id

    for (const l of linjer) {
      if (l.kind !== 'materiell') continue
      await database.get<OrderMaterial>('order_materials').create(m => {
        m.orderId = order.id
        m.description = l.description
        m.quantity = l.quantity ?? 0
        m.unit = l.unit ?? 'stk'
        m.elnummer = l.elnummer
        m.productId = l.productId
        // Prisen kunden ble lovet, ikke dagens pris.
        m.unitPrice = l.unitPrice
        m.costPrice = l.costPrice
        m.vatType = l.vatType
      })
    }

    await quote.update(t => {
      t.status = 'akseptert'
      t.decidedAt = naa
      t.decidedBy = svar.av?.trim() || null
      t.decisionMethod = svar.mate ?? null
      t.decisionNote = svar.notat?.trim() || null
      t.orderId = order.id
    })
  })
  syncQuietly()
  return orderId
}

/**
 * Nytt tilbud bygget på et gammelt. Den vanligste måten et tilbud blir til:
 * «samme som forrige gang, men på Storgata 4».
 *
 * Statusfeltene følger ALDRI med — kopien er et nytt utkast, ikke et sendt
 * dokument.
 */
export async function dupliserTilbud(quote: Quote, tittel?: string): Promise<string> {
  const linjer = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', quote.id), Q.sortBy('sort_order', Q.asc)).fetch()

  let id = ''
  await database.write(async () => {
    const ny = await database.get<Quote>('quotes').create(t => {
      t.title = tittel?.trim() || `${quote.title} (kopi)`
      t.description = quote.description
      t.customerId = quote.customerId
      t.customerName = quote.customerName
      t.customerPhone = quote.customerPhone
      t.address = quote.address
      t.projectId = quote.projectId
      t.status = 'utkast'
      t.validUntil = standardGyldighet()
    })
    id = ny.id
    for (const l of linjer) {
      await database.get<QuoteLine>('quote_lines').create(r => {
        r.quoteId = ny.id
        r.sortOrder = l.sortOrder
        r.kind = l.kind
        r.description = l.description
        r.quantity = l.quantity
        r.unit = l.unit
        r.unitPrice = l.unitPrice
        r.costPrice = l.costPrice
        r.discountPercent = l.discountPercent
        r.vatType = l.vatType
        r.productId = l.productId
        r.activityId = l.activityId
        r.elnummer = l.elnummer
      })
    }
  })
  syncQuietly()
  return id
}

/** Soft delete av hele tilbudet med linjene. */
export async function slettTilbud(quote: Quote): Promise<void> {
  const linjer = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', quote.id)).fetch()
  await database.write(async () => {
    for (const l of linjer) await l.markAsDeleted()
    await quote.markAsDeleted()
  })
  syncQuietly()
}

export { kanRedigeres }

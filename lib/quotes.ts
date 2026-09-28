import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Customer } from './db/models/customer'
import { Order } from './db/models/order'
import { OrderMaterial } from './db/models/order-material'
import { Quote, type BeslutningsMate } from './db/models/quote'
import { QuoteLine } from './db/models/quote-line'
import { QuoteSection } from './db/models/quote-section'
import { syncQuietly } from './db/sync'
import {
  byggTilbudssum, grupperTilbud, kanRedigeres,
  type TilbudsInnhold, type Tilbudssum, type TilbudslinjeArt,
} from './quoting'

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

export function useOmrader(quoteId: string | null | undefined): QuoteSection[] {
  const [rows, setRows] = useState<QuoteSection[]>([])
  useEffect(() => {
    if (!quoteId) { setRows([]); return }
    const sub = database.get<QuoteSection>('quote_sections')
      .query(Q.where('quote_id', quoteId), Q.sortBy('sort_order', Q.asc))
      .observeWithColumns(['name', 'sort_order', 'parent_id'])
      .subscribe(setRows)
    return () => sub.unsubscribe()
  }, [quoteId])
  return rows
}

/**
 * Tilbudet delt i områder, med sum per område. Skjermen skal ikke måtte holde
 * linjer og områder i takt selv — særlig ikke mens et område slettes.
 */
export function useTilbudsinnhold(quoteId: string | null | undefined): TilbudsInnhold {
  const sum = useTilbudssum(quoteId)
  const omrader = useOmrader(quoteId)
  const [innhold, setInnhold] = useState<TilbudsInnhold>(() => ({ utenOmrade: [], omrader: [] }))
  useEffect(() => {
    setInnhold(grupperTilbud(sum.linjer, omrader.map(o => o.somOmrade)))
  }, [sum, omrader])
  return innhold
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

/* ── Områder ──────────────────────────────────────────────────────────── */

/** Nytt område nederst i tilbudet. `forelderId` gir et underområde. */
export async function opprettOmrade(
  quoteId: string,
  navn: string,
  forelderId: string | null = null,
  source: string | null = 'manuell',
): Promise<string> {
  const sosken = await database.get<QuoteSection>('quote_sections')
    .query(Q.where('quote_id', quoteId)).fetch()
  const neste = sosken.reduce((maks, o) => Math.max(maks, o.sortOrder), -1) + 1

  let id = ''
  await database.write(async () => {
    const o = await database.get<QuoteSection>('quote_sections').create(r => {
      r.quoteId = quoteId
      r.parentId = forelderId
      r.name = navn.trim()
      r.sortOrder = neste
      r.source = source
    })
    id = o.id
  })
  syncQuietly()
  return id
}

export async function giOmradeNyttNavn(omrade: QuoteSection, navn: string): Promise<void> {
  await database.write(async () => { await omrade.update(r => { r.name = navn.trim() }) })
  syncQuietly()
}

/**
 * Sletter et område. Linjene blir IKKE med: de legges tilbake i tilbudet først,
 * i samme write. Et trykk som fjerner en overskrift skal aldri kunne fjerne
 * penger fra summen — og gjør det i to skritt, overlever halvveien en krasj.
 */
export async function slettOmrade(omrade: QuoteSection): Promise<void> {
  const linjer = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('section_id', omrade.id)).fetch()
  const under = await database.get<QuoteSection>('quote_sections')
    .query(Q.where('parent_id', omrade.id)).fetch()

  await database.write(async () => {
    for (const l of linjer) await l.update(r => { r.sectionId = null })
    // Underområdene rykker opp ett nivå i stedet for å bli foreldreløse.
    for (const o of under) await o.update(r => { r.parentId = omrade.parentId })
    await omrade.markAsDeleted()
  })
  syncQuietly()
}

/** Flytter en linje til et annet område (null = rett i tilbudet). */
export async function flyttLinjeTilOmrade(line: QuoteLine, omradeId: string | null): Promise<void> {
  if ((line.sectionId ?? null) === omradeId) return
  await database.write(async () => { await line.update(r => { r.sectionId = omradeId }) })
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
  sectionId?: string | null
  /** Tilvalg: kunden velger. Nytt tilvalg er AV til noen velger det. */
  isOptional?: boolean
  isSelected?: boolean
  priceLocked?: boolean
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
      r.sectionId = input.sectionId ?? null
      r.isOptional = input.isOptional ?? false
      r.isSelected = input.isSelected ?? false
      r.priceLocked = input.priceLocked ?? false
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
      if (patch.sectionId !== undefined) r.sectionId = patch.sectionId
      if (patch.isOptional !== undefined) r.isOptional = patch.isOptional
      if (patch.isSelected !== undefined) r.isSelected = patch.isSelected
      if (patch.priceLocked !== undefined) r.priceLocked = patch.priceLocked
    })
  })
  syncQuietly()
}

/**
 * Kunden velger et tilvalg av eller på — sammen med montøren, på stedet.
 *
 * Lov også etter at tilbudet er SENDT: det er da kunden ser det og velger
 * (Jobber-mønsteret). Ikke etter at det er besvart — da er valget tatt.
 */
export async function velgTilvalg(line: QuoteLine, quote: Quote, valgt: boolean): Promise<void> {
  if (!line.isOptional) return
  if (quote.status === 'akseptert' || quote.status === 'avslatt') return
  await database.write(async () => {
    await line.update(r => { r.isSelected = valgt })
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

/**
 * Bytter plass på to naboer INNENFOR samme gruppe (samme område, eller de løse
 * linjene). Bytter bare de to radenes sort_order, så en pil i «Stue» aldri
 * flytter noe i «Kjøkken».
 *
 * To linjer med samme sort_order er et nullbytte — det kan bare oppstå i en
 * base som er reparert for hånd, og et nullbytte er et bedre svar enn en
 * rekkefølge som hopper.
 */
export async function byttPlassIGruppe(gruppe: QuoteLine[], fra: number, til: number): Promise<void> {
  if (fra === til || fra < 0 || til < 0 || fra >= gruppe.length || til >= gruppe.length) return
  const a = gruppe[fra]
  const b = gruppe[til]
  const aOrder = a.sortOrder
  const bOrder = b.sortOrder
  if (aOrder === bOrder) return
  await database.write(async () => {
    await a.update(r => { r.sortOrder = bOrder })
    await b.update(r => { r.sortOrder = aOrder })
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
      // Et fravalgt tilvalg er noe kunden sa NEI til. Det skal ikke bli
      // planlagt materiell i bilen — det er nøyaktig det Jobber gjør ved
      // konvertering: fravalgte linjer forsvinner.
      if (l.isOptional && !l.isSelected) continue
      await database.get<OrderMaterial>('order_materials').create(m => {
        m.orderId = order.id
        m.description = l.description
        m.quantity = l.quantity ?? 0
        m.unit = l.unit ?? 'stk'
        m.elnummer = l.elnummer
        m.productId = l.productId
        // Prisen kunden ble lovet, ikke dagens pris — OG rabatten hun ble
        // lovet. Uten rabatten ble ordren fakturert til full pris, og kunden
        // fikk regning på noe annet enn det hun sa ja til.
        m.unitPrice = l.unitPrice
        m.discountPercent = l.discountPercent
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
  const omrader = await database.get<QuoteSection>('quote_sections')
    .query(Q.where('quote_id', quote.id), Q.sortBy('sort_order', Q.asc)).fetch()
  // Kopien får EGNE områder. Peker kopien på originalens områder, slår en
  // omdøping i det ene tilbudet gjennom i det andre.
  const nyeIder = new Map<string, string>()

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
    for (const o of omrader) {
      const kopi = await database.get<QuoteSection>('quote_sections').create(r => {
        r.quoteId = ny.id
        r.parentId = null // settes under, når alle nye id-er finnes
        r.name = o.name
        r.sortOrder = o.sortOrder
        r.source = o.source
      })
      nyeIder.set(o.id, kopi.id)
    }
    for (const o of omrader) {
      if (!o.parentId) continue
      const forelder = nyeIder.get(o.parentId)
      const kopiId = nyeIder.get(o.id)
      if (!forelder || !kopiId) continue
      const kopi = await database.get<QuoteSection>('quote_sections').find(kopiId)
      await kopi.update(r => { r.parentId = forelder })
    }
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
        r.sectionId = l.sectionId ? nyeIder.get(l.sectionId) ?? null : null
        r.isOptional = l.isOptional
        r.isSelected = l.isSelected
        r.priceLocked = l.priceLocked
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

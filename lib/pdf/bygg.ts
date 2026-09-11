/**
 * Broen fra databasen til dokumentet — det ET UI faktisk kaller.
 *
 * Alt her er funksjoner uten skjerm: `lagSkjemaPdf(dokumentId)` gir deg en
 * ferdig PDF på disk, `delSkjemaPdf(...)` åpner delingsarket. Hvordan knappen
 * ser ut, hvor den står og hva den heter er UI-ets sak.
 *
 * Lagdelingen er med vilje: gjengivelsen (`./skjema`, `./tilbud`, `./faktura`)
 * er ren og selvtestet, dette laget henter data, og `./skriv` snakker med
 * operativsystemet.
 */
import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Order } from '../db/models/order'
import { OrderDocument } from '../db/models/order-document'
import { OrderSignature, formalLabel } from '../db/models/order-signature'
import { Quote } from '../db/models/quote'
import { QuoteLine } from '../db/models/quote-line'
import { Customer } from '../db/models/customer'
import { resolveTemplateAt } from '../forms/resolve'
import { visibleSections } from '../forms/visibility'
import { findUnfilledRequired } from '../forms/gap-check'
import type { FormValues } from '../forms/types'
import { byggTilbudssum } from '../quoting'
import { hentFakturagrunnlag } from '../order-billing'
import { mvaLabel } from '../invoicing'
import { hentAvsender } from '../firma'
import { dokumentHtml, datoNo, type Mottaker } from './dokument'
import { skjemaInnholdHtml, type SkjemaSeksjon, type SkjemaSignatur } from './skjema'
import { tilbudInnholdHtml } from './tilbud'
import { fakturaInnholdHtml } from './faktura'
import { skrivPdf, delPdf } from './skriv'

/** Kunden som mottaker. Ordren bærer navnet selv om kunderaden mangler. */
async function mottakerFor(order: Order): Promise<Mottaker> {
  if (order.customerId) {
    const kunde = await database.get<Customer>('customers').find(order.customerId).catch(() => null)
    if (kunde) {
      const adresse = [kunde.address, [kunde.postalCode, kunde.city].filter(Boolean).join(' ')]
        .filter(Boolean).join(', ')
      return { navn: kunde.name, adresse: adresse || order.address }
    }
  }
  return { navn: order.customerName, adresse: order.address }
}

async function signaturerFor(orderId: string): Promise<SkjemaSignatur[]> {
  const rader = await database
    .get<OrderSignature>('order_signatures')
    .query(Q.where('order_id', orderId), Q.sortBy('signed_at', Q.asc))
    .fetch()
  return rader.map(s => ({
    navn: s.signerName,
    tittel: s.signerTitle,
    formal: formalLabel[s.purpose] ?? s.purpose,
    signertTid: s.signedAt ? datoNo(s.signedAt.toISOString()) : null,
    strok: s.punkter,
    aspekt: s.aspect,
  }))
}

/* ── Skjema / sluttkontroll ───────────────────────────────────────────────── */

/**
 * Bygger HTML-en for et utfylt skjema. Skilt fra PDF-skrivingen så et UI kan
 * forhåndsvise dokumentet i en WebView uten å lage en fil.
 */
export async function byggSkjemaHtml(dokumentId: string): Promise<{ html: string; filnavn: string }> {
  const doc = await database.get<OrderDocument>('order_documents').find(dokumentId)
  const order = await database.get<Order>('orders').find(doc.orderId)
  const truffet = await resolveTemplateAt(doc.templateId, doc.templateVersion)
  if (!truffet) throw new Error('Fant ikke skjemamalen dokumentet ble fylt ut mot')
  const mal = truffet.template

  const verdier = (JSON.parse(doc.data || '{}') as FormValues) ?? {}

  // Kun synlige punkter skrives ut: svar på skjulte felt er allerede fjernet
  // ved lagring (pruneHidden), og spørsmålet hører da heller ikke hjemme.
  const seksjoner: SkjemaSeksjon[] = visibleSections(mal, verdier).map(s => ({
    tittel: s.title,
    punkter: s.fields
      .filter(f => f.type !== 'info')
      .map(f => ({
        nokkel: f.key,
        sporsmal: f.label,
        type: f.type,
        enhet: f.unit ?? null,
        alternativer: f.choices ?? null,
        hjelp: f.help ?? null,
        kolonner: f.columns ?? null,
        svar: verdier[f.key],
      })),
  }))

  // Et utkast skal SI at det er et utkast — ellers ser en halvferdig kontroll
  // ut som en ferdig en når den først er blitt en PDF.
  const mangler = doc.status === 'fullfort'
    ? []
    : findUnfilledRequired(mal, verdier).map(f => f.label)

  const [avsender, mottaker, signaturer] = await Promise.all([
    hentAvsender(),
    mottakerFor(order),
    signaturerFor(order.id),
  ])

  const html = dokumentHtml({
    meta: {
      type: doc.status === 'fullfort' ? mal.name : `${mal.name} (utkast)`,
      nummer: order.orderNumber != null ? String(order.orderNumber) : null,
      tittel: mal.name,
      dato: (doc.completedAt ?? doc.updatedAt ?? new Date()).toISOString(),
    },
    avsender,
    mottaker,
    metalinjer: [
      order.title,
      order.address ? `Anlegg: ${order.address}` : '',
      `Skjemaversjon ${truffet.version}`,
    ].filter(Boolean) as string[],
    innhold: skjemaInnholdHtml({ seksjoner, signaturer, mangler }),
  })

  return { html, filnavn: `${mal.name} ${order.orderNumber ?? ''}`.trim() }
}

export async function lagSkjemaPdf(dokumentId: string): Promise<string> {
  const { html, filnavn } = await byggSkjemaHtml(dokumentId)
  return skrivPdf(html, filnavn)
}

export async function delSkjemaPdf(dokumentId: string): Promise<void> {
  const { html, filnavn } = await byggSkjemaHtml(dokumentId)
  await delPdf(html, filnavn)
}

/* ── Tilbud ───────────────────────────────────────────────────────────────── */

export async function byggTilbudHtml(tilbudId: string): Promise<{ html: string; filnavn: string }> {
  const tilbud = await database.get<Quote>('quotes').find(tilbudId)
  const linjer = await database
    .get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', tilbudId), Q.sortBy('sort_order', Q.asc))
    .fetch()

  const sum = byggTilbudssum(linjer.map(l => l.somInn))
  const avsender = await hentAvsender()

  const html = dokumentHtml({
    meta: {
      type: 'Tilbud',
      nummer: tilbud.quoteNumber != null ? String(tilbud.quoteNumber) : null,
      tittel: tilbud.title,
      dato: (tilbud.sentAt ?? tilbud.createdAt ?? new Date()).toISOString(),
    },
    avsender,
    mottaker: { navn: tilbud.customerName, adresse: tilbud.address },
    innhold: tilbudInnholdHtml({
      // Kundens dokument: kostpris og dekningsbidrag følger IKKE med.
      linjer: sum.linjer.map(l => ({
        art: l.art,
        beskrivelse: l.beskrivelse,
        antall: l.antall,
        enhet: l.enhet,
        enhetsprisOre: l.enhetsprisOre,
        rabattProsent: l.rabattProsent,
        nettoOre: l.nettoOre,
        elnummer: l.elnummer ?? null,
      })),
      sum: {
        nettoOre: sum.nettoOre,
        rabattOre: sum.rabattOre,
        bruttoOre: sum.bruttoOre,
        mvaFordeling: sum.mvaFordeling.map(m => ({ mva: m.mva, nettoOre: m.nettoOre, mvaOre: m.mvaOre })),
      },
      mvaEtikett: (m: string) => mvaLabel[m as keyof typeof mvaLabel] ?? m,
      gyldigTil: tilbud.validUntil ? tilbud.validUntil.toISOString() : null,
      beskrivelse: tilbud.description,
    }),
  })

  return { html, filnavn: `Tilbud ${tilbud.quoteNumber ?? ''}`.trim() }
}

export async function lagTilbudPdf(tilbudId: string): Promise<string> {
  const { html, filnavn } = await byggTilbudHtml(tilbudId)
  return skrivPdf(html, filnavn)
}

export async function delTilbudPdf(tilbudId: string): Promise<void> {
  const { html, filnavn } = await byggTilbudHtml(tilbudId)
  await delPdf(html, filnavn)
}

/* ── Fakturagrunnlag ──────────────────────────────────────────────────────── */

const UTELATT_GRUNN: Record<string, string> = {
  ikke_fakturerbar: 'Ikke fakturerbar',
  mangler_pris: 'Mangler pris',
  allerede_fakturert: 'Allerede fakturert',
  ikke_godkjent: 'Ikke godkjent',
  avvist: 'Avvist',
}

export async function byggFakturaHtml(orderId: string): Promise<{ html: string; filnavn: string }> {
  const order = await database.get<Order>('orders').find(orderId)
  const grunnlag = await hentFakturagrunnlag(orderId)
  const [avsender, mottaker] = await Promise.all([hentAvsender(), mottakerFor(order)])

  const html = dokumentHtml({
    meta: {
      type: 'Fakturagrunnlag',
      nummer: order.orderNumber != null ? String(order.orderNumber) : null,
      tittel: order.title,
      dato: new Date(order.updatedAt ?? Date.now()).toISOString(),
    },
    avsender,
    mottaker,
    metalinjer: order.address ? [`Anlegg: ${order.address}`] : [],
    innhold: fakturaInnholdHtml({
      linjer: grunnlag.linjer.map(l => ({
        kilde: l.kilde,
        beskrivelse: l.beskrivelse,
        antall: l.antall,
        enhet: l.enhet,
        enhetsprisOre: l.enhetsprisOre,
        rabattProsent: l.rabattProsent ?? undefined,
        mva: l.mva,
        nettoOre: l.nettoOre,
        elnummer: l.elnummer ?? null,
      })),
      sum: {
        nettoOre: grunnlag.nettoOre,
        bruttoOre: grunnlag.bruttoOre,
        mvaFordeling: grunnlag.mvaFordeling.map(m => ({ mva: m.mva, nettoOre: m.nettoOre, mvaOre: m.mvaOre })),
      },
      mvaEtikett: (m: string) => mvaLabel[m as keyof typeof mvaLabel] ?? m,
      // Bare det kunden har nytte av å vite: arbeid vi IKKE tar betalt for.
      // «Mangler pris» og «ikke godkjent» er interne problemer, ikke kundens.
      ikkeFakturert: grunnlag.utelatt
        .filter(u => u.grunn === 'ikke_fakturerbar')
        .map(u => ({ beskrivelse: u.beskrivelse, grunn: UTELATT_GRUNN[u.grunn] ?? u.grunn })),
    }),
  })

  return { html, filnavn: `Fakturagrunnlag ${order.orderNumber ?? ''}`.trim() }
}

export async function lagFakturaPdf(orderId: string): Promise<string> {
  const { html, filnavn } = await byggFakturaHtml(orderId)
  return skrivPdf(html, filnavn)
}

export async function delFakturaPdf(orderId: string): Promise<void> {
  const { html, filnavn } = await byggFakturaHtml(orderId)
  await delPdf(html, filnavn)
}

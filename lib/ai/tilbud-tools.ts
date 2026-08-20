import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Customer } from '../db/models/customer'
import { Quote } from '../db/models/quote'
import { QuoteLine } from '../db/models/quote-line'
import { finnAktivitet } from '../activities'
import { finnVare } from '../products'
import { leggTilLinje, opprettTilbud, standardGyldighet } from '../quotes'
import { byggTilbudssum, kanRedigeres, tilbudStatusLabel, type TilbudslinjeArt } from '../quoting'
import { formatKr } from '../invoicing'
import { formatDate } from '../format'

/**
 * Tilbud for stemmeassistenten.
 *
 * **Hvorfor akkurat dette hører hjemme i stemmen:** et tilbud blir til på vei
 * hjem fra befaring. Du har akkurat sett rommet, du husker at det skal tolv
 * downlights og åtte timer, og om en time husker du det halvveis. Å kunne
 * diktere det mens du kjører er forskjellen på et tilbud som blir sendt og et
 * som blir liggende.
 *
 * **Assistenten sender ALDRI.** Å sende et tilbud er en handling ut av huset
 * mot en kunde, med et bindende beløp. Den forbereder alt; mennesket trykker.
 * Samme prinsipp som at den ikke kan fullføre et skjema eller godkjenne et
 * tilleggsarbeid.
 */

async function finnTilbud(nummer: unknown): Promise<Quote | { feil: string }> {
  const n = typeof nummer === 'number' ? nummer : NaN
  if (!Number.isInteger(n)) return { feil: 'Tilbudsnummer mangler eller er ikke et tall.' }
  const [q] = await database.get<Quote>('quotes').query(Q.where('quote_number', n)).fetch()
  if (!q) return { feil: `Fant ingen tilbud med nummer ${n}.` }
  return q
}

async function finnKunde(navn: string): Promise<Customer | null> {
  const q = navn.trim().toLowerCase()
  if (!q) return null
  const alle = await database.get<Customer>('customers').query().fetch()
  return alle.find(k => k.name.toLowerCase() === q)
    ?? alle.find(k => k.name.toLowerCase().includes(q))
    ?? null
}

export async function nyttTilbudVerktoy(args: {
  tittel?: string; kunde?: string; gyldig_dager?: number
}): Promise<Record<string, unknown>> {
  const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
  if (!tittel) return { feil: 'Hva gjelder tilbudet?' }

  const kunde = typeof args.kunde === 'string' ? await finnKunde(args.kunde) : null
  const dager = typeof args.gyldig_dager === 'number' && args.gyldig_dager > 0 ? args.gyldig_dager : null

  const id = await opprettTilbud({
    title: tittel,
    customerId: kunde?.id ?? null,
    validUntil: dager ? new Date(Date.now() + dager * 24 * 60 * 60 * 1000) : standardGyldighet(),
  })
  // Nummeret settes av en server-trigger ved synk. Lokalt er det null til da,
  // så assistenten må kunne omtale tilbudet uten det.
  const q = await database.get<Quote>('quotes').find(id)

  return {
    ok: true,
    tilbuds_id: id,
    tilbudsnummer: q.quoteNumber ?? undefined,
    kunde: kunde?.name ?? undefined,
    gyldig_til: formatDate(q.validUntil) ?? undefined,
    beskjed: kunde
      ? `Opprettet tilbud til ${kunde.name}. Legg til linjer nå.`
      : args.kunde
        ? `Opprettet tilbudet, men fant ingen kunde som heter «${args.kunde}» — si det, og at kunden må settes i appen før det kan sendes.`
        : 'Opprettet tilbudet. Uten kunde kan det ikke sendes — nevn det.',
  }
}

/**
 * Én linje på tilbudet.
 *
 * Nevner brukeren en vare vi har i kartoteket, hentes pris og enhet derfra —
 * det er hele poenget: «tolv downlights» skal bli et beløp, ikke en tekst.
 * Nevner han en aktivitet, hentes timeprisen. Ellers står linja uten pris, og
 * det sies fra om.
 */
export async function tilbudslinjeVerktoy(args: {
  tilbudsnummer?: number; art?: string; beskrivelse?: string; antall?: number; pris?: number; rabatt?: number
}): Promise<Record<string, unknown>> {
  const q = await finnTilbud(args.tilbudsnummer)
  if ('feil' in q) return q
  if (!kanRedigeres(q.status)) {
    return { feil: `Tilbudet er ${tilbudStatusLabel[q.visStatus].toLowerCase()} og kan ikke endres. Bare utkast kan redigeres.` }
  }

  const beskrivelse = typeof args.beskrivelse === 'string' ? args.beskrivelse.trim() : ''
  if (!beskrivelse) return { feil: 'Hva skal linja hete?' }
  const art: TilbudslinjeArt =
    args.art === 'arbeid' ? 'arbeid' : args.art === 'tekst' ? 'tekst' : 'materiell'

  if (art === 'tekst') {
    await leggTilLinje(q.id, { kind: 'tekst', description: beskrivelse })
    return { ok: true, beskjed: `La inn teksten «${beskrivelse}».` }
  }

  const antall = typeof args.antall === 'number' && args.antall > 0 ? args.antall : 1
  const oppgittPris = typeof args.pris === 'number' && args.pris >= 0 ? args.pris : null
  const rabatt = typeof args.rabatt === 'number' ? args.rabatt : null

  if (art === 'arbeid') {
    const aktivitet = await finnAktivitet(beskrivelse) ?? await finnAktivitet('Montasje')
    const pris = oppgittPris ?? aktivitet?.hourlyRate ?? null
    await leggTilLinje(q.id, {
      kind: 'arbeid',
      description: aktivitet?.name ?? beskrivelse,
      quantity: antall,
      unit: 't',
      unitPrice: pris,
      discountPercent: rabatt,
      vatType: aktivitet?.vatType ?? null,
      activityId: aktivitet?.id ?? null,
    })
    return {
      ok: true,
      beskjed: `La inn ${antall} timer ${(aktivitet?.name ?? beskrivelse).toLowerCase()}${pris != null ? ` à ${formatKr(Math.round(pris * 100))}` : ''}.`,
      ...(pris == null ? { advarsel: 'Ingen timepris funnet — linja teller null til noen setter en.' } : {}),
    }
  }

  // Materiell: slå opp i kartoteket, så «tolv downlights» blir et beløp.
  const treff = oppgittPris === null ? await finnVare(beskrivelse) : null
  const p = treff?.product
  const pris = oppgittPris ?? p?.unitPrice ?? null
  await leggTilLinje(q.id, {
    kind: 'materiell',
    description: p?.name ?? beskrivelse,
    quantity: antall,
    unit: p?.unit ?? 'stk',
    unitPrice: pris,
    costPrice: p?.costPrice ?? null,
    discountPercent: rabatt,
    vatType: p?.vatType ?? null,
    productId: p?.id ?? null,
    elnummer: p?.elnummer ?? null,
  })

  return {
    ok: true,
    beskjed: `La inn ${antall} ${p?.unit ?? 'stk'} ${p?.name ?? beskrivelse}${pris != null ? ` à ${formatKr(Math.round(pris * 100))}` : ''}.`,
    ...(p ? {} : { merknad: 'Varen finnes ikke i kartoteket — linja er ren tekst med det du oppga.' }),
    ...(pris == null ? { advarsel: 'Ingen pris — linja teller null til noen setter en.' } : {}),
    // Er kostprisen bare en listepris, er dekningsbidraget under for høyt.
    ...(treff?.pris.kunListepriser ? { advarsel_pris: 'Kostprisen er grossistens listepris, ikke firmaets — dekningsbidraget blir for lavt.' } : {}),
  }
}

/**
 * Summen, lest opp.
 *
 * Dekningsbidraget er med fordi dette er det ENESTE tidspunktet tallet kan
 * endre noe. Etter at prisen er sendt er det bare en rapport.
 */
export async function tilbudssumVerktoy(nummer: unknown): Promise<Record<string, unknown>> {
  const q = await finnTilbud(nummer)
  if ('feil' in q) return q
  const linjer = await database.get<QuoteLine>('quote_lines')
    .query(Q.where('quote_id', q.id), Q.sortBy('sort_order', Q.asc)).fetch()
  const sum = byggTilbudssum(linjer.map(l => l.somInn))

  return {
    tittel: q.title,
    kunde: q.customerName ?? undefined,
    status: tilbudStatusLabel[q.visStatus],
    antall_linjer: sum.linjer.filter(l => l.art !== 'tekst').length,
    sum_eks_mva: formatKr(sum.nettoOre),
    total_inkl_mva: formatKr(sum.bruttoOre),
    ...(sum.dbOre !== null
      ? {
          dekningsbidrag: `${formatKr(sum.dbOre)}${sum.dbProsent !== null ? ` (${String(sum.dbProsent).replace('.', ',')} %)` : ''}`,
          dekningsbidrag_negativt: sum.dbOre < 0 || undefined,
        }
      : {}),
    beskjed: q.customerId
      ? 'Tilbudet kan sendes fra appen. Du kan ikke sende det selv.'
      : 'Tilbudet mangler kunde og kan ikke sendes før den er satt i appen.',
  }
}

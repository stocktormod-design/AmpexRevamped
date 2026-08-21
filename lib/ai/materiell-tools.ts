import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Location } from '../db/models/location'
import { OrderMaterial } from '../db/models/order-material'
import { StockMovement } from '../db/models/stock-movement'
import { syncQuietly } from '../db/sync'
import { finnVare, finnVarer, formatBeholdning } from '../products'
import { formatKr, tilOre } from '../invoicing'

/**
 * Materiell og varesøk for stemmeassistenten.
 *
 * **Hvorfor dette er det viktigste verktøyet i hele assistenten:** simPRO
 * lanserte JobScribe 13. mai 2026 — tale → jobbdokumentasjon. Stemme til TEKST
 * er altså tatt. Det ingen har er stemme til **transaksjon**: at uttaket
 * faktisk skriver `stock_movements`, at materiellet faktisk havner på ordren.
 * Se `docs/KONKURRENTANALYSE.md` punkt 5.
 *
 * Alt kjører lokalt mot WatermelonDB, som resten av verktøyene — ingenting
 * annet enn lyd forlater telefonen.
 */

/** Kort, opplesbar beskrivelse av en vare. Skal kunne sies høyt uten å bli en tabell. */
function varelinje(t: Awaited<ReturnType<typeof finnVare>>): Record<string, unknown> {
  if (!t) return {}
  const p = t.product
  return {
    navn: p.name,
    elnummer: p.elnummer ?? undefined,
    produsent: p.fabrikat ?? undefined,
    enhet: p.unit,
    paa_lager: t.beholdning !== null ? formatBeholdning(t.beholdning, p.unit) : 'ikke talt',
    ...(t.billigste
      ? {
          billigste_pris: formatKr(tilOre(t.billigste.nettoPris)),
          billigste_grossist: t.billigste.grossist,
          // Skillet må være hørbart: en listepris er ikke firmaets pris.
          er_listepris: t.pris.kunListepriser || undefined,
        }
      : {}),
    ...(t.besparelse !== null && t.besparelse > 0 && t.billigste
      ? { du_sparer: `${formatKr(tilOre(t.besparelse))} per ${p.unit} hos ${t.billigste.grossist}` }
      : {}),
  }
}

export async function sokVareVerktoy(sok: string): Promise<Record<string, unknown>> {
  const q = sok.trim()
  if (!q) return { feil: 'Ingen søketekst.' }
  const treff = await finnVarer(q, 5)
  if (treff.length === 0) {
    return {
      funnet: false,
      beskjed: 'Ingen treff i varekartoteket. Si det ærlig — og nevn at kartoteket fylles av en prisfil fra grossisten.',
    }
  }
  return { funnet: true, antall: treff.length, varer: treff.map(varelinje) }
}

/**
 * Lokasjonen uttaket skal gå fra.
 *
 * Rekkefølgen speiler hvor montøren faktisk står: sin egen bil først, så en
 * navngitt lokasjon, så det eneste lageret hvis det bare finnes ett. Er det
 * flere og ingen er nevnt, SKAL vi spørre — å gjette hvilket lager noe ble
 * tatt fra gjør beholdningen på begge feil.
 */
async function finnLokasjon(navn: string | undefined, userId: string): Promise<Location | { feil: string }> {
  const alle = await database.get<Location>('locations').query().fetch()
  if (alle.length === 0) return { feil: 'Firmaet har ingen lagre eller biler registrert ennå.' }

  if (navn?.trim()) {
    const q = navn.trim().toLowerCase()
    const treff = alle.find(l => l.name.toLowerCase() === q)
      ?? alle.find(l => l.name.toLowerCase().includes(q))
      ?? alle.find(l => (l.regNr ?? '').toLowerCase().replace(/\s/g, '') === q.replace(/\s/g, ''))
    if (treff) return treff
    return { feil: `Fant ingen lokasjon som heter «${navn}». Finnes: ${alle.map(l => l.name).join(', ')}.` }
  }

  const minBil = alle.find(l => l.type === 'bil' && l.assignedTo === userId)
  if (minBil) return minBil
  const lagre = alle.filter(l => l.type === 'lager')
  if (lagre.length === 1) return lagre[0]
  return { feil: `Hvor ble det tatt fra? Velg mellom: ${alle.map(l => l.name).join(', ')}.` }
}

/**
 * Uttak fra lager eller bil.
 *
 * Uttaket lander i kurven (`order_id = null`), ikke rett på en ordre — se
 * `lib/cart.ts`. Det er med vilje: montøren tar ofte ut fem ting i bilen og
 * plasserer dem på ordren når han vet hvilken. Skal det rett på en ordre,
 * finnes `legg_til_materiell`.
 */
export async function taUtMateriellVerktoy(
  args: { vare?: string; antall?: number; lokasjon?: string },
  userId: string,
): Promise<Record<string, unknown>> {
  const sok = typeof args.vare === 'string' ? args.vare.trim() : ''
  if (!sok) return { feil: 'Hvilken vare?' }
  const antall = typeof args.antall === 'number' ? args.antall : NaN
  if (!Number.isFinite(antall) || antall <= 0) return { feil: 'Antall må være et positivt tall.' }

  const treff = await finnVare(sok)
  if (!treff) return { feil: `Fant ingen vare som matcher «${sok}».`, funnet: false }

  const lok = await finnLokasjon(args.lokasjon, userId)
  if ('feil' in lok) return lok

  await database.write(async () => {
    await database.get<StockMovement>('stock_movements').create(m => {
      m.productId = treff.product.id
      m.locationId = lok.id
      // Negativt: ut fra lageret. Kurven viser tallet positivt (lib/cart.ts).
      m.quantity = -antall
      m.kind = 'ut'
      m.orderId = null
      m.note = 'Tatt ut med stemme'
    })
  })
  syncQuietly()

  const igjen = (treff.beholdning ?? 0) - antall
  return {
    ok: true,
    beskjed: `Tok ut ${antall} ${treff.product.unit} ${treff.product.name} fra ${lok.name}. Ligger i kurven til den plasseres på en ordre.`,
    ...(treff.beholdning !== null && igjen < 0
      ? { advarsel: `Det gir negativ beholdning (${igjen}). Nevn det — enten er noe ikke registrert, eller så er tallet feil.` }
      : {}),
  }
}

/**
 * Materiell rett på en ordre.
 *
 * Prisen er et SNAPSHOT fra varekartoteket, som når det legges til i appen —
 * en gammel ordre skal ikke endre beløp fordi varen prises om senere.
 */
export async function leggTilMateriellVerktoy(
  args: { vare?: string; antall?: number },
  orderId: string,
  ordrenummer: number,
): Promise<Record<string, unknown>> {
  const sok = typeof args.vare === 'string' ? args.vare.trim() : ''
  if (!sok) return { feil: 'Hvilken vare?' }
  const antall = typeof args.antall === 'number' ? args.antall : NaN
  if (!Number.isFinite(antall) || antall <= 0) return { feil: 'Antall må være et positivt tall.' }

  const treff = await finnVare(sok)
  if (!treff) return { feil: `Fant ingen vare som matcher «${sok}».`, funnet: false }
  const p = treff.product

  await database.write(async () => {
    await database.get<OrderMaterial>('order_materials').create(m => {
      m.orderId = orderId
      m.description = p.name
      m.quantity = antall
      m.unit = p.unit
      m.elnummer = p.elnummer
      m.productId = p.id
      m.unitPrice = p.unitPrice
      m.costPrice = p.costPrice
      // Samme fallback som kurven (lib/cart.ts). Uten den kunne stemmeveien
      // lage en linje uten mva-type der knappeveien ikke kan.
      m.vatType = p.vatType ?? 'hoy'
    })
  })
  syncQuietly()

  return {
    ok: true,
    beskjed: `La ${antall} ${p.unit} ${p.name} på ordre ${ordrenummer}.`,
    ...(p.unitPrice == null
      ? { advarsel: 'Varen har ingen pris — linja faller ut av fakturagrunnlaget til noen setter en.' }
      : {}),
  }
}

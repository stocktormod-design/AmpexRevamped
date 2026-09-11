/**
 * Serviceavtaler — databasesiden. Regnestykket ligger i `lib/service-calc.ts`
 * (rent og selvtestet); dette laget lagrer og henter.
 *
 * FUNKSJON UTEN SKJERM. Et UI trenger:
 *
 *   opprettAvtale(...)                 ny avtale
 *   useForfallende()                   det som må planlegges nå
 *   opprettOrdreFraAvtale(avtale)      lager ordren for neste kontroll
 *   registrerUtfort(avtale, ordre)     flytter avtalen ett intervall fram
 *
 * Den viktigste linja er `opprettOrdreFraAvtale`: den gjør en avtale om til
 * ekte arbeid med riktig kunde, adresse og skjema — det er hele grunnen til
 * at avtalen finnes i systemet og ikke i et regneark.
 */
import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { ServiceAgreement } from './db/models/service-agreement'
import { Order } from './db/models/order'
import { Customer } from './db/models/customer'
import {
  forsteForfall, nesteForfallEtterUtforelse, forfallsstatus, dagerTilForfall,
  tilDagStart, type Forfallsstatus,
} from './service-calc'

export type { Forfallsstatus }
export { INTERVALLER, intervallNavn, kommendeForfall } from './service-calc'

export type AvtaleInn = {
  tittel: string
  kundeId?: string | null
  adresse?: string | null
  beskrivelse?: string | null
  intervallManeder?: number
  /** Startdato for avtalen. Neste forfall regnes fra denne. */
  start?: Date
  /** Skal første kontroll skje med en gang? */
  kontrollVedStart?: boolean
  varselDager?: number
  /** Malen kontrollen dokumenteres med — årskontrollen kommer med riktig skjema. */
  skjemaMalId?: string | null
  estimertTimer?: number | null
}

export async function opprettAvtale(inn: AvtaleInn): Promise<ServiceAgreement> {
  const intervall = { maneder: inn.intervallManeder ?? 12 }
  const start = inn.start ?? new Date()
  return database.write(async () =>
    database.get<ServiceAgreement>('service_agreements').create(a => {
      a.tittel = inn.tittel.trim()
      a.customerId = inn.kundeId ?? null
      a.adresse = inn.adresse?.trim() || null
      a.beskrivelse = inn.beskrivelse?.trim() || null
      a.intervallManeder = intervall.maneder
      a.nesteForfall = forsteForfall(start, intervall, inn.kontrollVedStart ?? false)
      a.varselDager = inn.varselDager ?? 30
      a.skjemaMalId = inn.skjemaMalId ?? null
      a.estimertTimer = inn.estimertTimer ?? null
      a.aktiv = true
    }),
  )
}

export async function oppdaterAvtale(avtale: ServiceAgreement, endring: Partial<AvtaleInn> & { nesteForfall?: Date; aktiv?: boolean }): Promise<void> {
  await database.write(async () =>
    avtale.update(a => {
      if (endring.tittel !== undefined) a.tittel = endring.tittel.trim()
      if (endring.kundeId !== undefined) a.customerId = endring.kundeId ?? null
      if (endring.adresse !== undefined) a.adresse = endring.adresse?.trim() || null
      if (endring.beskrivelse !== undefined) a.beskrivelse = endring.beskrivelse?.trim() || null
      if (endring.intervallManeder !== undefined) a.intervallManeder = endring.intervallManeder
      if (endring.varselDager !== undefined) a.varselDager = endring.varselDager
      if (endring.skjemaMalId !== undefined) a.skjemaMalId = endring.skjemaMalId ?? null
      if (endring.estimertTimer !== undefined) a.estimertTimer = endring.estimertTimer ?? null
      if (endring.nesteForfall !== undefined) a.nesteForfall = tilDagStart(endring.nesteForfall)
      if (endring.aktiv !== undefined) a.aktiv = endring.aktiv
    }),
  )
}

/** Avslutter avtalen. Historikken (utførte ordrer) blir stående. */
export async function avsluttAvtale(avtale: ServiceAgreement): Promise<void> {
  await oppdaterAvtale(avtale, { aktiv: false })
}

/**
 * Lager ordren for neste kontroll.
 *
 * Ordren er en HELT VANLIG ordre — den bærer bare `serviceAgreementId` så
 * historikken finnes. Datoen settes til forfallsdatoen, ikke i dag: en
 * årskontroll som forfaller om tre uker skal ligge i uke 39 i kalenderen,
 * ikke i dag.
 */
export async function opprettOrdreFraAvtale(avtale: ServiceAgreement): Promise<Order> {
  const kunde = avtale.customerId
    ? await database.get<Customer>('customers').find(avtale.customerId).catch(() => null)
    : null

  return database.write(async () =>
    database.get<Order>('orders').create(o => {
      o.title = avtale.tittel
      o.description = avtale.beskrivelse
      o.status = 'planlagt'
      o.customerId = avtale.customerId
      o.customerName = kunde?.name ?? ''
      o.customerPhone = kunde?.phone ?? null
      o.address = avtale.adresse ?? kunde?.address ?? null
      o.scheduledAt = avtale.nesteForfall
      o.serviceAgreementId = avtale.id
    }),
  )
}

/**
 * Registrerer at kontrollen er utført og flytter avtalen ett intervall fram.
 *
 * Neste forfall regnes fra UTFØRELSEN, ikke fra planlagt dato: en kontroll som
 * ble to måneder forsinket skal ha tolv måneder til neste, ikke ti.
 */
export async function registrerUtfort(
  avtale: ServiceAgreement,
  opts: { ordreId?: string | null; utfortDato?: Date } = {},
): Promise<void> {
  const utfort = tilDagStart(opts.utfortDato ?? new Date())
  await database.write(async () =>
    avtale.update(a => {
      a.sistUtfortAt = utfort
      a.sistOrdreId = opts.ordreId ?? a.sistOrdreId
      a.nesteForfall = nesteForfallEtterUtforelse(utfort, { maneder: a.intervallManeder })
    }),
  )
}

/* ── Lesing ────────────────────────────────────────────────────────────────── */

function sorterPaaForfall(rader: ServiceAgreement[]): ServiceAgreement[] {
  return [...rader].sort((a, b) => a.nesteForfall.getTime() - b.nesteForfall.getTime())
}

/** Alle aktive avtaler, nærmeste forfall først. */
export function useAvtaler(barAktive = true): ServiceAgreement[] {
  const [rader, setRader] = useState<ServiceAgreement[]>([])
  useEffect(() => {
    const betingelser = barAktive ? [Q.where('aktiv', true)] : []
    const sub = database
      .get<ServiceAgreement>('service_agreements')
      .query(...betingelser)
      .observe()
      .subscribe(r => setRader(sorterPaaForfall(r)))
    return () => sub.unsubscribe()
  }, [barAktive])
  return rader
}

/** Avtaler som forfaller nå eller er forfalt — det som må planlegges. */
export function useForfallende(naa: Date = new Date()): ServiceAgreement[] {
  const alle = useAvtaler(true)
  return alle.filter(a => forfallsstatus(a.nesteForfall, naa, a.varselDager) !== 'kommende')
}

export function useAvtalerForKunde(kundeId: string | null | undefined): ServiceAgreement[] {
  const [rader, setRader] = useState<ServiceAgreement[]>([])
  useEffect(() => {
    if (!kundeId) { setRader([]); return }
    const sub = database
      .get<ServiceAgreement>('service_agreements')
      .query(Q.where('customer_id', kundeId))
      .observe()
      .subscribe(r => setRader(sorterPaaForfall(r)))
    return () => sub.unsubscribe()
  }, [kundeId])
  return rader
}

/** Ordrene som har oppfylt en avtale — historikken. */
export async function hentUtforteOrdrer(avtaleId: string): Promise<Order[]> {
  return database
    .get<Order>('orders')
    .query(Q.where('service_agreement_id', avtaleId), Q.sortBy('scheduled_at', Q.desc))
    .fetch()
}

/** Status og dager til forfall for én avtale — til visning. */
export function avtaleStatus(avtale: ServiceAgreement, naa: Date = new Date()): {
  status: Forfallsstatus
  dagerTil: number
} {
  return {
    status: forfallsstatus(avtale.nesteForfall, naa, avtale.varselDager),
    dagerTil: dagerTilForfall(avtale.nesteForfall, naa),
  }
}

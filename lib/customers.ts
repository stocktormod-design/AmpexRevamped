import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Customer } from './db/models/customer'
import { Order } from './db/models/order'
import { syncQuietly } from './db/sync'

// ── Valgt kunde for en ordre som ikke er opprettet ennå (Ny ordre → Velg kunde).
// Velgeren kobler ellers kunden rett på ordren; her finnes ingen ordre å koble på,
// så valget parkeres til «Opprett ordre» trykkes.
let valgtKunde: Customer | null = null
const valgtLyttere = new Set<(k: Customer | null) => void>()
export function settValgtKunde(k: Customer | null) { valgtKunde = k; valgtLyttere.forEach(l => l(k)) }
export function useValgtKunde(): Customer | null {
  const [k, setK] = useState<Customer | null>(valgtKunde)
  useEffect(() => { valgtLyttere.add(setK); return () => { valgtLyttere.delete(setK) } }, [])
  return k
}

/** Kundesøk uten hook — for assistentens verktøy. Tom søketekst gir alle. */
export async function sokKunder(sok = '', maks = 20): Promise<Customer[]> {
  const alle = await database.get<Customer>('customers').query(Q.sortBy('name', Q.asc)).fetch()
  const q = sok.trim().toLowerCase()
  const treff = q ? alle.filter(k => [k.name, k.phone, k.city, k.address].some(v => (v ?? '').toLowerCase().includes(q))) : alle
  return treff.slice(0, maks)
}

/** Én kunde etter navn: eksakt først, så «begynner med». Null hvis ingen. */
export async function finnKunde(navn: string): Promise<Customer | null> {
  const n = navn.trim().toLowerCase()
  if (!n) return null
  const alle = await database.get<Customer>('customers').query().fetch()
  return alle.find(k => k.name.toLowerCase() === n) ?? alle.find(k => k.name.toLowerCase().startsWith(n)) ?? null
}

export function useKunder(sok = ''): Customer[] {
  const [rows, setRows] = useState<Customer[]>([])
  useEffect(() => {
    const sub = database.get<Customer>('customers')
      .query(Q.sortBy('name', Q.asc))
      .observeWithColumns(['name', 'phone', 'email', 'address', 'city'])
      .subscribe(alle => {
        const q = sok.trim().toLowerCase()
        setRows(!q ? alle : alle.filter(k =>
          k.name.toLowerCase().includes(q)
          || (k.phone ?? '').replace(/\s/g, '').includes(q.replace(/\s/g, ''))
          || (k.orgNr ?? '').includes(q)
          || (k.address ?? '').toLowerCase().includes(q),
        ))
      })
    return () => sub.unsubscribe()
  }, [sok])
  return rows
}

export function useKunde(id: string | null | undefined): Customer | null {
  const [kunde, setKunde] = useState<Customer | null>(null)
  useEffect(() => {
    if (!id) { setKunde(null); return }
    const sub = database.get<Customer>('customers').findAndObserve(id).subscribe({
      next: setKunde,
      error: () => setKunde(null), // slettet kunde skal ikke krasje ordredetaljen
    })
    return () => sub.unsubscribe()
  }, [id])
  return kunde
}

export type KundeInput = {
  name: string
  isCompany?: boolean
  orgNr?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  note?: string | null
}

export async function opprettKunde(input: KundeInput): Promise<Customer> {
  const kunde = await database.write(async () =>
    database.get<Customer>('customers').create(k => {
      k.name = input.name.trim()
      k.isCompany = input.isCompany ?? false
      k.orgNr = input.orgNr?.trim() || null
      k.email = input.email?.trim() || null
      k.phone = input.phone?.trim() || null
      k.address = input.address?.trim() || null
      k.postalCode = input.postalCode?.trim() || null
      k.city = input.city?.trim() || null
      k.note = input.note?.trim() || null
    }),
  )
  syncQuietly()
  return kunde
}

export async function oppdaterKunde(kunde: Customer, input: Partial<KundeInput>): Promise<void> {
  await database.write(async () => {
    await kunde.update(k => {
      if (input.name !== undefined) k.name = input.name.trim()
      if (input.isCompany !== undefined) k.isCompany = input.isCompany
      if (input.orgNr !== undefined) k.orgNr = input.orgNr?.trim() || null
      if (input.email !== undefined) k.email = input.email?.trim() || null
      if (input.phone !== undefined) k.phone = input.phone?.trim() || null
      if (input.address !== undefined) k.address = input.address?.trim() || null
      if (input.postalCode !== undefined) k.postalCode = input.postalCode?.trim() || null
      if (input.city !== undefined) k.city = input.city?.trim() || null
      if (input.note !== undefined) k.note = input.note?.trim() || null
    })
  })
  syncQuietly()
}

/**
 * Finn eller opprett på navn. Brukes av AI-verktøy og import, der en fritekst
 * skal bli en kunde uten at det lages duplikat hver gang navnet nevnes.
 */
export async function finnEllerOpprettKunde(navn: string, ekstra?: Partial<KundeInput>): Promise<Customer> {
  const n = navn.trim()
  if (!n) throw new Error('Kunde må ha navn')
  const alle = await database.get<Customer>('customers').query().fetch()
  const treff = alle.find(k => k.name.trim().toLowerCase() === n.toLowerCase())
  if (treff) return treff
  return opprettKunde({ name: n, ...ekstra })
}

/** Antall ordre per kunde — for kundelista. */
export function useOrdreAntallPerKunde(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const sub = database.get<Order>('orders').query().observeWithColumns(['customer_id']).subscribe(ordre => {
      const out: Record<string, number> = {}
      for (const o of ordre) if (o.customerId) out[o.customerId] = (out[o.customerId] ?? 0) + 1
      setCounts(out)
    })
    return () => sub.unsubscribe()
  }, [])
  return counts
}

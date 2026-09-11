import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Activity } from './db/models/activity'

/**
 * Standardaktiviteter for elektro. Seedes én gang ved første bruk, slik at
 * timeføring virker uten at noen må sette opp noe først — en tom aktivitetsliste
 * ville blokkert timeføringen på dag én.
 *
 * Satsene er startverdier, ikke fasit. De skal kunne endres i appen.
 */
export const STANDARD_AKTIVITETER: { name: string; hourlyRate: number; billable: boolean }[] = [
  { name: 'Montasje', hourlyRate: 850, billable: true },
  { name: 'Feilsøking', hourlyRate: 950, billable: true },
  { name: 'Service', hourlyRate: 895, billable: true },
  { name: 'Prosjektering', hourlyRate: 1050, billable: true },
  { name: 'Kjøring', hourlyRate: 650, billable: true },
  { name: 'Verksted', hourlyRate: 750, billable: true },
  { name: 'Garanti', hourlyRate: 0, billable: false },
  { name: 'Internt', hourlyRate: 0, billable: false },
]

/**
 * Idempotent — og først ETTER første synk. En fersk installasjon har tom lokal
 * tabell før synken har hentet firmaets aktiviteter; seedet vi da, fikk hver
 * ny telefon sitt eget sett (Tormod 2026-09-06: tre «Montasje», tre «Service»
 * i timeføringa). Duplikatene i basen er arkivert; dette hindrer nye.
 */
export async function seedAktiviteter(): Promise<void> {
  const collection = database.get<Activity>('activities')
  const synket = await database.localStorage.get('__watermelon_last_pulled_at')
  if (!synket) return
  const antall = await collection.query().fetchCount()
  if (antall > 0) return
  await database.write(async () => {
    await collection.database.batch(
      ...STANDARD_AKTIVITETER.map(a =>
        collection.prepareCreate(x => {
          x.name = a.name
          x.hourlyRate = a.hourlyRate
          x.billable = a.billable
          x.vatType = 'hoy'
          x.archived = false
        }),
      ),
    )
  })
}

export function useAktiviteter(inkluderArkiverte = false): Activity[] {
  const [rows, setRows] = useState<Activity[]>([])
  useEffect(() => {
    const q = inkluderArkiverte
      ? database.get<Activity>('activities').query(Q.sortBy('name', Q.asc))
      : database.get<Activity>('activities').query(Q.where('archived', false), Q.sortBy('name', Q.asc))
    const sub = q.observeWithColumns(['name', 'hourly_rate', 'billable', 'archived']).subscribe(setRows)
    return () => sub.unsubscribe()
  }, [inkluderArkiverte])
  return rows
}

export async function finnAktivitet(navn: string): Promise<Activity | null> {
  const treff = await database.get<Activity>('activities')
    .query(Q.where('archived', false)).fetch()
  const n = navn.trim().toLowerCase()
  return treff.find(a => a.name.toLowerCase() === n)
    ?? treff.find(a => a.name.toLowerCase().startsWith(n))
    ?? null
}

export async function opprettAktivitet(input: {
  name: string; hourlyRate?: number | null; billable?: boolean
}): Promise<Activity> {
  return database.write(async () =>
    database.get<Activity>('activities').create(a => {
      a.name = input.name.trim()
      a.hourlyRate = input.hourlyRate ?? null
      a.billable = input.billable ?? true
      a.vatType = 'hoy'
      a.archived = false
    }),
  )
}

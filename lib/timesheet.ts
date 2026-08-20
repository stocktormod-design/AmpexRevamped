import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { Activity } from './db/models/activity'
import { Order } from './db/models/order'
import { TimeEntry } from './db/models/time-entry'
import { byggUkeliste, tomUke, ukeSlutt, type Ukeliste } from './timesheet-calc'

export * from './timesheet-calc'

/**
 * Ukelista mot databasen. Regnestykket ligger i `timesheet-calc.ts`.
 *
 * Ordredetaljen viser timer per ORDRE — «hva koster denne jobben». Den svarer
 * ikke på «hvor mange timer jobbet jeg forrige uke», som er spørsmålet hver
 * eneste fredag, og det eneste som gir overtid og fravær et tall.
 */
export function useUkeliste(userId: string | null, start: Date): Ukeliste<TimeEntry> {
  const [uke, setUke] = useState<Ukeliste<TimeEntry>>(() => tomUke<TimeEntry>(start))
  const startMs = start.getTime()

  useEffect(() => {
    if (!userId) { setUke(tomUke<TimeEntry>(new Date(startMs))); return }
    const fra = startMs
    const til = ukeSlutt(new Date(startMs)).getTime()

    const sub = database.get<TimeEntry>('time_entries')
      .query(
        Q.where('user_id', userId),
        Q.where('date', Q.gte(fra)),
        Q.where('date', Q.lt(til)),
        Q.sortBy('date', Q.asc),
      )
      .observeWithColumns(['hours', 'date', 'order_id', 'activity_id', 'billable', 'note'])
      .subscribe(async linjer => {
        // Ordre og aktiviteter slås opp ETTER treffene, ikke abonneres på: en
        // ukeliste skal ikke rendres på nytt fordi en ordretittel i en helt
        // annen uke ble rettet.
        const ordreIder = [...new Set(linjer.map(l => l.orderId))]
        const aktivitetIder = [...new Set(linjer.map(l => l.activityId).filter((x): x is string => !!x))]
        const [ordre, aktiviteter] = await Promise.all([
          ordreIder.length ? database.get<Order>('orders').query(Q.where('id', Q.oneOf(ordreIder))).fetch() : Promise.resolve([]),
          aktivitetIder.length ? database.get<Activity>('activities').query(Q.where('id', Q.oneOf(aktivitetIder))).fetch() : Promise.resolve([]),
        ])
        setUke(byggUkeliste(
          new Date(startMs),
          linjer,
          new Map(ordre.map(o => [o.id, o])),
          new Map(aktiviteter.map(a => [a.id, a])),
        ))
      })
    return () => sub.unsubscribe()
  }, [userId, startMs])

  return uke
}

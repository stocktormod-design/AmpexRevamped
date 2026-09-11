/**
 * Påminnelser som faktisk varsler.
 *
 * FUNKSJON UTEN SKJERM. `reminders`-tabellen fantes, assistenten oppretter
 * dem — men ingenting sa fra. Denne modulen kobler radene til telefonens
 * varslingskø, og holder de to i takt.
 *
 * **Lokale varsler, ikke push.** Et push-varsel krever entitlement, en
 * server som sender, og nett i det øyeblikket det skal ringe. En påminnelse om
 * en jobb i morgen tidlig skal virke i en kjeller uten dekning — da er lokalt
 * planlagte varsler ikke en nødløsning, men det riktige valget.
 *
 * **Køen er en avledning av databasen, ikke en kilde.** Ved hver synkronisering
 * planlegges åpne påminnelser på nytt fra radene. Det gjør at en påminnelse
 * opprettet på en annen enhet også ringer her, og at en avkrysset påminnelse
 * slutter å ringe overalt.
 */
import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { database } from './db'
import { Reminder } from './db/models/reminder'
import { supabase } from './supabase'

/** Varselet skal vises selv om appen er åpen — ellers ser montøren ingenting. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

const KANAL = 'paaminnelser'

/** Ber om tillatelse. Kalles der brukeren nettopp BA om en påminnelse. */
export async function beOmVarseltillatelse(): Promise<boolean> {
  const eksisterende = await Notifications.getPermissionsAsync()
  const status = eksisterende.granted
    ? eksisterende
    : await Notifications.requestPermissionsAsync()
  if (!status.granted) return false

  if (Platform.OS === 'android') {
    // Uten en kanal er varselet stumt på Android — det vises, men ingen merker det.
    await Notifications.setNotificationChannelAsync(KANAL, {
      name: 'Påminnelser',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    })
  }
  return true
}

/* ── Databasen ─────────────────────────────────────────────────────────────── */

export async function lagPaaminnelse(opts: {
  tittel: string
  forfaller: Date
  ordreId?: string | null
  notat?: string | null
}): Promise<Reminder> {
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? ''
  const rad = await database.write(async () =>
    database.get<Reminder>('reminders').create(r => {
      r.userId = bruker
      r.title = opts.tittel
      r.dueAt = opts.forfaller
      r.orderId = opts.ordreId ?? null
      r.note = opts.notat ?? null
      r.status = 'open'
    }),
  )
  await planleggAlle()
  return rad
}

export async function fullforPaaminnelse(rad: Reminder): Promise<void> {
  await database.write(async () => rad.update(r => { r.status = 'done' }))
  await planleggAlle()
}

export async function slettPaaminnelse(rad: Reminder): Promise<void> {
  await database.write(async () => rad.markAsDeleted())
  await planleggAlle()
}

/** Åpne påminnelser for innlogget bruker, reaktivt. */
export function usePaaminnelser(userId: string | null | undefined): Reminder[] {
  const [rader, setRader] = useState<Reminder[]>([])
  useEffect(() => {
    if (!userId) { setRader([]); return }
    const sub = database
      .get<Reminder>('reminders')
      .query(Q.where('user_id', userId), Q.where('status', 'open'), Q.sortBy('due_at', Q.asc))
      .observe()
      .subscribe(setRader)
    return () => sub.unsubscribe()
  }, [userId])
  return rader
}

/* ── Varslingskøen ─────────────────────────────────────────────────────────── */

/**
 * Planlegger alle åpne, framtidige påminnelser på nytt.
 *
 * Hele køen tømmes først. Det ser brutalt ut, men er det eneste som holder:
 * uten en full omplanlegging ville en påminnelse som ble endret eller slettet
 * på en annen enhet fortsatt ringe her. Køen er billig — det er titalls
 * varsler, ikke tusener.
 *
 * Kalles fra synken (forgrunn/nettverksretur) og etter hver endring. ALDRI i
 * en løkke (regel 10).
 */
export async function planleggAlle(): Promise<number> {
  const tillatt = (await Notifications.getPermissionsAsync()).granted
  if (!tillatt) return 0

  const bruker = (await supabase.auth.getUser()).data.user?.id
  if (!bruker) return 0

  await Notifications.cancelAllScheduledNotificationsAsync()

  const naa = Date.now()
  const rader = await database
    .get<Reminder>('reminders')
    .query(Q.where('user_id', bruker), Q.where('status', 'open'), Q.sortBy('due_at', Q.asc))
    .fetch()

  let antall = 0
  for (const r of rader) {
    const tid = r.dueAt?.getTime() ?? 0
    // Forfalte påminnelser varsles ikke på nytt: en telefon som plutselig
    // ringer for noe som skulle skjedd i går er støy, ikke hjelp.
    if (tid <= naa) continue
    await Notifications.scheduleNotificationAsync({
      content: {
        title: r.title,
        body: r.note ?? '',
        // Ordre-id følger med så et trykk kan åpne riktig ordre.
        data: r.orderId ? { orderId: r.orderId, reminderId: r.id } : { reminderId: r.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(tid),
        ...(Platform.OS === 'android' ? { channelId: KANAL } : {}),
      },
    })
    antall++
  }
  return antall
}

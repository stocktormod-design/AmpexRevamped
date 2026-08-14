import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { Order } from './db/models/order'
import { OrderMember } from './db/models/order-member'
import { supabase } from './supabase'

/**
 * Medlemskaps-basert tilgang til ordrer INNAD i firmaet (RLS isolerer firmaer,
 * dette isolerer personer): full info kun for ordrer du er med på. For andres
 * ordrer er kun «visittkortet» lov å dele — nummer, tittel, hvem som er med,
 * ansvarlig — aldri innhold/dokumentasjon. Håndheves i AI-verktøyene
 * (lib/ai/live-session.ts) nå; skjermene kan gjenbruke samme helpers senere.
 * NB: order_members er foreløpig lokal (kun orders-tabellen synker) — hånd-
 * hevingen er per enhet til medlemskap får egen synk + RLS.
 */

export type CurrentUser = { id: string; name: string; role: string }

let cachedUser: CurrentUser | null = null

/** Innlogget bruker + navn/rolle (profiles), snapshotes i medlemsrader. Cache per prosess. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (cachedUser) return cachedUser
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return null
  let name = ''
  let role = ''
  try {
    const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).single()
    name = profile?.full_name ?? ''
    role = profile?.role ?? ''
  } catch {
    // offline — navn/rolle er berikelse; id-en er det som teller for tilgang
  }
  cachedUser = { id: user.id, name, role }
  return cachedUser
}

export async function getOrderMembers(orderId: string): Promise<OrderMember[]> {
  return database.get<OrderMember>('order_members').query(Q.where('order_id', orderId)).fetch()
}

/** Med på ordren = tildelt (assigned_to) ELLER medlemsrad i order_members. */
export async function isOrderMember(order: Order, userId: string): Promise<boolean> {
  if (order.assignedTo === userId) return true
  const rows = await database
    .get<OrderMember>('order_members')
    .query(Q.where('order_id', order.id), Q.where('user_id', userId))
    .fetch()
  return rows.length > 0
}

export type Colleague = { id: string; name: string }
export type ColleagueMatch =
  | { kind: 'one'; colleague: Colleague }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' }
  | { kind: 'offline' }

let colleagueCache: Colleague[] | null = null

/**
 * Finn kollega i samme firma på (deler av) navn — for «legg Glenn til på ordren».
 * profiles ligger KUN på serveren (RLS tillater select innen eget firma), så dette
 * krever nett; cache per prosess så én økt ikke spør igjen og igjen.
 */
export async function findColleagueByName(spoken: string): Promise<ColleagueMatch> {
  if (!colleagueCache) {
    try {
      const { data, error } = await supabase.from('profiles').select('id, full_name').is('deleted_at', null)
      if (error || !data) return { kind: 'offline' }
      colleagueCache = data.map(p => ({ id: p.id as string, name: (p.full_name as string) ?? '' }))
    } catch {
      return { kind: 'offline' }
    }
  }
  const q = spoken.trim().toLowerCase()
  const exact = colleagueCache.filter(c => c.name.toLowerCase() === q)
  if (exact.length === 1) return { kind: 'one', colleague: exact[0] }
  const partial = colleagueCache.filter(c => c.name.toLowerCase().includes(q))
  if (partial.length === 1) return { kind: 'one', colleague: partial[0] }
  if (partial.length > 1) return { kind: 'ambiguous', candidates: partial.slice(0, 5).map(c => c.name) }
  return { kind: 'none' }
}

/** Legg til person på ordre — idempotent. */
export async function addOrderMember(orderId: string, user: { id: string; name: string }): Promise<void> {
  const existing = await database
    .get<OrderMember>('order_members')
    .query(Q.where('order_id', orderId), Q.where('user_id', user.id))
    .fetch()
  if (existing.length > 0) return
  await database.write(async () => {
    await database.get<OrderMember>('order_members').create(m => {
      m.orderId = orderId
      m.userId = user.id
      m.userName = user.name
    })
  })
}

/** Alle ordrer brukeren er med på (tildelt eller medlem), nyeste først. */
export async function listMyOrders(userId: string, limit = 20): Promise<Order[]> {
  const memberRows = await database.get<OrderMember>('order_members').query(Q.where('user_id', userId)).fetch()
  const memberOrderIds = new Set(memberRows.map(m => m.orderId))
  const all = await database.get<Order>('orders').query(Q.sortBy('updated_at', Q.desc)).fetch()
  return all.filter(o => o.assignedTo === userId || memberOrderIds.has(o.id)).slice(0, limit)
}

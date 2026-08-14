import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { Order } from './db/models/order'

/** Finnes ikke fra før — ingen skjerm har trengt ordre-oppslag på nummer før tale-kommandoen. */
export async function findByOrderNumber(n: number): Promise<Order | null> {
  const [order] = await database.get<Order>('orders').query(Q.where('order_number', n)).fetch()
  return order ?? null
}

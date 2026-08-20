import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Registeroppføring for en frosset jobb.
 *
 * **Man søker aldri i R2 for å finne noe.** Denne raden ER registeret; R2 er
 * oppbevaring. «Gamle jobber, filtrert på kunde» skal være en spørring mot
 * lokal SQLite, ikke en opplisting av et objektlager — det er tregt, feilbarlig,
 * og et tapt objekt ville ikke merkes.
 */
export class OrderArchive extends Model {
  static table = 'order_archives'

  @text('order_id') orderId: string
  @text('customer_id') customerId: string | null
  @text('customer_name') customerName: string | null
  @field('order_number') orderNumber: number | null
  @field('aar') aar: number
  @text('r2_key') r2Key: string
  /** Beviset. Endres pakken i R2, stemmer den ikke lenger mot denne raden. */
  @text('sha256') sha256: string
  @field('bytes') bytes: number
  @text('innhold') innhold: string | null
  @date('frosset_at') frossetAt: Date
  @text('frosset_av') frossetAv: string | null
  /** Stemplet ved frysing — ikke regnet ut ved oppslag. Se migrasjonen. */
  @date('oppbevares_til') oppbevaresTil: Date
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get telleverk(): Record<string, number> {
    if (!this.innhold) return {}
    try {
      const p = JSON.parse(this.innhold)
      return p && typeof p === 'object' ? (p as Record<string, number>) : {}
    } catch {
      return {}
    }
  }
}

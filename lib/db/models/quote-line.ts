import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'
import type { TilbudslinjeArt, TilbudslinjeInn } from '../../quoting'

/**
 * Én linje i et tilbud.
 *
 * Prisen er et SNAPSHOT i kroner eks. mva, ikke en peker til varekartoteket:
 * et sendt tilbud er bindende, og skal ikke endre beløp fordi grossisten sendte
 * en ny prisfil dagen etter. `product_id` beholdes likevel, så linja kan spores
 * tilbake til varen den kom fra.
 */
export class QuoteLine extends Model {
  static table = 'quote_lines'

  @text('quote_id') quoteId: string
  /** Brukerens rekkefølge. Den er en del av dokumentet, ikke en visningsdetalj. */
  @field('sort_order') sortOrder: number
  @text('kind') kind: TilbudslinjeArt
  @text('description') description: string
  @text('elnummer') elnummer: string | null
  @text('product_id') productId: string | null
  @text('activity_id') activityId: string | null
  @field('quantity') quantity: number | null
  @text('unit') unit: string | null
  @field('unit_price') unitPrice: number | null
  @field('cost_price') costPrice: number | null
  @field('discount_percent') discountPercent: number | null
  @text('vat_type') vatType: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** Til lib/quoting.ts — flatt objekt, ingen modell, så regnestykket kan testes. */
  get somInn(): TilbudslinjeInn {
    return {
      id: this.id,
      art: this.kind,
      beskrivelse: this.description,
      antall: this.quantity,
      enhet: this.unit,
      enhetsprisKr: this.unitPrice,
      kostprisKr: this.costPrice,
      rabattProsent: this.discountPercent,
      mvaType: this.vatType,
      elnummer: this.elnummer,
    }
  }
}

import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'
import type { Omrade } from '../../quoting'

/**
 * Et område i et tilbud — «Stue», «1. etasje», «Utvendig».
 *
 * Området er en OVERSKRIFT MED SUM, ikke bare en tekstlinje: kunden som spør
 * «hva koster bare kjøkkenet» skal få svaret uten at noen regner for hånd.
 * Nestet via parentId (bygg → etasje → rom); appen viser ett nivå.
 *
 * Linjene peker hit, ikke motsatt — et slettet område skal aldri kunne ta
 * penger med seg ut av summen. Se `slettOmrade` i lib/quotes.ts.
 */
export class QuoteSection extends Model {
  static table = 'quote_sections'

  @text('quote_id') quoteId: string
  @text('parent_id') parentId: string | null
  @text('name') name: string
  @field('sort_order') sortOrder: number
  /** manuell | tegning | pakke — hvor området kom fra. */
  @text('source') source: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** Til lib/quoting.ts — flatt objekt, så grupperingen kan selvtestes. */
  get somOmrade(): Omrade {
    return {
      id: this.id,
      forelderId: this.parentId,
      navn: this.name,
      sortOrder: this.sortOrder,
    }
  }
}

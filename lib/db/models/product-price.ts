import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Én grossists pris på én vare.
 *
 * Dette er tabellen som gjør prissammenligning mulig, og den formen
 * `docs/KONKURRENTANALYSE.md` punkt 4 krevde: **(el-nummer, grossist, dato)**.
 * Før dette lå prisen som én kolonne på `products`, og den andre grossistens
 * fil overskrev den første — så «Solar er 14 % billigere på denne» kunne ikke
 * besvares i det hele tatt.
 *
 * Det er også hele salgsargumentet: Ahlsell og Onninen gir bort autopåfyll,
 * men ingen av dem kan si «bestill hos den andre». Det er strukturelt umulig
 * for dem.
 *
 * Én rad per (vare, grossist). Ny import fra samme grossist oppdaterer raden;
 * en annen grossist får sin egen.
 */
export class ProductPrice extends Model {
  static table = 'product_prices'

  @text('product_id') productId: string
  /** Dupliseres fra varen: join-nøkkelen, og gjør raden lesbar alene. */
  @text('elnummer') elnummer: string
  @text('supplier') supplier: string
  /** Kr eks. mva, etter rabatt. Det er dette som skal sammenlignes. */
  @field('net_price') netPrice: number
  /** Listepris før rabatt, når fila oppgir den. */
  @field('gross_price') grossPrice: number | null
  @field('discount_percent') discountPercent: number | null
  @text('price_type') priceType: string | null
  /** Minste normale bestillingsmengde. Å bestille 100 av noe i pakker à 10 er den dyre klassikeren. */
  @field('sales_pack') salesPack: number | null
  /** Fører grossisten varen på lager? */
  @field('stocked') stocked: boolean | null
  /** Grossisten har merket varen utgått. Prisen står, men den bør ikke bestilles. */
  @field('discontinued') discontinued: boolean | null
  @date('price_date') priceDate: Date | null
  @date('valid_from') validFrom: Date | null
  @date('valid_to') validTo: Date | null
  /** Når VI leste den inn. Ferskhet måles mot denne, ikke mot grossistens dato. */
  @date('imported_at') importedAt: Date
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

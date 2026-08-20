import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/** Vare. el-nummer er den universelle nøkkelen som gjør beholdning aggregerbar. */
export class Product extends Model {
  static table = 'products'

  @text('elnummer') elnummer: string | null
  @text('name') name: string
  @text('unit') unit: string
  /** Utsalgspris eks. mva. Fiken krever den for å opprette varen i regnskapet. */
  @field('unit_price') unitPrice: number | null
  /** Nettopris fra grossistens prisfil — grunnlaget for dekningsbidrag. */
  @field('cost_price') costPrice: number | null
  @text('vat_type') vatType: string | null
  @text('income_account') incomeAccount: string | null
  /**
   * Grossisten `cost_price` sist kom fra. Alle grossistenes priser ligger i
   * `product_prices` — denne er kun det raske oppslaget for fakturagrunnlaget.
   */
  @text('supplier') supplier: string | null
  @date('price_updated_at') priceUpdatedAt: Date | null

  // ── Varekortet ────────────────────────────────────────────────────────────
  // Alt dette står allerede i prisfila (VL/VX/VA-poster). Det ble kastet ved
  // import før, og det er grunnen til at varesøket føltes tomt mot EFObasen.

  /** Produsent — «Nexans», «ABB». Det folk faktisk sier når de beskriver en vare. */
  @text('fabrikat') fabrikat: string | null
  /** Produsentens egen typebetegnelse. */
  @text('type_betegnelse') typeBetegnelse: string | null
  /** Grossistens rabattgruppe. Faget bruker den som varegruppe. */
  @text('discount_group') discountGroup: string | null
  @text('ean') ean: string | null
  @text('nrf') nrf: string | null
  @text('image_url') imageUrl: string | null
  @text('fdv_url') fdvUrl: string | null
  @text('hms_url') hmsUrl: string | null
  @text('efobase_id') efobaseId: string | null
  /** El-nummeret som erstatter denne når grossisten har merket den utgått. */
  @text('replaced_by') replacedBy: string | null
  @field('sales_pack') salesPack: number | null
  /** JSON: alle VX-felt fra fila, også de vi ikke viser. Ingenting kastes. */
  @text('extra') extra: string | null
  /** Alt søkbart slått sammen, små bokstaver — SQLite LIKE-filtrerer på denne. */
  @text('search_text') searchText: string | null
  /** Varegruppe utledet av varenavnet. Grunnlaget for å BLA i stedet for å søke. */
  @text('category') category: string | null

  get ekstraFelt(): Record<string, string> {
    if (!this.extra) return {}
    try {
      const p = JSON.parse(this.extra)
      return p && typeof p === 'object' ? (p as Record<string, string>) : {}
    } catch {
      return {}
    }
  }
  @text('source_system') sourceSystem: string | null
  @text('external_id') externalId: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

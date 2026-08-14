import { Q } from '@nozbe/watermelondb'
import { router } from 'expo-router'
import { database } from './db'
import { syncQuietly } from './db/sync'
import { NfcTag } from './db/models/nfc-tag'
import { StockMovement } from './db/models/stock-movement'
import { Product } from './db/models/product'

/**
 * Sentral NFC-tapp-handler — samme funksjon «Simuler NFC-tapp» og (senere) ekte
 * expo-nfc-hendelser kaller. `locationId` trengs kun for material-tags (uttaket
 * registreres der du står); location-tags navigerer i stedet for å røre lageret.
 */
export async function onNfcTag(uid: string, locationId?: string) {
  const [tag] = await database.get<NfcTag>('nfc_tags').query(Q.where('tag_uid', uid)).fetch()
  if (!tag) return

  if (tag.targetType === 'location') {
    router.push({ pathname: '/(app)/lager/[id]', params: { id: tag.targetId } })
    return
  }

  if (!locationId) return
  await database.write(async () => {
    await database.get<StockMovement>('stock_movements').create(m => {
      m.productId = tag.targetId
      m.locationId = locationId
      m.quantity = -(tag.defaultQty ?? 1) // ut fra lager, som uttak.tsx
      m.kind = 'ut'
      m.orderId = null // uplassert → handlekurven plukker den opp
      m.note = null
    })
  })
  syncQuietly()
}

/**
 * Finn eller opprett en material-tag for et produkt. Brukes av simulerings-plukkeren
 * så tag-registeret bygges opp naturlig etter hvert som man tester — samme rad ekte
 * NFC-oppsett senere kan peke en fysisk tag mot.
 */
export async function findOrCreateProductTag(product: Product): Promise<NfcTag> {
  const [existing] = await database.get<NfcTag>('nfc_tags')
    .query(Q.where('target_type', 'material'), Q.where('target_id', product.id))
    .fetch()
  if (existing) return existing
  return database.write(async () =>
    database.get<NfcTag>('nfc_tags').create(t => {
      t.tagUid = `sim-${Math.random().toString(36).slice(2, 10)}`
      t.targetType = 'material'
      t.targetId = product.id
      t.defaultQty = null
    }),
  )
}

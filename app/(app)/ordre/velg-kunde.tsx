import { View } from 'react-native'
import { Text } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { KundeVelger } from '../../../components/kunde-velger'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order } from '../../../lib/db/models/order'
import { settValgtKunde } from '../../../lib/customers'
import { Customer } from '../../../lib/db/models/customer'
import { colors, spacing, type as t } from '../../../lib/theme'

/**
 * Kundevelger for ordreflaten — både en ordre som finnes og en som er under
 * oppretting.
 *
 * Den låner ikke `/(app)/kunder/velg`, selv om lista er den samme. Den ruta er
 * en modal i KUNDER-stakken: `router.dismiss()` der lukker kunder-stakken og
 * lander på kundefanen, ikke tilbake på ordreskjermen som venter i ordre-
 * stakken. Det var feilen Tormod meldte 04.11 — «valgt kunde reagerer ikke»:
 * valget ble satt, men skjermen som skulle vise det fikk aldri fokus tilbake.
 *
 * Her ligger alt i ORDRE-stakken, så `router.back()` går tilbake til skjermen
 * som åpnet velgeren.
 *
 * To tilfeller:
 *   · `orderId` finnes → skriv kunden på ordren (ordredetaljen).
 *   · `orderId` mangler → sett det ventende valget (ny ordre), som
 *     `useValgtKunde` i `ny.tsx` abonnerer på.
 */
export default function VelgKundeForOrdre() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>()

  async function velg(kunde: Customer) {
    if (!orderId) {
      settValgtKunde(kunde)
      router.back()
      return
    }
    const order = await database.get<Order>('orders').find(orderId).catch(() => null)
    if (order) {
      await database.write(async () => {
        await order.update(o => {
          o.customerId = kunde.id
          o.customerName = kunde.name
          if (kunde.phone) o.customerPhone = kunde.phone
          if (!o.address && kunde.postalAddress) o.address = kunde.postalAddress
        })
      })
      syncQuietly()
    }
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingVertical: spacing.lg,
      }}>
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Velg kunde</Text>
        <View style={{ width: 48 }} />
      </View>

      <KundeVelger
        onVelg={velg}
        // Ny kunde går via kundeflaten, som selv setter valget når hun er laget.
        onNy={navn => router.push({ pathname: '/(app)/kunder/ny', params: { navn } })}
      />
    </View>
  )
}

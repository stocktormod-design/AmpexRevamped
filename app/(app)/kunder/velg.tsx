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
 * Kundevelger. Åpnes fra ordredetalj og fakturagrunnlag. Kobler kunden på
 * ordren og lukker seg selv — ett trykk, ingen mellomskjerm.
 *
 * Denne ruta ligger i KUNDER-stakken og lukkes med `dismiss()`. Skal du velge
 * kunde til en ordre som ikke finnes ennå, bruk `/(app)/ordre/velg-kunde` —
 * se kommentaren der.
 */
export default function VelgKundeScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>()

  async function velg(kunde: Customer) {
    if (!orderId) { settValgtKunde(kunde); router.dismiss(); return }
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
    router.dismiss()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingVertical: spacing.lg,
      }}>
        <Pressable onPress={() => router.dismiss()} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Velg kunde</Text>
        <View style={{ width: 48 }} />
      </View>

      <KundeVelger
        onVelg={velg}
        onNy={navn => router.replace({ pathname: '/(app)/kunder/ny', params: { orderId, navn } })}
      />
    </View>
  )
}

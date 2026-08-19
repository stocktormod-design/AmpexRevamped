import { useState } from 'react'
import { View, Text, ScrollView, TextInput } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Plus, Building2, User, Check } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order } from '../../../lib/db/models/order'
import { useKunder } from '../../../lib/customers'
import { Customer } from '../../../lib/db/models/customer'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/**
 * Kundevelger. Åpnes fra ordredetalj og fakturagrunnlag. Kobler kunden på
 * ordren og lukker seg selv — ett trykk, ingen mellomskjerm.
 */
export default function VelgKundeScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>()
  const [sok, setSok] = useState('')
  const kunder = useKunder(sok)

  async function velg(kunde: Customer) {
    if (!orderId) { router.dismiss(); return }
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
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Velg kunde</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.md }}>
        <TextInput
          value={sok}
          onChangeText={setSok}
          placeholder="Søk"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }]}
          autoFocus
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Nyopprettelse ligger øverst med søketeksten som navn — den vanligste
            grunnen til å ikke finne en kunde er at hun ikke finnes ennå. */}
        <ListCard style={{ marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.replace({ pathname: '/(app)/kunder/ny', params: { orderId, navn: sok.trim() } })}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            }}
          >
            <Plus size={18} color={colors.brand} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.body, { color: colors.brand }]}>
              {sok.trim() ? `Ny kunde «${sok.trim()}»` : 'Ny kunde'}
            </Text>
          </Pressable>
        </ListCard>

        {kunder.length > 0 && (
          <ListCard>
            {kunder.map((k, i) => (
              <Pressable
                key={k.id}
                onPress={() => velg(k)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                  paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                  borderBottomWidth: i === kunder.length - 1 ? 0 : 0.5, borderBottomColor: colors.separator,
                }}
              >
                {k.isCompany
                  ? <Building2 size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                  : <User size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                <View style={{ flex: 1 }}>
                  <Text style={t.body} numberOfLines={1}>{k.name}</Text>
                  {!!k.postalAddress && <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{k.postalAddress}</Text>}
                </View>
                <Check size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
              </Pressable>
            ))}
          </ListCard>
        )}
      </ScrollView>
    </View>
  )
}

import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Phone, Mail, MapPin, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { Customer } from '../../../lib/db/models/customer'
import { Order, orderStatusLabel } from '../../../lib/db/models/order'
import { colors, spacing, sizes, type as t } from '../../../lib/theme'

function Rad({ ikon, tekst, onPress, sist }: {
  ikon: React.ReactNode; tekst: string; onPress?: () => void; sist?: boolean
}) {
  const innhold = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: sist ? 0 : 0.5, borderBottomColor: colors.separator,
    }}>
      {ikon}
      <Text style={[t.body, { flex: 1, color: onPress ? colors.brand : colors.label }]}>{tekst}</Text>
    </View>
  )
  return onPress ? <Pressable onPress={onPress}>{innhold}</Pressable> : innhold
}

export default function KundeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [kunde, setKunde] = useState<Customer | null>(null)
  const [ordre, setOrdre] = useState<Order[]>([])

  useEffect(() => {
    if (!id) return
    const k = database.get<Customer>('customers').findAndObserve(id).subscribe({
      next: setKunde, error: () => setKunde(null),
    })
    const o = database.get<Order>('orders')
      .query(Q.where('customer_id', id), Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['status', 'title', 'order_number'])
      .subscribe(setOrdre)
    return () => { k.unsubscribe(); o.unsubscribe() }
  }, [id])

  if (!kunde) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </Pressable>
        <Text style={t.headline} numberOfLines={1}>{kunde.name}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Text style={t.display}>{kunde.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {kunde.isCompany ? `Bedrift${kunde.orgNr ? ` · org.nr ${kunde.orgNr}` : ''}` : 'Privatkunde'}
          </Text>
        </View>

        {(kunde.phone || kunde.email || kunde.postalAddress) && (
          <ListCard style={{ marginBottom: spacing.lg }}>
            {!!kunde.phone && (
              <Rad
                ikon={<Phone size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                tekst={kunde.phone}
                onPress={() => Linking.openURL(`tel:${kunde.phone}`)}
                sist={!kunde.email && !kunde.postalAddress}
              />
            )}
            {!!kunde.email && (
              <Rad
                ikon={<Mail size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                tekst={kunde.email}
                onPress={() => Linking.openURL(`mailto:${kunde.email}`)}
                sist={!kunde.postalAddress}
              />
            )}
            {!!kunde.postalAddress && (
              <Rad
                ikon={<MapPin size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                tekst={kunde.postalAddress}
                sist
              />
            )}
          </ListCard>
        )}

        <SectionHeader>{ordre.length ? `${ordre.length} ordre` : 'Ingen ordre'}</SectionHeader>
        {ordre.length > 0 && (
          <ListCard>
            {ordre.map((o, i) => (
              <Pressable
                key={o.id}
                onPress={() => router.push(`/(app)/ordre/${o.id}`)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                  paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                  borderBottomWidth: i === ordre.length - 1 ? 0 : 0.5, borderBottomColor: colors.separator,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={t.body} numberOfLines={1}>{o.title}</Text>
                  <Text style={[t.footnote, { marginTop: 1 }]}>
                    {o.orderNumber ? `#${o.orderNumber} · ` : ''}{orderStatusLabel[o.status]}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
              </Pressable>
            ))}
          </ListCard>
        )}

        {!!kunde.note && (
          <>
            <SectionHeader>Notat</SectionHeader>
            <ListCard>
              <Text style={[t.body, { padding: spacing.lg }]}>{kunde.note}</Text>
            </ListCard>
          </>
        )}
      </ScrollView>
    </View>
  )
}

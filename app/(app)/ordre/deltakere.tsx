import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Check, WifiOff } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order } from '../../../lib/db/models/order'
import { OrderMember } from '../../../lib/db/models/order-member'
import { addOrderMember, removeOrderMember, listColleagues, type Colleague } from '../../../lib/order-access'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function initialer(navn: string): string {
  return navn.split(/\s+/).filter(Boolean).slice(0, 2).map(o => o[0]?.toUpperCase() ?? '').join('')
}

/**
 * Hvem er med på ordren. Styrer to ting: hvem som kan føre timer, og hvor mye
 * av ordren andre i firmaet får se (lib/order-access.ts).
 *
 * Fantes ikke som skjerm før — medlemskap kunne kun settes med stemmen
 * («legg Glenn til på ordren»), og det er en dårlig eneste vei.
 */
export default function DeltakereScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [order, setOrder] = useState<Order | null>(null)
  const [medlemmer, setMedlemmer] = useState<OrderMember[]>([])
  const [kollegaer, setKollegaer] = useState<Colleague[] | null>(null)

  useEffect(() => {
    if (!id) return
    const o = database.get<Order>('orders').findAndObserve(id).subscribe({
      next: setOrder, error: () => setOrder(null),
    })
    const m = database.get<OrderMember>('order_members')
      .query(Q.where('order_id', id), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setMedlemmer)
    return () => { o.unsubscribe(); m.unsubscribe() }
  }, [id])

  useEffect(() => { listColleagues().then(setKollegaer) }, [])

  const medlemIder = new Set(medlemmer.map(m => m.userId))

  async function veksle(k: Colleague) {
    if (!id) return
    if (medlemIder.has(k.id)) await removeOrderMember(id, k.id)
    else await addOrderMember(id, k)
    syncQuietly()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </Pressable>
        <Text style={t.headline}>Deltakere</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.xl }}>
          <Text style={t.footnote}>
            Den som er med kan føre timer på ordren og se hele innholdet. Andre i firmaet
            ser bare nummer, tittel og hvem som er med.
          </Text>
        </View>

        {kollegaer === null ? (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>Henter kollegaer …</Text>
          </View>
        ) : kollegaer.length === 0 ? (
          // profiles ligger kun på serveren — uten nett finnes det ingen liste å vise.
          <ListCard>
            <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg }}>
              <WifiOff size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.subhead, { flex: 1, color: colors.secondaryLabel }]}>
                Kollegalista ligger på serveren og krever nett. Timene dine kan føres uansett.
              </Text>
            </View>
          </ListCard>
        ) : (
          <>
            <SectionHeader>{`${medlemmer.length} med på ordren`}</SectionHeader>
            <ListCard>
              {kollegaer.map((k, i) => {
                const med = medlemIder.has(k.id)
                const ansvarlig = order?.assignedTo === k.id
                return (
                  <Pressable
                    key={k.id}
                    haptic="light"
                    onPress={() => !ansvarlig && veksle(k)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                      borderBottomWidth: i === kollegaer.length - 1 ? 0 : 0.5,
                      borderBottomColor: colors.separator,
                      opacity: ansvarlig ? 0.6 : 1,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: radius.pill,
                      backgroundColor: med ? colors.brand : colors.fill,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={[t.footnote, { fontWeight: '700', color: med ? '#fff' : colors.secondaryLabel }]}>
                        {initialer(k.name) || '?'}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={t.body} numberOfLines={1}>{k.name || 'Uten navn'}</Text>
                      {ansvarlig && (
                        <Text style={[t.footnote, { marginTop: 1 }]}>Ansvarlig — alltid med</Text>
                      )}
                    </View>
                    {med && <Check size={19} color={colors.brand} strokeWidth={2.4} />}
                  </Pressable>
                )
              })}
            </ListCard>
          </>
        )}
      </ScrollView>
    </View>
  )
}

import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TextInput, TextStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Plus, Minus, Check, Search, ShoppingCart, Nfc } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Location } from '../../../lib/db/models/location'
import { Product } from '../../../lib/db/models/product'
import { StockMovement } from '../../../lib/db/models/stock-movement'
import { useLocationStock, formatQty } from '../../../lib/stock'
import { findOrCreateProductTag } from '../../../lib/nfc'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

type AddedItem = { key: string; name: string; qty: number }

/**
 * __DEV__-only: simuler en plukk-økt med enten NFC-tapp eller søk (i stedet for ekte
 * NFC-maskinvare, lib/nfc.ts). Tapp på NFC-ikonet legger varen rett i listen (antall 1) —
 * som et ekte tapp. Trykk på selve raden velger varen som «ventende» med en antall-steppe
 * og en hake for å bekrefte. Et nytt NFC-tapp mens noe venter, lagrer det ventende
 * automatisk først. Økten lukkes ikke mellom varer — du plukker flere før du trykker Ferdig.
 */
function NfcSimSheet({ onCommit, onClose }: { onCommit: (p: Product, qty: number) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [products, setProducts] = useState<Product[]>([])
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Product | null>(null)
  const [pendingQty, setPendingQty] = useState(1)
  const [added, setAdded] = useState<AddedItem[]>([])

  useEffect(() => {
    const sub = database.get<Product>('products').query().observe().subscribe(setProducts)
    return () => sub.unsubscribe()
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? products.filter(p => p.name.toLowerCase().includes(q) || (p.elnummer ?? '').toLowerCase().includes(q))
    : products

  function confirmPending() {
    if (!pending) return
    onCommit(pending, pendingQty)
    setAdded(a => [...a, { key: `${pending.id}-${a.length}`, name: pending.name, qty: pendingQty }])
    setPending(null)
    setPendingQty(1)
  }

  function tapNfc(p: Product) {
    if (pending) confirmPending()
    onCommit(p, 1)
    setAdded(a => [...a, { key: `${p.id}-${a.length}`, name: p.name, qty: 1 }])
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{
        backgroundColor: colors.bg, borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero,
        maxHeight: '85%', marginBottom: sizes.tabBar,
        paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.lg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.screen, marginBottom: spacing.sm }}>
          <Text style={t.headline}>Simuler NFC-tapp</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>Ferdig</Text>
          </Pressable>
        </View>

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
          marginHorizontal: spacing.screen, marginBottom: spacing.sm,
          backgroundColor: colors.fill, borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 40,
        }}>
          <Search size={16} color={colors.tertiaryLabel} strokeWidth={2} />
          <TextInput
            value={query} onChangeText={setQuery}
            placeholder="Søk navn eller el-nummer" placeholderTextColor={colors.tertiaryLabel}
            style={[t.body, { flex: 1 }]}
          />
        </View>

        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {filtered.map(p => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen }}>
              <Pressable haptic="light" onPress={() => { setPending(p); setPendingQty(1) }}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={t.body} numberOfLines={1}>{p.name}</Text>
                  {!!p.elnummer && <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${p.elnummer}`}</Text>}
                </View>
              </Pressable>
              <Pressable haptic="light" onPress={() => tapNfc(p)} hitSlop={8}
                style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Nfc size={16} color={colors.brand} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
          {filtered.length === 0 && (
            <Text style={[t.footnote, { marginHorizontal: spacing.screen }]}>Ingen varer funnet.</Text>
          )}
        </ScrollView>

        {pending && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            marginHorizontal: spacing.screen, marginTop: spacing.sm,
            backgroundColor: colors.brandSoft, borderRadius: radius.lg,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
          }}>
            <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{pending.name}</Text>
            <Pressable onPress={() => setPendingQty(v => Math.max(1, v - 1))} pressScale={0.9}
              style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Minus size={14} color={colors.label} strokeWidth={2.4} />
            </Pressable>
            <Text style={[t.bodyMedium, { minWidth: 20, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{pendingQty}</Text>
            <Pressable onPress={() => setPendingQty(v => v + 1)} pressScale={0.9}
              style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={14} color={colors.label} strokeWidth={2.4} />
            </Pressable>
            <Pressable haptic="medium" onPress={confirmPending} pressScale={0.9}
              style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}>
              <Check size={16} color={colors.ctaLabel} strokeWidth={2.6} />
            </Pressable>
          </View>
        )}

        {added.length > 0 && (
          <View style={{ marginHorizontal: spacing.screen, marginTop: spacing.md, maxHeight: 120 }}>
            <Text style={[t.footnote, { marginBottom: spacing.xs }]}>Lagt til nå</Text>
            <ScrollView>
              {added.map(a => (
                <View key={a.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 }}>
                  <Check size={13} color={colors.brand} strokeWidth={2.6} />
                  <Text style={[t.footnote, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                  <Text style={[t.footnote, { fontVariant: ['tabular-nums'] }]}>{a.qty}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  )
}

/** Reg.nr + tracker-IMEI for et bil-lager — lagres på blur. Klar for senere Teltonika-binding. */
function VehicleFieldsCard({ location }: { location: Location }) {
  const [regNr, setRegNr] = useState(location.regNr ?? '')
  const [trackerImei, setTrackerImei] = useState(location.trackerImei ?? '')

  async function save(nextRegNr: string, nextImei: string) {
    if (nextRegNr === (location.regNr ?? '') && nextImei === (location.trackerImei ?? '')) return
    await database.write(async () => {
      await location.update(l => {
        l.regNr = nextRegNr.trim() || null
        l.trackerImei = nextImei.trim() || null
      })
    })
    syncQuietly()
  }

  return (
    <>
      <SectionHeader>Kjøretøy</SectionHeader>
      <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden', marginBottom: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: colors.separator }}>
          <Text style={[t.body, { flex: 1 }]}>Reg.nr</Text>
          <TextInput
            value={regNr} onChangeText={setRegNr} onBlur={() => save(regNr, trackerImei)}
            autoCapitalize="characters" placeholder="AB 12345" placeholderTextColor={colors.tertiaryLabel}
            style={[t.body as TextStyle, { textAlign: 'right', minWidth: 120 }]}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
          <Text style={[t.body, { flex: 1 }]}>Tracker-IMEI</Text>
          <TextInput
            value={trackerImei} onChangeText={setTrackerImei} onBlur={() => save(regNr, trackerImei)}
            keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.tertiaryLabel}
            style={[t.body as TextStyle, { textAlign: 'right', minWidth: 120 }]}
          />
        </View>
      </View>
    </>
  )
}

export default function LocationDetailScreen() {
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [location, setLocation] = useState<Location | null>(null)
  const [showNfcSim, setShowNfcSim] = useState(false)
  const stock = useLocationStock(id ?? '')

  useEffect(() => {
    if (!id) return
    const sub = database.get<Location>('locations').findAndObserve(id).subscribe({
      next: setLocation,
      error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [id])

  /** Legger varen rett i handlekurven — brukes for både NFC-tapp og bekreftet søkevalg. */
  async function commitItem(product: Product, qty: number) {
    if (!location) return
    await findOrCreateProductTag(product) // holder tag-registeret oppdatert til ekte NFC senere
    await database.write(async () => {
      await database.get<StockMovement>('stock_movements').create(m => {
        m.productId = product.id
        m.locationId = location.id
        m.quantity = -qty
        m.kind = 'ut'
        m.orderId = null
        m.note = null
      })
    })
    syncQuietly()
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  if (!location) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>{location.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {location.type === 'lager' ? 'Sentrallager' : (location.regNr ? `Bil · ${location.regNr}` : 'Bil')}
          </Text>

          {location.type === 'lager' && (
            <Pressable
              haptic="medium"
              onPress={() => router.push({ pathname: '/(app)/lager/uttak', params: { locationId: location.id } })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, marginTop: spacing.lg,
              }}
            >
              <ShoppingCart size={sizes.icon} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.headline, { color: colors.ctaLabel }]}>Ta ut (handletur)</Text>
            </Pressable>
          )}

          {__DEV__ && location.type === 'lager' && (
            <Pressable
              haptic="light"
              onPress={() => setShowNfcSim(true)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 14, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm,
              }}
            >
              <Nfc size={sizes.icon - 2} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Simuler NFC-tapp (dev)</Text>
            </Pressable>
          )}
        </View>

        {location.type === 'bil' && <VehicleFieldsCard location={location} />}

        <SectionHeader>{stock.length > 0 ? `Beholdning · ${stock.length}` : 'Beholdning'}</SectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          {stock.map((line, i) => (
            <View
              key={line.product.id}
              style={[
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                i < stock.length && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={t.body} numberOfLines={1}>{line.product.name}</Text>
                {!!line.product.elnummer && (
                  <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${line.product.elnummer}`}</Text>
                )}
              </View>
              <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>
                {`${formatQty(line.qty)} ${line.product.unit}`}
              </Text>
            </View>
          ))}
          <Pressable
            onPress={() => router.push({ pathname: '/(app)/lager/bevegelse', params: { locationId: location.id } })}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}
          >
            <View style={{
              width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
            }}>
              <Plus size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>Legg til / juster</Text>
          </Pressable>
        </View>

        {stock.length === 0 && (
          <Text style={[t.caption, { marginHorizontal: spacing.screen + spacing.lg, marginTop: spacing.sm }]}>
            Ingen beholdning ennå. Legg til varer, eller la bestillinger og forbruk fylle den.
          </Text>
        )}
      </ScrollView>

      {showNfcSim && <NfcSimSheet onCommit={commitItem} onClose={() => setShowNfcSim(false)} />}
    </View>
  )
}

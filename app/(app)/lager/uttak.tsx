import { useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import * as Haptics from 'expo-haptics'
import { Pressable } from '../../../components/pressable'
import { ToolChip, ToolGlow, useMorkStatuslinje } from '../../../components/tool-surface'
import { ProductPicker } from '../../../components/product-picker'
import { finnEllerOpprettVare } from '../../../lib/products'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Product } from '../../../lib/db/models/product'
import { StockMovement } from '../../../lib/db/models/stock-movement'
import { colors, spacing, radius, sizes, toolType as t } from '../../../lib/theme'

const UNITS = ['stk', 'm', 'pk', 'rull', 'sett']

/**
 * Ta ut fra lager → handlekurv (stand-in for NFC-skann). Trekker fra lageret nå,
 * lander som uplassert uttak i kurven. Blir liggende åpen for flere uttak.
 */
export default function UttakScreen() {
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  useMorkStatuslinje()
  const { locationId } = useLocalSearchParams<{ locationId: string }>()
  const [name, setName] = useState('')
  const [elnummer, setElnummer] = useState('')
  const [unit, setUnit] = useState('stk')
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [soker, setSoker] = useState(true)

  const qty = parseFloat(quantity.replace(',', '.'))
  const canAdd = name.trim().length > 0 && qty > 0 && !busy

  function velgVare(p: Product) {
    setName(p.name)
    setElnummer(p.elnummer ?? '')
    setUnit(p.unit)
    setSoker(false)
  }

  function nyVare(sok: string) {
    setName(sok)
    setSoker(false)
  }

  /** Legg til i kurv; hold modalen åpen for neste uttak (flere om gangen). */
  async function addAnother() {
    if (!canAdd || !locationId) return
    setBusy(true)
    const product = await finnEllerOpprettVare({ navn: name, elnummer, enhet: unit })
    await database.write(async () => {
      await database.get<StockMovement>('stock_movements').create(m => {
        m.productId = product.id
        m.locationId = locationId
        m.quantity = -qty          // ut fra lager
        m.kind = 'ut'
        m.orderId = null           // uplassert → i handlekurven
        m.note = null
      })
    })
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    syncQuietly()
    setName(''); setElnummer(''); setQuantity('1'); setSoker(true)
    setBusy(false)
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.toolBg }}>
      <ToolGlow />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.toolSecondary }]}>Ferdig</Text>
        </Pressable>
        <Text style={t.headline}>Ta ut</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginBottom: spacing.md }]}>
          Legg til flere om gangen — de samles i handlekurven, som du plasserer på en ordre etterpå.
        </Text>

        {soker ? (
          <View style={{ marginHorizontal: spacing.screen }}>
            <ProductPicker onVelg={velgVare} onNy={nyVare} autoFocus />
          </View>
        ) : (
          <>
        <View style={{ backgroundColor: colors.toolRaised, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <TextInput
            value={name} onChangeText={setName}
            placeholder="Vare (påkrevd)" placeholderTextColor={colors.toolTertiary} autoFocus
            style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.toolBorder }]}
          />
          <TextInput
            value={elnummer} onChangeText={setElnummer}
            placeholder="El-nummer (valgfritt)" placeholderTextColor={colors.toolTertiary} keyboardType="number-pad"
            style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
          />
        </View>
          <Pressable
            onPress={() => setSoker(true)}
            style={{ paddingHorizontal: spacing.screen + spacing.lg, paddingTop: spacing.md }}
          >
            <Text style={[t.subhead, { color: colors.brand }]}>Søk i varer i stedet</Text>
          </Pressable>

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          backgroundColor: colors.toolRaised, borderRadius: radius.lg,
          marginHorizontal: spacing.screen, marginTop: spacing.md,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        }}>
          <Text style={[t.body, { flex: 1 }]}>Antall</Text>
          <TextInput
            value={quantity} onChangeText={setQuantity}
            keyboardType="decimal-pad" selectTextOnFocus
            style={[t.body as TextStyle, { minWidth: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
          />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.screen, marginTop: spacing.md }}>
          {UNITS.map(u => (
            <ToolChip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>

        <Pressable
          haptic="medium" onPress={addAnother} disabled={!canAdd}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
            alignItems: 'center', justifyContent: 'center',
            marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canAdd ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>Legg i handlekurv</Text>
        </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

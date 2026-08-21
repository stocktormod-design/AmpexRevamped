import { useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Pressable } from '../../../components/pressable'
import { ToolChip, ToolGlow, useMorkStatuslinje } from '../../../components/tool-surface'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Product } from '../../../lib/db/models/product'
import { StockMovement } from '../../../lib/db/models/stock-movement'
import { colors, spacing, radius, sizes, toolType as t } from '../../../lib/theme'

const UNITS = ['stk', 'm', 'pk', 'rull', 'sett']

/**
 * Legg til / juster beholdning på en lokasjon. Finner eksisterende vare på
 * el-nummer (ellers navn) og gjenbruker den — så beholdning aggregerer riktig —
 * eller oppretter en ny. Skriver én bevegelse.
 */
export default function BevegelseScreen() {
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  useMorkStatuslinje()
  const { locationId } = useLocalSearchParams<{ locationId: string }>()
  const [name, setName] = useState('')
  const [elnummer, setElnummer] = useState('')
  const [unit, setUnit] = useState('stk')
  const [quantity, setQuantity] = useState('1')
  const [direction, setDirection] = useState<'inn' | 'ut'>('inn')
  const [saving, setSaving] = useState(false)

  const qty = parseFloat(quantity.replace(',', '.'))
  const canSave = name.trim().length > 0 && qty > 0 && !saving

  async function findOrCreateProduct(): Promise<Product> {
    const el = elnummer.trim()
    const collection = database.get<Product>('products')
    if (el) {
      const [byEl] = await collection.query(Q.where('elnummer', el)).fetch()
      if (byEl) return byEl
    }
    const [byName] = await collection.query(Q.where('name', name.trim())).fetch()
    if (byName) return byName
    return collection.create(p => {
      p.name = name.trim()
      p.elnummer = el || null
      p.unit = unit
    })
  }

  async function save() {
    if (!canSave || !locationId) return
    setSaving(true)
    const signed = direction === 'inn' ? qty : -qty
    await database.write(async () => {
      const product = await findOrCreateProduct()
      await database.get<StockMovement>('stock_movements').create(m => {
        m.productId = product.id
        m.locationId = locationId
        m.quantity = signed
        m.kind = direction === 'inn' ? 'inn' : 'justering'
        m.orderId = null
        m.note = null
      })
    })
    syncQuietly()
    router.dismiss()
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.toolBg }}>
      <ToolGlow />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.toolSecondary }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Beholdning</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginBottom: spacing.md }}>
          <ToolChip label="Legg til" selected={direction === 'inn'} onPress={() => setDirection('inn')} />
          <ToolChip label="Trekk fra" selected={direction === 'ut'} onPress={() => setDirection('ut')} />
        </View>

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
          haptic="medium" onPress={save} disabled={!canSave}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
            alignItems: 'center', justifyContent: 'center',
            marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canSave ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>
            {direction === 'inn' ? 'Legg til' : 'Trekk fra'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

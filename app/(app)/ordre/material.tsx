import { useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { Chip } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { OrderMaterial } from '../../../lib/db/models/order-material'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const UNITS = ['stk', 'm', 'pk', 'rull', 'sett']

/** Legg til en materiell-linje på ordren (modal). elnummer valgfritt i v1. */
export default function MaterialScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>()
  const [description, setDescription] = useState('')
  const [elnummer, setElnummer] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('stk')
  const [saving, setSaving] = useState(false)

  const qty = parseFloat(quantity.replace(',', '.'))
  const canSave = description.trim().length > 0 && qty > 0 && !saving

  async function add() {
    if (!canSave || !orderId) return
    setSaving(true)
    await database.write(async () =>
      database.get<OrderMaterial>('order_materials').create(m => {
        m.orderId = orderId
        m.description = description.trim()
        m.elnummer = elnummer.trim() || null
        m.quantity = qty
        m.unit = unit
      }),
    )
    syncQuietly()
    router.dismiss()
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingVertical: spacing.lg,
      }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Materiell</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <TextInput
            value={description} onChangeText={setDescription}
            placeholder="Beskrivelse (påkrevd)" placeholderTextColor={colors.tertiaryLabel} autoFocus
            style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}
          />
          <TextInput
            value={elnummer} onChangeText={setElnummer}
            placeholder="El-nummer (valgfritt)" placeholderTextColor={colors.tertiaryLabel} keyboardType="number-pad"
            style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
          />
        </View>

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          backgroundColor: colors.bg, borderRadius: radius.lg,
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
            <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>

        <Pressable
          haptic="medium" onPress={add} disabled={!canSave}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
            alignItems: 'center', justifyContent: 'center',
            marginHorizontal: spacing.screen, marginTop: spacing.xl, opacity: canSave ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>Legg til</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

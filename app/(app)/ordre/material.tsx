import { useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { Chip } from '../../../components/ui'
import { ProductPicker } from '../../../components/product-picker'
import { Product } from '../../../lib/db/models/product'
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
  const [pris, setPris] = useState('')
  // Vare valgt fra søket. Null = fritekstlinje, som fortsatt er lov.
  const [vare, setVare] = useState<Product | null>(null)
  const [soker, setSoker] = useState(true)
  const [saving, setSaving] = useState(false)

  const qty = parseFloat(quantity.replace(',', '.'))
  const prisRaa = parseFloat(pris.replace(',', '.'))
  const prisTall = Number.isFinite(prisRaa) && prisRaa >= 0 ? prisRaa : null
  const canSave = description.trim().length > 0 && qty > 0 && !saving


  function velgVare(p: Product) {
    setVare(p)
    setDescription(p.name)
    setElnummer(p.elnummer ?? '')
    setUnit(p.unit)
    if (p.unitPrice != null) setPris(String(p.unitPrice))
    setSoker(false)
  }

  function nyVare(navn: string) {
    setVare(null)
    setDescription(navn)
    setSoker(false)
  }

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
        // Tom pris lagres som null, ikke 0. Null betyr «ikke satt» og dukker opp
        // som mangel på fakturagrunnlaget; 0 ville betydd «gratis» og forsvunnet.
        m.unitPrice = prisTall
        m.vatType = vare?.vatType ?? 'hoy'
        // Kobling til varen gjør dekningsbidraget mulig å regne ut, og lar
        // prisen spores tilbake til grossistfila den kom fra.
        m.productId = vare?.id ?? null
        m.costPrice = vare?.costPrice ?? null
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
        {soker ? (
          <View style={{ marginHorizontal: spacing.screen }}>
            <ProductPicker onVelg={velgVare} onNy={nyVare} autoFocus />
          </View>
        ) : (
          <>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              <TextInput
                value={description} onChangeText={setDescription}
                placeholder="Beskrivelse (påkrevd)" placeholderTextColor={colors.tertiaryLabel} autoFocus={!vare}
                style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}
              />
              <TextInput
                value={elnummer} onChangeText={setElnummer}
                placeholder="El-nummer (valgfritt)" placeholderTextColor={colors.tertiaryLabel} keyboardType="number-pad"
                style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
              />
            </View>
            <Pressable
              onPress={() => { setSoker(true); setVare(null) }}
              style={{ paddingHorizontal: spacing.screen + spacing.lg, paddingTop: spacing.md }}
            >
              <Text style={[t.subhead, { color: colors.brand }]}>Søk i varer i stedet</Text>
            </Pressable>
          </>
        )}

        {!soker && (
        <>
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

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          backgroundColor: colors.bg, borderRadius: radius.lg,
          marginHorizontal: spacing.screen, marginTop: spacing.md,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        }}>
          <Text style={[t.body, { flex: 1 }]}>Pris per {unit}</Text>
          <TextInput
            value={pris} onChangeText={setPris}
            placeholder="—" placeholderTextColor={colors.tertiaryLabel}
            keyboardType="decimal-pad" selectTextOnFocus
            style={[t.body as TextStyle, { minWidth: 72, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
          />
          <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>kr</Text>
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
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

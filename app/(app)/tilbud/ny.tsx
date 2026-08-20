import { useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Check, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { useKunder } from '../../../lib/customers'
import { Customer } from '../../../lib/db/models/customer'
import { opprettTilbud, standardGyldighet, GYLDIGHET_DAGER } from '../../../lib/quotes'
import { formatDate } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/** Gyldighet i dager. 30 er normalen i faget; 7 for hastejobber, 60 for større anlegg. */
const GYLDIGHET_VALG = [7, 14, GYLDIGHET_DAGER, 60]

export default function NyttTilbud() {
  const insets = useSafeAreaInsets()
  const [tittel, setTittel] = useState('')
  const [sok, setSok] = useState('')
  const [kunde, setKunde] = useState<Customer | null>(null)
  const [dager, setDager] = useState(GYLDIGHET_DAGER)
  const [busy, setBusy] = useState(false)
  const kunder = useKunder(sok)

  const kanOpprette = !!tittel.trim() && !busy

  async function opprett() {
    if (!kanOpprette) return
    setBusy(true)
    try {
      const id = await opprettTilbud({
        title: tittel,
        customerId: kunde?.id ?? null,
        validUntil: new Date(Date.now() + dager * 24 * 60 * 60 * 1000),
      })
      router.replace({ pathname: '/(app)/tilbud/[id]', params: { id } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm,
      }}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Nytt tilbud</Text>
        <Pressable hitSlop={8} onPress={opprett} disabled={!kanOpprette}>
          <Text style={[t.body, { color: kanOpprette ? colors.brand : colors.tertiaryLabel, fontWeight: '600' }]}>Opprett</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={tittel} onChangeText={setTittel} autoFocus
          placeholder="Hva gjelder det? F.eks. Nytt sikringsskap"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.title3, {
            backgroundColor: colors.bg, borderRadius: radius.lg,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }]}
        />

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
          Gyldig i
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {GYLDIGHET_VALG.map(d => {
            const aktiv = dager === d
            return (
              <Pressable key={d} haptic="light" onPress={() => setDager(d)}
                style={{
                  flex: 1, paddingVertical: spacing.md, borderRadius: radius.lg,
                  backgroundColor: aktiv ? colors.label : colors.bg, alignItems: 'center',
                }}>
                <Text style={[t.subhead, { fontWeight: '600', color: aktiv ? colors.bg : colors.secondaryLabel }]}>
                  {`${d} d`}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={[t.footnote, { marginTop: spacing.xs, marginLeft: spacing.xs }]}>
          {/* Fristen er ikke pynt: den er grunnen til at kunden svarer. */}
          {`Utløper ${formatDate(new Date(Date.now() + dager * 24 * 60 * 60 * 1000))}`}
        </Text>

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
          Kunde
        </Text>
        <TextInput
          value={sok} onChangeText={setSok}
          placeholder="Søk i kunderegisteret"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, marginBottom: spacing.sm,
          }]}
        />
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, overflow: 'hidden' }}>
          {kunder.slice(0, 12).map((k, i, arr) => {
            const valgt = kunde?.id === k.id
            return (
              <Pressable key={k.id} haptic="light"
                onPress={() => setKunde(valgt ? null : k)}
                style={[
                  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
                  i < arr.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                ]}>
                <View style={{ flex: 1 }}>
                  <Text style={t.body} numberOfLines={1}>{k.name}</Text>
                  {!!k.postalAddress && (
                    <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]} numberOfLines={1}>
                      {k.postalAddress}
                    </Text>
                  )}
                </View>
                {valgt && <Check size={18} color={colors.brand} strokeWidth={2.4} />}
              </Pressable>
            )
          })}
          {kunder.length === 0 && (
            <Pressable haptic="light" onPress={() => router.push('/(app)/kunder/ny')}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
              <Text style={[t.body, { flex: 1, color: colors.secondaryLabel }]}>
                {sok.trim() ? 'Ingen treff — opprett kunde' : 'Kunderegisteret er tomt — opprett kunde'}
              </Text>
              <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
          )}
        </View>
        <Text style={[t.footnote, { marginTop: spacing.xs, marginLeft: spacing.xs }]}>
          Kunden kan settes senere, men uten kunde kan tilbudet ikke sendes.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

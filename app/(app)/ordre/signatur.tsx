import { useEffect, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Trash2 } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { SignaturePad, SignaturVisning } from '../../../components/signature-pad'
import { database } from '../../../lib/db'
import { Order } from '../../../lib/db/models/order'
import { OrderExtra } from '../../../lib/db/models/order-extra'
import {
  formalLabel, formalForklaring,
  type SignaturFormal, type SignaturStrok,
} from '../../../lib/db/models/order-signature'
import { lagreSignatur, slettSignatur, useSignaturer } from '../../../lib/signatures'
import { formatDateTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

const PAD_HOYDE = 200

/**
 * Kundesignatur.
 *
 * Beviset når noe bestrides. Tre ting må stå sammen for at den skal være verdt
 * noe: HVA som bekreftes (formålet), HVEM som skrev under (navn, ikke bare en
 * krusedull) og NÅR. Navnet er derfor påkrevd — en signatur uten navn er en
 * strek.
 */
export default function SignaturScreen() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { id, extraId } = useLocalSearchParams<{ id: string; extraId?: string }>()

  const [order, setOrder] = useState<Order | null>(null)
  const [tillegg, setTillegg] = useState<OrderExtra | null>(null)
  const [formal, setFormal] = useState<SignaturFormal>(extraId ? 'tillegg' : 'ferdig')
  const [navn, setNavn] = useState('')
  const [tittel, setTittel] = useState('')
  const [notat, setNotat] = useState('')
  const [strokes, setStrokes] = useState<SignaturStrok[]>([])
  const [bredde, setBredde] = useState(0)
  const [busy, setBusy] = useState(false)
  const signaturer = useSignaturer(id)

  useEffect(() => {
    if (!id) return
    let montert = true
    database.get<Order>('orders').find(id).then(o => {
      if (!montert) return
      setOrder(o)
      // Kundenavnet er nesten alltid riktig utgangspunkt — men det er den som
      // faktisk står der som skal skrive under, så feltet kan overskrives.
      setNavn(prev => prev || o.customerName || '')
    }).catch(() => router.back())
    return () => { montert = false }
  }, [id])

  useEffect(() => {
    if (!extraId) return
    let montert = true
    database.get<OrderExtra>('order_extras').find(extraId)
      .then(e => { if (montert) setTillegg(e) })
      .catch(() => {})
    return () => { montert = false }
  }, [extraId])

  const kanLagre = !!navn.trim() && strokes.length > 0 && !busy

  async function lagre() {
    if (!kanLagre || !id) return
    setBusy(true)
    try {
      await lagreSignatur({
        orderId: id,
        purpose: formal,
        signerName: navn,
        signerTitle: tittel,
        strokes,
        aspect: bredde > 0 ? bredde / PAD_HOYDE : 2,
        note: notat,
        extraId: extraId ?? null,
      })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      router.back()
    } finally {
      setBusy(false)
    }
  }

  const formaler: SignaturFormal[] = extraId ? ['tillegg'] : ['ferdig', 'overtakelse', 'annet']

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paperCanvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.paperBg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>Signatur</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {tillegg ? `Tilleggsarbeid: ${tillegg.title}` : order?.title ?? ''}
          </Text>
        </View>

        {/* Hva som bekreftes */}
        <View style={{ paddingHorizontal: spacing.screen }}>
          <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
            Hva bekreftes
          </Text>
          <View style={{ gap: spacing.sm }}>
            {formaler.map(f => {
              const aktiv = formal === f
              return (
                <Pressable key={f} haptic="light" onPress={() => setFormal(f)}
                  style={{
                    backgroundColor: aktiv ? colors.brandSoft : colors.paperBg,
                    borderRadius: radius.lg, padding: spacing.lg,
                    borderWidth: 1, borderColor: aktiv ? colors.brand : 'transparent',
                  }}>
                  <Text style={[t.bodyMedium, aktiv && { color: colors.brand }]}>{formalLabel[f]}</Text>
                  <Text style={[t.footnote, { marginTop: 2 }]}>{formalForklaring[f]}</Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
            Hvem signerer
          </Text>
          <TextInput
            value={navn} onChangeText={setNavn}
            placeholder="Navn på den som skriver under"
            placeholderTextColor={colors.paperTertiary}
            style={[t.body, { backgroundColor: colors.paperBg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
          />
          <TextInput
            value={tittel} onChangeText={setTittel}
            placeholder="Rolle (valgfritt) — f.eks. eier, styreleder, driftsleder"
            placeholderTextColor={colors.paperTertiary}
            style={[t.body, { backgroundColor: colors.paperBg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.sm }]}
          />

          <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
            Signatur
          </Text>
          <View onLayout={e => setBredde(e.nativeEvent.layout.width)}>
            <SignaturePad strokes={strokes} onChange={setStrokes} height={PAD_HOYDE} />
          </View>

          <TextInput
            value={notat} onChangeText={setNotat} multiline
            placeholder="Merknad (valgfritt) — forbehold eller avtale som ikke står andre steder"
            placeholderTextColor={colors.paperTertiary}
            style={[t.body, {
              backgroundColor: colors.paperBg, borderRadius: radius.lg,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
              marginTop: spacing.lg, minHeight: 72, textAlignVertical: 'top',
            }]}
          />

          <Pressable haptic="medium" onPress={lagre} disabled={!kanLagre}
            style={{
              height: sizes.ctaHeight, borderRadius: radius.xl,
              backgroundColor: kanLagre ? colors.brand : colors.paperFill,
              alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg,
            }}>
            <Text style={[t.headline, { color: kanLagre ? colors.brandLabel : colors.paperTertiary }]}>Lagre signatur</Text>
          </Pressable>
          {!kanLagre && !busy && (
            <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.sm }]}>
              {!navn.trim() ? 'Navn må fylles ut — en signatur uten navn er en strek.' : 'Signer i feltet over.'}
            </Text>
          )}
        </View>

        {/* Tidligere signaturer på ordren */}
        {signaturer.length > 0 && (
          <View style={{ marginTop: spacing.xxl }}>
            <SectionHeader tone="papir">Signert tidligere</SectionHeader>
            <View style={{ marginHorizontal: spacing.screen, gap: spacing.sm }}>
              {signaturer.map(s => (
                <View key={s.id} style={{ backgroundColor: colors.paperBg, borderRadius: radius.lg, padding: spacing.lg }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={t.bodyMedium}>{s.signerName}</Text>
                      <Text style={[t.footnote, { marginTop: 1 }]}>
                        {[s.signerTitle, formalLabel[s.purpose], formatDateTime(s.signedAt)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Pressable hitSlop={8} haptic="light" onPress={() => slettSignatur(s)}>
                      <Trash2 size={16} color={colors.paperTertiary} strokeWidth={2} />
                    </Pressable>
                  </View>
                  {bredde > 0 && (
                    <View style={{ marginTop: spacing.sm }}>
                      <SignaturVisning strokes={s.punkter} aspect={s.aspect} width={bredde - spacing.lg * 2} />
                    </View>
                  )}
                  {!!s.note && <Text style={[t.footnote, { marginTop: spacing.xs }]}>{s.note}</Text>}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

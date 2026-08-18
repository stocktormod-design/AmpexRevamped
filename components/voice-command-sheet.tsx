import { useEffect, useState } from 'react'
import { View, Text, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pressable } from './pressable'
import { speak } from '../lib/ai/voice-speaker'
import { orderStatusLabel } from '../lib/db/models/order'
import type { OrderLookupOutcome } from '../lib/ai/order-lookup'
import { colors, spacing, radius, sizes, shadows, type as t } from '../lib/theme'

/**
 * Bekreftelse før navigering til en ordre funnet ved tale — aldri stille
 * navigering (bulletproof-krav). Leser svaret høyt idet det vises.
 */
export function VoiceCommandSheet({ outcome, onConfirm, onClose, onManualLookup }: {
  outcome: OrderLookupOutcome
  onConfirm: () => void
  onClose: () => void
  onManualLookup: (orderNumber: number) => void
}) {
  const insets = useSafeAreaInsets()
  const [manualInput, setManualInput] = useState('')

  useEffect(() => {
    // Tom spokenReply = utfallet kom fra en Live-økt der modellen allerede har svart muntlig.
    if ((outcome.kind === 'found' || outcome.kind === 'not_found') && outcome.spokenReply) speak(outcome.spokenReply)
  }, [outcome])

  function submitManual() {
    const n = parseInt(manualInput, 10)
    if (!Number.isNaN(n)) onManualLookup(n)
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      <Pressable haptic="none" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />

      <View
        style={[
          {
            position: 'absolute', left: spacing.screen, right: spacing.screen,
            top: insets.top + spacing.xxxl * 2, backgroundColor: colors.bg, borderRadius: radius.hero,
            padding: spacing.xl,
          },
          shadows.floating,
        ]}
      >
        {outcome.kind === 'found' && (
          <>
            <Text style={t.headline}>{`Mener du ordre ${outcome.orderNumber}?`}</Text>
            <Text style={[t.body, { marginTop: spacing.sm }]} numberOfLines={2}>{outcome.order.title}</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs }]}>
              {[outcome.order.customerName, orderStatusLabel[outcome.order.status]].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
              <Pressable
                haptic="light" onPress={onClose}
                style={{ flex: 1, height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[t.headline, { color: colors.label }]}>Nei</Text>
              </Pressable>
              <Pressable
                haptic="medium" onPress={onConfirm}
                style={{ flex: 1, height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[t.headline, { color: colors.ctaLabel }]}>Ja</Text>
              </Pressable>
            </View>
          </>
        )}

        {outcome.kind === 'not_found' && (
          <>
            <Text style={t.headline}>
              {outcome.orderNumber ? `Fant ikke ordre ${outcome.orderNumber}` : 'Oppfattet ikke ordrenummeret'}
            </Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>Skriv nummeret manuelt i stedet:</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                value={manualInput}
                onChangeText={setManualInput}
                keyboardType="number-pad"
                placeholder="Ordrenummer"
                placeholderTextColor={colors.tertiaryLabel}
                autoFocus
                style={[t.body, {
                  flex: 1, backgroundColor: colors.canvas, borderRadius: radius.lg,
                  paddingHorizontal: spacing.lg, height: sizes.ctaHeight,
                }]}
              />
              <Pressable
                haptic="medium" onPress={submitManual}
                style={{ paddingHorizontal: spacing.xl, height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={[t.headline, { color: colors.ctaLabel }]}>Søk</Text>
              </Pressable>
            </View>
          </>
        )}

        {(outcome.kind === 'other_intent' || outcome.kind === 'failed') && (
          <>
            <Text style={t.headline}>
              {outcome.kind === 'failed' ? 'Fikk ikke kontakt' : 'Oppfattet ikke kommandoen'}
            </Text>
            <Text style={[t.footnote, { marginTop: spacing.xs }]}>
              {outcome.kind === 'failed' ? 'Prøv igjen om litt.' : 'Prøv å si det litt annerledes.'}
            </Text>
            <Pressable
              haptic="light" onPress={onClose}
              style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg }}
            >
              <Text style={[t.headline, { color: colors.label }]}>Lukk</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

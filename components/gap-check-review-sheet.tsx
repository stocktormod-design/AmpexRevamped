import { useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { Pressable } from './pressable'
import { SectionHeader } from './ui'
import { FormFieldView } from './form-field-view'
import type { FormTemplate, FormValues } from '../lib/forms/types'
import { visibleSections, pruneHidden } from '../lib/forms/visibility'
import type { GapCheckExtraction } from '../lib/forms/gap-check'
import type { AiFieldOriginMap } from '../lib/db/models/order-document'
import { colors, spacing, radius, sizes, shadows, type as t } from '../lib/theme'

function AiSuggestedBadge() {
  return (
    <View style={{
      alignSelf: 'flex-start', marginLeft: spacing.lg, marginTop: spacing.sm,
      paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill,
      backgroundColor: colors.brandSoft,
    }}>
      <Text style={[t.caption, { color: colors.brand }]}>AI-foreslått</Text>
    </View>
  )
}

/**
 * Gjennomgang av ett gap-check-forslag — compliance-kritisk steg (aldri tale, alltid
 * skjerm). Redigering av et AI-foreslått felt fjerner "AI-foreslått"-merket for det
 * feltet. Skriver ALDRI til OrderDocument selv — kun onConfirm gir skjema.tsx data
 * tilbake for lagring, med status fortsatt 'utkast' (aldri 'fullfort').
 */
export function GapCheckReviewSheet({ template, baseValues, extraction, onConfirm, onRecordMore, onDiscard }: {
  template: FormTemplate
  baseValues: FormValues
  extraction: GapCheckExtraction
  onConfirm: (values: FormValues, aiOrigin: AiFieldOriginMap) => void
  /** Lagrer det som er svart så langt (samme som onConfirm) og starter en ny opptaksrunde. */
  onRecordMore: (values: FormValues, aiOrigin: AiFieldOriginMap) => void
  onDiscard: () => void
}) {
  const insets = useSafeAreaInsets()

  const [values, setValues] = useState<FormValues>(() => ({
    ...baseValues,
    ...Object.fromEntries(extraction.extracted.map(e => [e.key, e.value])),
  }))
  const [origin, setOrigin] = useState<AiFieldOriginMap>(() =>
    Object.fromEntries(extraction.extracted.map(e => [e.key, { origin: 'ai' as const, reason: e.reason }])),
  )

  function onFieldEdit(key: string, v: string | Record<string, string>[]) {
    // Samme rydding som i skjema-skjermen: et svar som nettopp ble skjult skal
    // ikke bli med videre til onConfirm.
    setValues(prev => pruneHidden(template, { ...prev, [key]: v }))
    setOrigin(prev => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      <Pressable haptic="none" onPress={onDiscard} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />

      <View
        style={[
          {
            position: 'absolute', left: spacing.sm, right: spacing.sm,
            top: insets.top + spacing.xxl, bottom: insets.bottom + spacing.sm,
            backgroundColor: colors.bg, borderRadius: radius.hero, overflow: 'hidden',
          },
          shadows.floating,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
          <Text style={t.headline}>Gjennomgang</Text>
          <Pressable onPress={onDiscard} pressScale={0.92} style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>

        {!!extraction.transcript && (
          <View style={{ backgroundColor: colors.fillPressed, borderRadius: radius.md, marginHorizontal: spacing.screen, marginBottom: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
            <Text style={t.footnote}>{`"${extraction.transcript}"`}</Text>
          </View>
        )}

        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          {visibleSections(template, values).map(section => (
            <View key={section.title} style={{ marginBottom: spacing.screen }}>
              <SectionHeader>{section.title}</SectionHeader>
              <View style={{ backgroundColor: colors.fill, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
                {section.fields.map((f, i) => (
                  <View key={f.key} style={i < section.fields.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator }}>
                    {origin[f.key]?.origin === 'ai' && <AiSuggestedBadge />}
                    <FormFieldView field={f} value={values[f.key]} onChange={v => onFieldEdit(f.key, v)} readOnly={false} />
                    {origin[f.key]?.origin === 'ai' && !!origin[f.key].reason && (
                      <Text style={[t.caption, { paddingHorizontal: spacing.lg, marginTop: -spacing.sm, marginBottom: spacing.sm }]}>
                        {origin[f.key].reason}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}

          {extraction.stillMissing.length > 0 && (
            <View style={{ marginHorizontal: spacing.screen, marginBottom: spacing.screen }}>
              <SectionHeader>Fortsatt ubesvart</SectionHeader>
              <View style={{ backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: spacing.lg }}>
                {extraction.stillMissing.map(m => (
                  <Text key={m.key} style={[t.subhead, { marginBottom: spacing.xs }]}>{`• ${m.followUpQuestion}`}</Text>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={{ padding: spacing.screen, paddingTop: spacing.sm, gap: spacing.sm }}>
          {extraction.stillMissing.length > 0 && (
            <Pressable
              haptic="medium" onPress={() => onRecordMore(values, origin)}
              style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={[t.headline, { color: colors.label }]}>Ta opp mer</Text>
            </Pressable>
          )}
          <Pressable
            haptic="medium" onPress={() => onConfirm(values, origin)}
            style={{ height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Bruk disse svarene</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

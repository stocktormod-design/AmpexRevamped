import { useMemo, useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { router } from 'expo-router'
import { FileUp, Sparkles, Wand2, AlertTriangle, ChevronDown, ChevronRight, FileText } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionsEditor } from '../../../components/form-fields-editor'
import { FormProblems } from '../../../components/form-problems'
import { createTemplate } from '../../../lib/forms'
import { validateFirmSections } from '../../../lib/forms/firm-schema'
import { IMPORT_KATEGORIER, oppsummer, type Importresultat } from '../../../lib/forms/import'
import { lesSkjemafil, velgSkjemafil, type Valgtfil } from '../../../lib/forms/import-fil'
import type { FormSection } from '../../../lib/db/models/form-template'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/**
 * Importer firmaets eget skjema — PDF eller bilde → redigerbar mal.
 *
 * Modellen LAGRER ingenting. Den lager et utkast, og et menneske går gjennom
 * det før det blir en mal. Det er ikke forsiktighet for forsiktighetens skyld:
 * en publisert mal går rett ut til montører som bruker den som dokumentasjon,
 * og et punkt som ble lest feil blir et hull i papirene på en jobb.
 *
 * Derfor er gjennomgangen bygget rundt tre spørsmål, i den rekkefølgen:
 *   1. Hva så den?           — kildekort med modellens egen merknad
 *   2. Hva er den usikker på? — merket PÅ punktet, ikke i en liste på toppen
 *   3. Hva rettet den selv?   — sammenslått, åpnes hvis du vil vite
 * Resten er den vanlige skjemaredigeringen, uendret. Ingen ny redigeringsflate
 * å lære.
 */
type Steg = 'velg' | 'leser' | 'gjennomgang'

export default function ImporterSkjema() {
  const insets = useSafeAreaInsets()
  const [steg, setSteg] = useState<Steg>('velg')
  const [fil, setFil] = useState<Valgtfil | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [res, setRes] = useState<Importresultat | null>(null)

  const [tittel, setTittel] = useState('')
  const [kategori, setKategori] = useState('Sluttkontroll')
  const [seksjoner, setSeksjoner] = useState<FormSection[]>([])
  const [visRettelser, setVisRettelser] = useState(false)
  const [lagrer, setLagrer] = useState(false)

  const problemer = useMemo(() => validateFirmSections(seksjoner), [seksjoner])
  const kanLagre = !!tittel.trim() && seksjoner.length > 0 && problemer.length === 0 && !lagrer

  async function velgOgLes() {
    setFeil(null)
    const valgt = await velgSkjemafil()
    if (!valgt) return
    setFil(valgt)
    setSteg('leser')
    const svar = await lesSkjemafil(valgt)
    if (!svar.ok) {
      setFeil(svar.feil)
      setSteg('velg')
      return
    }
    setRes(svar.resultat)
    setTittel(svar.resultat.tittel)
    setKategori(svar.resultat.kategori)
    setSeksjoner(svar.resultat.seksjoner)
    setSteg('gjennomgang')
  }

  async function lagre() {
    if (!kanLagre) return
    setLagrer(true)
    try {
      const id = await createTemplate({ title: tittel, category: kategori, sections: seksjoner })
      router.replace({ pathname: '/(app)/skjema/[id]', params: { id } })
    } finally {
      setLagrer(false)
    }
  }

  const sum = res ? oppsummer(res) : null
  // Usikkerhetsmerkene følger punktet, ikke posisjonen: sletter du et punkt i
  // gjennomgangen skal ikke merket hoppe over på nabopunktet.
  const flagg = res?.usikre ?? {}

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm }}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>{steg === 'gjennomgang' ? 'Gjennomgang' : 'Importer skjema'}</Text>
        {steg === 'gjennomgang' ? (
          <Pressable hitSlop={8} onPress={lagre} disabled={!kanLagre}>
            <Text style={[t.body, { color: kanLagre ? colors.brand : colors.tertiaryLabel, fontWeight: '600' }]}>Lagre</Text>
          </Pressable>
        ) : (
          <View style={{ width: 48 }} />
        )}
      </View>

      {steg === 'velg' && (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}>
          <Animated.View entering={FadeInDown.springify()}>
            <View style={{ alignItems: 'center', paddingTop: spacing.xl }}>
              <View style={{ width: 72, height: 72, borderRadius: radius.pill, backgroundColor: colors.brandWash, alignItems: 'center', justifyContent: 'center' }}>
                <FileUp size={32} color={colors.brand} strokeWidth={1.7} />
              </View>
              <Text style={[t.title2, { marginTop: spacing.lg, textAlign: 'center' }]}>Ta med skjemaet dere alt bruker</Text>
              <Text style={[t.footnote, { marginTop: spacing.sm, textAlign: 'center', lineHeight: 20, maxWidth: 330 }]}>
                PDF eller bilde. Sluttkontroll, SJA, måleprotokoll, egenkontroll — fra SpeedyCraft, Cordel, NELFO eller
                deres eget Word-dokument. Klikklister, tabeller og «hvis ja, beskriv» blir med.
              </Text>
            </View>

            {feil && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.xl }}>
                <AlertTriangle size={16} color={colors.warning} strokeWidth={2.2} style={{ marginTop: 1 }} />
                <Text style={[t.footnote, { flex: 1, lineHeight: 19 }]}>{feil}</Text>
              </View>
            )}

            <Pressable
              haptic="medium" onPress={velgOgLes}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, marginTop: spacing.xl,
              }}>
              <FileText size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
              <Text style={[t.headline, { color: colors.ctaLabel }]}>Velg fil</Text>
            </Pressable>

            <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: spacing.md, textAlign: 'center', lineHeight: 17 }]}>
              Du går gjennom og retter alt før det lagres.{'\n'}
              Ingenting publiseres automatisk.
            </Text>
          </Animated.View>
        </ScrollView>
      )}

      {steg === 'leser' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen }}>
          <ActivityIndicator color={colors.brand} />
          <Text style={[t.headline, { marginTop: spacing.lg, textAlign: 'center' }]}>Leser {fil?.navn}</Text>
          {/* Ærlig om ventetiden. Et framdriftsmål vi ikke har ville vært en løgn
              med animasjon på — og da trykker folk på nytt midt i kallet. */}
          <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center', lineHeight: 20, maxWidth: 300 }]}>
            Punkt, klikklister, tabeller og betingelser hentes ut. Et skjema på flere sider kan ta et minutt eller to.
          </Text>
        </View>
      )}

      {steg === 'gjennomgang' && res && (
        <ScrollView
          contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Sparkles size={16} color={colors.brand} strokeWidth={2.2} />
              <Text style={[t.subhead, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{fil?.navn}</Text>
            </View>
            <Text style={[t.footnote, { marginTop: spacing.xs, fontVariant: ['tabular-nums'] }]}>
              {sum!.seksjoner} {sum!.seksjoner === 1 ? 'del' : 'deler'} · {sum!.punkt} punkt
              {sum!.usikre > 0 ? ` · ${sum!.usikre} markert usikre` : ''}
            </Text>
            {!!res.merknad && (
              <Text style={[t.footnote, { marginTop: spacing.sm, lineHeight: 19, color: colors.secondaryLabel }]}>{res.merknad}</Text>
            )}
          </View>

          {sum!.usikre > 0 && (
            <View style={{ flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md }}>
              <AlertTriangle size={15} color={colors.warning} strokeWidth={2.2} style={{ marginTop: 1 }} />
              <Text style={[t.footnote, { flex: 1, lineHeight: 19 }]}>
                {sum!.usikre === 1 ? 'Ett punkt er' : `${sum!.usikre} punkt er`} markert usikre lenger nede — de har gul ramme.
                Sammenlign dem med skjemaet før du lagrer.
              </Text>
            </View>
          )}

          {res.rettelser.length > 0 && (
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginTop: spacing.md, overflow: 'hidden' }}>
              <Pressable haptic="light" onPress={() => setVisRettelser(v => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                <Wand2 size={15} color={colors.iconMuted} strokeWidth={2.2} />
                <Text style={[t.footnote, { flex: 1, fontWeight: '600' }]}>
                  {res.rettelser.length === 1 ? 'Én ting ble rettet automatisk' : `${res.rettelser.length} ting ble rettet automatisk`}
                </Text>
                {visRettelser ? <ChevronDown size={16} color={colors.tertiaryLabel} strokeWidth={2} />
                              : <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={2} />}
              </Pressable>
              {visRettelser && (
                <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                  {res.rettelser.map((r, i) => (
                    <Text key={i} style={[t.caption, { color: colors.secondaryLabel, lineHeight: 18, marginTop: 3 }]}>{`· ${r}`}</Text>
                  ))}
                </View>
              )}
            </View>
          )}

          <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Tittel</Text>
          <TextInput
            value={tittel} onChangeText={setTittel}
            placeholder="Tittel på skjemaet" placeholderTextColor={colors.tertiaryLabel}
            style={[t.title3, { backgroundColor: colors.bg, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
          />

          <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Kategori</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {IMPORT_KATEGORIER.map(c => {
              const aktiv = kategori === c
              return (
                <Pressable key={c} haptic="light" onPress={() => setKategori(c)}
                  style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: aktiv ? colors.label : colors.bg }}>
                  <Text style={[t.subhead, { fontWeight: '600', color: aktiv ? colors.bg : colors.secondaryLabel }]}>{c}</Text>
                </Pressable>
              )
            })}
          </View>

          <View style={{ marginTop: spacing.xl }}>
            <FormProblems problems={problemer} />
            <SectionsEditor sections={seksjoner} flagg={flagg} onChange={setSeksjoner} />
          </View>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  )
}

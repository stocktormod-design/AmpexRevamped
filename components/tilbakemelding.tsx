import { useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, View } from 'react-native'
import { Bug, Lightbulb, Heart, Star } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { Ark } from './sheet'
import { sendTilbakemelding, type TilbakemeldingType } from '../lib/tilbakemelding'
import { colors, spacing, radius, type as t } from '../lib/theme'

const TYPER: { id: TilbakemeldingType; label: string; icon: typeof Bug; hint: string }[] = [
  { id: 'feil', label: 'Feil', icon: Bug, hint: 'Hva skjedde, og hva forventet du?' },
  { id: 'forslag', label: 'Forslag', icon: Lightbulb, hint: 'Hva ville gjort jobben din enklere?' },
  { id: 'ros', label: 'Ros', icon: Heart, hint: 'Hva fungerer bra?' },
]

/** Arket bak tilbakemeldingsboblen. Teksten er det viktige; resten er ett trykk. */
export function TilbakemeldingArk({ synlig, onLukk }: { synlig: boolean; onLukk: () => void }) {
  const [type, setType] = useState<TilbakemeldingType>('feil')
  const [vurdering, setVurdering] = useState<number | null>(null)
  const [tekst, setTekst] = useState('')
  const [sender, setSender] = useState(false)
  const gyldig = tekst.trim().length > 0

  async function send() {
    setSender(true)
    try {
      const r = await sendTilbakemelding({ type, tekst, vurdering })
      setTekst(''); setVurdering(null); setType('feil')
      onLukk()
      Alert.alert('Takk!', r === 'sendt'
        ? 'Tilbakemeldingen er sendt til Ampex.'
        : 'Du er uten nett. Den sendes automatisk når du er på nett igjen.')
    } catch (e: any) {
      Alert.alert('Fikk ikke sendt', e?.message ?? 'Prøv igjen.')
    } finally {
      setSender(false)
    }
  }

  const valgt = TYPER.find(x => x.id === type)!
  return (
    <Ark synlig={synlig} onLukk={onLukk}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: spacing.screen, gap: spacing.lg }}>
          <Text style={t.title3}>Tilbakemelding</Text>

          {/* Segmentert valg, som Apples egne. */}
          <View style={{ flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.fill }}>
            {TYPER.map(({ id, label, icon: Ikon }) => {
              const aktiv = id === type
              return (
                <Pressable key={id} haptic="light" onPress={() => setType(id)}
                  style={{ flex: 1, height: 36, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
                    borderRadius: radius.md - 3, backgroundColor: aktiv ? colors.bg : 'transparent',
                    ...(aktiv ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null) }}>
                  <Ikon size={15} color={aktiv ? colors.label : colors.secondaryLabel} strokeWidth={2} />
                  <Text style={[t.subhead, { fontWeight: '600', color: aktiv ? colors.label : colors.secondaryLabel }]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>

          <TextInput value={tekst} onChangeText={setTekst} placeholder={valgt.hint} multiline autoFocus
            textAlignVertical="top" maxLength={8000}
            style={[t.body, { minHeight: 120, maxHeight: 220, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill }]} />

          <View style={{ gap: spacing.xs }}>
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Hvordan fungerer appen for deg nå?</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {[1, 2, 3, 4, 5].map(n => {
                const på = vurdering !== null && n <= vurdering
                return (
                  <Pressable key={n} haptic="light" hitSlop={4} onPress={() => setVurdering(vurdering === n ? null : n)}
                    accessibilityLabel={`${n} av 5`} style={{ padding: 4 }}>
                    <Star size={28} color={på ? colors.label : colors.tertiaryLabel} fill={på ? colors.label : 'transparent'} strokeWidth={1.8} />
                  </Pressable>
                )
              })}
            </View>
          </View>

          <Text style={[t.caption, { color: colors.tertiaryLabel }]}>
            Telefonmodell, appversjon og hvor i appen du var legges ved automatisk.
          </Text>

          <Pressable haptic="medium" disabled={!gyldig || sender} onPress={send}
            style={{ height: 50, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: gyldig ? colors.brand : colors.fill }}>
            <Text style={[t.headline, { color: gyldig ? colors.brandLabel : colors.tertiaryLabel }]}>{sender ? 'Sender …' : 'Send'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Ark>
  )
}

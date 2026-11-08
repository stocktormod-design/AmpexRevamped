import { useState } from 'react'
import { View, ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar } from 'react-native'
import { Text, TextInput } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { supabase } from '../../lib/supabase'
import { Pressable } from '../../components/pressable'
import { AmpexLogo } from '../../components/ampex-logo'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function signIn(e: string = email, p: string = password) {
    setLoading(true)
    setError(null)
    setInfo(null)
    // trim: iOS-forslagslinja legger et mellomrom etter e-posten, og da avviser Supabase innloggingen
    const { error } = await supabase.auth.signInWithPassword({ email: e.trim().toLowerCase(), password: p })
    if (error) setError(/fetch|network/i.test(error.message) ? 'Ingen dekning. Prøv igjen når du har nett.' : 'Feil e-post eller passord')
    setLoading(false)
  }

  // Lenka går til Kontor (www.ampex.no), som har «Velg nytt passord»-skjemaet;
  // så logger de inn her med det nye. Svaret er det samme om kontoen finnes eller
  // ikke, så skjermen kan ikke brukes til å sjekke hvem som har konto.
  async function glemtPassord() {
    const e = email.trim().toLowerCase()
    setError(null)
    setInfo(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { setError('Skriv e-posten din over først.'); return }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: 'https://www.ampex.no/' })
    setLoading(false)
    if (error && /fetch|network/i.test(error.message)) { setError('Ingen dekning. Prøv igjen når du har nett.'); return }
    if (error && (error.status === 429 || /rate|seconds/i.test(error.message))) { setError('Vent et minutt før du ber om en ny lenke.'); return }
    setInfo(`Hvis ${e} har en konto, kommer det en e-post nå. Trykk på lenka, velg nytt passord og logg inn her.`)
  }

  const inputStyle = {
    ...t.body,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    paddingBottom: spacing.md + 2,
  } as const

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" />
      <View style={{ flex: 1, paddingHorizontal: spacing.screen + 4, paddingTop: insets.top + 72, paddingBottom: insets.bottom + spacing.screen }}>

        <Animated.View entering={FadeInDown.springify()} style={{ flex: 1 }}>
          {/* Merket først — det er det ENE stedet i appen der lyn-A-en får stå stort. */}
          <View style={{
            width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.bg,
            borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center',
            marginBottom: spacing.xl, ...shadows.card,
          }}>
            <AmpexLogo size={38} />
          </View>
          <Text style={{ fontSize: 52, fontWeight: '800', color: colors.label, letterSpacing: -2, lineHeight: 54, marginBottom: spacing.sm }}>
            Ampex
          </Text>
          <Text style={[t.body, { color: colors.secondaryLabel, marginBottom: 56 }]}>
            Elektro · Prosjekt · Dokumentasjon
          </Text>

          <Text style={[t.caption, { marginBottom: spacing.sm }]}>E-POST</Text>
          <TextInput
            style={[inputStyle, { marginBottom: spacing.screen + 4 }]}
            placeholder="navn@firma.no"
            placeholderTextColor={colors.tertiaryLabel}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={[t.caption, { marginBottom: spacing.sm }]}>PASSORD</Text>
          <TextInput
            style={[inputStyle, { marginBottom: spacing.xxl + 8 }]}
            placeholder="••••••••"
            placeholderTextColor={colors.tertiaryLabel}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error && (
            <Text style={[t.footnote, { color: colors.danger, marginBottom: spacing.lg }]}>{error}</Text>
          )}
          {info && (
            <Text style={[t.footnote, { color: colors.label, marginBottom: spacing.lg }]}>{info}</Text>
          )}

          <Pressable
            onPress={() => signIn()}
            disabled={loading}
            haptic="medium"
            style={{
              backgroundColor: colors.cta, borderRadius: radius.xl, height: sizes.ctaHeight,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {loading
              ? <ActivityIndicator color={colors.ctaLabel} />
              : <Text style={[t.headline, { color: colors.ctaLabel }]}>Logg inn</Text>
            }
          </Pressable>

          <Pressable onPress={glemtPassord} disabled={loading} haptic="light"
            style={{ alignSelf: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Glemt passord?</Text>
          </Pressable>

          {/* KUN i dev-bygg: en «Test-innlogging»-knapp i et butikkbygg er det
              første en App Store-anmelder ser, og ser ut som et hull. */}
          {__DEV__ && <Pressable
            onPress={() => signIn('test@ampex.no', 'ampex-test-2026')}
            disabled={loading}
            style={{
              marginTop: spacing.md, height: sizes.ctaHeight - 8, borderRadius: radius.xl,
              borderWidth: 1, borderColor: colors.border,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
            }}
          >
            <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Test-innlogging</Text>
            <Text style={[t.caption, { color: colors.tertiaryLabel }]}>dev</Text>
          </Pressable>}
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  )
}

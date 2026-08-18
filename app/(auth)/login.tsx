import { useState } from 'react'
import { View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { supabase } from '../../lib/supabase'
import { Pressable } from '../../components/pressable'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn(e: string = email, p: string = password) {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p })
    if (error) setError('Feil e-post eller passord')
    setLoading(false)
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

          {/* Vises også i Release: intern testflåte. Fjern gaten når kundebygg blir en ting. */}
          <Pressable
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
          </Pressable>
        </Animated.View>

        <Text style={[t.footnote, { color: colors.tertiaryLabel, textAlign: 'center' }]}>
          Kontakt din administrator for tilgang
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

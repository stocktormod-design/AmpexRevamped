import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Feil e-post eller passord')
    setLoading(false)
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" />
      <View
        className="flex-1 justify-between px-6"
        style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}
      >
        {/* Logo */}
        <View>
          <Text className="text-white text-4xl font-bold tracking-tight">Ampex</Text>
          <Text className="text-slate-500 text-base mt-2">Elektro · Prosjekt · Dokumentasjon</Text>
        </View>

        {/* Form */}
        <View>
          <View className="mb-3">
            <Text className="text-slate-400 text-xs font-medium tracking-widest uppercase mb-2">
              E-post
            </Text>
            <TextInput
              className="bg-slate-900 text-white rounded-xl px-4 py-4 text-base"
              style={{ borderWidth: 0.5, borderColor: '#1e293b' }}
              placeholder="navn@firma.no"
              placeholderTextColor="#334155"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />
          </View>

          <View className="mb-6">
            <Text className="text-slate-400 text-xs font-medium tracking-widest uppercase mb-2">
              Passord
            </Text>
            <TextInput
              className="bg-slate-900 text-white rounded-xl px-4 py-4 text-base"
              style={{ borderWidth: 0.5, borderColor: '#1e293b' }}
              placeholder="••••••••"
              placeholderTextColor="#334155"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {error && (
            <Text className="text-red-400 text-sm mb-4 text-center">{error}</Text>
          )}

          <TouchableOpacity
            className="bg-sky-500 rounded-xl py-4 items-center"
            onPress={signIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text className="text-white font-semibold text-base tracking-tight">Logg inn</Text>
            }
          </TouchableOpacity>
        </View>

        <Text className="text-slate-700 text-xs text-center">
          Kontakt din administrator for tilgang
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-white text-3xl font-bold mb-2">Ampex</Text>
        <Text className="text-slate-400 text-base mb-10">Logg inn for å fortsette</Text>

        <TextInput
          className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-3 text-base"
          placeholder="E-post"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          className="bg-slate-800 text-white rounded-xl px-4 py-4 mb-6 text-base"
          placeholder="Passord"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error && (
          <Text className="text-red-400 text-sm mb-4">{error}</Text>
        )}

        <TouchableOpacity
          className="bg-sky-500 rounded-xl py-4 items-center"
          onPress={signIn}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="white" />
            : <Text className="text-white font-semibold text-base">Logg inn</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

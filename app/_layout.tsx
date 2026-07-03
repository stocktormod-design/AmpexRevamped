import '../global.css'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { syncQuietly } from '../lib/db/sync'

export default function RootLayout() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/(auth)/login')
      } else {
        router.replace('/(app)')
        syncQuietly()
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace('/(auth)/login')
      } else {
        router.replace('/(app)')
        syncQuietly()
      }
    })

    // Usynlig synk når appen kommer til forgrunn (aldri polling — batterikrav #8)
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') return
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) syncQuietly()
      })
    })

    return () => {
      subscription.unsubscribe()
      appState.remove()
    }
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  )
}

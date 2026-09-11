import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { Text } from './text'
import { Pressable } from './pressable'
import { getCurrentUser } from '../lib/order-access'
import { colors, sizes, type as t } from '../lib/theme'

/**
 * Avataren øverst til høyre er inngangen til Meg (referansen 2026-09-06:
 * profilen sitter i hodet, ikke som femte fane). Initialen i en sort disk —
 * samme form som merket i docken, så de leses som samme familie.
 */
export function useUserName(): string {
  const [navn, setNavn] = useState('')
  useEffect(() => { getCurrentUser().then(u => { if (u) setNavn(u.name) }) }, [])
  return navn
}

export function MegAvatar({ size = sizes.iconChip }: { size?: number }) {
  const navn = useUserName()
  const init = navn.trim().split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('') || '·'
  return (
    <Pressable haptic="light" pressScale={0.94} onPress={() => router.push('/(app)/meg')} accessibilityLabel="Meg"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
      <View>
        <Text style={[t.subhead, { fontWeight: '700', color: colors.label, letterSpacing: 0 }]}>{init}</Text>
      </View>
    </Pressable>
  )
}

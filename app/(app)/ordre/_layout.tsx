import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function OrdreLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="material" options={{ presentation: 'modal' }} />
      <Stack.Screen name="faktura" />
      <Stack.Screen name="timer" />
      <Stack.Screen name="deltakere" />
      <Stack.Screen name="tillegg" />
      <Stack.Screen name="signatur" />
    </Stack>
  )
}

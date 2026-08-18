import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function LagerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny-lokasjon" options={{ presentation: 'modal' }} />
      <Stack.Screen name="bevegelse" options={{ presentation: 'modal' }} />
      <Stack.Screen name="uttak" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

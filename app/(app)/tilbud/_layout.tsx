import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function TilbudLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="linje" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

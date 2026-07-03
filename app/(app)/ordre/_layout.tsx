import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function OrdreLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.groupedBg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

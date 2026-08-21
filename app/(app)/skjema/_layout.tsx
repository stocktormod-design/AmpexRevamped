import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function SkjemaLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="rediger" options={{ presentation: 'modal' }} />
      <Stack.Screen name="importer" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

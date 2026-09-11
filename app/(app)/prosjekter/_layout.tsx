import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

export default function ProsjekterLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="tegning-ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="medlem" options={{ presentation: 'modal' }} />
      <Stack.Screen name="rom-ny" options={{ presentation: 'modal' }} />
      <Stack.Screen name="rom" />
      <Stack.Screen name="mappe" />
      <Stack.Screen name="oppgaver" />
      <Stack.Screen name="tegning" />
      <Stack.Screen name="tegning-edit" options={{ animation: 'fade' }} />
    </Stack>
  )
}

import { Stack } from 'expo-router'
import { colors } from '../../../lib/theme'

// Lager-lista ligger alltid under. «Legg til bil» på Meg åpner ny-lokasjon direkte i
// denne stabelen; uten et anker under ble stabelen tom når skjemaet ble lukket på en
// ny konto, og fanelinja sluttet å bytte skjerm (Henning 08.11).
export const unstable_settings = { initialRouteName: 'index' }

export default function LagerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="ny-lokasjon" options={{ presentation: 'modal' }} />
      <Stack.Screen name="bevegelse" options={{ presentation: 'modal' }} />
      <Stack.Screen name="uttak" options={{ presentation: 'modal' }} />
      <Stack.Screen name="prisfil" />
      <Stack.Screen name="varer" />
      <Stack.Screen name="vare" />
      <Stack.Screen name="efobasen" />
    </Stack>
  )
}

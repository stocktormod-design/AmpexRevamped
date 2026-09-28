import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '../../../lib/theme'

/**
 * Læretid er én flate, ikke sju faner. Uten denne ble hver skjerm i mappa
 * (logger, quiz, logg/[id], samtale …) en egen rute i fanelinja.
 *
 * Toppavstanden legges her, én gang, så skjermene under slipper å huske den.
 */
export default function LaeretidLayout() {
  const insets = useSafeAreaInsets()
  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.bg, paddingTop: insets.top },
    }} />
  )
}

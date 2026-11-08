import { forwardRef, useEffect } from 'react'
import { View, Linking } from 'react-native'
import { Text } from './text'
import { Pressable } from './pressable'
import { colors, spacing, radius, type as t } from '../lib/theme'

export type EfobasenVinduRef = { tilbake: () => void; lastPaNytt: () => void }

/**
 * I nettleseren kan EFObasen ikke bygges inn: de sender `X-Frame-Options:
 * SAMEORIGIN` og `frame-ancestors 'self'`. Da åpnes den i en ny fane, og
 * panelet under viser varen skjermen ble åpnet med.
 */
export const EfobasenVindu = forwardRef<EfobasenVinduRef, {
  startUrl: string
  onAdresse: (url: string) => void
  onKanGaTilbake: (kan: boolean) => void
  bunn: number
}>(function EfobasenVindu({ startUrl, onAdresse }, _ref) {
  useEffect(() => { onAdresse(startUrl) }, [startUrl, onAdresse])
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.canvas }}>
      <Text style={t.headline}>EFObasen åpnes i en egen fane</Text>
      <Pressable haptic="light" onPress={() => Linking.openURL(startUrl)}
        style={{ marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.fill }}>
        <Text style={[t.subhead, { fontWeight: '600' }]}>Åpne EFObasen</Text>
      </Pressable>
    </View>
  )
})

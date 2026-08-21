import { useEffect, useState } from 'react'
import { InteractionManager, View, Text } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { BlurView } from 'expo-blur'
import { Navigation } from 'lucide-react-native'
import { Pressable } from './pressable'
import { geocodeAddress } from '../lib/geocode'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/**
 * Ikke-interaktivt kartpreview (Apple MapKit) med pin og «Kjørevei»-chip.
 * Trykk hvor som helst → onPress (åpner Kart med kjørerute).
 * Rendres ikke før geokodingen har svart — ingen tom kartboks.
 */
export function AddressMap({ address, onPress, height = 150, chrome = true }: {
  address: string
  onPress: () => void
  /** Hero-bruk: full høyde bak tittelen. */
  height?: number
  /** «Kjørevei»-pilla. Av i hero — der ligger navigasjonen som egen knapp. */
  chrome?: boolean
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  // MapView koster rammer ved oppstart. Monteres den midt i en push-overgang,
  // hakker overgangen — og det er overgangen brukeren ser, ikke kartet. Vi
  // venter til navigasjonen har satt seg; kartet kommer et øyeblikk etter, og
  // ingen legger merke til DET.
  const [ferdigNavigert, setFerdigNavigert] = useState(false)

  useEffect(() => {
    let mounted = true
    geocodeAddress(address).then(c => { if (mounted) setCoords(c) })
    const oppgave = InteractionManager.runAfterInteractions(() => {
      if (mounted) setFerdigNavigert(true)
    })
    return () => { mounted = false; oppgave.cancel() }
  }, [address])

  if (!coords || !ferdigNavigert) return null

  return (
    <Pressable onPress={onPress}>
      <View pointerEvents="none">
        <MapView
          style={{ height }}
          initialRegion={{
            latitude: coords.lat,
            longitude: coords.lng,
            latitudeDelta: 0.008,
            longitudeDelta: 0.008,
          }}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          showsPointsOfInterests={false}
        >
          <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }} />
        </MapView>
      </View>
      {chrome && (
      <BlurView
        tint="light"
        intensity={70}
        style={{
          position: 'absolute', right: spacing.sm + 2, bottom: spacing.sm + 2,
          flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 1,
          paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 1,
          borderRadius: radius.pill, overflow: 'hidden',
          backgroundColor: colors.cardGlass,
          borderWidth: 0.5, borderColor: colors.glassEdge,
        }}
      >
        <Navigation size={12} color={colors.label} strokeWidth={sizes.lucideStroke} />
        <Text style={[t.caption, { color: colors.label, fontWeight: '600' }]}>Kjørevei</Text>
      </BlurView>
      )}
    </Pressable>
  )
}

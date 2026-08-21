import { useEffect, useRef, useState } from 'react'
import { View, Text } from 'react-native'
import MapView, { Marker, type Region } from 'react-native-maps'
import { Pressable } from './pressable'
import { geocodeAddress } from '../lib/geocode'
import { orderStatusLabel, type Order } from '../lib/db/models/order'
import { formatTime } from '../lib/format'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * Alle åpne jobber på ett kart.
 *
 * Dette er den ene tingen enhver god feltapp i utlandet har og vi ikke hadde:
 * Jobber, Housecall Pro og Tradify åpner alle dagen i kartvisning. Grunnen er
 * ikke at kart er pent — det er at REKKEFØLGEN på jobbene bestemmes av
 * geografi, og en liste sortert på klokkeslett skjuler at to av dem ligger i
 * samme gate.
 *
 * Geokodingen er den samme hurtigbufrede som adressekortet bruker
 * (lib/geocode.ts): hver adresse slås opp én gang, aldri på nytt. Uten nett
 * vises de adressene som alt er slått opp — resten uteblir stille, framfor å
 * hindre kartet i å tegne seg.
 */
type Pin = { order: Order; lat: number; lng: number }

// Nord-Norge til Lindesnes. Brukes kun til å tegne noe før første pin finnes.
const NORGE: Region = { latitude: 61, longitude: 9.5, latitudeDelta: 10, longitudeDelta: 10 }

export const kartStottes = true

export function OrdreKart({ orders, onVelg }: { orders: Order[]; onVelg: (order: Order) => void }) {
  const [pins, setPins] = useState<Pin[]>([])
  const [valgt, setValgt] = useState<string | null>(null)
  const kart = useRef<MapView | null>(null)

  useEffect(() => {
    let levende = true
    const medAdresse = orders.filter(o => !!o.address?.trim())
    void (async () => {
      const funnet: Pin[] = []
      for (const o of medAdresse) {
        const c = await geocodeAddress(o.address!.trim())
        if (!levende) return
        if (c) {
          funnet.push({ order: o, lat: c.lat, lng: c.lng })
          // Tegn pins etter hvert som de kommer. Å vente på at ALLE adresser er
          // slått opp ville gitt en tom skjerm i flere sekunder første gang.
          setPins([...funnet])
        }
      }
    })()
    return () => { levende = false }
  }, [orders])

  // Zoom til jobbene så snart vi vet hvor de er — ikke ved hver ny pin, bare
  // når antallet endrer seg, ellers hopper kartet mens brukeren panorerer.
  const antall = pins.length
  useEffect(() => {
    if (antall === 0 || !kart.current) return
    kart.current.fitToCoordinates(
      pins.map(p => ({ latitude: p.lat, longitude: p.lng })),
      { edgePadding: { top: 80, right: 60, bottom: 220, left: 60 }, animated: true },
    )
  }, [antall])

  const aktiv = pins.find(p => p.order.id === valgt)

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={kart} style={{ flex: 1 }} initialRegion={NORGE} showsUserLocation>
        {pins.map(p => (
          <Marker
            key={p.order.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            pinColor={colors.brand}
            onPress={() => setValgt(p.order.id)}
          />
        ))}
      </MapView>

      {/* Trykk på en pin viser jobben nederst — ett trykk til åpner den. To
          ledd, fordi et feiltrykk på et kart er lett og skal ikke navigere. */}
      {aktiv && (
        <Pressable
          haptic="light"
          onPress={() => onVelg(aktiv.order)}
          style={{
            position: 'absolute', left: spacing.screen, right: spacing.screen, bottom: spacing.xl,
            backgroundColor: colors.bg, borderRadius: radius.xl, padding: spacing.lg,
          }}
        >
          <Text style={[t.caption, { color: colors.brand, textTransform: 'uppercase' }]}>
            {orderStatusLabel[aktiv.order.status]}
            {aktiv.order.scheduledAt ? ` · ${formatTime(aktiv.order.scheduledAt)}` : ''}
          </Text>
          <Text style={[t.headline, { marginTop: 2 }]} numberOfLines={1}>{aktiv.order.title}</Text>
          <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>{aktiv.order.address}</Text>
        </Pressable>
      )}

      {pins.length === 0 && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: '45%', alignItems: 'center' }}>
          <Text style={[t.footnote, { textAlign: 'center', paddingHorizontal: spacing.xxl }]}>
            Ingen av jobbene har en adresse som lot seg plassere.
          </Text>
        </View>
      )}
    </View>
  )
}

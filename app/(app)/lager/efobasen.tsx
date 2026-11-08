import { useCallback, useRef, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, X } from 'lucide-react-native'
import { Text } from '../../../components/text'
import { Pressable } from '../../../components/pressable'
import { EfobasenVindu, type EfobasenVinduRef } from '../../../components/efobasen-vindu'
import { EfobasenPanel } from '../../../components/efobasen-panel'
import { efobasenUrl, elnummerFraEfobasen } from '../../../lib/pricefile/varekort'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const FORSIDE = 'https://efobasen.efo.no/'

/**
 * EFObasen er katalogen, Ampex er handlekurven (Tormod 30.09).
 *
 * Montøren blar fritt i EFObasen — de har alle varedata — og panelet nederst
 * følger varen han står på: firmaets pris per grossist og «Legg i kurv». Vi
 * leser BARE el-nummeret i adressen, aldri innholdet på siden deres.
 *
 * Åpnes fra varekortet (`?elnr=`) eller fra Lager (forsiden).
 */
export default function EfobasenSkjerm() {
  const insets = useSafeAreaInsets()
  const { elnr } = useLocalSearchParams<{ elnr?: string }>()
  const [startUrl] = useState(() => efobasenUrl(elnr) ?? FORSIDE)
  const [elnummer, setElnummer] = useState<string | null>(() => elnummerFraEfobasen(startUrl))
  const [kanGaTilbake, setKanGaTilbake] = useState(false)
  const [bunn, setBunn] = useState(0)
  const vindu = useRef<EfobasenVinduRef>(null)

  // Samme adresse meldes både av lytteren og av navigasjonen; settes bare når
  // el-nummeret faktisk endres, så panelet ikke rendres på hvert meldingsbytte.
  const onAdresse = useCallback((url: string) => {
    const nr = elnummerFraEfobasen(url)
    setElnummer(forrige => (forrige === nr ? forrige : nr))
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Krom øverst: tilbake i katalogen, eller ut av den. Vertsnavnet står der
          så det aldri er tvil om at dette er EFObasens side, ikke vår. */}
      <View style={{
        paddingTop: insets.top, backgroundColor: colors.bg,
        borderBottomWidth: 0.5, borderBottomColor: colors.separator,
      }}>
        <View style={{ height: sizes.navBar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm }}>
          <Pressable pressScale={0.92}
            onPress={() => (kanGaTilbake ? vindu.current?.tilbake() : router.back())}
            style={{ width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.iconLg} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[t.subhead, { fontWeight: '600' }]}>EFObasen</Text>
            <Text style={[t.caption, { color: colors.tertiaryLabel }]}>efobasen.efo.no</Text>
          </View>
          <Pressable pressScale={0.92} onPress={() => router.back()}
            style={{ width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }}>
            <X size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      <EfobasenVindu
        ref={vindu}
        startUrl={startUrl}
        onAdresse={onAdresse}
        onKanGaTilbake={setKanGaTilbake}
        bunn={bunn}
      />

      <EfobasenPanel elnummer={elnummer} onHvilehoyde={setBunn} />
    </View>
  )
}

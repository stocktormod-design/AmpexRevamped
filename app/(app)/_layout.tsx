import { Tabs, useSegments } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, ChevronRight, House, FolderOpen, FileText, User, Warehouse } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { Text } from '../../components/text'
import { Pressable } from '../../components/pressable'
import { AmpexMarkButton } from '../../components/ampex-mark-button'
import { CartBar } from '../../components/cart-bar'
import { colors, sizes, radius, shadows, spacing, type as t } from '../../lib/theme'

// Lucide, som resten av appen (DESIGN.md idiom 5). Tab-baren var det ENESTE
// stedet med Ionicons — den mest sette flaten i appen, i en annen ikonfamilie
// enn alt annet. Det er den slags detalj som får en app til å lese som «bygget»
// i stedet for «designet».
//
// Lucide har ingen fylte varianter, så aktiv tilstand markeres med tykkere
// strek + farge i stedet for outline→fylt. Det er også mer i tråd med resten:
// ingen andre ikoner i appen bytter form når de er aktive.
// Fem plasser i pillen: Hjem · Prosjekter⇄Ordre · [Ampex/AI] · Lager · Meg.
// Prosjekter og Ordre deler ÉN plass (Tormod 2026-09-06): to små piler på knappen
// bytter hvilken av dem plassen åpner. Slik får Meg plass igjen, og merket står
// nøyaktig i midten fordi det har sin egen plass i lista.
type Fane = { name: string; label: string; icon: typeof House }
const HJEM: Fane = { name: 'index', label: 'Hjem', icon: House }
const PROSJEKTER: Fane = { name: 'prosjekter', label: 'Prosjekter', icon: FolderOpen }
const ORDRE: Fane = { name: 'ordre', label: 'Ordre', icon: FileText }
const LAGER: Fane = { name: 'lager', label: 'Lager', icon: Warehouse }
const MEG: Fane = { name: 'meg', label: 'Meg', icon: User }

export default function AppLayout() {
  const insets = useSafeAreaInsets()
  // Tegningen fyller hele skjermen: dokken over lerretet stjal nederste
  // stripe av tegningen (og la seg over delt skjerm).
  const segments = useSegments() as string[]
  const skjulDock = segments.includes('tegning') || segments.includes('tegning-edit')
  // Hvilken av Prosjekter/Ordre den delte plassen viser. Følger ruta du står i.
  const [deltValg, setDeltValg] = useState<'prosjekter' | 'ordre'>(segments.includes('prosjekter') ? 'prosjekter' : 'ordre')
  // Står du i Prosjekter (også via deep link), viser plassen Prosjekter — og omvendt.
  useEffect(() => {
    if (segments.includes('prosjekter')) setDeltValg('prosjekter')
    else if (segments.includes('ordre')) setDeltValg('ordre')
  }, [segments])
  const delt = deltValg === 'prosjekter' ? PROSJEKTER : ORDRE
  const andre = deltValg === 'prosjekter' ? ORDRE : PROSJEKTER
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        /*
         * FRYS FANER SOM IKKE VISES (2026-08-30).
         *
         * Alle fem fanene blir stående montert etter første besøk, og uten
         * dette re-renderer de fire usynlige hver gang en WatermelonDB-
         * spørring emitter (54 observe-abonnement i appen). Det arbeidet
         * skjer på JS-tråden — den samme tråden som skal ta imot neste trykk,
         * som dermed må stå i kø bak et gjenoppbygd Lager ingen ser på.
         *
         * `freezeOnBlur` stopper KUN rendering; useEffect-abonnement, synk og
         * opplastinger går som før, så ingenting mister tråden.
         */
        freezeOnBlur: true,
        /*
         * DOCKEN ER EN FLYTENDE GLASS-PILLE (spec 2026-08-29).
         *
         * Frostet lys pille over papiret, spekulær hårlinjekant, varm skygge.
         * Glass finnes kun tre steder i appen (navbar, dock, stemme-orb) —
         * dette er ett av dem. Aktiv fane i BLEKK, ikke messing: messingen er
         * opptatt (neste-prikken og primærknappen).
         */
        // FLAT, FULL BREDDE (Tormod 2026-09-06: «bottom bar er avlang»). Pillen
        // leste som en avlang boble; Apple/Tesla-baren er en hvit flate med
        // hårlinje øverst, kant til kant.
        // FLYTENDE PILLE m/ hevet oransje midtknapp (Tormods referanse 2026-09-06).
        tabBarStyle: {
          display: skjulDock ? 'none' : 'flex',
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: Math.max(insets.bottom - 6, 12),
          height: 64,
          borderRadius: 32,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          paddingBottom: 8,
          paddingTop: 8,
          paddingHorizontal: 6,
          ...shadows.floating,
        },
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, borderRadius: 32, borderWidth: 1, borderColor: colors.separator }]} />
        ),
        tabBarActiveTintColor: colors.label,
        tabBarInactiveTintColor: colors.secondaryLabel,
        tabBarItemStyle: { flex: 1, paddingHorizontal: 0 },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.1,
        },
      }}
    >
      {([HJEM] as Fane[]).map(({ name, label, icon: Icon }) => (
        <Tabs.Screen key={name} name={name} options={{ title: label,
          tabBarIcon: ({ focused, color, size }) => <Icon size={size - 2} color={color} strokeWidth={focused ? 2.4 : 1.8} /> }} />
      ))}
      {/* Den delte plassen: ikonet + navnet for valgt, og to piler som bytter. */}
      {([PROSJEKTER, ORDRE] as Fane[]).map(f => (
        <Tabs.Screen key={f.name} name={f.name} options={{
          title: f.label,
          // href + tabBarButton kan ikke kombineres i Expo Router. Den skjulte
          // ruta får display:none på PLASSEN sin — en tom knapp (null) beholdt
          // plassen og dyttet merket ut av midten.
          tabBarItemStyle: f.name === delt.name ? { flex: 1, paddingHorizontal: 0 } : { display: 'none' },
          tabBarButton: (props) => {
            if (f.name !== delt.name) return null
            const Icon = delt.icon
            const focused = !!props['aria-selected'] || props.accessibilityState?.selected
            const bytt = () => { setDeltValg(andre.name as 'prosjekter' | 'ordre'); router.push(`/(app)/${andre.name}` as never) }
            return (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Pressable haptic="light" onPress={props.onPress as unknown as () => void} accessibilityLabel={delt.label}
                  style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={sizes.icon - 2} color={focused ? colors.label : colors.secondaryLabel} strokeWidth={focused ? 2.4 : 1.8} />
                  <Text style={{ fontSize: 11, fontWeight: '500', letterSpacing: 0.1, marginTop: 3, color: focused ? colors.label : colors.secondaryLabel }}>{delt.label}</Text>
                </Pressable>
                <Pressable haptic="light" hitSlop={8} accessibilityLabel={`Bytt til ${andre.label}`} onPress={bytt}
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronLeft size={13} color={colors.tertiaryLabel} strokeWidth={2.4} />
                </Pressable>
                <Pressable haptic="light" hitSlop={8} accessibilityLabel={`Bytt til ${andre.label}`} onPress={bytt}
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 18, alignItems: 'center', justifyContent: 'center' }}>
                  <ChevronRight size={13} color={colors.tertiaryLabel} strokeWidth={2.4} />
                </Pressable>
              </View>
            )
          },
        }} />
      ))}
      {/* Midten: Ampex-merket. Egen rute = egen, fast plass. Trykk = assistent. */}
      <Tabs.Screen name="ai" options={{
        title: 'Ampex',
        tabBarLabel: () => null,
        tabBarButton: () => (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start' }}>
            {/* Vertikalt sentrert i pillen (Tormod: «lengre ned»): orben er 54 + 3 px ring = 60,
                innholdshøyden er 48 → −6 gir like mye over og under. */}
            <View style={{ marginTop: -6, padding: 3, borderRadius: 33, backgroundColor: colors.bg }}>
              <AmpexMarkButton tone="orb" />
            </View>
          </View>
        ),
      }} />
      {([LAGER, MEG] as Fane[]).map(({ name, label, icon: Icon }) => (
        <Tabs.Screen key={name} name={name} options={{ title: label,
          tabBarIcon: ({ focused, color, size }) => <Icon size={size - 2} color={color} strokeWidth={focused ? 2.4 : 1.8} /> }} />
      ))}
      {/* Skjult fra tab-baren, navigerbar via snarveier (handlekurv er nå overlay, se CartBar) */}
      <Tabs.Screen name="skjema" options={{ href: null }} />
      {/* Registrene nås fra Meg og fra ordredetalj — de hører ikke til i tab-baren,
          som er for det montøren gjør hver dag, ikke det som settes opp én gang. */}
      <Tabs.Screen name="kunder" options={{ href: null }} />
      {/* Tilbud nås fra ordrelista. Det er ikke en daglig montørhandling — det er
          basen som svarer på en forespørsel — så det tar ikke plass i tab-baren. */}
      <Tabs.Screen name="tilbud" options={{ href: null }} />
      {/* Mine timer nås fra Meg — det er lønnsgrunnlaget, ikke en daglig handling. */}
      <Tabs.Screen name="mine-timer" options={{ href: null }} />
      {/* Faglig godkjenning nås fra Meg og fra Hjem når noe venter. Den er
          faglig ansvarliges skjerm, ikke montørens daglige flate. */}
      <Tabs.Screen name="godkjenning" options={{ href: null }} />
      {/* Gamle jobber — arkivet. Nås fra Meg og fra kundekortet. */}
      <Tabs.Screen name="arkiv" options={{ href: null }} />
      <Tabs.Screen name="aktiviteter" options={{ href: null }} />
      <Tabs.Screen name="skanner" options={{ href: null }} />
      {/* Fullskjerm skanner/viewer — skjul tab-baren mens den er fokusert */}
      <Tabs.Screen name="skann" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
    <CartBar />
    </View>
  )
}

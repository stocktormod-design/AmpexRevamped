import { Tabs } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { House, FolderOpen, FileText, Package, User } from 'lucide-react-native'
import { CartBar } from '../../components/cart-bar'
import { colors, sizes } from '../../lib/theme'

// Lucide, som resten av appen (DESIGN.md idiom 5). Tab-baren var det ENESTE
// stedet med Ionicons — den mest sette flaten i appen, i en annen ikonfamilie
// enn alt annet. Det er den slags detalj som får en app til å lese som «bygget»
// i stedet for «designet».
//
// Lucide har ingen fylte varianter, så aktiv tilstand markeres med tykkere
// strek + farge i stedet for outline→fylt. Det er også mer i tråd med resten:
// ingen andre ikoner i appen bytter form når de er aktive.
const tabs: { name: string; label: string; icon: typeof House }[] = [
  { name: 'index',      label: 'Hjem',       icon: House },
  { name: 'prosjekter', label: 'Prosjekter', icon: FolderOpen },
  { name: 'ordre',      label: 'Ordre',      icon: FileText },
  { name: 'lager',      label: 'Lager',      icon: Package },
  { name: 'meg',        label: 'Meg',        icon: User },
]

export default function AppLayout() {
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        // Frosted glass bar — floats over content, screens scroll under it.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopColor: 'rgba(60,60,67,0.2)',
          borderTopWidth: 0.5,
          paddingBottom: 4,
          paddingTop: 6,
          height: sizes.tabBar,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            tint="systemChromeMaterialLight"
            intensity={90}
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.chromeGlass }]}
          />
        ),
        tabBarActiveTintColor: '#000',
        tabBarInactiveTintColor: '#8e8e93',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          letterSpacing: 0.2,
        },
      }}
    >
      {tabs.map(({ name, label, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: label,
            tabBarIcon: ({ focused, color, size }) => (
              <Icon size={size - 2} color={color} strokeWidth={focused ? 2.4 : 1.8} />
            ),
          }}
        />
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
      {/* Fullskjerm skanner/viewer — skjul tab-baren mens den er fokusert */}
      <Tabs.Screen name="skann" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
    <CartBar />
    </View>
  )
}

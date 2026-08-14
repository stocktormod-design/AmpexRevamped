import { Tabs } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { CartBar } from '../../components/cart-bar'
import { colors, sizes } from '../../lib/theme'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const tabs: { name: string; label: string; icon: IoniconName; iconActive: IoniconName }[] = [
  { name: 'index',      label: 'Hjem',      icon: 'home-outline',    iconActive: 'home' },
  { name: 'prosjekter', label: 'Prosjekter', icon: 'folder-outline',  iconActive: 'folder' },
  { name: 'ordre',      label: 'Ordre',      icon: 'document-text-outline', iconActive: 'document-text' },
  { name: 'lager',      label: 'Lager',      icon: 'cube-outline',    iconActive: 'cube' },
  { name: 'meg',        label: 'Meg',        icon: 'person-outline',  iconActive: 'person' },
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
      {tabs.map(t => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? t.iconActive : t.icon}
                size={size - 1}
                color={color}
              />
            ),
          }}
        />
      ))}
      {/* Skjult fra tab-baren, navigerbar via snarveier (handlekurv er nå overlay, se CartBar) */}
      <Tabs.Screen name="skjema" options={{ href: null }} />
      {/* Fullskjerm skanner/viewer — skjul tab-baren mens den er fokusert */}
      <Tabs.Screen name="skann" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
    <CartBar />
    </View>
  )
}

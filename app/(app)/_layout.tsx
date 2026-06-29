import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0f1a',
          borderTopColor: '#1e293b',
          borderTopWidth: 0.5,
          paddingBottom: 4,
          paddingTop: 6,
          height: 58,
        },
        tabBarActiveTintColor: '#38bdf8',
        tabBarInactiveTintColor: '#475569',
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
    </Tabs>
  )
}

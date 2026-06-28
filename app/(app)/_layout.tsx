import { Tabs } from 'expo-router'
import { View } from 'react-native'

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        tabBarActiveTintColor: '#0ea5e9',
        tabBarInactiveTintColor: '#64748b',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Hjem' }} />
      <Tabs.Screen name="prosjekter" options={{ title: 'Prosjekter' }} />
      <Tabs.Screen name="ordre" options={{ title: 'Ordre' }} />
      <Tabs.Screen name="lager" options={{ title: 'Lager' }} />
      <Tabs.Screen name="meg" options={{ title: 'Meg' }} />
    </Tabs>
  )
}

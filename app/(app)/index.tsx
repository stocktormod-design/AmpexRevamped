import { View, Text, TouchableOpacity, ScrollView, StatusBar } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

interface QuickAction {
  label: string
  sub: string
  icon: IoniconName
  color: string
  onPress: () => void
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()

  const actions: QuickAction[] = [
    {
      label: 'Ny ordre',
      sub: 'Service, installasjon, kontroll',
      icon: 'add-circle-outline',
      color: '#38bdf8',
      onPress: () => router.push('/(app)/ordre'),
    },
    {
      label: 'Nytt prosjekt',
      sub: 'Tegninger, rom, framdrift',
      icon: 'folder-open-outline',
      color: '#a78bfa',
      onPress: () => router.push('/(app)/prosjekter'),
    },
    {
      label: 'Lager',
      sub: 'Inn/ut, bil, auto-bestilling',
      icon: 'cube-outline',
      color: '#34d399',
      onPress: () => router.push('/(app)/lager'),
    },
    {
      label: 'Timeføring',
      sub: 'Dag, uke, godkjenn forslag',
      icon: 'time-outline',
      color: '#fb923c',
      onPress: () => {},
    },
  ]

  return (
    <View className="flex-1 bg-slate-950" style={{ paddingTop: insets.top }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View className="px-5 pt-6 pb-4">
        <Text className="text-slate-500 text-sm font-medium tracking-widest uppercase">
          Ampex
        </Text>
        <Text className="text-white text-2xl font-semibold mt-1 tracking-tight">
          Hva vil du gjøre?
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick actions */}
        <View className="gap-3 mt-2">
          {actions.map((a) => (
            <TouchableOpacity
              key={a.label}
              onPress={a.onPress}
              activeOpacity={0.7}
              className="bg-slate-900 rounded-2xl p-4 flex-row items-center"
              style={{ borderWidth: 0.5, borderColor: '#1e293b' }}
            >
              <View
                className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                style={{ backgroundColor: a.color + '18' }}
              >
                <Ionicons name={a.icon} size={20} color={a.color} />
              </View>
              <View className="flex-1">
                <Text className="text-white font-semibold text-base tracking-tight">
                  {a.label}
                </Text>
                <Text className="text-slate-500 text-sm mt-0.5">
                  {a.sub}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#334155" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Divider */}
        <View className="h-px bg-slate-800 my-6" />

        {/* Snarveier */}
        <Text className="text-slate-500 text-xs font-medium tracking-widest uppercase mb-3">
          Snarveier
        </Text>
        <View className="flex-row gap-3">
          {([
            { label: 'Skann', icon: 'barcode-outline' as IoniconName, color: '#38bdf8' },
            { label: 'Avvik', icon: 'warning-outline' as IoniconName, color: '#fb923c' },
            { label: 'HMS', icon: 'shield-checkmark-outline' as IoniconName, color: '#34d399' },
          ]).map(s => (
            <TouchableOpacity
              key={s.label}
              activeOpacity={0.7}
              className="flex-1 bg-slate-900 rounded-2xl py-4 items-center"
              style={{ borderWidth: 0.5, borderColor: '#1e293b' }}
            >
              <Ionicons name={s.icon} size={22} color={s.color} />
              <Text className="text-slate-400 text-xs font-medium mt-2">{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

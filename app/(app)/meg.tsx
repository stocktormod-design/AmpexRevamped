import { View, Text, TouchableOpacity } from 'react-native'
import { supabase } from '../../lib/supabase'

export default function MegScreen() {
  return (
    <View className="flex-1 bg-slate-950 items-center justify-center">
      <Text className="text-white text-xl font-semibold mb-8">Min profil</Text>
      <TouchableOpacity
        className="bg-slate-800 rounded-xl px-6 py-3"
        onPress={() => supabase.auth.signOut()}
      >
        <Text className="text-red-400 font-medium">Logg ut</Text>
      </TouchableOpacity>
    </View>
  )
}

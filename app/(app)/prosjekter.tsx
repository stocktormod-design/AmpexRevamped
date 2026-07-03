import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function Screen() {
  const insets = useSafeAreaInsets()
  return <View style={{ flex: 1, backgroundColor: '#f2f2f7', paddingTop: insets.top }} />
}

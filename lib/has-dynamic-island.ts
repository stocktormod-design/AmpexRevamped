import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Apple gir ingen direkte "har denne enheten Dynamic Island"-API. Standard
// tilnærming: toppens safe-area-inset er distinkt per skjermtype — ~44-47pt på
// hakk-enheter (iPhone X–13 Pro, 14/14 Plus), ~59pt på Dynamic Island-enheter
// (14 Pro og nyere, samt 15/16/17 ikke-Pro fra og med 2026). Terskelen 51 ligger
// midt mellom disse — robust for fremtidige modeller uten en hardkodet enhetsliste.
const DYNAMIC_ISLAND_INSET_THRESHOLD = 51

export function useHasDynamicIsland(): boolean {
  const insets = useSafeAreaInsets()
  return Platform.OS === 'ios' && insets.top >= DYNAMIC_ISLAND_INSET_THRESHOLD
}

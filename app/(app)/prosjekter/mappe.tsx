import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { Text } from '../../../components/text'
import { Pressable } from '../../../components/pressable'
import { ToolGlow } from '../../../components/tool-surface'
import { usePapirFokus } from '../../../components/papir-surface'
import { MappeInnhold, useMapper, mappeSti } from '../../../components/tegning-mapper'
import { database } from '../../../lib/db'
import { DrawingFolder } from '../../../lib/db/models/drawing-folder'
import { useUserId } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/** Én mappe: undermapper som rader, tegninger som fliser. Samme hode som prosjektet. */
export default function MappeScreen() {
  usePapirFokus() // hvit grunn → mørk statuslinje
  const insets = useSafeAreaInsets()
  const { folderId, projectId: pid } = useLocalSearchParams<{ folderId?: string; projectId?: string }>()
  const [mappe, setMappe] = useState<DrawingFolder | null>(null)
  const userId = useUserId()
  useEffect(() => {
    if (!folderId) return
    const sub = database.get<DrawingFolder>('drawing_folders').findAndObserve(folderId).subscribe({
      next: setMappe, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [folderId])
  const { mapper, tegninger } = useMapper(mappe?.projectId ?? pid ?? '')
  // «Uten mappe»: rota med tegningene som ikke ligger i noen mappe.
  if (!folderId && pid) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ToolGlow height={300} />
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cardGlassStrong, borderWidth: 0.5, borderColor: colors.glassEdge, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            <Text style={[t.title1, { marginTop: spacing.lg }]}>Uten mappe</Text>
          </View>
          <MappeInnhold projectId={pid} parentId={null} rotTegninger mapper={mapper} tegninger={tegninger} userId={userId} />
        </ScrollView>
      </View>
    )
  }
  if (!mappe) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />
  const sti = mappeSti(mappe.parentId, mapper)
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ToolGlow height={300} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{
              width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cardGlassStrong,
              borderWidth: 0.5, borderColor: colors.glassEdge, alignItems: 'center', justifyContent: 'center',
            }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          {sti.length > 0 && (
            <Text style={[t.eyebrow, { textTransform: 'uppercase', marginTop: spacing.lg }]} numberOfLines={1}>{sti.join(' / ')}</Text>
          )}
          <Text style={[t.title1, { marginTop: sti.length > 0 ? spacing.xs : spacing.lg }]}>{mappe.name}</Text>
        </View>
        <MappeInnhold projectId={mappe.projectId} parentId={mappe.id} mapper={mapper} tegninger={tegninger} userId={userId} />
      </ScrollView>
    </View>
  )
}

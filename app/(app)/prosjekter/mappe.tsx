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
import { Project } from '../../../lib/db/models/project'
import { useUserId } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'
import { TAB_BAR_HOYDE, tabBarBunn } from '../../../components/glass-tab-bar'

/** Én mappe: undermapper som rader, tegninger som fliser. Samme hode som prosjektet. */
export default function MappeScreen() {
  usePapirFokus() // hvit grunn → mørk statuslinje
  const insets = useSafeAreaInsets()
  const { folderId, projectId: pid } = useLocalSearchParams<{ folderId?: string; projectId?: string }>()
  const [mappe, setMappe] = useState<DrawingFolder | null>(null)
  const [prosjekt, setProsjekt] = useState<Project | null>(null)
  const userId = useUserId()
  const prosjektId = pid ?? mappe?.projectId ?? ''
  useEffect(() => {
    if (!prosjektId) return
    const sub = database.get<Project>('projects').findAndObserve(prosjektId).subscribe({ next: setProsjekt, error: () => {} })
    return () => sub.unsubscribe()
  }, [prosjektId])
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
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: TAB_BAR_HOYDE + tabBarBunn(insets.bottom) + spacing.xxl }} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            {!!prosjekt?.name && (
              <Text style={[t.eyebrow, { textTransform: 'uppercase', marginTop: spacing.lg }]} numberOfLines={1}>{prosjekt.name}</Text>
            )}
            <Text style={[t.title1, { marginTop: spacing.lg }]}>Løse tegninger</Text>
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
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: TAB_BAR_HOYDE + tabBarBunn(insets.bottom) + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{
              width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.bg,
              borderWidth: 1, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center',
            }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          {/* Brødsmule: prosjektet og mappene over. Mappa du står i er tittelen.
              Hvert ledd kan trykkes — en lang sti er en vei tilbake, ikke pynt. */}
          {(() => {
            const kjede: { id: string | null; navn: string }[] = []
            let opp = mappe.parentId
            let vakt = 0
            while (opp && vakt++ < 20) {
              const m = mapper.find(x => x.id === opp)
              if (!m) break
              kjede.unshift({ id: m.id, navn: m.name })
              opp = m.parentId
            }
            const ledd = [
              ...(prosjekt ? [{ id: null as string | null, navn: prosjekt.name }] : []),
              ...kjede,
            ]
            if (ledd.length === 0) return null
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: spacing.lg }}>
                {ledd.map((l, i) => (
                  <View key={l.id ?? 'prosjekt'} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <Text style={[t.caption, { color: colors.tertiaryLabel }]}>›</Text>}
                    <Pressable
                      haptic="light"
                      hitSlop={6}
                      onPress={() => {
                        if (!l.id) {
                          if (prosjekt) router.dismissTo({ pathname: '/(app)/prosjekter/[id]', params: { id: prosjekt.id } })
                        } else {
                          router.dismissTo({ pathname: '/(app)/prosjekter/mappe', params: { projectId: mappe.projectId, folderId: l.id } })
                        }
                      }}
                    >
                      <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.secondaryLabel }]} numberOfLines={1}>{l.navn}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )
          })()}
          <Text style={[t.title1, { marginTop: spacing.sm }]}>{mappe.name}</Text>
        </View>
        <MappeInnhold projectId={mappe.projectId} parentId={mappe.id} mapper={mapper} tegninger={tegninger} userId={userId} />
      </ScrollView>
    </View>
  )
}

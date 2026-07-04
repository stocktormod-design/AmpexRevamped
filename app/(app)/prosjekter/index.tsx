import { useEffect, useState } from 'react'
import { View, Text, FlatList } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Plus, FolderOpen, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { Project, projectStatusLabel } from '../../../lib/db/models/project'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    const sub = database.get<Project>('projects')
      .query(Q.where('status', Q.notEq('arkivert')), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setProjects)
    return () => sub.unsubscribe()
  }, [])
  return projects
}

export default function ProsjekterScreen() {
  const insets = useSafeAreaInsets()
  const projects = useProjects()

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <FlatList
        data={projects}
        keyExtractor={p => p.id}
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
            paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
          }}>
            <Text style={t.largeTitle}>Prosjekter</Text>
            <Pressable
              haptic="medium" pressScale={0.92}
              onPress={() => router.push('/(app)/prosjekter/ny')}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs }}
            >
              <Plus size={sizes.icon} color={colors.ctaLabel} strokeWidth={2.2} />
            </Pressable>
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: colors.bg, marginHorizontal: spacing.screen }}>
            <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg + sizes.iconChip - 8 + spacing.md }} />
          </View>
        )}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => router.push(`/(app)/prosjekter/${item.id}`)}
            style={{
              backgroundColor: colors.bg, marginHorizontal: spacing.screen,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
              flexDirection: 'row', alignItems: 'center',
              borderTopLeftRadius: index === 0 ? radius.lg : 0, borderTopRightRadius: index === 0 ? radius.lg : 0,
              borderBottomLeftRadius: index === projects.length - 1 ? radius.lg : 0, borderBottomRightRadius: index === projects.length - 1 ? radius.lg : 0,
            }}
          >
            <View style={{
              width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
            }}>
              <FolderOpen size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
            </View>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={t.bodyMedium} numberOfLines={1}>{item.name}</Text>
              <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                {[item.customerName, projectStatusLabel[item.status]].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, alignItems: 'center', paddingVertical: spacing.xxl }}>
            <Text style={t.headline}>Ingen prosjekter</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs }]}>Opprett et prosjekt for å legge til tegninger.</Text>
          </View>
        }
      />
    </View>
  )
}

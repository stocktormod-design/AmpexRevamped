import { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, Plus } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { supabase } from '../../../lib/supabase'
import { ProjectMember } from '../../../lib/db/models/project-member'
import { colors, spacing, radius, type as t } from '../../../lib/theme'

type Profile = { id: string; full_name: string; role: string }

const roleLabel: Record<string, string> = {
  owner: 'Eier', admin: 'Admin', bas: 'Bas', baas: 'Bas',
  installator: 'Installatør', montor: 'Montør', montør: 'Montør',
  laerling: 'Lærling', lærling: 'Lærling', apprentice: 'Lærling',
  regnskapsforer: 'Regnskapsfører',
}

export default function MedlemScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set())

  // Hent firmaets folk (online — RLS scoper til firma)
  useEffect(() => {
    let mounted = true
    supabase.from('profiles').select('id, full_name, role').is('deleted_at', null)
      .then(({ data }) => { if (mounted) setProfiles((data as Profile[]) ?? []) })
    return () => { mounted = false }
  }, [])

  // Eksisterende medlemmer (lokalt, reaktivt) for å markere lagt til
  useEffect(() => {
    if (!projectId) return
    const sub = database.get<ProjectMember>('project_members')
      .query(Q.where('project_id', projectId)).observe()
      .subscribe(ms => setMemberIds(new Set(ms.map(m => m.userId))))
    return () => sub.unsubscribe()
  }, [projectId])

  async function add(p: Profile) {
    if (!projectId || memberIds.has(p.id)) return
    await database.write(async () =>
      database.get<ProjectMember>('project_members').create(m => {
        m.projectId = projectId
        m.userId = p.id
        m.userName = p.full_name
        m.role = p.role
      }),
    )
    syncQuietly()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: spacing.lg }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Ferdig</Text>
        </Pressable>
        <Text style={t.headline}>Legg til folk</Text>
        <View style={{ width: 56 }} />
      </View>

      {profiles === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.secondaryLabel} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
            {profiles.map((p, i) => {
              const added = memberIds.has(p.id)
              return (
                <Pressable
                  key={p.id} onPress={() => add(p)} disabled={added} haptic={added ? 'none' : 'light'}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < profiles.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={t.body} numberOfLines={1}>{p.full_name}</Text>
                    <Text style={[t.footnote, { marginTop: 1 }]}>{roleLabel[p.role] ?? p.role}</Text>
                  </View>
                  {added
                    ? <Check size={18} color={colors.success} strokeWidth={2.4} />
                    : <Plus size={18} color={colors.iconMuted} strokeWidth={2.4} />}
                </Pressable>
              )
            })}
            {profiles.length === 0 && (
              <Text style={[t.footnote, { padding: spacing.lg }]}>Fant ingen folk i firmaet.</Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

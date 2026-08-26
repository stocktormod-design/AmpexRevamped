// Detektorliste — dokumentasjonsleveransen fra brannlaget (fase 4,
// docs/TEGNING_MULTIVIEW_PLAN.md). Genereres fra fire_devices per prosjekt,
// gruppert sløyfe → adresse (praksis: lista følger O-planen; detektornummer
// SKAL matche sentralens display — TBRT-veiledningen). Deles som CSV via
// systemets deleark nå; PDF/FDV-eksport hører til arkiv-sporet.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Share, View } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Share as ShareIcon } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { FireDevice, fireDeviceKindLabel } from '../../../lib/db/models/fire-device'
import { colors, radius, shadows, sizes, spacing, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

const WORKSPACE = '#EFEAE1'
const PANEL = 'rgba(252,252,253,0.96)'

export default function Detektorliste() {
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const [devices, setDevices] = useState<FireDevice[]>([])

  useEffect(() => {
    if (!projectId) return
    const sub = database.get<FireDevice>('fire_devices')
      .query(Q.where('project_id', projectId), Q.sortBy('tag', Q.asc))
      .observe().subscribe(setDevices)
    return () => sub.unsubscribe()
  }, [projectId])

  // Gruppér på sløyfe (tag-prefiks før punktum)
  const grupper = useMemo(() => {
    const m = new Map<string, FireDevice[]>()
    for (const d of devices) {
      const key = d.tag.includes('.') ? d.tag.split('.')[0] : '—'
      m.set(key, [...(m.get(key) ?? []), d])
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [devices])

  async function delCsv() {
    const header = 'Tag;Type;Modell;Serienummer'
    const rows = devices.map(d =>
      [d.tag, fireDeviceKindLabel[d.kind] ?? d.kind, d.model ?? '', d.serial ?? ''].join(';'))
    await Share.share({ message: [header, ...rows].join('\n') })
  }

  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + spacing.xxl, paddingHorizontal: spacing.screen }}>
        {grupper.map(([sloyfe, list]) => (
          <View key={sloyfe} style={{ marginBottom: spacing.lg }}>
            <Text style={[t.footnote, { color: colors.paperSecondary, marginBottom: spacing.xs, textTransform: 'uppercase' }]}>
              Sløyfe {sloyfe} · {list.length} komponenter
            </Text>
            <View style={[panel, { borderRadius: radius.lg, overflow: 'hidden' }]}>
              {list.map((d, i) => (
                <View key={d.id} style={{
                  flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
                  borderBottomWidth: i === list.length - 1 ? 0 : 0.5, borderBottomColor: 'rgba(0,0,0,0.06)',
                }}>
                  <Text style={[t.bodyMedium, { width: 72, fontVariant: ['tabular-nums'] }]}>{d.tag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={t.subhead}>{fireDeviceKindLabel[d.kind] ?? d.kind}{d.model ? ` · ${d.model}` : ''}</Text>
                    {!!d.serial && <Text style={t.caption}>SN {d.serial}</Text>}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
        {devices.length === 0 && (
          <Text style={[t.body, { color: colors.paperSecondary, textAlign: 'center', marginTop: spacing.xxl }]}>
            Ingen brannkomponenter plassert ennå.{'\n'}Bruk brann-verktøyet i tegningseditoren.
          </Text>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen, right: spacing.screen, flexDirection: 'row', justifyContent: 'space-between' }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 5, paddingRight: spacing.md, height: 44, borderRadius: radius.pill }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.subhead, { fontWeight: '700' }]}>Detektorliste</Text>
        </View>
        {devices.length > 0 && (
          <Pressable onPress={delCsv} pressScale={0.92}
            style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
            <ShareIcon size={sizes.icon - 2} color={colors.paperLabel} strokeWidth={2.1} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

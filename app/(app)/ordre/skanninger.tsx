import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, ScanLine } from 'lucide-react-native'
import { Text } from '../../../components/text'
import { Pressable } from '../../../components/pressable'
import { ScanCard } from '../../../components/scan-card'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { OrderScan, scanKindLabel, type ScanKind } from '../../../lib/db/models/order-scan'
import { deleteScanFiles, clearRevisions, archiveRevision } from '../../../lib/scan-revisions'
import { usePapirFokus } from '../../../components/papir-surface'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/**
 * SKANNENE av ett slag på en ordre — som tegningene inne i et prosjekt
 * (Tormod 2026-09-06: «når du trykker på Planlegging-skann skal det komme opp
 * skanns sånn som tegningene»). Fliser med miniatyr, og «Nytt skann» øverst.
 */
export default function SkanningerScreen() {
  usePapirFokus()
  const insets = useSafeAreaInsets()
  const { orderId, kind } = useLocalSearchParams<{ orderId: string; kind: ScanKind }>()
  const slag: ScanKind = kind === 'dokumentasjon' ? 'dokumentasjon' : 'planlegging'
  const [scans, setScans] = useState<OrderScan[]>([])
  useEffect(() => {
    if (!orderId) return
    const sub = database.get<OrderScan>('order_scans')
      .query(Q.where('order_id', orderId), Q.where('kind', slag), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setScans)
    return () => sub.unsubscribe()
  }, [orderId, slag])

  async function nytt() {
    if (!orderId) return
    const n = scans.length + 1
    let id = ''
    await database.write(async () => {
      const r = await database.get<OrderScan>('order_scans').create(s => { s.orderId = orderId; s.kind = slag; s.title = `${scanKindLabel[slag]} ${n}` })
      id = r.id
    })
    syncQuietly()
    router.push({ pathname: '/(app)/skann', params: { scanId: id, kind: scanKindLabel[slag], title: `${scanKindLabel[slag]} ${n}`, viewPath: '' } })
  }
  async function slett(s: OrderScan) {
    if (s.scanPath) await deleteScanFiles(s.scanPath)
    await clearRevisions(s.id)
    await database.write(async () => s.markAsDeleted())
    syncQuietly()
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
            </Pressable>
            <Pressable haptic="medium" pressScale={0.95} onPress={nytt}
              style={{ height: 38, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.label, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Plus size={16} color="#FFFFFF" strokeWidth={2.4} />
              <Text style={[t.subhead, { fontWeight: '600', color: '#FFFFFF' }]}>Nytt skann</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg }}>
            <ScanLine size={14} color={colors.secondaryLabel} strokeWidth={2.2} />
            <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>Skann</Text>
          </View>
          <Text style={[t.title1, { marginTop: 2 }]}>{scanKindLabel[slag]}</Text>
        </View>

        {scans.length === 0 ? (
          <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, borderStyle: 'dashed', alignItems: 'center', padding: spacing.xl }}>
            <Text style={[t.footnote, { textAlign: 'center' }]}>
              {slag === 'planlegging' ? 'Ingen planleggingsskann ennå. Mål opp rommet før jobben.' : 'Ingen dokumentasjonsskann ennå. Vis hvordan det ble.'}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
            {scans.map(s => (
              <View key={s.id} style={{ width: '48%', flexGrow: 1 }}>
                <ScanCard
                  title={s.title}
                  meta={new Date(s.createdAt).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
                  scanPath={s.scanPath}
                  revisionKey={s.id}
                  onOpen={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, ...(s.scanPath ? { viewPath: s.scanPath } : {}) } })}
                  onScan={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, viewPath: '' } })}
                  onOpenRevision={rev => router.push({ pathname: '/(app)/skann', params: { viewPath: rev.path, title: `${s.title} · ${new Date(rev.ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` } })}
                  onDelete={() => slett(s)}
                  onRebuilt={async path => {
                    if (s.scanPath) await archiveRevision(s.id, s.scanPath)
                    await database.write(async () => { await s.update(x => { x.scanPath = path }) })
                    syncQuietly()
                    router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, viewPath: path } })
                  }}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, ChevronRight, Plus, ScanLine, Box } from 'lucide-react-native'
import { Text } from '../../components/text'
import { Pressable } from '../../components/pressable'
import { ScanCard } from '../../components/scan-card'
import { usePapirFokus } from '../../components/papir-surface'
import { database } from '../../lib/db'
import { syncQuietly } from '../../lib/db/sync'
import { OrderScan, scanKindLabel } from '../../lib/db/models/order-scan'
import { Order } from '../../lib/db/models/order'
import { deleteScanFiles, clearRevisions, archiveRevision } from '../../lib/scan-revisions'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/**
 * SKANN — den dedikerte lista (Tormod 2026-09-06: «Ny skann på hjemsiden burde
 * ikke åpne en ordre, det burde være en dedikert skann-liste, den kan man finne
 * på Meg og Scans»). Alle 3D-skann, nyeste først; frie skann (uten ordre) og
 * skann på ordre om hverandre, med ordrenavnet som undertekst der det finnes.
 */
export default function SkannerScreen() {
  usePapirFokus()
  const insets = useSafeAreaInsets()
  const [scans, setScans] = useState<OrderScan[]>([])
  const [ordre, setOrdre] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const s1 = database.get<OrderScan>('order_scans')
      .query(Q.where('kind', Q.oneOf(['planlegging', 'dokumentasjon'])), Q.sortBy('created_at', Q.desc))
      .observe().subscribe(setScans)
    const s2 = database.get<Order>('orders').query().observe().subscribe(r => setOrdre(new Map(r.map(o => [o.id, o.title]))))
    return () => { s1.unsubscribe(); s2.unsubscribe() }
  }, [])

  async function nytt() {
    const n = scans.filter(s => !s.orderId).length + 1
    let id = ''
    await database.write(async () => {
      const r = await database.get<OrderScan>('order_scans').create(s => {
        s.orderId = null as unknown as string // fritt skann — knyttes til ordre senere
        s.kind = 'planlegging'
        s.title = `Skann ${n}`
      })
      id = r.id
    })
    syncQuietly()
    router.push({ pathname: '/(app)/skann', params: { scanId: id, kind: 'Skann', title: `Skann ${n}`, viewPath: '' } })
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
          <Text style={[t.display, { marginTop: spacing.lg }]}>Skann</Text>
        </View>

        {scans.length === 0 ? (
          <View style={{ marginHorizontal: spacing.screen, alignItems: 'center', paddingVertical: spacing.xxl }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
              <ScanLine size={24} color={colors.secondaryLabel} strokeWidth={1.8} />
            </View>
            <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen skann ennå</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>Trykk Nytt skann for å måle opp et rom.</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
            {scans.map(s => (
              <View key={s.id} style={{ width: '48%', flexGrow: 1 }}>
                <ScanCard
                  title={s.title}
                  meta={[s.orderId ? ordre.get(s.orderId) : null, scanKindLabel[s.kind] ?? s.kind].filter(Boolean).join(' · ')}
                  scanPath={s.scanPath}
                  revisionKey={s.id}
                  onOpen={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind] ?? 'Skann', title: s.title, ...(s.scanPath ? { viewPath: s.scanPath } : {}) } })}
                  onScan={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind] ?? 'Skann', title: s.title, viewPath: '' } })}
                  onOpenRevision={rev => router.push({ pathname: '/(app)/skann', params: { viewPath: rev.path, title: `${s.title} · ${new Date(rev.ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` } })}
                  onDelete={() => slett(s)}
                  onRebuilt={async path => {
                    if (s.scanPath) await archiveRevision(s.id, s.scanPath)
                    await database.write(async () => { await s.update(x => { x.scanPath = path }) })
                    syncQuietly()
                    router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind] ?? 'Skann', title: s.title, viewPath: path } })
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

// Multiview — flere tegninger samtidig (fase 2 i docs/TEGNING_MULTIVIEW_PLAN.md).
// iPhone: 2 ruter (stablet i portrett, side-ved-side i landskap). Hver rute har
// sin egen pan/zoom; synk-låsen (Dalux-mønsteret: global toggle nederst) kopierer
// den aktive rutas gest-DELTA inn i de andre ved gestslutt — deltaer, ikke
// absolutt posisjon, så to tegninger i ulik målestokk låses uten å hoppe, og
// inaktive ruter re-rendrer ikke midt i gesten. 2×2 på iPad kommer når raster-
// minnet er målt (samme komponent × 4).
import { useEffect, useMemo, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Link, Link2Off, Plus } from 'lucide-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Pressable } from '../../../components/pressable'
import { ChoiceSheet } from '../../../components/sheet'
import { DrawingPane, type PaneDelta, type PaneTransform } from '../../../components/drawing-pane'
import { database } from '../../../lib/db'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { colors, radius, shadows, sizes, spacing, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

const WORKSPACE = '#E7E7EC'
const PANEL = 'rgba(252,252,253,0.96)'
const PANES = 2

export default function Multiview() {
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const { projectId, drawingId } = useLocalSearchParams<{ projectId: string; drawingId?: string }>()

  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [paneIds, setPaneIds] = useState<(string | null)[]>([drawingId ?? null, null])
  const [locked, setLocked] = useState(true)
  const [picking, setPicking] = useState<number | null>(null)

  useEffect(() => {
    if (!projectId) return
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('plan', Q.asc), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setDrawings)
    return () => sub.unsubscribe()
  }, [projectId])

  // Rute-transformer eies HER (ikke i rutene) så synk-låsen kan skrive på tvers.
  // Fast antall hooks — PANES er konstant.
  const t0: PaneTransform = { scale: useSharedValue(1), tx: useSharedValue(0), ty: useSharedValue(0) }
  const t1: PaneTransform = { scale: useSharedValue(1), tx: useSharedValue(0), ty: useSharedValue(0) }
  const transforms = [t0, t1]

  function onPaneGestureEnd(from: number, d: PaneDelta) {
    if (!locked) return
    for (let i = 0; i < PANES; i++) {
      if (i === from) continue
      const tr = transforms[i]
      tr.scale.value = Math.min(Math.max(tr.scale.value * d.ds, 1), 8)
      tr.tx.value += d.dtx
      tr.ty.value += d.dty
    }
  }

  const byId = useMemo(() => new Map(drawings.map(d => [d.id, d])), [drawings])
  const portrait = win.height >= win.width
  const paneW = portrait ? win.width : win.width / PANES
  const paneH = portrait ? win.height / PANES : win.height
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      <View style={{ flex: 1, flexDirection: portrait ? 'column' : 'row' }}>
        {paneIds.slice(0, PANES).map((id, i) => {
          const d = id ? byId.get(id) : null
          return (
            <View key={i} style={{
              width: paneW, height: paneH, overflow: 'hidden',
              borderColor: 'rgba(0,0,0,0.12)',
              borderBottomWidth: portrait && i < PANES - 1 ? 1 : 0,
              borderRightWidth: !portrait && i < PANES - 1 ? 1 : 0,
            }}>
              {d ? (
                <DrawingPane
                  drawing={d} width={paneW} height={paneH} transform={transforms[i]}
                  onGestureEnd={delta => onPaneGestureEnd(i, delta)}
                />
              ) : (
                <Pressable onPress={() => setPicking(i)}
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
                  <View style={{ width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
                    <Plus size={26} color={colors.paperSecondary} strokeWidth={2} />
                  </View>
                  <Text style={[t.footnote, { color: colors.paperSecondary }]}>Velg tegning</Text>
                </Pressable>
              )}
              {/* Rutas navnepill — tap for å bytte tegning */}
              {d && (
                <Pressable onPress={() => setPicking(i)} pressScale={0.95}
                  style={[panel, {
                    position: 'absolute', top: spacing.sm + (i === 0 ? insets.top + 44 : 0), left: spacing.screen,
                    paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill,
                    justifyContent: 'center', maxWidth: paneW * 0.6,
                  }]}>
                  <Text style={[t.caption, { fontWeight: '700' }]} numberOfLines={1}>
                    {d.name}{d.plan ? ` · ${d.plan}` : ''}
                  </Text>
                </Pressable>
              )}
            </View>
          )
        })}
      </View>

      {/* Topp: tilbake */}
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen }} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} pressScale={0.92}
          style={[panel, { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
          <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Synk-lås — nederst i tommelsonen (Dalux-mønsteret) */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.md, alignItems: 'center' }} pointerEvents="box-none">
        <Pressable haptic="light" pressScale={0.95} onPress={() => setLocked(v => !v)}
          style={[panel, {
            flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
            paddingHorizontal: spacing.lg, height: 40, borderRadius: radius.pill,
            backgroundColor: locked ? colors.paperLabel : PANEL,
          }]}>
          {locked
            ? <Link size={16} color="#fff" strokeWidth={2.2} />
            : <Link2Off size={16} color={colors.paperLabel} strokeWidth={2.2} />}
          <Text style={[t.footnote, { fontWeight: '700', color: locked ? '#fff' : colors.paperLabel }]}>
            {locked ? 'Låst sammen' : 'Fri'}
          </Text>
        </Pressable>
      </View>

      <ChoiceSheet
        synlig={picking !== null}
        tittel="Velg tegning"
        valg={drawings.map(d => ({
          verdi: d.id,
          etikett: d.name,
          underetikett: [d.plan, disciplineLabel[d.discipline] ?? d.discipline].filter(Boolean).join(' · '),
        }))}
        valgt={picking !== null ? paneIds[picking] ?? undefined : undefined}
        onVelg={id => {
          if (picking === null) return
          setPaneIds(prev => prev.map((p, i) => (i === picking ? id : p)))
          setPicking(null)
        }}
        onAvbryt={() => setPicking(null)}
      />
    </View>
  )
}

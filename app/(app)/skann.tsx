import { useCallback, useEffect, useState } from 'react'
import { View, Alert, ScrollView } from 'react-native'
import { Text, TextInput } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { SvgXml } from 'react-native-svg'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { X, ScanLine, Check, TriangleAlert, Trash2, Undo2, Pencil } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { database } from '../../lib/db'
import { syncQuietly } from '../../lib/db/sync'
import { archiveRevision } from '../../lib/scan-revisions'
import { OrderScan } from '../../lib/db/models/order-scan'
import { Room } from '../../lib/db/models/room'
import { MeshMarker } from '../../lib/db/models/mesh-marker'
import { SYMBOLS, getSymbol, symbolSvg } from '../../lib/symbols'
import { useUserId } from '../../lib/auth-user'
import * as FileSystem from 'expo-file-system/legacy'
import { NativeMeshViewer, nativeSplatAvailable, presentMeshScan, resolveScanPath, type MeshScanResult, type PlanLine } from '../../lib/splat'
import { ensureScanLocal, ensureScanUploaded } from '../../lib/scan-storage'
import { supabase } from '../../lib/supabase'
import { colors, spacing, radius, type as t } from '../../lib/theme'

type MarkerSheetState = { mode: 'new'; point: { x: number; y: number; z: number } } | { mode: 'edit'; marker: MeshMarker } | null

type Stage = 'intro' | 'done' | 'view'
// To moduser: VIS (se rundt i skannet som Street View, AR-knappen viser redigeringene på veggene
// i rommet) og REDIGER (sett punkter og tegn linjer på modellen).
type Visning = 'vis' | 'rediger'
type Verktøy = 'punkt' | 'linje'
const VERKTØY: { id: Verktøy; label: string }[] = [{ id: 'punkt', label: 'Punkt' }, { id: 'linje', label: 'Linje' }]

// Planlagte linjer (§110) ligger i en fil ved siden av modellen, `<glb>.linjer.json`: de hører til
// DENNE revisjonen (samme koordinater som GLB-en og relokaliseringskartet). Bare lokalt foreløpig —
// ikke synket, så en kollega ser dem ikke.
const linjeFil = (glbPath: string) => 'file://' + glbPath + '.linjer.json'
async function lesLinjer(glbPath: string): Promise<PlanLine[]> {
  try { return JSON.parse(await FileSystem.readAsStringAsync(linjeFil(glbPath))) } catch { return [] }
}

export default function SkannScreen() {
  const insets = useSafeAreaInsets()
  const { scanId, roomId, kind, title, viewPath } = useLocalSearchParams<{ scanId?: string; roomId?: string; kind?: string; title?: string; viewPath?: string }>()
  // Åpnet for å SE et eksisterende skann → rett i vieweren (Skann på nytt tilgjengelig derfra)
  const opensExisting = !!viewPath
  const [stage, setStage] = useState<Stage>(opensExisting ? 'view' : 'intro')
  const [mesh, setMesh] = useState<MeshScanResult | null>(
    viewPath
      ? { glbPath: resolveScanPath(viewPath), framesDir: '', keyframes: 0, textured: true, filledFraction: null, geometryPath: 'anchor-v2' }
      : null,
  )
  // Punkter er knyttet til DENNE skann-revisjonen (scan_path) — ikke bare rommet/ordren.
  // Skannes på nytt, følger gamle punkter forrige GLB uten transform (se confirmRescan).
  const [scanPath, setScanPath] = useState<string | null>(viewPath ?? null)
  const [visning, setVisning] = useState<Visning>('vis')
  const [verktøy, setVerktøy] = useState<Verktøy>('linje')
  const [lines, setLines] = useState<PlanLine[]>([])
  const [draft, setDraft] = useState<[number, number, number][]>([])
  const [markers, setMarkers] = useState<MeshMarker[]>([])
  const [sheet, setSheet] = useState<MarkerSheetState>(null)
  const userId = useUserId()

  // Expo Router GJENBRUKER denne skjerm-instansen (den bor i tab-navigatoren): et nytt
  // «push» remounter ikke, og useState-startverdiene kjører ikke på nytt. En ren
  // [viewPath]-effekt var ikke nok — navigeres det hit på nytt med IDENTISKE parametre
  // (skann → «Skann ferdig» → lukk → slett → «Skann» igjen) endres ingenting, og skjermen
  // ble stående på forrige økts «Skann ferdig» med den gamle modellen. Re-synk derfor på
  // HVER fokusering: uten viewPath skal en (re)åpning alltid starte på intro.
  useFocusEffect(useCallback(() => {
    setVisning('vis')
    if (viewPath) {
      setStage('view')
      setMesh({ glbPath: resolveScanPath(viewPath), framesDir: '', keyframes: 0, textured: true, filledFraction: null, geometryPath: 'anchor-v2' })
      setScanPath(viewPath)
    } else {
      setStage('intro')
      setMesh(null)
      setScanPath(null)
    }
  }, [viewPath]))

  // Speil GLB-en mot R2 i bakgrunnen: finnes den lokalt men ikke i skyen → last opp
  // (f.eks. skann tatt offline); finnes den IKKE lokalt (kollegas skann, reinstallert
  // app) → hent ned og remount vieweren (glbReload — samme sti, så prop-endring alene
  // trigger ikke ny SceneKit-load). Stille ved feil — synk er usynlig (regel 2).
  const [glbReload, setGlbReload] = useState(0)
  useEffect(() => {
    if (!viewPath) return
    let alive = true
    ;(async () => {
      const abs = resolveScanPath(viewPath)
      const info = await FileSystem.getInfoAsync('file://' + abs).catch(() => null)
      if (info?.exists) { ensureScanUploaded(viewPath).catch(() => {}); return }
      const got = await ensureScanLocal(viewPath)
      if (alive && got) setGlbReload(n => n + 1)
    })()
    return () => { alive = false }
  }, [viewPath])

  useEffect(() => {
    setDraft([])
    if (!mesh?.glbPath) { setLines([]); return }
    let alive = true
    lesLinjer(mesh.glbPath).then(l => { if (alive) setLines(l) })
    return () => { alive = false }
  }, [mesh?.glbPath])

  async function saveLines(next: PlanLine[]) {
    setLines(next)
    if (mesh?.glbPath) await FileSystem.writeAsStringAsync(linjeFil(mesh.glbPath), JSON.stringify(next)).catch(() => {})
  }

  function finishLine() {
    if (draft.length >= 2) saveLines([...lines, { id: String(Date.now()), punkter: draft }])
    setDraft([])
  }

  function undoLine() {
    if (draft.length > 0) { setDraft(draft.slice(0, -1)); return }
    if (lines.length > 0) saveLines(lines.slice(0, -1))
  }

  useEffect(() => {
    if (!scanPath) { setMarkers([]); return }
    const sub = database.get<MeshMarker>('mesh_markers')
      .query(Q.where('scan_path', scanPath))
      .observe()
      .subscribe(setMarkers)
    return () => sub.unsubscribe()
  }, [scanPath])

  async function saveMarker(symbolId: string, note: string) {
    if (sheet?.mode === 'new') {
      const { point } = sheet
      await database.write(async () => {
        await database.get<MeshMarker>('mesh_markers').create(m => {
          m.roomId = roomId ?? null
          m.orderScanId = scanId ?? null
          m.scanPath = scanPath!
          m.x = point.x; m.y = point.y; m.z = point.z
          m.symbolId = symbolId
          m.note = note || null
          m.createdBy = userId
        })
      })
    } else if (sheet?.mode === 'edit') {
      const { marker } = sheet
      await database.write(async () => { await marker.update(m => { m.symbolId = symbolId; m.note = note || null }) })
    }
    syncQuietly()
    setSheet(null)
  }

  async function deleteMarker(m: MeshMarker) {
    await database.write(async () => { await m.markAsDeleted() })
    syncQuietly()
    setSheet(null)
  }

  function confirmRescan() {
    if (markers.length === 0) { setMesh(null); setStage('intro'); return }
    Alert.alert(
      'Skann på nytt?',
      `${markers.length} punkt${markers.length === 1 ? '' : 'er'} er merket på denne 3D-modellen. De følger denne versjonen og vises ikke på den nye skannen.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Skann på nytt', style: 'destructive', onPress: () => { setMesh(null); setStage('intro') } },
      ],
    )
  }

  // PRIMÆR flyt: juni-mesh-pipelinen (teksturert GLB) — egen fullskjerm native UI.
  async function startMeshScan() {
    try {
      const r = await presentMeshScan('ampex', scanId ?? roomId ?? 'rom')
      const path = r.relativePath || r.glbPath
      await persistPath(path)
      ensureScanUploaded(path).catch(() => {}) // speil til R2 i bakgrunnen — stille ved offline
      setScanPath(path)
      setMesh(r)
      setStage('done')
    } catch (e: any) {
      const message = typeof e?.message === 'string' ? e.message : 'Ukjent feil'
      if (message !== 'Skann avbrutt') Alert.alert('Skann feilet', message)
      // avbrutt eller feilet → tilbake til intro
      setStage('intro')
    }
  }

  const heading = title || (kind ? `${kind} · LiDAR` : 'LiDAR-skann')

  async function persistPath(path: string) {
    try {
      if (scanId) {
        const s = await database.get<OrderScan>('order_scans').find(scanId)
        if (s.scanPath && s.scanPath !== path) await archiveRevision(scanId, s.scanPath) // aldri destruktivt
        await database.write(async () => { await s.update(x => { x.scanPath = path }) })
        syncQuietly()
      } else if (roomId) {
        const r = await database.get<Room>('rooms').find(roomId)
        if (r.scanPath && r.scanPath !== path) await archiveRevision(roomId, r.scanPath)
        await database.write(async () => { await r.update(x => { x.scanPath = path }) })
        syncQuietly()
      }
    } catch { /* rad borte */ }
  }

  function close() {
    router.back()
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0B0C' }}>
      {/* 3D-viewer: teksturert mesh (GLB, SceneKit) — kun device/prebuild */}
      {stage === 'view' && mesh && NativeMeshViewer && (
        <NativeMeshViewer
          key={`${mesh.glbPath}#${glbReload}`}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          glbPath={mesh.glbPath}
          markerMode={visning === 'rediger'}
          markers={JSON.stringify(markers.map(m => ({ id: m.id, x: m.x, y: m.y, z: m.z })))}
          lines={JSON.stringify(draft.length ? [...lines, { id: 'utkast', punkter: draft }] : lines)}
          onTapPoint={(e: any) => {
            const p = e.nativeEvent
            if (visning !== 'rediger') return
            if (verktøy === 'punkt') setSheet({ mode: 'new', point: p })
            else setDraft(d => [...d, [p.x, p.y, p.z]])
          }}
          onTapMarker={(e: any) => {
            const m = markers.find(x => x.id === e.nativeEvent.id)
            if (m) setSheet({ mode: 'edit', marker: m })
          }}
        />
      )}

      {/* Topp: lukk + tittel */}
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen, right: spacing.screen, zIndex: 10, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable onPress={close} pressScale={0.92}
          style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <X size={20} color="#fff" strokeWidth={2.2} />
        </Pressable>
        <Text style={[t.headline, { color: '#fff', flex: 1 }]} numberOfLines={1}>{heading}</Text>
        {stage === 'view' && !!mesh && (
          visning === 'vis' ? (
            <Pressable onPress={() => setVisning('rediger')} haptic="light" pressScale={0.95}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)' }}>
              <Pencil size={15} color="#fff" strokeWidth={2.2} />
              <Text style={[t.subhead, { color: '#fff', fontWeight: '600' }]}>Rediger</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => { finishLine(); setVisning('vis') }} haptic="medium" pressScale={0.95}
              style={{ height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: '#fff', justifyContent: 'center' }}>
              <Text style={[t.subhead, { color: '#000', fontWeight: '600' }]}>Ferdig</Text>
            </Pressable>
          )
        )}
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen }}>
        {stage === 'intro' && (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <ScanLine size={44} color="#fff" strokeWidth={1.5} />
            </View>
            <Text style={[t.title1, { color: '#fff', marginTop: spacing.xl }]}>Skann rommet</Text>
          </Animated.View>
        )}

        {stage === 'done' && (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={48} color="#fff" strokeWidth={3} />
            </View>
            <Text style={[t.title1, { color: '#fff', marginTop: spacing.xl }]}>Skann ferdig</Text>
            <Text style={[t.body, { color: 'rgba(255,255,255,0.6)', marginTop: spacing.sm }]}>
              {mesh
                ? mesh.textured
                  ? `${mesh.keyframes} bilder · teksturert 3D-modell klar`
                  : `${mesh.keyframes} bilder · 3D-modell klar (uten tekstur)`
                : '3D-modell klar'}
            </Text>
            {!!mesh && (!mesh.textured || mesh.geometryPath === 'anchor-fallback' || (mesh.filledFraction !== null && mesh.filledFraction < 0.8)) && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
                backgroundColor: 'rgba(255,149,0,0.16)', borderRadius: radius.pill,
                paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, marginTop: spacing.md,
              }}>
                <TriangleAlert size={14} color={colors.warning} strokeWidth={2.2} />
                <Text style={[t.footnote, { color: colors.warning, fontWeight: '600' }]}>
                  {!mesh.textured ? 'Uten tekstur' : 'Lav dekning i deler av rommet'}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      {/* Bunn-CTA per steg */}
      <View style={{ position: 'absolute', left: spacing.screen, right: spacing.screen, bottom: insets.bottom + spacing.lg }}>
        {stage === 'intro' && (
          <Cta
            label="Start skann"
            onPress={() =>
              nativeSplatAvailable
                ? startMeshScan()
                : Alert.alert('Skanning utilgjengelig', '3D-skanning krever en dev-build på en enhet med LiDAR.')
            }
          />
        )}
        {stage === 'done' && (
          <View style={{ gap: spacing.sm }}>
            {!!mesh && NativeMeshViewer && (
              <Cta label="Åpne i 3D" onPress={() => setStage('view')} />
            )}
            <Pressable onPress={close} pressScale={0.97}
              style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: 'rgba(255,255,255,0.7)' }]}>Lukk</Text>
            </Pressable>
          </View>
        )}
        {stage === 'view' && (
          <View style={{ gap: spacing.sm }}>
            {!!mesh && visning === 'rediger' && (
              <View style={{ flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.pill, padding: 3 }}>
                {VERKTØY.map(v => (
                  <Pressable key={v.id} haptic="light" pressScale={0.96} onPress={() => { if (v.id !== 'linje') finishLine(); setVerktøy(v.id) }}
                    style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: verktøy === v.id ? colors.brand : 'transparent' }}>
                    <Text style={[t.subhead, { color: '#fff', fontWeight: '600' }]}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {visning === 'rediger' && markers.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: 2 }}>
                {markers.map(m => {
                  const sym = getSymbol(m.symbolId)
                  return (
                    <Pressable key={m.id} haptic="light" pressScale={0.95} onPress={() => setSheet({ mode: 'edit', marker: m })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                      {!!sym && <SvgXml xml={symbolSvg(sym.id, '#fff')} width={14} height={14} />}
                      <Text style={[t.footnote, { color: '#fff', fontWeight: '600' }]}>{sym?.label ?? m.symbolId}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            )}
            {visning === 'rediger' && verktøy === 'linje' && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
                <Pressable haptic="light" pressScale={0.96} onPress={undoLine} disabled={draft.length === 0 && lines.length === 0}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                  <Undo2 size={16} color="#fff" strokeWidth={2} />
                  <Text style={[t.subhead, { color: '#fff', fontWeight: '600' }]}>Angre</Text>
                </Pressable>
                <Pressable haptic="medium" pressScale={0.96} onPress={finishLine} disabled={draft.length < 2}
                  style={{ paddingHorizontal: spacing.lg, height: 36, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: draft.length >= 2 ? '#fff' : 'rgba(255,255,255,0.08)' }}>
                  <Text style={[t.subhead, { color: draft.length >= 2 ? '#000' : 'rgba(255,255,255,0.4)', fontWeight: '600' }]}>Ferdig linje</Text>
                </Pressable>
              </View>
            )}
            {visning !== 'vis' && verktøy !== 'punkt' && draft.length > 0 && (
              <Text style={[t.footnote, { color: 'rgba(255,255,255,0.55)', textAlign: 'center' }]}>
                {`${draft.length} punkt${draft.length === 1 ? '' : 'er'}`}
              </Text>
            )}
            {visning === 'vis' && opensExisting && (scanId || roomId) && (
              <Pressable onPress={confirmRescan} pressScale={0.97}
                style={{ height: 48, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[t.headline, { color: '#fff' }]}>Skann på nytt</Text>
              </Pressable>
            )}
            <Pressable onPress={() => (opensExisting ? close() : setStage('done'))} pressScale={0.97}
              style={{ height: 48, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: '#fff' }]}>{opensExisting ? 'Lukk' : 'Tilbake'}</Text>
            </Pressable>
          </View>
        )}
      </View>

      {sheet && (
        <MarkerSheet
          initialSymbolId={sheet.mode === 'edit' ? sheet.marker.symbolId : undefined}
          initialNote={sheet.mode === 'edit' ? sheet.marker.note : undefined}
          onSave={saveMarker}
          onDelete={sheet.mode === 'edit' ? () => deleteMarker(sheet.marker) : undefined}
          onCancel={() => setSheet(null)}
        />
      )}
    </View>
  )
}

function Cta({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable haptic="medium" pressScale={0.97} onPress={onPress} disabled={disabled}
      style={{ height: 54, borderRadius: radius.xl, backgroundColor: disabled ? 'rgba(255,255,255,0.16)' : '#fff', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.6 : 1 }}>
      <Text style={[t.headline, { color: disabled ? 'rgba(255,255,255,0.6)' : '#000' }]}>{label}</Text>
    </Pressable>
  )
}

/** Bunnark for nytt/eksisterende 3D-punkt: velg symbol (gjenbruker lib/symbols.ts), notat, lagre/slett. */
function MarkerSheet({ initialSymbolId, initialNote, onSave, onDelete, onCancel }: {
  initialSymbolId?: string
  initialNote?: string | null
  onSave: (symbolId: string, note: string) => void
  onDelete?: () => void
  onCancel: () => void
}) {
  const [symbolId, setSymbolId] = useState(initialSymbolId ?? SYMBOLS[0].id)
  const [note, setNote] = useState(initialNote ?? '')
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onCancel} />
      <View style={{ backgroundColor: '#17171A', borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero, padding: spacing.screen, paddingBottom: spacing.xxl }}>
        <Text style={[t.headline, { color: '#fff', marginBottom: spacing.md }]}>Velg type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
          {SYMBOLS.map(s => {
            const active = symbolId === s.id
            return (
              <Pressable key={s.id} haptic="light" pressScale={0.95} onPress={() => setSymbolId(s.id)} style={{ alignItems: 'center', gap: 4, width: 56 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: active ? colors.brand : 'rgba(255,255,255,0.08)',
                }}>
                  <SvgXml xml={symbolSvg(s.id, active ? '#fff' : 'rgba(255,255,255,0.7)')} width={22} height={22} />
                </View>
                <Text style={[t.caption, { color: active ? '#fff' : 'rgba(255,255,255,0.5)' }]} numberOfLines={1}>{s.label}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Notat (valgfritt)"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={{
            color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.lg,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, marginTop: spacing.sm, marginBottom: spacing.lg,
          }}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {!!onDelete && (
            <Pressable haptic="medium" onPress={onDelete} pressScale={0.97}
              style={{ width: 52, height: 52, borderRadius: radius.xl, borderWidth: 1, borderColor: 'rgba(255,59,48,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={20} color={colors.danger} strokeWidth={2} />
            </Pressable>
          )}
          <Pressable haptic="medium" onPress={() => onSave(symbolId, note.trim())} pressScale={0.97}
            style={{ flex: 1, height: 52, borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[t.headline, { color: '#fff' }]}>Lagre</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

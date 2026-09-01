import { useCallback, useEffect, useState } from 'react'
import { View, Alert, ScrollView } from 'react-native'
import { Text, TextInput } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn } from 'react-native-reanimated'
import { SvgXml } from 'react-native-svg'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { X, ScanLine, Check, TriangleAlert, Trash2 } from 'lucide-react-native'
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
import { NativeMeshViewer, nativeSplatAvailable, presentMeshScan, rebakeMeshScan, buildSplat, resolveScanPath, type MeshScanResult } from '../../lib/splat'
import { ensureScanLocal, ensureScanUploaded } from '../../lib/scan-storage'
import { colors, spacing, radius, type as t } from '../../lib/theme'

type MarkerSheetState = { mode: 'new'; point: { x: number; y: number; z: number } } | { mode: 'edit'; marker: MeshMarker } | null

type Stage = 'intro' | 'done' | 'view'

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
  const [markerMode, setMarkerMode] = useState(false)
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
          markerMode={markerMode}
          markers={JSON.stringify(markers.map(m => ({ id: m.id, x: m.x, y: m.y, z: m.z })))}
          onTapPoint={(e: any) => markerMode && setSheet({ mode: 'new', point: e.nativeEvent })}
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
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen }}>
        {stage === 'intro' && (
          <Animated.View entering={FadeIn} style={{ alignItems: 'center' }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <ScanLine size={44} color="#fff" strokeWidth={1.5} />
            </View>
            <Text style={[t.title1, { color: '#fff', marginTop: spacing.xl }]}>Skann rommet</Text>
            <Text style={[t.body, { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: spacing.sm, maxWidth: 300 }]}>
              Beveg telefonen rolig rundt i rommet. LiDAR fanger dybde + farge og bygger en 3D-modell på enheten.
            </Text>
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
                  {!mesh.textured ? 'Uten tekstur. Vurder å skanne på nytt' : 'Lav dekning i deler av rommet'}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      {/* Bunn-CTA per steg */}
      <View style={{ position: 'absolute', left: spacing.screen, right: spacing.screen, bottom: insets.bottom + spacing.lg }}>
        {/* A/B-selen hører hjemme HER, rett over primærknappen — ikke inne i den sentrerte
            introteksten. Der lå den først, og da havnet den bak denne absolutt plasserte
            bunnblokka: rendret, men usynlig. Ikke __DEV__-gated, fordi selen må virke i et
            RELEASE-bygg — det er bare der bake-tider, termikk og wireframe-kadens er ekte.
            Viser seg kun når det ligger skann-bundler med fixture på enheten. */}
        {stage === 'intro' && nativeSplatAvailable && (
          <RebakeAB onResult={(glbPath) => {
            setMesh({ glbPath, framesDir: '', keyframes: 0, textured: true, filledFraction: null, geometryPath: 'anchor-v2' })
            setScanPath(null) // rebake-GLB er ikke en lagret revisjon — ingen punkter hører til
            setStage('view')
          }} />
        )}
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
            {!!mesh && (
              <View style={{ flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.pill, padding: 3 }}>
                {([false, true] as const).map(on => (
                  <Pressable key={String(on)} haptic="light" pressScale={0.96} onPress={() => setMarkerMode(on)}
                    style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: markerMode === on ? colors.brand : 'transparent' }}>
                    <Text style={[t.subhead, { color: '#fff', fontWeight: '600' }]}>{on ? 'Merk' : 'Se'}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {markers.length > 0 && (
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
            <Text style={[t.footnote, { color: 'rgba(255,255,255,0.55)', textAlign: 'center' }]}>
              {markerMode ? 'Trykk på flaten for å sette et punkt' : 'Dra for å se rundt · klyp for å gå · to fingre flytter · dobbelttrykk nullstiller'}
            </Text>
            {opensExisting && (scanId || roomId) && (
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

/**
 * A/B-sele for teksturbaken (KUN __DEV__). Lister skann-bundlene som ligger igjen på
 * enheten (`Documents/scan-frames/*` med fixture-mesh.bin) og baker den samme bundlen på
 * nytt — poenget er å sammenligne to bake-varianter av NØYAKTIG samme skann, ikke nye
 * skann der håndbevegelsen er en ukontrollert variabel.
 *
 * To knapper, null valg (flagg-matrisen ble «mindless» — brukerdom 2026-08-27):
 *   ny     = ingen flagg → dagens defaulter (hybrid multiband + warp + tone-trim + frynse-trim)
 *   gammel = dagens nits skrudd av (tonetrim/fringetrim off) → gårsdagens bake som referanse
 * Trenger en finere matrise igjen (enkeltflagg, terskler), sett flaggene her midlertidig —
 * mekanismen (rebakeMeshScan tar vilkårlige meshscan.*-strenger) står urørt.
 */
function RebakeAB({ onResult }: { onResult: (glbPath: string) => void }) {
  const [bundles, setBundles] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const dir = (FileSystem.documentDirectory ?? '') + 'scan-frames'
    FileSystem.readDirectoryAsync(dir)
      .then(async (names) => {
        const withFixture: string[] = []
        for (const n of names) {
          const info = await FileSystem.getInfoAsync(`${dir}/${n}/fixture-mesh.bin`)
          if (info.exists) withFixture.push(n)
        }
        setBundles(withFixture.sort().reverse())
      })
      .catch(() => setBundles([]))
  }, [])

  if (bundles.length === 0) return null

  const run = async (name: string, variant: 'ny' | 'jevn' | 'splat') => {
    const path = ((FileSystem.documentDirectory ?? '') + 'scan-frames/' + name).replace('file://', '')
    setBusy(`${name}:${variant}`)
    setNote(null)
    try {
      // Splat er ikke en bake: den skriver splat.ply ved siden av fixturen og har ingen GLB
      // å vise i mesh-vieweren ennå. Hent fila med devicectl og se på den utenfor appen.
      if (variant === 'splat') {
        const s = await buildSplat(path)
        setNote(`splat · ${(s.ms / 1000).toFixed(1)}s · ${s.bytes === null ? '?' : Math.round(s.bytes / 1024 / 1024)}MB`)
        onResult(s.plyPath) // vieweren kjenner .ply igjen og laster den som punktsky
        return
      }
      // «jevn» går etter FARGEVARIASJON mellom flater: gain-klemmen åpnes fra ±25 % til
      // ±40 % (loggene viser at gainene slår i den gamle klemmen, altså at utjevningen
      // stopper for tidlig), og tone-trimmen slås av så flere syn er med i lavfrekvens-
      // snittet. Prisen er at semi-gloss-sheen kan komme tilbake som svake bloom-flekker,
      // og at ekte lysforskjeller (skygge under et bord) dras litt mot hverandre.
      // Mild forenkling i BEGGE: TSDF-nett har 600k+ trekanter, og xatlas henger i mange
      // minutter på det. 250k er halvparten bort, som er nesten gratis på et surface-nets-nett
      // (flate vegger har like tett triangulering som detaljerte lister). Det HARDE taket
      // «on» (60k) er noe annet — det ga fasetter i taket da det ble prøvd i august.
      // Begge bygger geometrien fra RÅ LiDAR-dybde («tsdf») i stedet for ARKit-nettet.
      // Forskjellen er FARGE-utjevning, i to trinn:
      //   ny   = gain-klemme ±40 % + tone-trim av. Dette var «jevn», og er nå standard fordi
      //          den gamle standarden ga fire-fem lyshetsfelt med rette kanter på én hvit vegg.
      //   jevn = blend=raw: HELE teksturen er et warp-justert fullfrekvens-snitt.
      //
      // Dette er den manglende halvdelen av sub-pixel-planen. Warpen har kjørt hele tiden,
      // men multiband bruker den KUN i lavfrekvensen (final = vinner + blur(snitt) −
      // blur(vinner)) — altså på nøyaktig det som deretter blurres bort. Detaljen, der
      // smøringen mellom bilder faktisk synes, kommer fra ETT bilde uten warp. Derfor ga
      // hverken finere warp-rutenett eller adaptiv regularisering synlig utslag.
      // «raw» dropper vinnervalget og lar det warp-justerte snittet bære alle frekvenser.
      // Prisen ifølge koden: tonelapper der topp-K-settet skifter.
      //
      // TONE-TRIM ER SLÅTT PÅ IGJEN i «ny» (2026-09-01). Den ble laget 26. august mot
      // «oily vegg» — semi-gloss sheen flytter seg med synsvinkelen, så tre syn gir tre
      // svake bloom-flekker i lavfrekvensen, og trimmen midler kun de synene som er
      // FARGEMESSIG enige med vinneren. Jeg slo den av for å styrke eksponeringsutjevningen
      // mens gain-solven fortsatt drev. Nå som normaliseringen fjerner driften, er den
      // hjelpen ikke lenger nødvendig — og oljesmøren kom tilbake uten trimmen.
      //
      // FRI KLEMME ER PRØVD OG FORKASTET (device 2026-08-31): med normaliseringen på plass
      // ga «off» gain-lum 0.62–1.72, altså 2,8× spredning mellom lyseste og mørkeste bilde.
      // Enkeltbilder får da ekstreme gains som lager NYE flekker på veggen — verre enn det
      // klemmen på 0.4 ga (0.60–0.82, 1,4× spredning). Normaliseringen fjerner driften;
      // klemmen må fortsatt begrense SPREDNINGEN. De løser to ulike ting.
      // GAIN-KLEMMEN ER FERDIG UTFORSKET (2026-09-01). Målt: ved 0.4 slår gainene i BEGGE
      // grenser (0.60–1.40), ved 0.7 lander de fritt på 0.68–1.44. Solven har altså
      // KONVERGERT — den vil ikke utligne mer selv når den får lov. 0.7 er standard fordi
      // klemmen da ikke lenger kutter av noe.
      //
      // KONSEKVENS: fargeforskjeller som STÅR IGJEN er ikke eksponering mellom bilder. De er
      // ekte lys bakt inn i teksturen (sollys på en vegg gjorde den faktisk lysere der).
      // Ingen gain-utjevning kan fjerne det; det krever delighting — å skille albedo fra
      // lyssetting — som er en helt annen og mye større jobb. Ikke tune denne knotten videre.
      //
      // «jevn» er nå ett hakk mykere blanding (topk 3) for de flatene der to syn er for få.
      const shared = {
        'meshscan.geometry': 'tsdf',
        // 400k, ikke 250k: taket er rommets flateste flate og kollapses hardest av
        // kvadrikk-decimeringen — det er der fasettene dukker opp først (kodens egen
        // august-notat om «synlige store fasetter i taket»). 250k ble satt da xatlas tok
        // 99 s; med blokk-parallelliseringen tar den 10 s, så prisen for flere trekanter
        // er nå små sekunder i stedet for minutter.
        'meshscan.simplify': '400000',
        'meshscan.blend': 'raw',
        'meshscan.blendsharp': '12',
      }
      // A/B PÅ DEPTH SUPER-RES (JBU), etter at dybde-termen kom inn.
      //   ny   = JBU på (×3) med dybde-term: bildet OG dybden må være enige om en kant
      //   jevn = JBU helt av (kontroll — gir rent tak, men mister kantpresisjon på detaljer)
      // BEKREFTET på enhet: uten dybde-term utvidet JBU rommets bounding box med 2,4 m og
      // la falske flak foran taket. Med den skal detaljene (klokke, lister, karmer) beholdes.
      // Hypotese: JBU styrer dybdeinterpolasjonen etter kanter i RGB. Et hvitt tak har ingen
      // tekstur, men lysgradienter og skygger — leses de som kanter, lager JBU dybdesprang
      // som ikke finnes, og resultatet er flak som flyter foran taket.
      //
      // TIDLIGERE FORKASTET som årsak til de hvite flakene: decimering, viewer-lyssetting
      // (materialet er .constant), overeksponering, UV-blokker, frynse-trim. De hvite flakene i taket passer kodens egen beskrivelse av en
      // frynse: «åpne grenseflater med grazing-tekstur» — flater på skanngrensen som ingen
      // kamera så ordentlig, og som derfor får strukket, utsmurt tekstur. Trimmen er AVBRUTT
      // fordi 3,9 % kvalifiserer mot en vakt på 3 %.
      //   ny   = trim av (vakten avbryter) — dagens utseende
      //   jevn = terskel 5 %, altså trimmen får kjøre
      // Merk at 12 % ble prøvd tidligere og ga avflassing over hele rommet: da fjernet den
      // 6,3 % av flatene, altså ekte geometri. 5 % er akkurat nok til å slippe disse
      // gjennom uten å åpne for det.
      const r = await rebakeMeshScan(path, variant === 'ny'
        ? { ...shared, 'meshscan.gainclamp': '0.7', 'meshscan.topk': '2' }
        : { ...shared, 'meshscan.gainclamp': '0.7', 'meshscan.topk': '2', 'meshscan.jbu': '1' })
      setNote(`${variant} · ${(r.ms / 1000).toFixed(1)}s · fylt ${r.filledFraction === null ? '–' : Math.round(r.filledFraction * 100) + '%'}`)
      onResult(r.glbPath)
    } catch (e: any) {
      setNote(`feilet: ${e?.message ?? e}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={{ marginTop: spacing.xl, alignSelf: 'stretch', gap: spacing.sm }}>
      <Text style={[t.footnote, { color: 'rgba(255,255,255,0.4)' }]}>A/B-rebake (dev)</Text>
      {bundles.map(name => (
        <View key={name} style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.lg, padding: spacing.sm, gap: spacing.xs }}>
          <Text style={[t.caption, { color: 'rgba(255,255,255,0.5)' }]} numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {(['ny', 'jevn', 'splat'] as const).map(variant => (
              <Pressable key={variant} haptic="light" pressScale={0.96} disabled={busy !== null}
                onPress={() => run(name, variant)}
                style={{
                  flex: 1, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: busy === `${name}:${variant}` ? colors.brand : 'rgba(255,255,255,0.1)',
                  opacity: busy !== null && busy !== `${name}:${variant}` ? 0.4 : 1,
                }}>
                <Text style={[t.footnote, { color: '#fff', fontWeight: '600' }]}>
                  {busy === `${name}:${variant}` ? 'baker…' : variant}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {!!note && <Text style={[t.caption, { color: 'rgba(255,255,255,0.55)' }]}>{note}</Text>}
    </View>
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

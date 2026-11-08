import { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator, Alert, Platform, useWindowDimensions } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Grid2x2, Layers, ScanLine, ScanSearch, FileText, Flame, Link, Link2Off, MousePointer2, Pencil, Plus, Redo2, Rows2, Square, Undo2, Upload, Waypoints } from 'lucide-react-native'
import { useSharedValue } from 'react-native-reanimated'
import { Pressable } from '../../../components/pressable'
import { DrawingPane, type EditTool } from '../../../components/drawing-pane'
import { TaskPinSheet, type TaskPinSheetState } from '../../../components/task-pin-sheet'
import { Ark } from '../../../components/sheet'
import { TegningVelger } from '../../../components/tegning-velger'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { Room, tilPunkter } from '../../../lib/db/models/room'
import { finnRomPaaTegning } from '../../../lib/rom-fra-tegning'
import { finnKomponenterPaaTegning } from '../../../lib/brann-fra-tegning'
import { analyserTegning, type AnalyseSteg } from '../../../lib/tegning-analyse'
import { requestLidarScan } from '../../../lib/tasks'
import { DrawingMarkup, type Stroke } from '../../../lib/db/models/drawing-markup'
import { DrawingLoop } from '../../../lib/db/models/drawing-loop'
import { FireDevice } from '../../../lib/db/models/fire-device'
import { FireDeviceSheet } from '../../../components/fire-device-sheet'
import { Task } from '../../../lib/db/models/task'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
import { loadDraft, saveDraft, clearDraft } from '../../../lib/markup-drafts'
import { useUserId } from '../../../lib/auth-user'
import { colors, spacing, radius, sizes, shadows, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'
import { lagreSisteTegning } from '../../../lib/siste-tegning'

// Forma-lys arbeidsflate — matcher editoren
const WORKSPACE = '#E7E7EC'
// Kromen er BEKSORT og kantete (Tormod 08.11: «pitch black, proper autodesk») — ikke
// grått glass. Hårlinje i stedet for skygge, små hjørner, hvite ikoner. Aktiv = hvit plate.
const PANEL = '#000000'
const KANT = 'rgba(255,255,255,0.14)'
const DEMPET = 'rgba(255,255,255,0.58)'
const PLATE = 'rgba(255,255,255,0.10)'
const HJORNE = 8

// Dokken til høyre (Forma-mønsteret, Tormod 07.11): loddrett, verktøy med etikett.
const DOKK = PANEL
const FARGER = ['#FF3B30', '#0A84FF', '#34C759', '#FFD60A', '#000000']

type Ikon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

/** Verktøy i dokken: ikon over kort etikett. Aktiv = hvit plate med sort ikon. */
function DokkKnapp({ Icon, etikett, aktiv = false, disabled = false, onPress }: {
  Icon: Ikon; etikett?: string; aktiv?: boolean; disabled?: boolean; onPress: () => void
}) {
  const farge = aktiv ? colors.paperLabel : '#fff'
  return (
    <Pressable haptic="light" pressScale={0.92} disabled={disabled} onPress={onPress}
      accessibilityLabel={etikett}
      style={{
        width: 44, height: etikett ? 46 : 36, borderRadius: 5, alignItems: 'center', justifyContent: 'center', gap: 2,
        backgroundColor: aktiv ? '#fff' : 'transparent', opacity: disabled ? 0.35 : 1,
      }}>
      <Icon size={18} color={farge} strokeWidth={2} />
      {!!etikett && <Text style={{ fontSize: 9, lineHeight: 10, fontWeight: '600', color: aktiv ? colors.paperLabel : DEMPET }}>{etikett}</Text>}
    </Pressable>
  )
}

/** Navnepille inne i en rute — trykk for å bytte tegning i ruta. */
function RutePill({ tekst, top, onPress }: { tekst: string; top: number; onPress: () => void }) {
  // Hver rute har sin egen, likt plassert: trykk = bytt tegning i DENNE ruta (Tormod 04.11:
  // «det burde være lettere å se hvor man bytter tegning»).
  return (
    <Pressable onPress={onPress} pressScale={0.95} haptic="light"
      style={{
        position: 'absolute', top, left: spacing.sm, maxWidth: '75%',
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingLeft: spacing.md, paddingRight: spacing.sm, height: 32, borderRadius: HJORNE,
        backgroundColor: PANEL, borderWidth: 0.5, borderColor: KANT,
      }}>
      <Text style={[t.caption, { fontWeight: '700', flexShrink: 1, color: '#fff' }]} numberOfLines={1}>{tekst}</Text>
      <ChevronDown size={14} color={DEMPET} strokeWidth={2.4} />
    </Pressable>
  )
}

export default function TegningViewer() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { drawingId, split: splitParam, rom: romParam, delInn } = useLocalSearchParams<{ drawingId: string; split?: string; rom?: string; delInn?: string }>()
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [siblings, setSiblings] = useState<Drawing[]>([])
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const userId = useUserId()
  const win = useWindowDimensions()

  // Vieweren kjører på DrawingPane (rasterert side + eid transform + Skia) —
  // samme komponent som multiview. NB: kun side 1 inntil sideveksler bygges.
  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  useEffect(() => { scale.value = 1; tx.value = 0; ty.value = 0 }, [drawingId, scale, tx, ty])

  // ── Edit-modus (Autodesk-mønstrene: samme lerret, verktøylinje til høyre,
  // kontekstuell redigering ved valg — se research i TEGNING_MULTIVIEW_PLAN) ──
  const [tool, setTool] = useState<EditTool>('ingen')
  const [color, setColor] = useState('#FF3B30')
  const [penWidth, setPenWidth] = useState(4)
  const [draft, setDraft] = useState<Stroke[]>([])
  useEffect(() => {
    if (!drawingId) { setDraft([]); return }
    loadDraft(drawingId).then(setDraft)
  }, [drawingId])
  // Gjør om: strøkene du angret ligger her til du tegner noe nytt.
  const [redo, setRedo] = useState<Stroke[]>([])
  useEffect(() => { setRedo([]) }, [drawingId])
  function changeDraft(next: Stroke[], fraAngre = false) {
    setDraft(next)
    if (!fraAngre) setRedo([])
    if (drawingId) saveDraft(drawingId, next).catch(() => {})
  }
  function angre() {
    if (tool === 'sloyfe') { void angreNode(); return }
    const siste = draft[draft.length - 1]
    if (!siste) return
    setRedo(r => [...r, siste])
    changeDraft(draft.slice(0, -1), true)
  }
  function gjorOm() {
    const neste = redo[redo.length - 1]
    if (!neste) return
    setRedo(r => r.slice(0, -1))
    changeDraft([...draft, neste], true)
  }
  async function publish() {
    if (!drawing || draft.length === 0) return
    // Rad-formen fra v32: ÉN NY rad per publisering (aldri overskriv andres) —
    // fikser at samtidige publiseringer mistet strøk i blob-formen.
    await database.write(async () => {
      await database.get<DrawingMarkup>('drawing_markup').create(m => {
        m.drawingId = drawing.id
        m.data = JSON.stringify(draft)
        m.kind = 'stroke'
        m.createdBy = userId
      })
    })
    await clearDraft(drawing.id)
    setDraft([])
    syncQuietly()
  }

  // ── Brannkomponenter (fase 4): stempel-plassering med AUTO-TAG (neste ledige
  // adresse på sløyfe 01 — «plasser 40 detektorer uten å skrive ett tall»),
  // detaljer via velg-tapp. Arket åpnes IKKE per plassering (stempel-flyt). ──
  const [deviceSheet, setDeviceSheet] = useState<FireDevice | null>(null)
  async function placeDevice(pt: { x: number; y: number }) {
    if (!drawing) return
    const all = await database.get<FireDevice>('fire_devices')
      .query(Q.where('project_id', drawing.projectId)).fetch()
    let max = 0
    for (const d of all) {
      const m = /^01\.(\d+)$/.exec(d.tag)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    await database.write(async () => {
      await database.get<FireDevice>('fire_devices').create(d => {
        d.projectId = drawing.projectId
        d.drawingId = drawing.id
        d.x = pt.x; d.y = pt.y
        d.kind = 'royk'
        d.tag = `01.${String(max + 1).padStart(3, '0')}`
        d.createdBy = userId
      })
    })
    syncQuietly()
  }
  async function openDevice(id: string) {
    try { setDeviceSheet(await database.get<FireDevice>('fire_devices').find(id)) } catch {}
  }

  // Oppgave-pins: KUN mine åpne (synlighet er tildelt-bare, plan-avgjørelse).
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [pinSheet, setPinSheet] = useState<TaskPinSheetState>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [romEdit, setRomEdit] = useState(romParam === '1')
  const [lag, setLag] = useState({ sloyfer: true, komponenter: true, markering: true })
  const [lagMeny, setLagMeny] = useState(false)
  const lagEndret = romEdit || !lag.sloyfer || !lag.komponenter || !lag.markering
  useEffect(() => { if (romParam !== undefined) setRomEdit(romParam === '1') }, [romParam])
  const [romPanel, setRomPanel] = useState<Room | null>(null)
  const [skannBer, setSkannBer] = useState(false)
  const [deler, setDeler] = useState(false)
  const [finner, setFinner] = useState(false)
  const [maalestokk] = useState(50)

  // ── Sløyfene på tegningen: kjeden bygges i lerretet, men KONTROLLENE hører
  // hjemme i verktøylinja (ny sløyfe, angre siste node). Uten «ny sløyfe» kunne
  // du aldri starte sløyfe nr. 2 — alt havnet i den samme kjeden.
  const [loops, setLoops] = useState<DrawingLoop[]>([])
  useEffect(() => {
    if (!drawingId) { setLoops([]); return }
    const sub = database.get<DrawingLoop>('drawing_loops')
      .query(Q.where('drawing_id', drawingId), Q.sortBy('created_at', Q.asc))
      .observeWithColumns(['nodes', 'color', 'name']).subscribe(setLoops)
    return () => sub.unsubscribe()
  }, [drawingId])
  const aktivSloyfe = loops.length ? loops[loops.length - 1] : null
  async function nySloyfe() {
    if (!drawing) return
    const nr = loops.reduce((m, l) => Math.max(m, l.number ?? 0), 0) + 1
    await database.write(async () => {
      await database.get<DrawingLoop>('drawing_loops').create(l => {
        l.drawingId = drawing.id
        l.name = `Sløyfe ${nr}`
        l.number = nr
        l.color = color
        l.nodes = JSON.stringify([])
      })
    })
    syncQuietly()
  }
  async function angreNode() {
    const l = aktivSloyfe
    if (!l) return
    const n = l.nodeList
    await database.write(async () => {
      if (n.length <= 1 && loops.length > 1) await l.markAsDeleted()
      else await l.update(x => { x.nodes = JSON.stringify(n.slice(0, -1)) })
    })
    syncQuietly()
  }

  // ── Delt skjerm: et VERKTØY i tegningen, ikke en egen skjerm. Tegningen du
  // ser på blir øverste halvdel, du velger nederste. Skillelinja bærer låsen.
  // Visning: én rute · to (over/under) · fire (2×2, kun iPad). Telefonen veksler
  // én↔to; på iPad sykler knappen én → to → fire (Tormod 2026-09-06).
  type Visning = 'en' | 'to' | 'fire'
  const erPad = Platform.OS === 'ios' && (Platform as { isPad?: boolean }).isPad === true
  const [visning, setVisning] = useState<Visning>(splitParam === '1' ? 'to' : 'en')
  // Toppbaren viser ÉN tegning; trykk åpner lista over prosjektets tegninger (Tormod 2026-09-13).
  const [velger, setVelger] = useState(false)
  useEffect(() => { if (splitParam !== undefined) settVisning(splitParam === '1' ? 'to' : 'en') }, [splitParam]) // eslint-disable-line react-hooks/exhaustive-deps
  const split = visning !== 'en'
  /** Tegningene i rute 2–4 (rute 1 er `drawing`). */
  const [ruter, setRuter] = useState<(string | null)[]>([null, null, null])
  const [locked, setLocked] = useState(true)
  const [picking, setPicking] = useState<number | null>(null)
  const scale2 = useSharedValue(1), tx2 = useSharedValue(0), ty2 = useSharedValue(0)
  const scale3 = useSharedValue(1), tx3 = useSharedValue(0), ty3 = useSharedValue(0)
  const scale4 = useSharedValue(1), tx4 = useSharedValue(0), ty4 = useSharedValue(0)
  const alleTransformer = [
    { scale, tx, ty }, { scale: scale2, tx: tx2, ty: ty2 }, { scale: scale3, tx: tx3, ty: ty3 }, { scale: scale4, tx: tx4, ty: ty4 },
  ]
  const nullstill = () => { for (const m of alleTransformer) { m.scale.value = 1; m.tx.value = 0; m.ty.value = 0 } }
  function settVisning(v: Visning) {
    if (v === visning) return
    setRomEdit(false); setTool('ingen')
    nullstill()
    setVisning(v)
  }
  /**
   * Låst = ÉN transform for alle rutene (Tormod 04.11). Før ble endringen kopiert over
   * når du slapp: rutene sto stille under gesten, klemmene (zoom 1–8) og fokuspunktet
   * ga glidning over tid, og hver rute kunne flyttes for seg. Nå deler de verdiene,
   * så de beveger seg likt mens du drar og kan ikke komme ut av takt.
   */
  function byttLaas() {
    if (locked) {
      // Løs opp: hver rute fortsetter fra det felles bildet.
      for (let i = 1; i < 4; i++) {
        const m = alleTransformer[i]
        m.scale.value = scale.value; m.tx.value = tx.value; m.ty.value = ty.value
      }
    }
    setLocked(v => !v)
  }
  const transformFor = (i: number) => (locked && split ? alleTransformer[0] : alleTransformer[i])
  // Transformene er i skjermpiksler for rutas størrelse. Snur du telefonen eller iPad-en
  // endrer rutene størrelse, og en gammel forskyvning kan legge tegningen utenfor ruta.
  const forrigeVindu = useRef(`${win.width}x${win.height}`)
  useEffect(() => {
    const n = `${win.width}x${win.height}`
    if (n !== forrigeVindu.current) { forrigeVindu.current = n; nullstill() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.width, win.height])
  /** Ny tegning i rute i: start fra hele siden (gjelder bare ruta når den er fri). */
  function settRute(i: number, id: string) {
    if (i === 0) { router.setParams({ drawingId: id }); return }
    setRuter(r => r.map((x, k) => (k === i - 1 ? id : x)))
    if (!locked) { const m = alleTransformer[i]; m.scale.value = 1; m.tx.value = 0; m.ty.value = 0 }
  }
  useEffect(() => {
    if (!drawingId || !userId) { setMyTasks([]); return }
    const sub = database.get<Task>('tasks')
      .query(Q.where('drawing_id', drawingId), Q.where('assigned_to', userId), Q.where('status', 'open'))
      .observe().subscribe(setMyTasks)
    return () => sub.unsubscribe()
  }, [drawingId, userId])

  // Rommene på denne tegningen — usynlige treffområder, synlige i romredigering
  useEffect(() => {
    if (!drawingId) { setRooms([]); return }
    const sub = database.get<Room>('rooms')
      .query(Q.where('drawing_id', drawingId))
      .observeWithColumns(['shape', 'name', 'scan_path']).subscribe(setRooms)
    return () => sub.unsubscribe()
  }, [drawingId])

  /** Lagrer et rom sin form etter at et hjørne er dratt. */
  async function lagreRomForm(id: string, punkter: [number, number][]) {
    const rom = rooms.find(r => r.id === id)
    if (!rom) return
    await database.write(async () => { await rom.update(r => { r.shape = JSON.stringify({ points: punkter }) }) })
    syncQuietly()
  }

  const delInnKjørt = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (delInn && delInn !== '0' && localUri && drawing && delInnKjørt.current !== delInn) { delInnKjørt.current = delInn; setRomEdit(true); void delIRom() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delInn, localUri, drawing?.id])

  /** Kjører romdelingen på tegningen og lager ett rom per forslag. */
  async function delIRom() {
    if (!drawing || !localUri || deler) return
    setDeler(true)
    try {
      const forslag = await finnRomPaaTegning(localUri, { maalestokk })
      if (!forslag.length) { Alert.alert('Fant ingen rom'); return }
      forslag.sort((a, b) => b.areal - a.areal)
      await database.write(async () => {
        await database.batch(...forslag.map((f, i) => database.get<Room>('rooms').prepareCreate(r => {
          r.projectId = drawing.projectId
          r.drawingId = drawing.id
          r.plan = drawing.plan
          r.name = f.navn ?? `Rom ${i + 1}`
          r.shape = JSON.stringify({ points: f.punkter, ...(f.bekreftet === false ? { usikker: true } : {}) })
        })))
      })
      syncQuietly()
    } catch (e) {
      Alert.alert('Romdelingen stoppet', e instanceof Error ? e.message : String(e))
    } finally {
      setDeler(false)
    }
  }

  /**
   * Komponentene fra tegningens egen symbolforklaring → fire_devices, én per
   * symbol, så montøren kan trykke på dem (Tormod 2026-09-13). Se
   * lib/symbol-detekt.ts. Kjører lokalt; ingenting lastes opp.
   */
  async function finnKomponenter() {
    if (!drawing || !localUri || finner) return
    setFinner(true)
    try {
      const svar = await finnKomponenterPaaTegning(localUri)
      if (svar.utenForklaring) {
        Alert.alert('Fant ingen symbolforklaring')
        return
      }
      const iProsjektet = await database.get<FireDevice>('fire_devices').query(Q.where('project_id', drawing.projectId)).fetch()
      const paaTegningen = iProsjektet.filter(d => d.drawingId === drawing.id)
      // Alt som alt står der (innen 0,4 % av sidebredden) hoppes over — søket kan kjøres igjen.
      const nye = svar.forslag.filter(f => !paaTegningen.some(d => Math.hypot(d.x - f.x, d.y - f.y) < 0.004))
      if (!nye.length) { Alert.alert('Ingenting nytt', `${svar.forslag.length} komponenter, alle registrert`); return }
      // Auto-tag fortsetter der stempel-verktøyet slapp (neste ledige adresse på sløyfe 01).
      let max = 0
      for (const d of iProsjektet) { const m = /^01\.(\d+)$/.exec(d.tag); if (m) max = Math.max(max, parseInt(m[1], 10)) }
      await database.write(async () => {
        await database.batch(...nye.map((f, i) => database.get<FireDevice>('fire_devices').prepareCreate(d => {
          d.projectId = drawing.projectId
          d.drawingId = drawing.id
          d.x = f.x; d.y = f.y
          d.kind = f.kind
          d.tag = `01.${String(max + 1 + i).padStart(3, '0')}`
          d.note = [f.etikett, f.tillegg].filter(Boolean).join(' · ')
          d.source = 'tegning' // symbolet står alt på tegningen — bare trykkbar, ingen glyf oppå
          d.createdBy = userId
        })))
      })
      syncQuietly()
      Alert.alert('Komponenter fra tegningen', `${nye.length} lagt til · ${svar.symboltyper.length} symboltyper`)
    } catch (e) {
      console.error('[symbol] stoppet', e instanceof Error ? e.stack : e)
      Alert.alert('Søket stoppet', e instanceof Error ? e.message : String(e))
    } finally {
      setFinner(false)
    }
  }

  /**
   * Analysen ved første opplasting (lib/tegning-analyse.ts): komponenter fra
   * forklaringen og rom fra strekene, én gang per tegning, på telefonen som har
   * fila. Stempelet `analyzedAt` gjør at ingen andre regner på nytt.
   */
  const [analyse, setAnalyse] = useState<{ steg: AnalyseSteg; andel: number } | null>(null)
  const analyseStartet = useRef<string | null>(null)
  async function kjørAnalyse(d: Drawing, uri: string) {
    if (analyseStartet.current === d.id) return
    analyseStartet.current = d.id
    setAnalyse({ steg: 'leser', andel: 0 })
    const r = await analyserTegning(d, uri, userId, (steg, andel) => setAnalyse({ steg, andel }))
    setAnalyse(null)
    if (r.kind === 'utsatt') analyseStartet.current = null // prøv igjen neste gang
  }
  // Tegning med fil, aldri analysert, og fila er her: kjør én gang.
  useEffect(() => {
    if (drawing && localUri && drawing.filePath && !drawing.analyzedAt) void kjørAnalyse(drawing, localUri)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing?.id, drawing?.analyzedAt, localUri])

  // Aktiv tegning
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Drawing>('drawings').findAndObserve(drawingId).subscribe({
      next: setDrawing, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [drawingId])
  // «Sist åpnet» øverst i prosjektet.
  useEffect(() => { if (drawing) void lagreSisteTegning(drawing.projectId, drawing.id) }, [drawing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alle tegningene i prosjektet — grunnlaget for bytte-linja nederst. Uten
  // denne var det umulig å komme til tegning nummer to i det hele tatt.
  const projectId = drawing?.projectId
  useEffect(() => {
    if (!projectId) { setSiblings([]); return }
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('plan', Q.asc), Q.sortBy('name', Q.asc))
      .observe().subscribe(setSiblings)
    return () => sub.unsubscribe()
  }, [projectId])

  // (Den gamle «samme plan»-lista overskrev prosjektlista over, så velgeren
  // viste bare tegninger i samme plan. Fjernet 2026-09-13.)

  // Hent PDF lokalt (cache) når tegningen har en fil
  const filePath = drawing?.filePath
  useEffect(() => {
    let mounted = true
    if (!filePath) { setLocalUri(null); return }
    setBusy(true)
    getLocalPdf(filePath)
      .then(uri => { if (mounted) setLocalUri(uri) })
      .catch(() => { if (mounted) setLocalUri(null) })
      .finally(() => { if (mounted) setBusy(false) })
    return () => { mounted = false }
  }, [filePath])

  async function pickAndUpload() {
    if (!drawing) return
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.[0]) return
    setBusy(true)
    try {
      const key = await uploadDrawingPdf(drawing.id, res.assets[0].uri)
      await database.write(async () => { await drawing.update(d => { d.filePath = key }) })
      syncQuietly()
    } finally {
      setBusy(false)
    }
  }

  if (!drawing) return <View style={{ flex: 1, backgroundColor: WORKSPACE }} />
  const flerePlaner = new Set(siblings.map(d => d.plan)).size > 1
  // Tegningene i samme mappe, i samme rekkefølge som arkvelgeren — «‹ 3 av 8 ›».
  const mappeSosken = siblings.filter(d => (d.folderId ?? null) === (drawing.folderId ?? null))
  const posisjon = mappeSosken.findIndex(d => d.id === drawing.id)
  const DELER = 36
  const TOPP = insets.top + spacing.xs + 48 + spacing.xs // toppbaren skal ikke ligge over rutene
  // Nederste rute stopper over hjemmestreken (DeepSeek 07.11, funn 6).
  const paneH = (win.height - TOPP - DELER - insets.bottom) / 2
  const ruteH = paneH
  const ruteW = (win.width - DELER) / 2
  const rutenavn = (d: Drawing) => [d.name, flerePlaner ? d.plan : null].filter(Boolean).join(' · ')
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: KANT } as const
  const laasPille = (
    <Pressable haptic="light" pressScale={0.92} onPress={byttLaas}
      style={[panel, {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, height: 34, borderRadius: HJORNE,
        backgroundColor: locked ? '#fff' : PANEL,
      }]}>
      {locked ? <Link size={15} color={colors.paperLabel} strokeWidth={2.4} /> : <Link2Off size={15} color="#fff" strokeWidth={2.2} />}
      <Text style={[t.caption, { fontWeight: '700', color: locked ? colors.paperLabel : '#fff' }]}>{locked ? 'Låst' : 'Fri'}</Text>
    </Pressable>
  )
  /** Rute i (0 = tegningen du kom fra, 1–3 = valgte). Tom rute = «Velg tegning». */
  function rute(i: number, w: number, h: number) {
    const d = i === 0 ? drawing : (ruter[i - 1] ? siblings.find(x => x.id === ruter[i - 1]) ?? null : null)
    const m = transformFor(i)
    if (!d) {
      return (
        <Pressable onPress={() => setPicking(i)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={26} color={colors.paperSecondary} strokeWidth={2} />
          </View>
          <Text style={[t.subhead, { color: colors.paperSecondary, fontWeight: '600' }]}>Velg tegning</Text>
        </Pressable>
      )
    }
    return (
      <>
        <DrawingPane
          drawing={d} width={w} height={h}
          transform={m}
          rasterTak={visning === 'fire' ? 2048 : undefined}
          rooms={i === 0 ? rooms.map(r => ({ id: r.id, navn: r.name, punkter: r.shapePoints ?? [] })).filter(r => r.punkter.length >= 3) : undefined}
          onRoomLongPress={i === 0 ? id => setRomPanel(rooms.find(r => r.id === id) ?? null) : undefined}
        />
        <RutePill tekst={rutenavn(d)} top={spacing.sm} onPress={() => (i === 0 ? setVelger(true) : setPicking(i))} />
      </>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      {/* Lerret — DrawingPane (rasterert side + Skia-overlay). Langtrykk = ny
          oppgave-pin her; tap på pin = mitt oppgaveark. */}
      {localUri ? (
        split ? (
          <View style={{ flex: 1, paddingTop: TOPP }}>
            {visning === 'fire' ? (
              <>
                <View style={{ flexDirection: 'row', height: ruteH }}>
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(0, ruteW, ruteH)}</View>
                  <View style={{ width: DELER }} />
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(1, ruteW, ruteH)}</View>
                </View>
                <View style={{ height: DELER }} />
                <View style={{ flexDirection: 'row', height: ruteH }}>
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(2, ruteW, ruteH)}</View>
                  <View style={{ width: DELER }} />
                  <View style={{ width: ruteW, overflow: 'hidden' }}>{rute(3, ruteW, ruteH)}</View>
                </View>
                {/* Kryss + lås i midten */}
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: TOPP, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ruteH + DELER / 2, height: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: ruteW + DELER / 2, width: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  {laasPille}
                </View>
              </>
            ) : (
              <>
                <View style={{ height: paneH, overflow: 'hidden' }}>{rute(0, win.width, paneH)}</View>
                <View style={{ height: DELER, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', left: 0, right: 0, top: DELER / 2, height: 1, backgroundColor: 'rgba(0,0,0,0.18)' }} />
                  {laasPille}
                </View>
                <View style={{ height: paneH, overflow: 'hidden' }}>{rute(1, win.width, paneH)}</View>
              </>
            )}
          </View>
        ) : (
          <DrawingPane
          drawing={drawing}
          width={win.width} height={win.height}
          transform={{ scale, tx, ty }}
          pins={myTasks.filter(x => x.pinX !== null && x.pinY !== null).map(x => ({ id: x.id, x: x.pinX!, y: x.pinY! }))}
          edit={{ tool, color, width: penWidth, draft, onDraftChange: changeDraft, onPlaceDevice: placeDevice, onTapDevice: openDevice }}
          rooms={rooms.map(r => ({ id: r.id, navn: r.name, punkter: r.shapePoints ?? [] })).filter(r => r.punkter.length >= 3)}
          roomEdit={romEdit}
          lag={lag}
          maalestokk={maalestokk}
          onRoomShape={lagreRomForm}
          onRoomLongPress={id => setRomPanel(rooms.find(r => r.id === id) ?? null)}
          onNavigate={() => setTool('ingen')}
          onLongPress={pt => setPinSheet({ mode: 'ny', projectId: drawing.projectId, drawingId: drawing.id, x: pt.x, y: pt.y })}
          onTapPin={id => {
            const task = myTasks.find(x => x.id === id)
            if (task) setPinSheet({ mode: 'vis', task })
          }}
        />
        )
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {busy ? (
            <ActivityIndicator color={colors.paperSecondary} />
          ) : (
            <>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={30} color={colors.paperSecondary} strokeWidth={1.6} />
              </View>
              <Text style={[t.body, { color: colors.paperSecondary, marginTop: spacing.lg, textAlign: 'center' }]}>
                Ingen PDF lastet opp ennå
              </Text>
              <Pressable
                haptic="medium" onPress={pickAndUpload}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brand }}
              >
                <Upload size={sizes.icon - 2} color={colors.brandLabel} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.headline, { color: colors.brandLabel }]}>Legg til PDF</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* TOPPBAR (Tormod 2026-09-06: «ikke pillen top left, det burde være en bar»;
          2026-09-13: «øverst bar burde bare være 1 tegning, men hvis du trykker kan
          du velge i listen»): tilbake · tegningen du ser på (trykk = velg) · visning. */}
      <View style={{ position: 'absolute', top: insets.top + spacing.xs, left: spacing.sm, right: spacing.sm }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: 5, height: 48, borderRadius: HJORNE + 2 }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: 5, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color="#fff" strokeWidth={2.2} />
          </Pressable>
          <Pressable haptic="light" pressScale={0.97} disabled={siblings.length < 2}
            onPress={() => setVelger(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 36, paddingHorizontal: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[t.subhead, { fontWeight: '600', color: '#fff' }]} numberOfLines={1}>{drawing.name}</Text>
              {!!drawing.plan && drawing.plan !== drawing.name && (
                <Text style={[t.caption, { color: DEMPET, marginTop: -1 }]} numberOfLines={1}>{drawing.plan}</Text>
              )}
            </View>
            {siblings.length > 1 && <ChevronDown size={16} color={DEMPET} strokeWidth={2.2} />}
          </Pressable>
          {/* Lag (Claude + DeepSeek 08.11): rom er ett lag av flere, ikke en egen knapp. Bare
              lag som finnes — ingen døde rader. */}
          {localUri && !split && (
            <Pressable haptic="light" pressScale={0.92} onPress={() => setLagMeny(true)} accessibilityLabel="Lag"
              style={{ width: 36, height: 36, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: lagEndret ? '#fff' : PLATE }}>
              <Layers size={17} color={lagEndret ? colors.paperLabel : '#fff'} strokeWidth={2.1} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Analysen ved første opplasting — én tynn stripe, forsvinner når den er ferdig. */}
      {analyse && (
        <View style={{ position: 'absolute', top: insets.top + spacing.xs + 48 + spacing.sm, left: spacing.sm, right: spacing.sm, alignItems: 'center' }} pointerEvents="none">
          <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, height: 30, borderRadius: HJORNE }]}>
            <ActivityIndicator size="small" color={DEMPET} />
            <Text style={[t.caption, { color: DEMPET, fontWeight: '600' }]}>
              {analyse.steg === 'leser' ? 'Leser tegningen …'
                : analyse.steg === 'komponenter' ? `Finner komponenter … ${Math.round(analyse.andel * 100)} %`
                : analyse.steg === 'rom' ? 'Deler inn i rom …' : 'Lagrer …'}
            </Text>
          </View>
        </View>
      )}

      {/* DOKKEN til høyre (Forma-mønsteret, Tormod 07.11): verktøyene loddrett med
          etikett, valgene for verktøyet i hånda i et panel til venstre for dokken, angre/
          gjør om i en egen liten dokk under. Ingen «rediger-modus» — verktøyet i hånda ER
          modusen; trykk på aktivt verktøy legger det bort. Verktøyene gjelder én rute. */}
      {localUri && !split && (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: spacing.sm, top: TOPP + spacing.sm, bottom: insets.bottom + 110, justifyContent: 'center' }}>
          <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {/* Valgene for verktøyet: en smal stripe rett ved dokken (Formas utfelling).
                DeepSeek ville ha et bunnark så arket er fritt; dette er kompromisset — ~48 pt
                bredt, dekker nesten ingenting, og fargebytte er fortsatt ett trykk. */}
            {(tool === 'penn' || tool === 'sloyfe' || tool === 'brann') && (
              <View style={[panel, { borderRadius: HJORNE, paddingVertical: 8, paddingHorizontal: 6, gap: 8, alignItems: 'center' }]}>
                {(tool === 'penn' || tool === 'sloyfe') && FARGER.map(c => (
                  <Pressable key={c} haptic="light" onPress={() => setColor(c)} accessibilityLabel={`Farge ${c}`}
                    style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? '#fff' : 'rgba(255,255,255,0.35)' }} />
                ))}
                {tool === 'penn' && (
                  <>
                    <View style={{ width: 22, height: 0.5, backgroundColor: KANT }} />
                    {[2, 4, 8].map(w => (
                      <Pressable key={w} haptic="light" onPress={() => setPenWidth(w)} accessibilityLabel={`Strek ${w}`}
                        style={{ width: 32, height: 26, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: penWidth === w ? PLATE : 'transparent' }}>
                        <View style={{ width: 18, height: w, borderRadius: w / 2, backgroundColor: '#fff' }} />
                      </Pressable>
                    ))}
                  </>
                )}
                {tool === 'sloyfe' && (
                  <>
                    <View style={{ width: 22, height: 0.5, backgroundColor: KANT }} />
                    <Pressable haptic="medium" pressScale={0.92} onPress={nySloyfe} accessibilityLabel="Ny sløyfe"
                      style={{ width: 36, alignItems: 'center', gap: 1 }}>
                      <Plus size={18} color="#fff" strokeWidth={2.3} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff' }}>Ny</Text>
                    </Pressable>
                  </>
                )}
                {tool === 'brann' && (
                  /* Søket leser tegningens egen symbolforklaring — finnes den ikke, sier knappen fra. */
                  <Pressable haptic="medium" pressScale={0.92} onPress={finnKomponenter} disabled={finner} accessibilityLabel="Finn fra tegningen"
                    style={{ width: 40, alignItems: 'center', gap: 2, opacity: finner ? 0.5 : 1 }}>
                    {finner ? <ActivityIndicator size="small" color="#fff" /> : <ScanSearch size={19} color="#fff" strokeWidth={2.1} />}
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff' }}>Finn</Text>
                  </Pressable>
                )}
              </View>
            )}
            <View style={{ gap: spacing.sm }}>
              <View style={{ backgroundColor: DOKK, borderRadius: HJORNE, borderWidth: 0.5, borderColor: KANT, padding: 3, gap: 2 }}>
                {([
                  ['velg', MousePointer2, 'Velg'],
                  ['penn', Pencil, 'Penn'],
                ] as const).map(([tl, Icon, etikett]) => (
                  <DokkKnapp key={tl} Icon={Icon} etikett={etikett} aktiv={tool === tl}
                    onPress={() => { setRomEdit(false); setTool(v => (v === tl ? 'ingen' : tl)) }} />
                ))}
                <View style={{ height: 0.5, marginHorizontal: 6, marginVertical: 2, backgroundColor: KANT }} />
                {([
                  ['sloyfe', Waypoints, 'Sløyfe'],
                  ['brann', Flame, 'Brann'],
                ] as const).map(([tl, Icon, etikett]) => (
                  <DokkKnapp key={tl} Icon={Icon} etikett={etikett} aktiv={tool === tl}
                    onPress={() => { setRomEdit(false); setTool(v => (v === tl ? 'ingen' : tl)) }} />
                ))}
              </View>
              <View style={{ backgroundColor: DOKK, borderRadius: HJORNE, borderWidth: 0.5, borderColor: KANT, padding: 3, gap: 2 }}>
                <DokkKnapp Icon={Undo2} onPress={angre}
                  disabled={tool === 'sloyfe' ? !aktivSloyfe?.nodeList.length : draft.length === 0} />
                <DokkKnapp Icon={Redo2} onPress={gjorOm} disabled={tool === 'sloyfe' || redo.length === 0} />
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Publiser — flytende sort pille nede på midten, bare når det finnes kladd
          (DeepSeek 08.11: tommelvennlig, og toppen holdes til fire kontroller). */}
      {localUri && !split && draft.length > 0 && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.md, alignItems: 'center' }}>
          <Pressable haptic="medium" onPress={publish} pressScale={0.95}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, height: 44, borderRadius: HJORNE, backgroundColor: PANEL, borderWidth: 0.5, borderColor: KANT }}>
            <Check size={16} color="#fff" strokeWidth={2.6} />
            <Text style={[t.subhead, { fontWeight: '700', color: '#fff' }]}>{`Publiser ${draft.length}`}</Text>
          </Pressable>
        </View>
      )}

      {/* Nede til høyre (Formas ‹ ▦ ›): forrige/neste tegning i samme mappe · visning. */}
      {localUri && (
        <View style={{ position: 'absolute', right: spacing.sm, bottom: insets.bottom + spacing.md, alignItems: 'flex-end', gap: spacing.sm }}>
          {!split && mappeSosken.length > 1 && posisjon >= 0 && (
            <View style={[panel, { flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: HJORNE }]}>
              <Pressable haptic="light" pressScale={0.92} disabled={posisjon === 0} onPress={() => settRute(0, mappeSosken[posisjon - 1].id)} accessibilityLabel="Forrige tegning"
                style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', opacity: posisjon === 0 ? 0.3 : 1 }}>
                <ChevronLeft size={18} color="#fff" strokeWidth={2.2} />
              </Pressable>
              <Text style={[t.caption, { fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'center' }]}>{`${posisjon + 1} av ${mappeSosken.length}`}</Text>
              <Pressable haptic="light" pressScale={0.92} disabled={posisjon === mappeSosken.length - 1} onPress={() => settRute(0, mappeSosken[posisjon + 1].id)} accessibilityLabel="Neste tegning"
                style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', opacity: posisjon === mappeSosken.length - 1 ? 0.3 : 1 }}>
                <ChevronRight size={18} color="#fff" strokeWidth={2.2} />
              </Pressable>
            </View>
          )}
          <View style={[panel, { flexDirection: 'row', padding: 3, gap: 2, borderRadius: HJORNE }]}>
            {([
              ['en', Square, 'Én tegning'],
              ['to', Rows2, 'To tegninger'],
              ...(erPad ? [['fire', Grid2x2, 'Fire tegninger'] as const] : []),
            ] as const).map(([v, Icon, navn]) => (
              <Pressable key={v} haptic="light" pressScale={0.92} onPress={() => settVisning(v)} accessibilityLabel={navn}
                style={{ width: 40, height: 34, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: visning === v ? '#fff' : 'transparent' }}>
                <Icon size={17} color={visning === v ? colors.paperLabel : '#fff'} strokeWidth={2.1} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Lag-menyen. */}
      <Ark synlig={lagMeny} onLukk={() => setLagMeny(false)}>
        <View style={{ paddingHorizontal: spacing.screen, gap: spacing.xs }}>
          <Text style={[t.title3, { marginBottom: spacing.sm }]}>Lag</Text>
          {([
            ['rom', 'Rom', 'Vis og juster rommene', romEdit],
            ['sloyfer', 'Sløyfer', 'Kabelsløyfene på tegningen', lag.sloyfer],
            ['komponenter', 'Komponenter', 'Brannkomponenter du har plassert', lag.komponenter],
            ['markering', 'Markering', 'Publiserte strøk', lag.markering],
          ] as const).map(([k, navn, under, paa]) => (
            <Pressable key={k} haptic="light"
              onPress={() => {
                if (k === 'rom') { setRomEdit(v => !v); setTool('ingen') }
                else setLag(l => ({ ...l, [k]: !l[k] }))
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontWeight: '600' }]}>{navn}</Text>
                <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: 1 }]}>{under}</Text>
              </View>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: paa ? colors.label : 'transparent', borderWidth: paa ? 0 : 1.5, borderColor: colors.separator }}>
                {paa && <Check size={14} color="#fff" strokeWidth={3} />}
              </View>
            </Pressable>
          ))}
        </View>
      </Ark>

      {/* Arkvelgeren — mappetreet, søk og nylige (components/tegning-velger.tsx). */}
      <TegningVelger
        synlig={velger}
        projectId={drawing.projectId}
        valgtId={drawing.id}
        onVelg={id => { if (id !== drawing.id) settRute(0, id) }}
        onLukk={() => setVelger(false)}
      />

      {/* Rompanel — 1 s hold på et rom. Rommet er en usynlig knapp på tegningen. */}
      <Ark synlig={!!romPanel} onLukk={() => setRomPanel(null)}>
        {romPanel && (
          <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
            <View>
              <Text style={t.title3}>{romPanel.name}</Text>
              <Text style={[t.footnote, { marginTop: 2 }]}>
                {[romPanel.plan, romPanel.scanPath ? 'Skannet' : 'Ikke skannet'].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable haptic="medium"
              onPress={() => { const r = romPanel; setRomPanel(null); setPinSheet({ mode: 'ny', projectId: r.projectId, roomId: r.id }) }}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: colors.brandLabel }]}>Ny oppgave i rommet</Text>
            </Pressable>
            {/* Skann etterspørres her, ikke fra en romliste — rommet er på tegningen. */}
            <Pressable haptic="medium" disabled={skannBer}
              onPress={async () => { const r = romPanel; setSkannBer(true); try { await requestLidarScan(r) } finally { setSkannBer(false); setRomPanel(null) } }}
              style={{ flexDirection: 'row', gap: spacing.sm, height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center', opacity: skannBer ? 0.5 : 1 }}>
              <ScanLine size={sizes.icon - 2} color={colors.paperLabel} strokeWidth={2.1} />
              <Text style={[t.headline, { color: colors.paperLabel }]}>Etterspør LiDAR-skann</Text>
            </Pressable>
            <Pressable haptic="medium"
              onPress={() => { const id = romPanel.id; setRomPanel(null); router.push({ pathname: '/(app)/prosjekter/rom', params: { roomId: id } }) }}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.paperFill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: colors.paperLabel }]}>Åpne rommet</Text>
            </Pressable>
          </View>
        )}
      </Ark>

      <TegningVelger
        synlig={picking !== null}
        projectId={drawing.projectId}
        tittel={picking === 0 ? 'Øverste rute' : `Rute ${(picking ?? 0) + 1}`}
        valgtId={picking === 0 ? drawing.id : (picking ? ruter[picking - 1] : null)}
        onVelg={id => { if (picking !== null) settRute(picking, id) }}
        onLukk={() => setPicking(null)}
      />

      <TaskPinSheet state={pinSheet} userId={userId} onClose={() => setPinSheet(null)} />
      <FireDeviceSheet device={deviceSheet} onClose={() => setDeviceSheet(null)} />
    </View>
  )
}

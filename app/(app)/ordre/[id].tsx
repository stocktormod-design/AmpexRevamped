import { useEffect, useRef, useState } from 'react'
import { View, ScrollView, Linking, Platform, Alert, StyleSheet, Dimensions } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Q } from '@nozbe/watermelondb'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, FilePlus2, FileText, Navigation, Package, PenLine, Phone, Plus, Receipt, ScanLine, Search, Trash2, UserPlus, Users } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { AvtaltPrisKort } from '../../../components/avtalt-pris-kort'
import { useSignaturer } from '../../../lib/signatures'
import { useGodkjenninger, useGrunnlag } from '../../../lib/approvals'
import { GodkjenningKort } from '../../../components/godkjenning-kort'
import { ArkivKort } from '../../../components/arkiv-kort'
import { Chip } from '../../../components/ui'
import { PapirCard, usePapirFokus } from '../../../components/papir-surface'
import { Ark, ChoiceSheet } from '../../../components/sheet'
import { taOrdrefoto, useOrdrefoto, velgOrdrefoto } from '../../../lib/foto'
import { TidForing, SeksjonsRad } from '../../../components/tid-foring'
import { MegAvatar } from '../../../components/meg-avatar'
import { ScanCard } from '../../../components/scan-card'
import { deleteScanFiles, clearRevisions, archiveRevision } from '../../../lib/scan-revisions'
import { AddressMap } from '../../../components/address-map'
import { database } from '../../../lib/db'
import { slettMateriell, uttakForMateriell } from '../../../lib/cart'
import { syncQuietly } from '../../../lib/db/sync'
import { Order, orderStatuses, orderStatusLabel, type OrderStatus } from '../../../lib/db/models/order'
import { OrderDocument } from '../../../lib/db/models/order-document'
import { FormTemplate } from '../../../lib/db/models/form-template'
import { OrderMaterial } from '../../../lib/db/models/order-material'
import { OrderScan, scanKindLabel, type ScanKind } from '../../../lib/db/models/order-scan'
import { AMPEX_TEMPLATES } from '../../../lib/forms/templates'
import { markOrderOpened } from '../../../lib/last-opened'
import { formatDateTime } from '../../../lib/format'
import { TimeEntry } from '../../../lib/db/models/time-entry'
import { OrderMember } from '../../../lib/db/models/order-member'
import { OrderExtra } from '../../../lib/db/models/order-extra'
import { useFakturagrunnlag } from '../../../lib/order-billing'
import { formatKr } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

/** Dokumentstatus per mal for én ordre — reaktivt (rad finnes først ved første endring) */
/**
 * Firmaets egne, publiserte skjemamaler — inkludert de som ble importert fra
 * en PDF. Uten denne kunne bare Ampex-malene legges på en ordre fra appen.
 */
function useFirmTemplates() {
  const [maler, setMaler] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    const sub = database
      .get<FormTemplate>('form_templates')
      .query(Q.where('status', 'published'), Q.sortBy('title', Q.asc))
      .observeWithColumns(['title', 'status'])
      .subscribe(rader => setMaler(rader.map(r => ({ id: r.id, name: r.title }))))
    return () => sub.unsubscribe()
  }, [])
  return maler
}

function useOrderDocuments(orderId: string) {
  const [docs, setDocs] = useState<OrderDocument[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderDocument>('order_documents')
      .query(Q.where('order_id', orderId))
      .observe()
      .subscribe(setDocs)
    return () => sub.unsubscribe()
  }, [orderId])
  return docs
}

/** Materiell-linjer for én ordre — reaktivt */
function useOrderMaterials(orderId: string) {
  const [materials, setMaterials] = useState<OrderMaterial[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderMaterial>('order_materials')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observe()
      .subscribe(setMaterials)
    return () => sub.unsubscribe()
  }, [orderId])
  return materials
}

/** Sum timer på ordren — reaktivt. Mater både denne raden og fakturagrunnlaget. */
function useOrderTimer(orderId: string) {
  const [sum, setSum] = useState(0)
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<TimeEntry>('time_entries')
      .query(Q.where('order_id', orderId))
      .observeWithColumns(['hours'])
      .subscribe(rader => setSum(rader.reduce((a, e) => a + e.hours, 0)))
    return () => sub.unsubscribe()
  }, [orderId])
  return sum
}

/** Tilleggsarbeid — reaktivt. Ventende tillegg er penger som ikke kan faktureres. */
function useOrderExtras(orderId: string) {
  const [rader, setRader] = useState<{ ventende: number; total: number }>({ ventende: 0, total: 0 })
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<OrderExtra>('order_extras')
      .query(Q.where('order_id', orderId))
      .observeWithColumns(['status'])
      .subscribe(x => setRader({
        ventende: x.filter(e => e.status === 'foreslatt').length,
        total: x.length,
      }))
    return () => sub.unsubscribe()
  }, [orderId])
  return rader
}

/** Antall deltakere — reaktivt */
function useOrderMemberCount(orderId: string) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!orderId) return
    const sub = database
      .get<OrderMember>('order_members')
      .query(Q.where('order_id', orderId))
      .observe()
      .subscribe(rader => setN(rader.length))
    return () => sub.unsubscribe()
  }, [orderId])
  return n
}

/** LiDAR-skann for én ordre — reaktivt */
function useOrderScans(orderId: string) {
  const [scans, setScans] = useState<OrderScan[]>([])
  useEffect(() => {
    const sub = database
      .get<OrderScan>('order_scans')
      .query(Q.where('order_id', orderId), Q.sortBy('created_at', Q.asc))
      .observe()
      .subscribe(setScans)
    return () => sub.unsubscribe()
  }, [orderId])
  return scans
}

async function addScan(orderId: string, kind: ScanKind, index: number): Promise<string> {
  let id = ''
  await database.write(async () => {
    const rad = await database.get<OrderScan>('order_scans').create(s => {
      s.orderId = orderId
      s.kind = kind
      s.title = `${scanKindLabel[kind]} ${index}`
    })
    id = rad.id
  })
  syncQuietly()
  return id
}

const scanKinds: ScanKind[] = ['planlegging', 'dokumentasjon']

/**
 * LiDAR — samme mønster som materiell og dokumentasjon: en liten seksjonstittel
 * med ÉN handling til høyre, og innholdet under, ledet av seg selv.
 *
 * Forrige versjon var en tonet boks med kant, ikon, tittel, forklaring, kort OG
 * en messingknapp i full bredde — fem lag før du kom til selve skannet, og en
 * messingknapp nummer to på en skjerm som allerede har den forankrede
 * hovedhandlingen i messing. Tormods dom: «overstimulerende». Alt som gjør noe
 * er beholdt; alt som forklarte er tatt bort. Typen velges fortsatt i arket.
 */
function ScanSection({ orderId, scans }: { orderId: string; scans: OrderScan[] }) {
  async function removeScan(s: OrderScan) {
    if (s.scanPath) await deleteScanFiles(s.scanPath)
    await clearRevisions(s.id)
    await database.write(async () => s.markAsDeleted())
    syncQuietly()
  }

  /**
   * To FASTE fliser (Tormod 2026-09-06): «Planlegging» og «Dokumentasjon».
   * Det finnes bare to slags skann, så de skal alltid stå der — tom flis
   * starter skanningen direkte, fylt flis viser siste modell av det slaget.
   * Ingen «velg type»-ark, ingen pluss.
   */
  async function nyOgSkann(kind: ScanKind) {
    const id = await addScan(orderId, kind, scans.filter(s => s.kind === kind).length + 1)
    router.push({ pathname: '/(app)/skann', params: { scanId: id, kind: scanKindLabel[kind], title: `${scanKindLabel[kind]} ${scans.filter(s => s.kind === kind).length + 1}`, viewPath: '' } })
  }

  return (
    <View>
      <SeksjonsRad navn="3D-skann" verdi={scans.filter(s => s.scanPath).length > 0 ? `${scans.filter(s => s.scanPath).length} modell${scans.filter(s => s.scanPath).length === 1 ? '' : 'er'}` : 'Ingen'} />
      <View style={{ flexDirection: 'row', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
        {scanKinds.map(kind => {
          const mine = scans.filter(s => s.kind === kind)
          const s = mine.length ? mine[mine.length - 1] : null
          // Uten modell ennå ser flisa lik ut som en tom — trykk starter skanningen
          // på den eksisterende raden (det stiplede skannkortet brøt rytmen).
          if (!s || !s.scanPath) {
            const start = () => s
              ? router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, viewPath: '' } })
              : void nyOgSkann(kind)
            return (
              <Pressable key={kind} haptic="medium" pressScale={0.97} onPress={start}
                style={{ flex: 1, height: 72, borderRadius: radius.md, backgroundColor: colors.fill, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.label, alignItems: 'center', justifyContent: 'center' }}>
                  <ScanLine size={17} color="#FFFFFF" strokeWidth={2.2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[t.subhead, { fontWeight: '600', color: colors.label }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{scanKindLabel[kind]}</Text>
                  <Text style={[t.caption, { marginTop: 1 }]} numberOfLines={1}>{kind === 'planlegging' ? 'Mål opp' : 'Som bygd'}</Text>
                </View>
              </Pressable>
            )
          }
          return (
            <View key={kind} style={{ flex: 1 }}>
              <ScanCard
                title={scanKindLabel[kind]}
                meta={mine.length > 1 ? `${mine.length} skann` : undefined}
                scanPath={s.scanPath}
                revisionKey={s.id}
                onOpen={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, ...(s.scanPath ? { viewPath: s.scanPath } : {}) } })}
                onScan={() => router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, viewPath: '' } })}
                onOpenRevision={rev => router.push({ pathname: '/(app)/skann', params: { viewPath: rev.path, title: `${s.title} · ${new Date(rev.ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}` } })}
                onDelete={() => removeScan(s)}
                onRebuilt={async path => {
                  if (s.scanPath) await archiveRevision(s.id, s.scanPath)
                  await database.write(async () => { await s.update(x => { x.scanPath = path }) })
                  syncQuietly()
                  router.push({ pathname: '/(app)/skann', params: { scanId: s.id, kind: scanKindLabel[s.kind], title: s.title, viewPath: path } })
                }}
              />
            </View>
          )
        })}
      </View>
    </View>
  )
}

/**
 * «Legg til» i en seksjonstittel: et bart pluss, ingen pille.
 *
 * Pillene («+ Legg til», «+ Skann») sto som tre like knapper nedover siden og
 * tok mer plass enn innholdet de la til (Tormod 2026-09-02). Et pluss i
 * tertiærfarge med stor treffflate gjør samme jobb uten å rope. Tomme seksjoner
 * har ikke plusset i det hele tatt — der ER den stiplede raden handlingen.
 */
function PlussKnapp({ onPress }: { onPress: () => void }) {
  return (
    <Pressable haptic="light" pressScale={0.9} hitSlop={14} onPress={onPress}
      style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
      <Plus size={17} color={colors.label} strokeWidth={2.2} />
    </Pressable>
  )
}

/** Boksene under listeradene — samme token for skann og bilder. */
function Token({ Icon, navn, under, ferdig, onPress }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  navn: string; under: string; ferdig?: boolean; onPress: () => void
}) {
  return (
    <Pressable haptic="medium" pressScale={0.97} onPress={onPress}
      style={{ flex: 1, height: 104, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, padding: spacing.md, justifyContent: 'space-between' }}>
      <View style={{ width: 30, height: 30, borderRadius: 14, backgroundColor: ferdig ? colors.success : colors.label, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} color="#FFFFFF" strokeWidth={2.3} />
      </View>
      <View>
        <Text style={[t.subhead, { fontWeight: '600', color: colors.label }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{navn}</Text>
        <Text style={[t.caption, { marginTop: 1 }]} numberOfLines={1}>{under}</Text>
      </View>
    </Pressable>
  )
}

/** Seksjonstittel med valgfritt pluss til høyre — samme rytme i alle seksjoner. */
function Seksjonshode({ tekst, paaPluss }: { tekst: string; paaPluss?: () => void }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', height: 28,
      marginHorizontal: spacing.screen + spacing.xs, marginBottom: spacing.xs,
    }}>
      <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.secondaryLabel, flex: 1 }]}>{tekst}</Text>
      {!!paaPluss && <PlussKnapp onPress={paaPluss} />}
    </View>
  )
}

/** Tom seksjon: én stille rad som ER handlingen. Hvit flate, hårlinje, pluss
 *  til venstre og pil til høyre — samme rad som alt annet i appen, ikke en
 *  stiplet boks (den leste som «her mangler noe» i stedet for «trykk her»). */
function TomRad({ tekst, onPress }: { tekst: string; onPress: () => void }) {
  return (
    <Pressable
      haptic="light"
      pressScale={0.985}
      onPress={onPress}
      style={{
        marginHorizontal: spacing.screen, borderRadius: radius.lg,
        backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Plus size={15} color={colors.label} strokeWidth={2.2} />
      </View>
      <Text style={[t.body, { flex: 1, color: colors.label }]}>{tekst}</Text>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
}

/**
 * Sveip til venstre avdekker Slett — iOS-standard, trenger ingen bruksanvisning
 * (den gamle «hold inne»-hinten under lista er derfor borte). Sveipet avdekker
 * bare knappen; slettingen krever et trykk. To bevisste ledd, fordi hansker og
 * bevegelse i felt gir utilsiktede sveip — og materiell mater fakturagrunnlaget.
 * Langtrykk beholdt som fallback for den som ikke får sveipet til å ta.
 */
/**
 * Én rad i et kort: ikon, tittel, valgfri underlinje, verdi, pil.
 *
 * Fantes som fire nesten like Pressable-blokker på denne skjermen alene. Det
 * gjorde det tungvint å FLYTTE en rad — og rekkefølgen er nettopp det som var
 * feil her.
 */
function Rad({ ikon, tittel, under, underVarsel, verdi, sterkVerdi, onPress, forst, sist }: {
  ikon: React.ReactNode
  tittel: string
  under?: string
  underVarsel?: boolean
  verdi: string
  sterkVerdi?: boolean
  onPress: () => void
  forst?: boolean
  sist?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        ...(forst ? {} : { borderTopWidth: 1, borderTopColor: colors.separator }),
      }}
    >
      {ikon}
      <View style={{ flex: 1 }}>
        <Text style={[t.headline, { color: colors.label }]}>{tittel}</Text>
        {!!under && (
          <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 1 }, underVarsel && { color: colors.warning }]}>
            {under}
          </Text>
        )}
      </View>
      <Text style={[t.bodyMedium, { color: sterkVerdi ? colors.label : colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>
        {verdi}
      </Text>
      <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

/**
 * Flis — to av dem side om side i stedet for to like kort under hverandre.
 *
 * Det var stablingen som fikk skjermen til å lese som en handleliste: like
 * høye, like hvite, ett under det andre. To fliser i én rad leses som et
 * instrumentpanel i stedet — tallet er hovedsaken, ikke linja.
 *
 * `paaLegg` gir et lite pluss i hjørnet der det gir mening. Den store brune
 * «+ Legg til …»-knappen under hvert kort er borte: den skrev seg inn i
 * kolonnen som enda en linje, og det var halve problemet.
 */
function Flis({ ikon, etikett, tall, under, tom, onPress, paaLegg }: {
  ikon: React.ReactNode
  etikett: string
  tall: string
  under: string
  /** Vises i stedet for tallet når det ikke finnes noe å telle. */
  tom?: string
  onPress: () => void
  paaLegg?: () => void
}) {
  return (
    <Pressable
      haptic="light"
      onPress={onPress}
      style={{
        flex: 1, backgroundColor: colors.bg, borderRadius: radius.xl,
        padding: spacing.lg, minHeight: 128, justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        {ikon}
        {!!paaLegg && (
          <Pressable
            haptic="medium"
            hitSlop={10}
            onPress={paaLegg}
            style={{
              width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.fill,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Plus size={15} color={colors.label} strokeWidth={2.6} />
          </Pressable>
        )}
      </View>
      <View>
        {tom ? (
          <Text style={[t.title3, { color: colors.brand }]}>{tom}</Text>
        ) : (
          <Text style={[t.title1, { fontVariant: ['tabular-nums'] }]}>{tall}</Text>
        )}
        <Text style={[t.footnote, { fontWeight: '600', marginTop: 1 }]}>{etikett}</Text>
        <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: 1 }]} numberOfLines={1}>{under}</Text>
      </View>
    </Pressable>
  )
}

function MaterialRow({ material }: { material: OrderMaterial }) {
  /**
   * Kom linja fra et lageruttak, finnes den samme varen som TO rader: uttaket
   * (bilen er tommere) og materiallinja (fakturaen). Sletter vi bare den siste,
   * blir beholdningen stående for lav for alltid, uten spor.
   *
   * Bare mennesket vet hvilket av de to utfallene som gjelder, så vi gjetter
   * ikke — vi spør, med ord som beskriver virkeligheten og ikke datamodellen.
   */
  async function remove() {
    const uttak = await uttakForMateriell(material)
    if (uttak.length === 0) {
      await slettMateriell(material, 'beholdt')
      return
    }
    Alert.alert(
      'Fjern materiellet',
      'Varen ble tatt ut av lageret. Hva skjedde med den?',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Lagt tilbake på lager', onPress: () => { void slettMateriell(material, 'tilbake') } },
        { text: 'Fortsatt ute — bare ikke her', onPress: () => { void slettMateriell(material, 'beholdt') } },
      ],
    )
  }
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={36}
      overshootRight={false}
      containerStyle={{ borderRadius: radius.xl, overflow: 'hidden' }}
      renderRightActions={() => (
        <Pressable
          haptic="medium"
          onPress={remove}
          style={{
            width: 84, backgroundColor: colors.danger,
            alignItems: 'center', justifyContent: 'center', gap: 2,
          }}
        >
          <Trash2 size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>Slett</Text>
        </Pressable>
      )}
    >
      <Pressable
        onLongPress={remove}
        haptic="none"
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          paddingHorizontal: spacing.md, paddingVertical: spacing.md,
          borderRadius: radius.xl, backgroundColor: colors.fill,
        }}
      >
        <Text style={[t.body, { width: 52, color: colors.brand, fontWeight: '700', fontVariant: ['tabular-nums'] }]}>
          {`${formatQty(material.quantity)} ${material.unit}`}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={t.body} numberOfLines={1}>{material.description}</Text>
          {!!material.elnummer && (
            <Text style={[t.footnote, { marginTop: 1 }]}>{`EL ${material.elnummer}`}</Text>
          )}
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  )
}

function DocumentRow({ name, status, onPress }: { name: string; status: 'fullfort' | 'utkast'; onPress: () => void }) {
  const done = status === 'fullfort'
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.md, paddingVertical: spacing.md,
        borderRadius: radius.xl, backgroundColor: colors.fill,
      }}
    >
      <View style={{
        width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: done ? colors.slateSoft : colors.bg,
      }}>
        {done
          ? <Check size={14} color={colors.slate} strokeWidth={2.6} />
          : <FileText size={14} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
      </View>
      <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{name}</Text>
      <Text style={[t.caption, { color: done ? colors.slate : colors.secondaryLabel, fontWeight: '600' }]}>
        {done ? 'Fullført' : 'Utkast'}
      </Text>
      <ChevronRight size={15} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
      !last && { borderBottomWidth: 1, borderBottomColor: colors.separator },
    ]}>
      <Text style={[t.body, { color: colors.secondaryLabel }]}>{label}</Text>
      <Text style={[t.body, { color: colors.label, fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  )
}

export default function OrderDetailScreen() {
  usePapirFokus()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [skjemaListe, setSkjemaListe] = useState(false)
  const [skjemaSok, setSkjemaSok] = useState('')
  async function nyOgSkann(kind: ScanKind) {
    if (!order) return
    const n = scans.filter(s => s.kind === kind).length + 1
    const nyId = await addScan(order.id, kind, n)
    router.push({ pathname: '/(app)/skann', params: { scanId: nyId, kind: scanKindLabel[kind], title: `${scanKindLabel[kind]} ${n}`, viewPath: '' } })
  }
  const [bildeValg, setBildeValg] = useState(false)
  const [side, setSide] = useState(0)
  const [bekreft, setBekreft] = useState(false)
  const kortBredde = Dimensions.get('window').width - spacing.screen * 2
  const foto = useOrdrefoto(id)
  const docs = useOrderDocuments(id ?? '')
  const materials = useOrderMaterials(id ?? '')
  const scans = useOrderScans(id ?? '')
  const firmaMaler = useFirmTemplates()
  const docByTemplate = new Map(docs.map(d => [d.templateId, d]))
  /**
   * Nevneren er skjemaene som er LAGT TIL på denne ordren — ikke alle malene
   * som finnes.
   *
   * «0/5» påsto at hver jobb trenger alle fem Ampex-malene. Det stemmer ikke:
   * en samsvarserklæring hører til et anlegg, en SJA til en risikojobb, og en
   * servicejobb trenger kanskje ingen av dem. Du velger selv hva som passer, og
   * da er «2/3» det ærlige tallet — «2/5» var en oppgaveliste vi hadde funnet
   * på for kunden.
   */
  const doneCount = docs.filter(d => d.status === 'fullfort').length
  const grunnlag = useFakturagrunnlag(id ?? '')
  const timer = useOrderTimer(id ?? '')
  const antallMedlemmer = useOrderMemberCount(id ?? '')
  const tillegg = useOrderExtras(id ?? '')
  const signaturer = useSignaturer(id ?? '')
  const godkjenninger = useGodkjenninger(id)
  const godkjenningsgrunnlag = useGrunnlag(id, grunnlag?.bruttoOre ?? 0)
  const allDocsDone = docs.length > 0 && doneCount === docs.length
  const docsDone = doneCount
  // Siste linje som ble ført — flisa sier hva som er der, ikke bare hvor mange.
  const sisteMateriell = materials.length > 0 ? materials[materials.length - 1].description : ''

  useEffect(() => {
    if (!id) return
    markOrderOpened(id)
    const sub = database.get<Order>('orders').findAndObserve(id).subscribe({
      next: setOrder,
      error: () => router.back(), // slettet eller ukjent id
    })
    return () => sub.unsubscribe()
  }, [id])

  /**
   * «Fakturert» kan ALDRI settes herfra.
   *
   * Å skrive status direkte hopper over markerFakturert() — som krever faglig
   * godkjenning, stempler `invoiced_at` på linjene og låser dem mot ny
   * fakturering. Uten det kan samme arbeid faktureres om igjen.
   *
   * Og verre: serveren har en trigger (`krev_faglig_godkjenning`) som avviser
   * status 'fakturert' uten godkjenning. Siden watermelon_push kjører i én
   * transaksjon, ville ett slikt trykk blokkert HELE synken — stille, akkurat
   * som base62-id-ene gjorde. Fakturering skjer på fakturaskjermen, punktum.
   */
  async function setStatus(status: OrderStatus) {
    if (!order || order.status === status) return
    if (status === 'fakturert') {
      router.push({ pathname: '/(app)/ordre/faktura', params: { id } })
      return
    }
    await database.write(async () => {
      await order.update(o => { o.status = status })
    })
    syncQuietly()
  }

  function ring() {
    if (order?.customerPhone) Linking.openURL(`tel:${order.customerPhone.replace(/\s/g, '')}`)
  }

  function naviger() {
    if (!order?.address) return
    const q = encodeURIComponent(order.address)
    // dirflg=d → Kart åpner rett i kjørerute
    Linking.openURL(Platform.OS === 'android' ? `geo:0,0?q=${q}` : `https://maps.apple.com/?daddr=${q}&dirflg=d`)
  }

  const [velgerSkjema, setVelgerSkjema] = useState(false)

  /**
   * Både Ampex-malene og firmaets EGNE — også de som nettopp ble importert fra
   * en PDF. Før kunne bare Ampex-malene legges på en ordre fra appen; et
   * importert skjema kunne AI-en bruke, men montøren fant det ikke. Da var
   * importen halvveis ubrukelig.
   */
  const alleMaler: { id: string; name: string }[] = [
    ...AMPEX_TEMPLATES.map(tpl => ({ id: tpl.id, name: tpl.name })),
    ...firmaMaler,
  ]
  const startedTemplates = alleMaler.filter(tpl => docByTemplate.has(tpl.id))
  const remainingTemplates = alleMaler.filter(tpl => !docByTemplate.has(tpl.id))

  // Dokumentasjon viser kun faktisk lagt-til skjema — «Legg til» velger blant de
  // resterende. Valget står i Ampex-arket, ikke i iOS-arket: systemarket finnes
  // ikke på Android, og der åpnet appen bare det FØRSTE skjemaet i lista uten å
  // spørre. Malen din het ikke det du trodde du valgte.
  function addDocumentation() {
    if (!order || remainingTemplates.length === 0) return
    setVelgerSkjema(true)
  }

  function velgSkjema(templateId: string) {
    setVelgerSkjema(false)
    if (order) router.push({ pathname: '/(app)/ordre/skjema', params: { orderId: order.id, templateId } })
  }

  /**
   * INGEN «Start jobben» (Tormod 2026-09-06: «ingen tenker at de må ha en knapp
   * der det står start jobben»). Jobben starter seg selv: fører du timer, tar
   * ut materiell, åpner et skjema eller skanner, ER den i gang — statusen
   * følger arbeidet, ikke omvendt. Det eneste montøren sier eksplisitt er at
   * jobben er FERDIG, og den ligger der arbeidet slutter, ikke som en fast
   * knapp over alt.
   */
  const arbeidFinnes = timer > 0 || materials.length > 0 || startedTemplates.length > 0 || scans.length > 0
  useEffect(() => {
    if (!order) return
    if ((order.status === 'mottatt' || order.status === 'planlagt') && arbeidFinnes) void setStatus('pagaar')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.status, arbeidFinnes])

  if (!order) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  const when = formatDateTime(order.scheduledAt)
  // Neste steg i den lineære flyten — null når ordren står på siste status.
  const statusIdx = orderStatuses.indexOf(order.status)
  const nextStatus = statusIdx >= 0 && statusIdx < orderStatuses.length - 1
    ? orderStatuses[statusIdx + 1]
    : null


  return (
    /*
     * HELE siden er mørk, ikke bare hodet.
     *
     * Første forsøk hadde mørkt hode over beige grunn, og det ble halvt om
     * halvt — to konkurrerende bakgrunner med en søm midt på skjermen. Nå er
     * grunnen ett sammenhengende mørkt felt, og de lyse kortene FLYTER på den.
     * Det er den samme modellen som før (tonet grunn + kort som løftes), bare
     * snudd: kontrasten går nå riktig vei, og «arket»-følelsen er borte fordi
     * det ikke finnes noe ark igjen.
     */
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ChoiceSheet<string>
        synlig={velgerSkjema}
        tittel="Legg til dokumentasjon"
        valg={remainingTemplates.map(tpl => ({ verdi: tpl.id, etikett: tpl.name }))}
        onVelg={velgSkjema}
        onAvbryt={() => setVelgerSkjema(false)}
      />
      {/*
        LYS I ROMMET. En flat mørk flate ser billig ut — ekte mørke grensesnitt
        har en lyskilde. To lag, begge uten trykkflate:
          · en vertikal gradient som gjør toppen litt lysere enn bunnen
          · en kobberglød bak hodet, der tittelen står
        Det er forskjellen på «bakgrunnsfargen er satt til mørkebrun» og «denne
        skjermen er belyst».
      */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 460 }}>
        <LinearGradient
          colors={['rgba(29,29,31,0.04)', 'rgba(29,29,31,0.01)', 'rgba(0,0,0,0)']}
          locations={[0, 0.45, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ flex: 1 }}
        />
      </View>
      <ScrollView
        contentContainerStyle={{
          // Plass til den forankrede handlingen — ellers skjuler den siste rad.
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/*
          ── Hodet er en SONE, ikke en linje ────────────────────────────────
          Før startet skjermen med lys bakgrunn, en liten prikk og litt tekst —
          og så fulgte det ene hvite kortet etter det andre i én jevn kolonne.
          Øyet leste det som en handleliste: like høye, like hvite, «legg til
          mer» under hver.

          Et mørkt hode i samme brune som knappene gir skjermen et ANKER. Den
          starter som en jobb, ikke som et ark. Kunden, adressen og kartet bor
          her inne, så det hvite kortet de lå i forsvinner helt — én ting mindre
          i kolonnen, og den viktigste informasjonen får mest vekt.
        */}
        {/*
          ── HERO ────────────────────────────────────────────────────────────
          Ikke et kort med et lite kart i. Stedet ER jobben, så kartet ligger
          full bredde bak tittelen med en mørk gradient over — og teksten står
          oppå. Det gir skjermen en topp med vekt i stedet for en overskrift på
          en flate.

          Uten adresse faller den tilbake til ren mørk grunn med kobbergløden.
          Ingen tom kartboks.
        */}
        <View style={{ height: order.address ? 250 : 180 }}>
          {!!order.address && (
            <View style={StyleSheet.absoluteFill}>
              <AddressMap address={order.address} onPress={naviger} height={250} chrome={false} />
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.78)', colors.canvas]}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
              />
            </View>
          )}

          <View style={{ flex: 1, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.screen }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable
                onPress={() => router.back()}
                pressScale={0.92}
                style={{
                  width: 38, height: 38, borderRadius: radius.pill,
                  backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
                  ...shadows.card,
                }}
              >
                <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
              </Pressable>
              <MegAvatar />
            </View>

            <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: spacing.lg }}>
              <Text style={[t.display, { color: colors.label }]} numberOfLines={2}>
                {order.title}
              </Text>
              {/* Meta UNDER tittelen: status bare når den sier noe, så tid og nummer. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                {(order.status === 'pagaar' || order.status === 'fakturaklar' || order.status === 'fakturert') && (
                  <View style={{ paddingHorizontal: spacing.sm + 1, height: 22, borderRadius: radius.pill, justifyContent: 'center',
                    backgroundColor: order.status === 'pagaar' ? colors.label : colors.successSoft }}>
                    <Text style={[t.caption, { fontWeight: '600', color: order.status === 'pagaar' ? '#FFFFFF' : colors.success }]}>
                      {order.status === 'pagaar' ? 'Pågår' : order.status === 'fakturaklar' ? 'Ferdig' : 'Fakturert'}
                    </Text>
                  </View>
                )}
                {!!when && <Text style={[t.footnote, { color: colors.secondaryLabel }]}>{when}</Text>}
                {!!order.orderNumber && <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>{`#${order.orderNumber}`}</Text>}
              </View>

              {/* Kunden er en TOKEN: navnet når den finnes, «Velg kunde» når ikke.
                  Trykk åpner kundevalget — ingen egen varselrad (Tormod 2026-09-06). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
                <Pressable haptic="light" pressScale={0.96}
                  onPress={() => router.push({ pathname: '/(app)/kunder/velg', params: { orderId: id } })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill,
                    backgroundColor: (order.customerId || order.customerName) ? colors.fill : colors.warningSoft }}>
                  {(order.customerId || order.customerName)
                    ? <Users size={14} color={colors.label} strokeWidth={2.2} />
                    : <UserPlus size={14} color={colors.warning} strokeWidth={2.2} />}
                  <Text style={[t.subhead, { fontWeight: '600', color: (order.customerId || order.customerName) ? colors.label : colors.warning }]} numberOfLines={1}>
                    {order.customerName || 'Velg kunde'}
                  </Text>
                </Pressable>
                {!!order.customerPhone && (
                  <Pressable haptic="medium" onPress={ring} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                    <Phone size={15} color={colors.label} strokeWidth={2.1} />
                  </Pressable>
                )}
                <View style={{ flex: 1 }} />
                {!!order.address && (
                  <Pressable haptic="medium" pressScale={0.95} onPress={naviger} hitSlop={8} style={{
                    height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill,
                    backgroundColor: colors.fill, flexDirection: 'row', alignItems: 'center', gap: 6,
                  }}>
                    <Navigation size={14} color={colors.label} strokeWidth={2.2} />
                    <Text style={[t.subhead, { color: colors.label, fontWeight: '600' }]}>Kjørerute</Text>
                  </Pressable>
                )}
              </View>
              {!!order.address && (
                <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.sm }]} numberOfLines={1}>{order.address}</Text>
              )}
            </View>
          </View>
        </View>
        <View style={{ height: spacing.md }} />

        {/* TRE LISTERADER: Skjema · Materiell · Timeføring (Tormod 2026-09-06). */}
        <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, overflow: 'hidden' }}>
          {([
            { navn: 'Skjema', verdi: [doneCount > 0 ? `${doneCount} fullført` : null, (docs.length - doneCount) > 0 ? `${docs.length - doneCount} påbegynt` : null].filter(Boolean).join(' · '), Icon: FileText, gaa: () => setSkjemaListe(true) },
            { navn: 'Materiell', verdi: `${materials.length} ${materials.length === 1 ? 'vare' : 'varer'}`, Icon: Package, gaa: () => router.push({ pathname: '/(app)/ordre/material', params: { orderId: order.id } }) },
            { navn: 'Timeføring', verdi: `${(Number.isInteger(timer) ? timer : timer.toFixed(2).replace(/0+$/, '')).toString().replace('.', ',')} t`, Icon: Clock, gaa: () => router.push({ pathname: '/(app)/ordre/timer', params: { id } }) },
          ] as const).map((r, i) => (
            <Pressable key={r.navn} haptic="light" onPress={r.gaa}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, height: 50, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.separator }}>
              <r.Icon size={19} color={colors.label} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.body, { flex: 1, color: colors.label }]}>{r.navn}</Text>
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{r.verdi}</Text>
              <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
          ))}
        </View>

        {/* TRE LIKE TOKENS: Planlegging · Dokumentasjon · Bilder. Skann-tokenene
            åpner lista over skann av det slaget (som tegningene i et prosjekt). */}
        <View style={{ marginHorizontal: spacing.screen, marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm }}>
          {scanKinds.map(kind => {
            const mine = scans.filter(s => s.kind === kind)
            const klare = mine.filter(s => s.scanPath).length
            return (
              <Token key={kind} Icon={klare > 0 ? Check : ScanLine} ferdig={klare > 0} navn={scanKindLabel[kind]}
                under={klare > 0 ? `${klare} skann` : 'Skann'}
                onPress={() => router.push({ pathname: '/(app)/ordre/skanninger', params: { orderId: order.id, kind } })} />
            )
          })}
          <Token Icon={Camera} navn="Bilder" under={foto.length > 0 ? `${foto.length} bilde${foto.length === 1 ? '' : 'r'}` : 'Foto'} onPress={() => setBildeValg(true)} />
        </View>

        {/* SVEIPEKORTET: Opprettet → Fakturagrunnlag → Marker som ferdig. Tre sider
            i én rektangulær token; knappen for ferdig finnes bare på siste side. */}
        <View style={{ marginHorizontal: spacing.screen, marginTop: spacing.md }}>
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={e => setSide(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, e.nativeEvent.layoutMeasurement.width)))}
            style={{ borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, height: 132 }}
          >
            {/* 1 · Opprettet */}
            <View style={{ width: kortBredde, padding: spacing.md, paddingHorizontal: spacing.lg, gap: 4 }}>
              <Text style={t.title3}>Opprettet</Text>
              {[
                ['Opprettet', formatDateTime(order.createdAt) ?? ''],
                ['Sist endret', formatDateTime(order.updatedAt) ?? ''],
                ['Planlagt', when || 'Ikke satt'],
                ['Ordrenummer', order.orderNumber ? `#${order.orderNumber}` : 'Tildeles ved synk'],
              ].map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <Text style={[t.subhead, { color: colors.secondaryLabel }]}>{k}</Text>
                  <Text style={[t.subhead, { color: colors.label, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{v}</Text>
                </View>
              ))}
            </View>
            {/* 2 · Fakturagrunnlag */}
            <View style={{ width: kortBredde, padding: spacing.md, paddingHorizontal: spacing.lg, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={t.title3}>Fakturagrunnlag</Text>
                <Text style={[t.subhead, { fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{grunnlag ? `${formatKr(grunnlag.bruttoOre)} kr` : ''}</Text>
              </View>
              {!grunnlag || grunnlag.linjer.length === 0 ? (
                <Text style={t.footnote}>Ingenting å fakturere ennå. Timer og materiell havner her.</Text>
              ) : (
                <>
                  {grunnlag.linjer.slice(0, 3).map((l, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                      <Text style={[t.subhead, { flex: 1, color: colors.label }]} numberOfLines={1}>{`${l.antall} ${l.enhet} ${l.beskrivelse}`}</Text>
                      <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{formatKr(l.nettoOre)}</Text>
                    </View>
                  ))}
                  {grunnlag.linjer.length > 3 && <Text style={t.footnote}>{`+ ${grunnlag.linjer.length - 3} linjer til`}</Text>}
                  <Text style={[t.footnote, { marginTop: 2 }]}>{`Netto ${formatKr(grunnlag.nettoOre)} · mva ${formatKr(grunnlag.mvaOre)}`}</Text>
                </>
              )}
            </View>
            {/* 3 · Marker som ferdig */}
            <View style={{ width: kortBredde, padding: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.sm, justifyContent: 'space-between' }}>
              <View>
                <Text style={t.title3}>Marker som ferdig</Text>
                <Text style={[t.footnote, { marginTop: 4 }]}>
                  {order.status === 'fakturaklar' ? 'Ordren er ferdig og klar til faktura.' : order.status === 'fakturert' ? 'Ordren er fakturert.' : 'Ordren går til fakturering. Du får se hele grunnlaget først.'}
                </Text>
              </View>
              <Pressable haptic="medium" pressScale={0.985} disabled={order.status === 'fakturert'} onPress={() => setBekreft(true)}
                style={{ height: 46, borderRadius: radius.md, backgroundColor: order.status === 'fakturaklar' ? colors.successSoft : colors.label, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, opacity: order.status === 'fakturert' ? 0.4 : 1 }}>
                <Check size={17} color={order.status === 'fakturaklar' ? colors.success : '#FFFFFF'} strokeWidth={2.4} />
                <Text style={[t.headline, { color: order.status === 'fakturaklar' ? colors.success : '#FFFFFF' }]}>{order.status === 'fakturaklar' ? 'Til fakturagrunnlaget' : 'Send faktura'}</Text>
              </Pressable>
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm }}>
            {[0, 1, 2].map(i => <View key={i} style={{ width: i === side ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === side ? colors.label : colors.separator }} />)}
          </View>
        </View>

        {/* «Sikker?» — hele fakturagrunnlaget ramses opp før noe skjer. */}
        <Ark synlig={bekreft} onLukk={() => setBekreft(false)}>
          <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
            <View>
              <Text style={t.title3}>Sikker?</Text>
              <Text style={[t.footnote, { marginTop: 2 }]}>Dette er alt som faktureres på ordren.</Text>
            </View>
            <View style={{ gap: 6 }}>
              {(grunnlag?.linjer ?? []).map((l, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <Text style={[t.subhead, { flex: 1, color: colors.label }]} numberOfLines={1}>{`${l.antall} ${l.enhet} ${l.beskrivelse}`}</Text>
                  <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{formatKr(l.nettoOre)}</Text>
                </View>
              ))}
              {(grunnlag?.linjer.length ?? 0) === 0 && <Text style={t.footnote}>Ingen linjer. Ordren blir ferdig uten noe å fakturere.</Text>}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: spacing.sm, marginTop: 4 }}>
                <Text style={[t.headline]}>Å betale</Text>
                <Text style={[t.headline, { fontVariant: ['tabular-nums'] }]}>{grunnlag ? `${formatKr(grunnlag.bruttoOre)} kr` : '0 kr'}</Text>
              </View>
            </View>
            <Pressable haptic="medium" pressScale={0.985}
              onPress={async () => { setBekreft(false); if (order.status !== 'fakturaklar') await setStatus('fakturaklar'); router.push({ pathname: '/(app)/ordre/faktura', params: { id } }) }}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.label, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.headline, { color: '#FFFFFF' }]}>Ja, send faktura</Text>
            </Pressable>
            <Pressable haptic="light" onPress={() => setBekreft(false)} style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Avbryt</Text>
            </Pressable>
          </View>
        </Ark>

        {/* Skjema-lista som ark: sjekkliste, trykk åpner skjemaet. */}
        <Ark synlig={skjemaListe} onLukk={() => setSkjemaListe(false)}>
          <View style={{ paddingHorizontal: spacing.screen }}>
            <Text style={[t.title3, { marginBottom: spacing.sm }]}>Skjema</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, borderRadius: radius.pill, backgroundColor: colors.fill, paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
              <Search size={16} color={colors.secondaryLabel} strokeWidth={2.1} />
              <TextInput value={skjemaSok} onChangeText={setSkjemaSok} placeholder="Søk i skjema" placeholderTextColor={colors.tertiaryLabel} style={[t.body, { flex: 1 }]} autoCorrect={false} clearButtonMode="while-editing" />
            </View>
            {alleMaler.filter(tpl => tpl.name.toLowerCase().includes(skjemaSok.trim().toLowerCase())).map((tpl, i) => {
              const doc = docByTemplate.get(tpl.id)
              const tilstand = doc?.status === 'fullfort' ? 'ferdig' : doc ? 'utkast' : 'tom'
              return (
                <Pressable key={tpl.id} haptic="light"
                  onPress={() => { setSkjemaListe(false); router.push({ pathname: '/(app)/ordre/skjema', params: { orderId: order.id, templateId: tpl.id } }) }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, height: 48, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.separator }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: tilstand === 'ferdig' ? 0 : 1.5, borderColor: tilstand === 'utkast' ? colors.label : colors.separator, backgroundColor: tilstand === 'ferdig' ? colors.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {tilstand === 'ferdig' && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                    {tilstand === 'utkast' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.label }} />}
                  </View>
                  <Text style={[t.body, { flex: 1, color: colors.label }]} numberOfLines={1}>{tpl.name}</Text>
                  <Text style={[t.caption, { color: tilstand === 'ferdig' ? colors.success : colors.tertiaryLabel }]}>{tilstand === 'ferdig' ? 'Fullført' : tilstand === 'utkast' ? 'Utkast' : ''}</Text>
                </Pressable>
              )
            })}
          </View>
        </Ark>
        <ChoiceSheet<'kamera' | 'galleri'>
          synlig={bildeValg}
          tittel="Bilder"
          forklaring={foto.length > 0 ? `${foto.length} bilde${foto.length === 1 ? '' : 'r'} på ordren` : undefined}
          valg={[{ verdi: 'kamera', etikett: 'Ta bilde' }, { verdi: 'galleri', etikett: 'Velg fra bildene' }]}
          onVelg={async v => { setBildeValg(false); if (v === 'kamera') await taOrdrefoto(order.id); else await velgOrdrefoto(order.id) }}
          onAvbryt={() => setBildeValg(false)}
        />
      </ScrollView>

    </View>
  )
}

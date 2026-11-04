import { useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation, interpolate, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import * as Haptics from 'expo-haptics'
import { Q } from '@nozbe/watermelondb'
import { Minus, Plus, Check } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { database } from '../lib/db'
import { Product } from '../lib/db/models/product'
import { PurchaseOrderLine } from '../lib/db/models/purchase-order'
import { useVare, useGrossister, opprettFraKatalog } from '../lib/products'
import { useHandlelister, hentEllerLagUtkast, leggIHandleliste, leggVareIHandleliste, endreAntall } from '../lib/bestilling'
import { finnKatalogvare, type Katalogvare } from '../lib/katalog'
import { formatKr, tilOre } from '../lib/invoicing'
import { colors, spacing, radius, sizes, shadows, springs, type as t } from '../lib/theme'

/**
 * Panelet under EFObasen — det som gjør katalogen deres til vår handlekurv.
 *
 * Det følger varen montøren står på (el-nummeret i adressen), og har tre
 * hvileplasser: LITEN (bare navn og beste pris), VARE (prisene, antall og den
 * ene sorte knappen) og LISTE (dratt helt opp: handlelista per grossist).
 * Står han ikke på en vare, er det bare én stille linje — aldri en tom boks.
 *
 * Alt her er lokalt (regel 2): prisene fra `product_prices`, lista er
 * `purchase_orders` i utkast. Bare nettsiden over trenger nett.
 */

type Hvile = 'liten' | 'vare' | 'liste'

/** Varen bak el-nummeret: firmaets egen rad først, ellers katalogen. */
function useVareForElnummer(elnr: string | null): {
  productId: string | null
  katalog: Katalogvare | null
  laster: boolean
} {
  const [productId, setProductId] = useState<string | null>(null)
  const [katalog, setKatalog] = useState<Katalogvare | null>(null)
  const [laster, setLaster] = useState(false)

  useEffect(() => {
    setProductId(null); setKatalog(null)
    if (!elnr) { setLaster(false); return }
    setLaster(true)
    let levende = true
    const sub = database.get<Product>('products')
      .query(Q.where('elnummer', elnr), Q.take(1))
      .observe()
      .subscribe(async rader => {
        if (rader[0]) { setProductId(rader[0].id); setLaster(false); return }
        setProductId(null)
        const k = await finnKatalogvare(elnr)
        if (levende) { setKatalog(k); setLaster(false) }
      })
    return () => { levende = false; sub.unsubscribe() }
  }, [elnr])

  return { productId, katalog, laster }
}

/** Alle linjer i alle handlelister, med grossisten de hører til. */
function useHandlelinjer(): { linje: PurchaseOrderLine; grossist: string }[] {
  const lister = useHandlelister()
  const [linjer, setLinjer] = useState<PurchaseOrderLine[]>([])
  const nokkel = lister.map(l => l.id).sort().join(',')

  useEffect(() => {
    const ider = nokkel ? nokkel.split(',') : []
    if (ider.length === 0) { setLinjer([]); return }
    const sub = database.get<PurchaseOrderLine>('purchase_order_lines')
      .query(Q.where('purchase_order_id', Q.oneOf(ider)), Q.sortBy('sort_order', Q.asc))
      .observeWithColumns(['antall'])
      .subscribe(setLinjer)
    return () => sub.unsubscribe()
  }, [nokkel])

  return useMemo(() => {
    const grossistFor = new Map(lister.map(l => [l.id, l.grossist]))
    return linjer.map(linje => ({ linje, grossist: grossistFor.get(linje.purchaseOrderId) ?? '' }))
  }, [linjer, lister])
}

function formatAntall(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

function lesAntall(s: string): number {
  const n = Number(s.replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** − 80 m + — tallet kan skrives rett inn; 80 m kabel er ikke 80 trykk. */
function Antallvelger({ verdi, enhet, onEndre, liten }: {
  verdi: string; enhet: string; onEndre: (s: string) => void; liten?: boolean
}) {
  const h = liten ? 34 : sizes.ctaHeight
  const steg = (d: number) => onEndre(formatAntall(Math.max(liten ? 0 : 1, lesAntall(verdi) + d)))
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', height: h,
      borderRadius: radius.pill, backgroundColor: colors.fill,
    }}>
      <Pressable haptic="light" pressScale={0.9} onPress={() => steg(-1)} hitSlop={6}
        style={{ width: h, height: h, alignItems: 'center', justifyContent: 'center' }}>
        <Minus size={liten ? 15 : 17} color={colors.label} strokeWidth={2.2} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', minWidth: liten ? 38 : 52, justifyContent: 'center' }}>
        <TextInput
          value={verdi}
          onChangeText={s => onEndre(s.replace(/[^\d,.]/g, ''))}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={[liten ? t.subhead : t.headline, { fontVariant: ['tabular-nums'], textAlign: 'center', padding: 0, minWidth: 18 }]}
        />
        <Text style={[t.caption, { marginLeft: 3 }]}>{enhet}</Text>
      </View>
      <Pressable haptic="light" pressScale={0.9} onPress={() => steg(1)} hitSlop={6}
        style={{ width: h, height: h, alignItems: 'center', justifyContent: 'center' }}>
        <Plus size={liten ? 15 : 17} color={colors.label} strokeWidth={2.2} />
      </Pressable>
    </View>
  )
}

/** Én linje i handlelista. Antallet endres der det står; 0 fjerner linja. */
function Listelinje({ linje, sist }: { linje: PurchaseOrderLine; sist: boolean }) {
  const [tekst, setTekst] = useState(formatAntall(linje.antall))
  useEffect(() => { setTekst(formatAntall(linje.antall)) }, [linje.antall])
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
      !sist && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
    ]}>
      <View style={{ flex: 1 }}>
        <Text style={t.subhead} numberOfLines={2}>{linje.beskrivelse}</Text>
        {!!linje.elnummer && (
          <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1, fontVariant: ['tabular-nums'] }]}>
            {`EL ${linje.elnummer}`}
          </Text>
        )}
      </View>
      <Antallvelger liten verdi={tekst} enhet={linje.enhet} onEndre={s => {
        setTekst(s)
        const n = lesAntall(s)
        // Tomt felt mens han skriver er ikke «fjern» — bare en knapp til 0 er det.
        if (s !== '' && n !== linje.antall) endreAntall(linje, n).catch(() => {})
      }} />
    </View>
  )
}

export function EfobasenPanel({ elnummer, onHvilehoyde }: {
  elnummer: string | null
  /** Hvor mye av bunnen panelet dekker når det hviler — siden over trenger innrykket. */
  onHvilehoyde: (h: number) => void
}) {
  const insets = useSafeAreaInsets()
  const { height: skjerm } = useWindowDimensions()
  const { productId, katalog, laster } = useVareForElnummer(elnummer)
  const { product, priser, pris } = useVare(productId)
  const alleGrossister = useGrossister()
  const handlelinjer = useHandlelinjer()

  // Grossisten det bestilles fra. Standard er den billigste; et trykk på en
  // annen rad velger den. Nullstilles når varen byttes.
  const [valgt, setValgt] = useState<string | null>(null)
  const [antall, setAntall] = useState('1')
  const [kvittering, setKvittering] = useState<string | null>(null)
  const [legger, setLegger] = useState(false)
  useEffect(() => { setValgt(null); setAntall('1'); setKvittering(null) }, [elnummer])

  const harPriser = priser.length > 0
  const grossistvalg = harPriser ? priser.map(p => p.grossist) : alleGrossister
  const standard = pris.billigste?.grossist ?? grossistvalg[0] ?? null
  const grossist = valgt && grossistvalg.includes(valgt) ? valgt : standard
  const erBilligst = (g: string) => pris.besparelse !== null && pris.billigste?.grossist === g

  const navn = product?.name ?? katalog?.navn ?? null
  const enhet = product?.unit ?? katalog?.enhet ?? 'stk'
  const undertekst = [
    elnummer ? `EL ${elnummer}` : null,
    product?.fabrikat ?? katalog?.fabrikat ?? null,
  ].filter(Boolean).join(' · ')

  async function leggI() {
    if (!elnummer || !grossist || legger) return
    const n = lesAntall(antall)
    if (n <= 0) return
    setLegger(true)
    try {
      if (product) await leggVareIHandleliste(grossist, product, n)
      else if (katalog) await leggVareIHandleliste(grossist, await opprettFraKatalog(katalog), n)
      // Ukjent for både kartotek og katalog: el-nummeret er nok for grossisten.
      else await leggIHandleliste(grossist, { beskrivelse: `EL ${elnummer}`, elnummer, antall: n })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      const utkast = await hentEllerLagUtkast(grossist)
      const iLista = await database.get<PurchaseOrderLine>('purchase_order_lines')
        .query(Q.where('purchase_order_id', utkast.id))
        .fetchCount()
      setKvittering(`${formatAntall(n)} ${enhet} lagt i ${grossist}-lista · ${iLista} ${iLista === 1 ? 'vare' : 'varer'}`)
    } finally {
      setLegger(false)
    }
  }

  // Kvitteringen står til han gjør noe annet — eller i fire sekunder.
  const tidtaker = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!kvittering) return
    if (tidtaker.current) clearTimeout(tidtaker.current)
    tidtaker.current = setTimeout(() => setKvittering(null), 4000)
    return () => { if (tidtaker.current) clearTimeout(tidtaker.current) }
  }, [kvittering])

  /* ── Høyder og hvileplasser ─────────────────────────────────────────────── */

  const H = Math.round(skjerm * 0.8)
  const [sammendragH, setSammendragH] = useState(64)
  const [hodeH, setHodeH] = useState(64)
  const bunn = insets.bottom + spacing.sm
  // translateY for hver hvileplass. Panelet er H + bunn høyt og står i bunnen,
  // så synlig del er (H + bunn) − y: hodet pluss safe area under det.
  const plass = (h: Hvile) =>
    h === 'liste' ? 0 : H - (h === 'liten' ? sammendragH : hodeH)

  const y = useSharedValue(H)
  const start = useSharedValue(0)
  const yVare = useSharedValue(H)
  const yLiten = useSharedValue(H)
  const [hvile, setHvile] = useState<Hvile>('vare')

  // Høydene måles; hvileplassene følger dem. Et nytt innhold (kvitteringen,
  // en ny vare) flytter panelet med en fjær, ikke med et hopp.
  useEffect(() => {
    yVare.value = plass('vare')
    yLiten.value = plass(elnummer ? 'liten' : 'vare')
    y.value = withSpring(plass(hvile), springs.settle)
    onHvilehoyde(hvile === 'liten' ? sammendragH + bunn : hodeH + bunn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hodeH, sammendragH, hvile, H, bunn])

  // Ny vare fra søket: vis den. Har han skjøvet panelet ned, får han beholde det.
  useEffect(() => { if (hvile === 'liste') setHvile('vare') }, [elnummer]) // eslint-disable-line react-hooks/exhaustive-deps

  const dra = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => { start.value = y.value })
    .onUpdate(e => {
      const ny = start.value + e.translationY
      // Gummistrikk forbi endene — panelet skal kjennes, ikke stoppe hardt.
      y.value = ny < 0 ? ny / 4 : ny > yLiten.value ? yLiten.value + (ny - yLiten.value) / 4 : ny
    })
    .onEnd(e => {
      const kast = y.value + e.velocityY * 0.15
      const kandidater: [Hvile, number][] = [['liste', 0], ['vare', yVare.value], ['liten', yLiten.value]]
      let beste = kandidater[0]
      for (const k of kandidater) if (Math.abs(k[1] - kast) < Math.abs(beste[1] - kast)) beste = k
      y.value = withSpring(beste[1], { ...springs.settle, velocity: e.velocityY })
      scheduleOnRN(setHvile, beste[0])
    })

  const keyboard = useAnimatedKeyboard()
  const panelStil = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value - Math.max(0, keyboard.height.value - bunn) }],
  }))
  // Detaljene (prisene, knappen) tones ut mot LITEN, lista inn mot LISTE —
  // så det som stikker ned i bunnkanten aldri er et halvt kort.
  const detaljStil = useAnimatedStyle(() => ({
    opacity: yLiten.value - yVare.value < 1
      ? 1
      : interpolate(y.value, [yVare.value, yLiten.value], [1, 0], Extrapolation.CLAMP),
  }))
  const listeStil = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, yVare.value], [1, 0], Extrapolation.CLAMP),
  }))
  const bakStil = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, yVare.value], [0.28, 0], Extrapolation.CLAMP),
  }))

  const antallLinjer = handlelinjer.length
  const listeGrossister = [...new Set(handlelinjer.map(h => h.grossist))]
  const listeTekst = antallLinjer === 0
    ? null
    : `${antallLinjer} ${antallLinjer === 1 ? 'vare' : 'varer'} hos ${listeGrossister.join(' og ')}`

  /* ── Innholdet ──────────────────────────────────────────────────────────── */

  const sammendrag = elnummer ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text style={t.headline} numberOfLines={1}>
          {navn ?? (laster ? ' ' : `EL ${elnummer}`)}
        </Text>
        <Text style={[t.caption, { marginTop: 1, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
          {navn ? undertekst : laster ? ' ' : 'Ikke i kartoteket'}
        </Text>
      </View>
      {pris.billigste && (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[t.title3, { fontVariant: ['tabular-nums'] }]}>
            {formatKr(tilOre(pris.billigste.nettoPris))}
          </Text>
          <Text style={[t.caption, { color: colors.tertiaryLabel }]}>{`per ${enhet}`}</Text>
        </View>
      )}
    </View>
  ) : (
    <Pressable haptic="light" pressScale={0.99}
      onPress={() => antallLinjer > 0 && setHvile(hvile === 'liste' ? 'vare' : 'liste')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 }}>
      {listeTekst ? (
        <>
          <View style={{ flex: 1 }}>
            <Text style={t.subhead}>Handleliste</Text>
            <Text style={[t.caption, { marginTop: 1 }]} numberOfLines={1}>{listeTekst}</Text>
          </View>
          <Text style={[t.subhead, { fontWeight: '600' }]}>{hvile === 'liste' ? 'Skjul' : 'Vis'}</Text>
        </>
      ) : (
        <Text style={[t.footnote, { flex: 1 }]}>
          Ingen vare
        </Text>
      )}
    </Pressable>
  )

  const detaljer = elnummer && !laster ? (
    <Animated.View style={detaljStil}>
      {harPriser ? (
        <View style={{ marginTop: spacing.md, gap: 2 }}>
          {priser.map(x => {
            const valgtRad = x.grossist === grossist
            const billigst = erBilligst(x.grossist)
            return (
              <Pressable key={x.grossist} haptic="light" pressScale={0.98}
                onPress={() => setValgt(x.grossist)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
                  borderRadius: radius.lg,
                  borderWidth: 1.5, borderColor: valgtRad ? colors.label : 'transparent',
                  backgroundColor: valgtRad ? colors.bg : colors.groupedBg,
                }}>
                <Text style={[t.subhead, { fontWeight: valgtRad ? '600' : '400' }]}>{x.grossist}</Text>
                {billigst && (
                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.success }}>
                    <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>BILLIGST</Text>
                  </View>
                )}
                {x.erListepris && (
                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                    <Text style={[t.caption, { fontWeight: '700' }]}>LISTEPRIS</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                {x.lagerfoert === false && (
                  <Text style={[t.caption, { color: colors.tertiaryLabel }]}>ikke lagerført</Text>
                )}
                <Text style={[t.subhead, { fontVariant: ['tabular-nums'], fontWeight: '600' }, billigst && { color: colors.success }]}>
                  {formatKr(tilOre(x.nettoPris))}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : grossistvalg.length > 0 ? (
        <>
          <Text style={[t.footnote, { marginTop: spacing.md }]}>
            Ingen pris
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {grossistvalg.map(g => (
              <Pressable key={g} haptic="light" pressScale={0.95} onPress={() => setValgt(g)}
                style={{
                  paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
                  backgroundColor: g === grossist ? colors.label : colors.fill,
                }}>
                <Text style={[t.subhead, { color: g === grossist ? colors.ctaLabel : colors.label, fontWeight: '500' }]}>{g}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {grossist ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
          <Antallvelger verdi={antall} enhet={enhet} onEndre={setAntall} />
          <Pressable haptic="medium" onPress={leggI} disabled={legger || lesAntall(antall) <= 0}
            style={{
              flex: 1, height: sizes.ctaHeight, borderRadius: radius.pill,
              backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center',
              opacity: lesAntall(antall) <= 0 ? 0.35 : 1,
            }}>
            <Text style={[t.headline, { color: colors.ctaLabel }]} numberOfLines={1}>
              {`Legg i kurv · ${grossist}`}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[t.footnote, { marginTop: spacing.md }]}>
          Ingen grossist
        </Text>
      )}

      {kvittering && (
        <Pressable haptic="light" pressScale={0.99} onPress={() => setHvile('liste')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }}>
            <Check size={13} color="#fff" strokeWidth={3} />
          </View>
          <Text style={[t.footnote, { flex: 1, color: colors.label }]} numberOfLines={1}>{kvittering}</Text>
          <Text style={[t.footnote, { color: colors.label, fontWeight: '600' }]}>Vis lista</Text>
        </Pressable>
      )}
    </Animated.View>
  ) : null

  // Lista gruppert per grossist — det er én bestilling per grossist.
  const grupper = listeGrossister.map(g => ({ grossist: g, linjer: handlelinjer.filter(h => h.grossist === g).map(h => h.linje) }))

  return (
    <>
      <Animated.View pointerEvents={hvile === 'liste' ? 'auto' : 'none'}
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, bakStil]}>
        <Pressable haptic="none" pressScale={1} style={{ flex: 1 }} onPress={() => setHvile('vare')} />
      </Animated.View>

      <Animated.View style={[{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: H + bunn,
        backgroundColor: colors.bg,
        borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero,
        borderTopWidth: 0.5, borderColor: colors.border,
      }, shadows.floating, panelStil]}>
        <GestureDetector gesture={dra}>
          <View collapsable={false}
            onLayout={e => setHodeH(Math.round(e.nativeEvent.layout.height))}
            style={{ paddingHorizontal: spacing.screen, paddingBottom: spacing.md }}>
            {/* Håndtaket: trykk veksler mellom vare og liste, dra gjør resten. */}
            <Pressable haptic="light" pressScale={1}
              onPress={() => setHvile(hvile === 'liste' ? 'vare' : 'liste')}
              style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm }}>
              <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator }} />
            </Pressable>
            <View onLayout={e => setSammendragH(Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height) + spacing.md)}>
              {sammendrag}
            </View>
            {detaljer}
          </View>
        </GestureDetector>

        <Animated.View style={[{ flex: 1, borderTopWidth: 0.5, borderTopColor: colors.separator }, listeStil]}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: bunn + spacing.xl }}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {grupper.length === 0 ? (
              <Text style={[t.footnote, { marginTop: spacing.lg }]}>
                Handlelista er tom
              </Text>
            ) : grupper.map(g => (
              <View key={g.grossist} style={{ marginTop: spacing.lg }}>
                <Text style={[t.eyebrow, { textTransform: 'uppercase' }]}>
                  {`${g.grossist} · ${g.linjer.length} ${g.linjer.length === 1 ? 'vare' : 'varer'}`}
                </Text>
                {g.linjer.map((l, i) => <Listelinje key={l.id} linje={l} sist={i === g.linjer.length - 1} />)}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </>
  )
}

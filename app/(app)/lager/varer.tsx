import { useMemo, useState } from 'react'
import { View, ScrollView, FlatList, Image, useWindowDimensions } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { router, useLocalSearchParams } from 'expo-router'
import {
  ChevronLeft, Package, ChevronRight, SlidersHorizontal, TrendingDown,
  X, ArrowUpDown, Search, LayoutGrid, Rows3, Plus,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { PapirChip, usePapirFokus } from '../../../components/papir-surface'
import { PromptSheet } from '../../../components/sheet'
import {
  useVaresok, useFabrikater, useGrossister, useVareantall, useKategorier, useMenteDu,
  formatBeholdning, finnEllerOpprettVare, type Varetreff, type Varefilter,
} from '../../../lib/products'
import { sorteringLabel, type Sortering } from '../../../lib/product-search'
import { useDemoAntall } from '../../../lib/pricefile/demo'
import { formatKr, tilOre } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/**
 * Varekartoteket — «EFObasen-følelsen».
 *
 * Alt som gjør dette mulig sto allerede i prisfila og ble kastet ved import:
 * fabrikat, typebetegnelse, EAN, NRF, bilde, FDV, HMS og pakningsstørrelse.
 * Se `lib/pricefile/varekort.ts`.
 *
 * Det vi har som EFObasen ikke har: **prisen fra flere grossister side om side.**
 * Det er også det ingen grossists eget system kan bygge.
 */
function VareRad({ treff, first, last }: { treff: Varetreff; first: boolean; last: boolean }) {
  const p = treff.product
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(app)/lager/vare', params: { id: p.id } })}
      style={{
        backgroundColor: colors.bg, marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        flexDirection: 'row', alignItems: 'center',
        borderTopLeftRadius: first ? radius.lg : 0, borderTopRightRadius: first ? radius.lg : 0,
        borderBottomLeftRadius: last ? radius.lg : 0, borderBottomRightRadius: last ? radius.lg : 0,
      }}
    >
      {/* Bildet kommer fra grossistens egen katalog. Mangler det, står ikonet. */}
      <View style={{
        width: 44, height: 44, borderRadius: radius.md,
        backgroundColor: p.imageUrl ? colors.brandSoft : colors.fill,
        alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, overflow: 'hidden',
      }}>
        {p.imageUrl
          ? <Image source={{ uri: p.imageUrl }} style={{ width: 44, height: 44 }} resizeMode="contain" />
          : <Package size={19} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />}
      </View>

      <View style={{ flex: 1, marginRight: spacing.sm }}>
        <Text style={t.bodyMedium} numberOfLines={2}>{p.name}</Text>
        <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
          {[
            p.fabrikat,
            p.elnummer ? `EL ${p.elnummer}` : null,
            treff.beholdning !== null ? `${formatBeholdning(treff.beholdning, p.unit)} på lager` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
        {/* Det som ingen grossists eget system kan si. */}
        {treff.besparelse !== null && treff.besparelse > 0 && treff.billigste && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
            <TrendingDown size={12} color={colors.success} strokeWidth={2.4} />
            <Text style={[t.caption, { color: colors.success, fontWeight: '600' }]}>
              {`${treff.billigste.grossist} er ${formatKr(tilOre(treff.besparelse))} billigere`}
            </Text>
          </View>
        )}
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        {treff.billigste && (
          <Text style={[t.subhead, {
            fontVariant: ['tabular-nums'],
            // Dempet når det bare er en listepris: tallet er katalogens, ikke firmaets.
            color: treff.pris.kunListepriser ? colors.secondaryLabel : colors.label,
          }]}>
            {formatKr(tilOre(treff.billigste.nettoPris))}
          </Text>
        )}
        <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]}>
          {treff.pris.kunListepriser
            ? 'listepris'
            : treff.priser.length > 1 ? `${treff.priser.length} grossister` : ''}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} style={{ marginLeft: spacing.sm }} />
    </Pressable>
  )
}

/**
 * Vare som rutekort.
 *
 * Bildet er hovedsaken her, ikke en dekorasjon: du blar fordi du IKKE husker
 * hva varen heter. Da er et bilde raskere enn en tekstlinje.
 */
function VareRute({ treff, bredde, indeks }: { treff: Varetreff; bredde: number; indeks: number }) {
  const p = treff.product
  return (
    <Animated.View
      // Stagger, aldri alt-på-en-gang. Taket på 10 hindrer at rad 30 kommer et
      // sekund for sent når man scroller fort.
      entering={FadeInDown.springify().damping(18).delay(Math.min(indeks, 10) * 40)}
      style={{ width: bredde, marginBottom: spacing.md }}
    >
    <Pressable onPress={() => router.push({ pathname: '/(app)/lager/vare', params: { id: p.id } })}>
      <View style={{
        height: bredde, borderRadius: radius.lg, overflow: 'hidden',
        backgroundColor: p.imageUrl ? colors.brandSoft : colors.fill,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {p.imageUrl
          ? <Image source={{ uri: p.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          : <Package size={26} color={colors.tertiaryLabel} strokeWidth={1.8} />}
      </View>
      <Text style={[t.subhead, { marginTop: spacing.sm }]} numberOfLines={2}>{p.name}</Text>
      <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]} numberOfLines={1}>
        {[p.fabrikat, p.elnummer ? `EL ${p.elnummer}` : null].filter(Boolean).join(' · ')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 3 }}>
        {treff.billigste && (
          <Text style={[t.bodyMedium, {
            fontVariant: ['tabular-nums'],
            color: treff.pris.kunListepriser ? colors.secondaryLabel : colors.label,
          }]}>
            {formatKr(tilOre(treff.billigste.nettoPris))}
          </Text>
        )}
        {treff.pris.kunListepriser && (
          <Text style={[t.caption, { color: colors.tertiaryLabel }]}>listepris</Text>
        )}
      </View>
      {treff.besparelse !== null && treff.besparelse > 0 && treff.billigste && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
          <TrendingDown size={11} color={colors.success} strokeWidth={2.4} />
          <Text style={[t.caption, { color: colors.success, fontWeight: '600' }]} numberOfLines={1}>
            {`${treff.billigste.grossist} ${formatKr(tilOre(treff.besparelse))}`}
          </Text>
        </View>
      )}
    </Pressable>
    </Animated.View>
  )
}

export default function Varekartotek() {
  const insets = useSafeAreaInsets()
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  usePapirFokus()
  // `?sok=` fyller søkefeltet ved åpning. Brukes av dyplenker og av
  // AI-assistenten når den skal vise et bestemt oppslag.
  const { sok: sokParam } = useLocalSearchParams<{ sok?: string }>()
  const [sok, setSok] = useState(sokParam ?? '')
  const [filter, setFilter] = useState<Varefilter>({})
  const [visFilter, setVisFilter] = useState(false)
  // Rutenett som standard: du blar visuelt, og da er bildet poenget.
  const [rutenett, setRutenett] = useState(true)
  const { width } = useWindowDimensions()
  // To kolonner med skjermmarg og ett mellomrom.
  const ruteBredde = (width - spacing.screen * 2 - spacing.md) / 2

  const [sortering, setSortering] = useState<Sortering>('relevans')
  const treff = useVaresok(sok, filter, sortering)
  const fabrikater = useFabrikater()
  const grossister = useGrossister()
  const antall = useVareantall()
  const demoAntall = useDemoAntall()
  const kategorier = useKategorier()
  const menteDu = useMenteDu(sok, treff.length > 0)
  const [nyVare, setNyVare] = useState(false)

  /**
   * Ser søket ut som et el-nummer vi ikke har?
   *
   * El-nummer er sjusifret; 6–8 siffer fanger opp både eldre og skrivefeil.
   * Dette er det eneste tilfellet der «ingen treff» er feil svar: nummeret er
   * ekte, varen finnes hos grossisten — den finnes bare ikke i DITT kartotek
   * ennå, fordi kartoteket fylles av prisfila.
   */
  const ukjentElnummer = useMemo(() => {
    const q = sok.replace(/\s/g, '')
    return /^\d{6,8}$/.test(q) && treff.length === 0 ? q : null
  }, [sok, treff.length])

  // Tomt søk OG ingen varegruppe valgt = bla-modus. Det er dette et søkefelt
  // alene ikke gir: du vet ikke alltid hva varen heter, men du vet at du skal
  // ha en koblingsboks.
  const blar = !sok.trim() && !filter.kategori && kategorier.length > 0

  const aktiveFilter = Object.values(filter).filter(Boolean).length

  function slaaAv<K extends keyof Varefilter>(nokkel: K, verdi: Varefilter[K]) {
    setFilter(f => ({ ...f, [nokkel]: f[nokkel] === verdi ? undefined : verdi }))
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.screen }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable haptic="light" pressScale={0.94} onPress={() => setRutenett(r => !r)}
            style={{
              width: 34, height: 34, borderRadius: radius.pill,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
            }}>
            {rutenett
              ? <Rows3 size={16} color={colors.label} strokeWidth={2.1} />
              : <LayoutGrid size={16} color={colors.label} strokeWidth={2.1} />}
          </Pressable>
          <Pressable haptic="light" pressScale={0.94} onPress={() => setVisFilter(v => !v)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 34,
              paddingHorizontal: spacing.md, borderRadius: radius.pill,
              backgroundColor: aktiveFilter > 0 ? colors.brandSoft : colors.fill,
            }}>
            <SlidersHorizontal size={15} color={aktiveFilter > 0 ? colors.brand : colors.label} strokeWidth={2.1} />
            <Text style={[t.subhead, { fontWeight: '600', color: aktiveFilter > 0 ? colors.brand : colors.label }]}>
              {aktiveFilter > 0 ? `Filter · ${aktiveFilter}` : 'Filter'}
            </Text>
          </Pressable>
          </View>
        </View>

        <Text style={[t.display, { marginTop: spacing.md }]}>Varer</Text>
        <Text style={[t.footnote, { marginTop: 2 }]}>
          {antall === 0
            ? 'Kartoteket er tomt — importer en prisfil fra grossisten.'
            : blar
              ? `${antall} varer i ${kategorier.length} grupper${grossister.length > 0 ? ` · ${grossister.join(', ')}` : ''}`
              : `${antall} varer${grossister.length > 0 ? ` · ${grossister.join(', ')}` : ''}`}
        </Text>

        <TextInput
          value={sok} onChangeText={setSok}
          placeholder="El-nummer, navn, produsent eller strekkode"
          placeholderTextColor={colors.tertiaryLabel}
          autoCorrect={false} clearButtonMode="while-editing"
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            marginTop: spacing.md,
          }]}
        />
      </View>

      {visFilter && (
        <ScrollView style={{ maxHeight: 190, marginTop: spacing.md }} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
            <View>
              <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm }]}>Hvor</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                <PapirChip label="På vårt lager" selected={!!filter.kunPaaLager}
                  onPress={() => setFilter(f => ({ ...f, kunPaaLager: !f.kunPaaLager }))} />
                <PapirChip label="Lagerført hos grossist" selected={!!filter.kunLagerfoert}
                  onPress={() => setFilter(f => ({ ...f, kunLagerfoert: !f.kunLagerfoert }))} />
              </View>
            </View>
            {grossister.length > 0 && (
              <View>
                <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm }]}>Grossist</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {grossister.map(g => (
                    <PapirChip key={g} label={g} selected={filter.grossist === g} onPress={() => slaaAv('grossist', g)} />
                  ))}
                </View>
              </View>
            )}
            {fabrikater.length > 0 && (
              <View>
                <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm }]}>Produsent</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {fabrikater.slice(0, 30).map(f => (
                    <PapirChip key={f} label={f} selected={filter.fabrikat === f} onPress={() => slaaAv('fabrikat', f)} />
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Oppdiktede priser skal ALDRI kunne forveksles med ekte. Merket står i
          selve kartoteket, ikke bare på skjermen der demoen ble lastet inn. */}
      {demoAntall > 0 && (
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/lager/prisfil')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
            marginHorizontal: spacing.screen, marginTop: spacing.md,
            backgroundColor: colors.warningWash, borderRadius: radius.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
          }}
        >
          <Text style={[t.caption, { color: colors.warning, fontWeight: '700' }]}>DEMO</Text>
          <Text style={[t.footnote, { flex: 1 }]} numberOfLines={1}>
            {`${demoAntall} varer med oppdiktede priser`}
          </Text>
          <ChevronRight size={14} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
        </Pressable>
      )}

      {/* Valgt varegruppe vises som en brødsmule man kan trykke bort. */}
      {!!filter.kategori && (
        <View style={{ flexDirection: 'row', paddingHorizontal: spacing.screen, marginTop: spacing.md }}>
          <Pressable
            haptic="light"
            onPress={() => setFilter(f => ({ ...f, kategori: undefined }))}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
              paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderRadius: radius.pill, backgroundColor: colors.label,
            }}
          >
            <Text style={[t.subhead, { color: colors.bg, fontWeight: '600' }]}>{filter.kategori}</Text>
            <X size={14} color={colors.bg} strokeWidth={2.4} />
          </Pressable>
        </View>
      )}

      {/* Et ekte el-nummer som ikke er i kartoteket.
          Kartoteket fylles av prisfila, og den kommer fra grossisten. Men et
          nummer du har lest av en eske skal ikke møtes med «ingen treff» — du
          skal kunne legge varen inn og gå videre, og la prisfila fylle resten
          når den kommer. */}
      {!!ukjentElnummer && (
        <View style={{
          marginHorizontal: spacing.screen, marginTop: spacing.md,
          backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.lg,
        }}>
          <Text style={t.bodyMedium}>{`EL ${ukjentElnummer} er ikke i kartoteket`}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            Varekartoteket fylles av en prisfil fra grossisten — den har de ekte
            el-numrene, navnene og bildene. Til den er importert kan du legge inn
            varen selv; nummeret følger med, så prisfila kobler seg på den senere.
          </Text>
          <Pressable
            haptic="medium"
            onPress={() => setNyVare(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: 44, borderRadius: radius.lg, backgroundColor: colors.brandSoft, marginTop: spacing.md,
            }}
          >
            <Plus size={16} color={colors.brand} strokeWidth={2.4} />
            <Text style={[t.subhead, { color: colors.brand, fontWeight: '600' }]}>Legg inn varen</Text>
          </Pressable>
        </View>
      )}

      {/* «Mente du …» — et forslag, ikke et stille bytte av søket. */}
      {!!menteDu && (
        <Pressable
          haptic="light"
          onPress={() => setSok(menteDu)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
            marginHorizontal: spacing.screen, marginTop: spacing.md,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
            borderRadius: radius.md, backgroundColor: colors.brandSoft,
          }}
        >
          <Search size={14} color={colors.brand} strokeWidth={2.2} />
          <Text style={[t.subhead, { color: colors.brand }]}>
            Mente du <Text style={{ fontWeight: '700' }}>{menteDu}</Text>?
          </Text>
        </Pressable>
      )}

      {/* Sortering vises kun når det finnes noe å sortere. */}
      {!blar && treff.length > 1 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm, alignItems: 'center' }}
          style={{ marginTop: spacing.md, flexGrow: 0 }}
        >
          <ArrowUpDown size={13} color={colors.tertiaryLabel} strokeWidth={2.2} />
          {(['relevans', 'pris', 'navn'] as Sortering[]).map(v => (
            <PapirChip key={v} label={sorteringLabel[v]} selected={sortering === v} onPress={() => setSortering(v)} />
          ))}
        </ScrollView>
      )}

      {blar ? (
        <ScrollView
          contentContainerStyle={{
            paddingTop: spacing.lg, paddingHorizontal: spacing.screen,
            paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
            Varegrupper
          </Text>
          {rutenett ? (
            /* Fliser med bilde. Et bilde er raskere å kjenne igjen enn en
               tekstlinje — og du blar nettopp fordi du ikke husker navnet. */
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {kategorier.map(k => (
                <Pressable
                  key={k.kategori}
                  haptic="light"
                  onPress={() => setFilter(f => ({ ...f, kategori: k.kategori }))}
                  style={{ width: ruteBredde, marginBottom: spacing.md }}
                >
                  <View style={{
                    height: ruteBredde * 0.72, borderRadius: radius.lg, overflow: 'hidden',
                    backgroundColor: k.bilde ? colors.brandSoft : colors.fill,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {k.bilde
                      ? <Image source={{ uri: k.bilde }} style={{ width: '72%', height: '72%' }} resizeMode="contain" />
                      : <Package size={24} color={colors.tertiaryLabel} strokeWidth={1.8} />}
                  </View>
                  <Text style={[t.subhead, { fontWeight: '600', marginTop: spacing.sm }]} numberOfLines={2}>
                    {k.kategori}
                  </Text>
                  <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]}>
                    {`${k.antall} ${k.antall === 1 ? 'vare' : 'varer'}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, overflow: 'hidden' }}>
              {kategorier.map((k, i) => (
                <Pressable
                  key={k.kategori}
                  haptic="light"
                  onPress={() => setFilter(f => ({ ...f, kategori: k.kategori }))}
                  style={[
                    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
                    i < kategorier.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                  ]}
                >
                  <Text style={[t.body, { flex: 1 }]} numberOfLines={1}>{k.kategori}</Text>
                  <Text style={[t.subhead, { color: colors.tertiaryLabel, marginRight: spacing.sm }]}>{k.antall}</Text>
                  <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </Pressable>
              ))}
            </View>
          )}

          {fabrikater.length > 0 && (
            <>
              <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
                Produsenter
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {fabrikater.map(f => (
                  <PapirChip key={f} label={f} selected={filter.fabrikat === f} onPress={() => slaaAv('fabrikat', f)} />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      ) : (
      <FlatList
        data={treff}
        key={rutenett ? 'rutenett' : 'liste'}
        numColumns={rutenett ? 2 : 1}
        columnWrapperStyle={rutenett ? { justifyContent: 'space-between', paddingHorizontal: spacing.screen } : undefined}
        keyExtractor={x => x.product.id}
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={rutenett ? undefined : () => (
          <View style={{ backgroundColor: colors.bg, marginHorizontal: spacing.screen }}>
            <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg + 44 + spacing.md }} />
          </View>
        )}
        renderItem={({ item, index }) => (
          rutenett
            ? <VareRute treff={item} bredde={ruteBredde} indeks={index} />
            : <VareRad treff={item} first={index === 0} last={index === treff.length - 1} />
        )}
        ListEmptyComponent={
          <Text style={[t.footnote, { textAlign: 'center', paddingHorizontal: spacing.screen, marginTop: spacing.xl }]}>
            {antall === 0
              ? 'Last inn en V4- eller P4-fil fra grossisten, så fylles kartoteket med navn, produsent, bilder og priser.'
              : sok.trim()
                ? 'Ingen treff. Prøv el-nummer, produsent eller færre ord.'
                : 'Ingen varer passer filteret.'}
          </Text>
        }
      />
      )}

      <PromptSheet
        synlig={nyVare}
        tittel={`Ny vare · EL ${ukjentElnummer ?? ''}`}
        forklaring="Skriv navnet slik du vil finne den igjen. Prisfila retter det senere hvis den har et annet."
        plassholder="F.eks. Jordfeilautomat 16A"
        knapp="Legg inn"
        onSvar={async navn => {
          setNyVare(false)
          if (!ukjentElnummer || !navn.trim()) return
          const p = await finnEllerOpprettVare({ navn, elnummer: ukjentElnummer })
          router.push({ pathname: '/(app)/lager/vare', params: { id: p.id } })
        }}
        onAvbryt={() => setNyVare(false)}
      />
    </View>
  )
}

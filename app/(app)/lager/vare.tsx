import { View, ScrollView, Image, Linking } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import {
  ChevronLeft, Package, FileText, ShieldAlert,
  TrendingDown, AlertTriangle,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { PapirSectionHeader, usePapirFokus } from '../../../components/papir-surface'
import { useVare } from '../../../lib/products'
import { visbareEkstra } from '../../../lib/pricefile/varekort'
import { formatKr, tilOre } from '../../../lib/invoicing'
import { formatSince } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

/** Etikett/verdi-rad. Verdien er valgfri — mangler den, vises ikke raden. */
function Rad({ etikett, verdi, sist }: { etikett: string; verdi: string | null | undefined; sist?: boolean }) {
  if (!verdi) return null
  return (
    <View style={[
      { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
      !sist && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
    ]}>
      <Text style={[t.subhead, { color: colors.secondaryLabel, width: 132 }]}>{etikett}</Text>
      <Text style={[t.body, { flex: 1 }]} selectable>{verdi}</Text>
    </View>
  )
}

function Lenke({ ikon: Ikon, tittel, url }: { ikon: typeof FileText; tittel: string; url: string | null }) {
  if (!url) return null
  return (
    <Pressable haptic="light" onPress={() => Linking.openURL(url)}
      style={{
        flex: 1, alignItems: 'center', gap: spacing.xs,
        backgroundColor: colors.bg, borderRadius: radius.lg, paddingVertical: spacing.md,
      }}>
      <Ikon size={19} color={colors.brand} strokeWidth={2.1} />
      <Text style={[t.caption, { color: colors.brand, fontWeight: '600' }]}>{tittel}</Text>
    </Pressable>
  )
}

/**
 * Varekortet.
 *
 * Alt her — bilde, produsent, typebetegnelse, EAN, NRF, FDV, HMS,
 * pakningsstørrelse — kommer fra prisfila. Ingenting av det krever EFObasen,
 * og ingenting av det ble tatt vare på før 19. august.
 *
 * Det EFObasen har som dette ikke gir: ETIM-attributter (strukturerte tekniske
 * data), og varer ingen grossist du har fil fra fører.
 */
export default function Varekort() {
  const insets = useSafeAreaInsets()
  // Kremet klokke og batteri på mørk grunn — settes tilbake når skjermen forlates.
  usePapirFokus()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { product: p, priser, pris } = useVare(id)

  if (!p) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  const billigste = pris.billigste
  const besparelse = pris.besparelse
  const dyreste = priser.filter(x => !x.erListepris).slice(-1)[0] ?? null
  const ekstra = visbareEkstra(p.ekstraFelt)
  const utgaatt = priser.length > 0 && priser.every(x => x.utgaatt)

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Glass trenger noe å bryte — en flat farge bak glass er usynlig (DESIGN.md). */}
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>

          {p.imageUrl ? (
            <View style={{
              height: 220, backgroundColor: colors.brandSoft, borderRadius: radius.hero,
              marginTop: spacing.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <Image source={{ uri: p.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </View>
          ) : (
            <View style={{
              height: 96, backgroundColor: colors.bg, borderRadius: radius.hero,
              marginTop: spacing.lg, alignItems: 'center', justifyContent: 'center',
            }}>
              <Package size={30} color={colors.tertiaryLabel} strokeWidth={1.8} />
            </View>
          )}

          <Text style={[t.display, { marginTop: spacing.lg }]}>{p.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.sm }]}>
            {[p.fabrikat, p.typeBetegnelse].filter(Boolean).join(' · ') || 'Produsent ikke oppgitt i prisfila'}
          </Text>
        </View>

        {/* Utgått hos alle grossister vi har fil fra — og hva den erstattes av. */}
        {utgaatt && (
          <View style={{
            flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
            marginHorizontal: spacing.screen, marginTop: spacing.lg,
            backgroundColor: colors.warningWash, borderRadius: radius.lg, padding: spacing.lg,
          }}>
            <AlertTriangle size={17} color={colors.warning} strokeWidth={2.2} />
            <Text style={[t.footnote, { flex: 1 }]}>
              {p.replacedBy
                ? `Utgått hos grossisten. Erstattes av EL ${p.replacedBy}.`
                : 'Utgått hos grossisten. Ingen erstatningsvare oppgitt.'}
            </Text>
          </View>
        )}

        {/* Dokumentene montøren faktisk trenger, uten å ringe kontoret. */}
        {/* Kun lenker fila FAKTISK ga oss. EFObasen-id-en vises som tekst under
            Identifikasjon, ikke som knapp — vi kjenner ikke URL-formen deres, og
            en lenke som kanskje 404-er er verre enn ingen lenke. */}
        {(p.fdvUrl || p.hmsUrl) && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginTop: spacing.lg }}>
            <Lenke ikon={FileText} tittel="FDV" url={p.fdvUrl} />
            <Lenke ikon={ShieldAlert} tittel="HMS" url={p.hmsUrl} />
          </View>
        )}

        {p.sourceSystem === 'demo' && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
            marginHorizontal: spacing.screen, marginTop: spacing.lg,
            backgroundColor: colors.warningWash, borderRadius: radius.lg, padding: spacing.md,
          }}>
            <Text style={[t.caption, { color: colors.warning, fontWeight: '700' }]}>DEMO</Text>
            <Text style={[t.footnote, { flex: 1 }]}>
              Oppdiktet vare. Prisene er funnet på og skal ikke brukes på en ordre.
            </Text>
          </View>
        )}

        {/* Prisen per grossist — det ingen grossists eget system kan vise. */}
        <PapirSectionHeader>Pris per grossist</PapirSectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          {priser.length === 0 ? (
            <Text style={[t.footnote, { padding: spacing.lg }]}>
              Ingen prisfil importert for denne varen ennå.
            </Text>
          ) : priser.map((x, i) => {
            // Bare den prisbildet faktisk peker på, og bare når det er noe å
            // sammenligne med. En listepris skal aldri få «BILLIGST».
            const erBilligst = besparelse !== null && billigste?.grossist === x.grossist
            return (
              <View key={x.grossist} style={[
                { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 4 },
                i < priser.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
                erBilligst && { backgroundColor: colors.successWash },
              ]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={[t.bodyMedium, erBilligst && { color: colors.success }]}>{x.grossist}</Text>
                    {erBilligst && (
                      <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.success }}>
                        <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>BILLIGST</Text>
                      </View>
                    )}
                    {/* Listepris er katalogprisen, ikke firmaets. Sies på selve
                        raden, ikke bare i en fotnote — det er tallet som leses. */}
                    {x.erListepris && (
                      <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                        <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '700' }]}>LISTEPRIS</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 1 }]}>
                    {[
                      x.lagerfoert === true ? 'Lagerført' : x.lagerfoert === false ? 'Ikke lagerført' : null,
                      x.salgspakning ? `pakning à ${x.salgspakning}` : null,
                      x.utgaatt ? 'utgått' : null,
                      x.importertDato ? `oppdatert ${formatSince(x.importertDato)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {/* Tallet er hele grunnen til at skjermen finnes. Vinneren får
                    display-vekt; de andre står rolig ved siden av. */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                  <Text style={[
                    erBilligst ? t.title2 : t.bodyMedium,
                    { fontVariant: ['tabular-nums'] },
                    erBilligst && { color: colors.success },
                  ]}>
                    {formatKr(tilOre(x.nettoPris))}
                  </Text>
                  <Text style={[t.caption, { color: erBilligst ? colors.success : colors.tertiaryLabel }]}>
                    {`/ ${p.unit}`}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* Kjenner vi ingen nettopris, er det ærligere å si det enn å la
            listeprisen stå som om den var firmaets. */}
        {pris.kunListepriser && (
          <View style={{
            flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
            marginHorizontal: spacing.screen, marginTop: spacing.sm,
            backgroundColor: colors.warningWash, borderRadius: radius.lg, padding: spacing.lg,
          }}>
            <AlertTriangle size={17} color={colors.warning} strokeWidth={2.2} />
            <Text style={[t.footnote, { flex: 1 }]}>
              Dette er grossistens listepris, ikke deres pris. Importer en
              P4-fil — pristilbudet med firmaets egen rabatt — for å se hva varen
              faktisk koster, og for at dekningsbidraget skal bli riktig.
            </Text>
          </View>
        )}

        {pris.blandet && (
          <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginTop: spacing.sm }]}>
            Én av prisene over er en listepris og sammenlignes ikke — listepris og
            avtalt pris er ikke samme størrelse.
          </Text>
        )}

        {besparelse !== null && besparelse > 0 && billigste && dyreste && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
            marginHorizontal: spacing.screen, marginTop: spacing.sm,
            backgroundColor: colors.brandWash, borderRadius: radius.lg, padding: spacing.lg,
          }}>
            <TrendingDown size={18} color={colors.success} strokeWidth={2.2} />
            <Text style={[t.footnote, { flex: 1 }]}>
              {`${billigste.grossist} er ${formatKr(tilOre(besparelse))} billigere per ${p.unit} enn ${dyreste.grossist}. På 100 ${p.unit} er det ${formatKr(tilOre(besparelse * 100))}.`}
            </Text>
          </View>
        )}

        {/* Numrene. Alt kan markeres og kopieres — de skal inn i en bestilling. */}
        <PapirSectionHeader>Identifikasjon</PapirSectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <Rad etikett="El-nummer" verdi={p.elnummer} />
          <Rad etikett="EAN" verdi={p.ean} />
          <Rad etikett="NRF" verdi={p.nrf} />
          <Rad etikett="Produsent" verdi={p.fabrikat} />
          <Rad etikett="Type" verdi={p.typeBetegnelse} />
          <Rad etikett="Rabattgruppe" verdi={p.discountGroup} />
          <Rad etikett="EFObasen-id" verdi={p.efobaseId} />
          <Rad etikett="Enhet" verdi={p.unit} />
          <Rad etikett="Pakning" verdi={p.salesPack ? `${p.salesPack} ${p.unit}` : null} />
          {ekstra.map((x, i) => (
            <Rad key={x.etikett} etikett={x.etikett} verdi={x.verdi} sist={i === ekstra.length - 1} />
          ))}
        </View>

        <PapirSectionHeader>Våre priser</PapirSectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <Rad etikett="Vår kost" verdi={p.costPrice != null ? `${formatKr(tilOre(p.costPrice))} (${p.supplier ?? 'ukjent grossist'})` : null} />
          <Rad etikett="Utsalg eks. mva" verdi={p.unitPrice != null ? formatKr(tilOre(p.unitPrice)) : null} sist />
        </View>
        {p.costPrice != null && p.unitPrice != null && p.unitPrice > 0 && (
          <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginTop: spacing.xs }]}>
            {`Dekningsbidrag ${formatKr(tilOre(p.unitPrice - p.costPrice))} — ${String(Math.round(((p.unitPrice - p.costPrice) / p.unitPrice) * 1000) / 10).replace('.', ',')} %`}
            {/* Regnet på listepris er dette tallet for lavt, og en lønnsom jobb
                ser ulønnsom ut. Da skal det ikke stå som et faktum. */}
            {pris.kunListepriser ? ' — regnet på listepris, altså for lavt' : ''}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

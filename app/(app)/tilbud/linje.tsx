import { useEffect, useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Package, Clock, AlignLeft } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ProductPicker } from '../../../components/product-picker'
import { Segmented } from '../../../components/segmented'
import { database } from '../../../lib/db'
import { Activity } from '../../../lib/db/models/activity'
import { Product } from '../../../lib/db/models/product'
import { QuoteLine } from '../../../lib/db/models/quote-line'
import { leggTilLinje, oppdaterLinje, slettLinje } from '../../../lib/quotes'
import { byggTilbudssum, type TilbudslinjeArt } from '../../../lib/quoting'
import { formatKr } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const ARTER: { key: TilbudslinjeArt; label: string }[] = [
  { key: 'materiell', label: 'Materiell' },
  { key: 'arbeid', label: 'Arbeid' },
  { key: 'tekst', label: 'Tekst' },
]

const ART_IKON = { materiell: Package, arbeid: Clock, tekst: AlignLeft }

/** Tall fra et tekstfelt. Norsk komma er det montøren skriver. */
function somTall(v: string): number | null {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

function tallTekst(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return String(n).replace('.', ',')
}

function Felt({ label, verdi, onEndre, suffiks, tastatur, flex }: {
  label: string
  verdi: string
  onEndre: (v: string) => void
  suffiks?: string
  tastatur?: 'decimal-pad' | 'default'
  flex?: number
}) {
  return (
    <View style={{ flex: flex ?? 1 }}>
      <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs, marginLeft: spacing.xs }]}>{label}</Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        backgroundColor: colors.bg, borderRadius: radius.md,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
      }}>
        <TextInput
          value={verdi} onChangeText={onEndre}
          keyboardType={tastatur === 'default' ? 'default' : 'decimal-pad'}
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, { flex: 1 }]}
        />
        {!!suffiks && <Text style={[t.footnote, { color: colors.secondaryLabel }]}>{suffiks}</Text>}
      </View>
    </View>
  )
}

/**
 * Én tilbudslinje — ny eller redigering.
 *
 * Dekningsbidraget for linja står nederst og oppdateres mens du skriver. Det er
 * det eneste tidspunktet tallet kan endre noe: etter at prisen er sendt er det
 * bare en rapport.
 */
export default function Linje() {
  const insets = useSafeAreaInsets()
  const { quoteId, lineId } = useLocalSearchParams<{ quoteId: string; lineId?: string }>()
  const redigerer = !!lineId

  const [linje, setLinje] = useState<QuoteLine | null>(null)
  const [art, setArt] = useState<TilbudslinjeArt>('materiell')
  const [beskrivelse, setBeskrivelse] = useState('')
  const [antall, setAntall] = useState('1')
  const [enhet, setEnhet] = useState('stk')
  const [pris, setPris] = useState('')
  const [kost, setKost] = useState('')
  const [rabatt, setRabatt] = useState('')
  const [produktId, setProduktId] = useState<string | null>(null)
  const [aktivitetId, setAktivitetId] = useState<string | null>(null)
  const [elnummer, setElnummer] = useState<string | null>(null)
  const [mvaType, setMvaType] = useState<string | null>(null)
  const [aktiviteter, setAktiviteter] = useState<Activity[]>([])
  const [busy, setBusy] = useState(false)
  const [klar, setKlar] = useState(!lineId)

  useEffect(() => {
    if (!lineId) return
    let montert = true
    ;(async () => {
      const l = await database.get<QuoteLine>('quote_lines').find(lineId).catch(() => null)
      if (!montert || !l) { router.back(); return }
      setLinje(l)
      setArt(l.kind)
      setBeskrivelse(l.description)
      setAntall(tallTekst(l.quantity))
      setEnhet(l.unit ?? 'stk')
      setPris(tallTekst(l.unitPrice))
      setKost(tallTekst(l.costPrice))
      setRabatt(tallTekst(l.discountPercent))
      setProduktId(l.productId)
      setAktivitetId(l.activityId)
      setElnummer(l.elnummer)
      setMvaType(l.vatType)
      setKlar(true)
    })()
    return () => { montert = false }
  }, [lineId])

  useEffect(() => {
    const sub = database.get<Activity>('activities')
      .query(Q.where('archived', false), Q.sortBy('name', Q.asc))
      .observe().subscribe(setAktiviteter)
    return () => sub.unsubscribe()
  }, [])

  function velgVare(p: Product) {
    setProduktId(p.id)
    setElnummer(p.elnummer)
    setBeskrivelse(p.name)
    setEnhet(p.unit)
    setPris(tallTekst(p.unitPrice))
    setKost(tallTekst(p.costPrice))
    setMvaType(p.vatType)
  }

  function velgAktivitet(a: Activity) {
    setAktivitetId(a.id)
    setBeskrivelse(a.name)
    setEnhet('t')
    setPris(tallTekst(a.hourlyRate))
    setMvaType(a.vatType)
  }

  function byttArt(neste: TilbudslinjeArt) {
    setArt(neste)
    if (neste === 'arbeid' && enhet === 'stk') setEnhet('t')
    if (neste === 'materiell' && enhet === 't') setEnhet('stk')
  }

  // Forhåndsvisning av linja med akkurat de tallene som står i feltene nå.
  const forhandsvisning = byggTilbudssum([{
    id: 'preview', art, beskrivelse,
    antall: somTall(antall), enhet,
    enhetsprisKr: somTall(pris), kostprisKr: somTall(kost),
    rabattProsent: somTall(rabatt), mvaType,
  }]).linjer[0]

  const kanLagre = !!beskrivelse.trim() && !busy

  async function lagre() {
    if (!kanLagre || !quoteId) return
    setBusy(true)
    try {
      const felles = {
        kind: art,
        description: beskrivelse,
        quantity: art === 'tekst' ? null : somTall(antall),
        unit: art === 'tekst' ? null : enhet,
        unitPrice: art === 'tekst' ? null : somTall(pris),
        costPrice: art === 'tekst' ? null : somTall(kost),
        discountPercent: art === 'tekst' ? null : somTall(rabatt),
        vatType: mvaType,
        productId: art === 'materiell' ? produktId : null,
        activityId: art === 'arbeid' ? aktivitetId : null,
        elnummer: art === 'materiell' ? elnummer : null,
      }
      if (linje) await oppdaterLinje(linje, felles)
      else await leggTilLinje(quoteId, felles)
      router.back()
    } finally {
      setBusy(false)
    }
  }

  async function slett() {
    if (!linje) return
    await slettLinje(linje)
    router.back()
  }

  if (!klar) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: spacing.lg, paddingHorizontal: spacing.screen, paddingBottom: spacing.sm,
      }}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>{redigerer ? 'Rediger linje' : 'Ny linje'}</Text>
        <Pressable hitSlop={8} onPress={lagre} disabled={!kanLagre}>
          <Text style={[t.body, { color: kanLagre ? colors.brand : colors.tertiaryLabel, fontWeight: '600' }]}>Lagre</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      >
        <Segmented<TilbudslinjeArt> value={art} onChange={byttArt} options={ARTER} />

        {/* Varesøk og aktivitetsvalg fyller linja — men alt kan overstyres etterpå.
            Tilbudsprisen er ofte ikke listeprisen. */}
        {art === 'materiell' && !redigerer && (
          <View style={{ marginTop: spacing.lg }}>
            <ProductPicker onVelg={velgVare} />
          </View>
        )}

        {art === 'arbeid' && aktiviteter.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[t.caption, { textTransform: 'uppercase', marginBottom: spacing.sm, marginLeft: spacing.xs }]}>Aktivitet</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {aktiviteter.map(a => {
                const valgt = aktivitetId === a.id
                return (
                  <Pressable key={a.id} haptic="light" onPress={() => velgAktivitet(a)}
                    style={{
                      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                      borderRadius: radius.pill, backgroundColor: valgt ? colors.label : colors.bg,
                    }}>
                    <Text style={[t.subhead, { fontWeight: '600', color: valgt ? colors.bg : colors.secondaryLabel }]}>{a.name}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )}

        <Text style={[t.caption, { textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
          {art === 'tekst' ? 'Tekst' : 'Beskrivelse'}
        </Text>
        <TextInput
          value={beskrivelse} onChangeText={setBeskrivelse}
          autoFocus={!redigerer && art === 'tekst'}
          multiline={art === 'tekst'}
          placeholder={art === 'tekst' ? 'Overskrift eller forbehold — f.eks. «Stillas er ikke inkludert»' : 'Hva linja gjelder'}
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, {
            backgroundColor: colors.bg, borderRadius: radius.lg,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            minHeight: art === 'tekst' ? 80 : undefined,
            textAlignVertical: art === 'tekst' ? 'top' : 'center',
          }]}
        />

        {art !== 'tekst' && (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <Felt label="Antall" verdi={antall} onEndre={setAntall} suffiks={enhet} flex={1} />
              <Felt label="Pris eks. mva" verdi={pris} onEndre={setPris} suffiks="kr" flex={1.3} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Felt label="Rabatt" verdi={rabatt} onEndre={setRabatt} suffiks="%" flex={1} />
              <Felt label="Vår kost" verdi={kost} onEndre={setKost} suffiks="kr" flex={1.3} />
            </View>
            <Text style={[t.footnote, { marginTop: spacing.xs, marginLeft: spacing.xs }]}>
              Kost vises aldri for kunden. Den er der for at du skal se hva du sitter igjen med.
            </Text>

            {/* Regnestykket, mens du skriver. */}
            <View style={{
              backgroundColor: colors.brandSoft, borderRadius: radius.lg,
              padding: spacing.lg, marginTop: spacing.lg,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={t.subhead}>Linjesum eks. mva</Text>
                <Text style={[t.bodyMedium]}>{formatKr(forhandsvisning?.nettoOre ?? 0)}</Text>
              </View>
              {(forhandsvisning?.rabattOre ?? 0) > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                  <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Rabatt</Text>
                  <Text style={[t.footnote, { color: colors.secondaryLabel }]}>{`− ${formatKr(forhandsvisning.rabattOre)}`}</Text>
                </View>
              )}
              {forhandsvisning?.kostOre !== null && forhandsvisning !== undefined && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                  <Text style={[t.footnote, { color: colors.secondaryLabel }]}>Dekningsbidrag</Text>
                  <Text style={[t.footnote, {
                    color: forhandsvisning.nettoOre - (forhandsvisning.kostOre ?? 0) < 0 ? colors.danger : colors.secondaryLabel,
                    fontWeight: '600',
                  }]}>
                    {formatKr(forhandsvisning.nettoOre - (forhandsvisning.kostOre ?? 0))}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {redigerer && (
          <Pressable haptic="medium" onPress={slett}
            style={{ alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.lg }}>
            <Text style={[t.body, { color: colors.danger }]}>Slett linje</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

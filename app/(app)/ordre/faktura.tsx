import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Share, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, AlertTriangle, Share2, Check } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader, Chip } from '../../../components/ui'
import { database } from '../../../lib/db'
import { Order } from '../../../lib/db/models/order'
import { useKunde } from '../../../lib/customers'
import { useFakturagrunnlag, markerFakturert, angreFakturert, ManglerGodkjenning } from '../../../lib/order-billing'
import { formatKr, mvaLabel, type Fakturalinje, type Gruppering, type UtelattLinje } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const GRUPPERINGER: { key: Gruppering; label: string }[] = [
  { key: 'aktivitet', label: 'Per aktivitet' },
  { key: 'aktivitetOgPerson', label: 'Per person' },
  { key: 'ingen', label: 'Hver føring' },
]

const UTELATT_GRUNN: Record<UtelattLinje['grunn'], string> = {
  ikke_fakturerbar: 'Ikke fakturerbar',
  mangler_pris: 'Mangler pris',
  allerede_fakturert: 'Allerede fakturert',
  ikke_godkjent: 'Ikke godkjent',
  avvist: 'Avvist av kunden',
}

/** Ikke godkjent tillegg er penger på gulvet — det skal skille seg ut. */
const KRITISKE_GRUNNER: UtelattLinje['grunn'][] = ['mangler_pris', 'ikke_godkjent']

function antallTekst(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',').replace(/,?0+$/, '')
}

function Linje({ linje, sist }: { linje: Fakturalinje; sist: boolean }) {
  const [tittel, ...resten] = linje.beskrivelse.split('\n')
  return (
    <View style={{
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: sist ? 0 : 0.5, borderBottomColor: colors.separator,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={t.body}>{tittel}</Text>
          <Text style={[t.footnote, { marginTop: 2 }]}>
            {antallTekst(linje.antall)} {linje.enhet} × {formatKr(linje.enhetsprisOre)}
            {linje.elnummer ? `  ·  EL ${linje.elnummer}` : ''}
          </Text>
        </View>
        <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatKr(linje.nettoOre)}</Text>
      </View>
      {/* Montørens egne ord om hva som ble gjort — ofte det eneste kunden leser. */}
      {resten.length > 0 && (
        <Text style={[t.footnote, { marginTop: spacing.sm, color: colors.secondaryLabel }]}>
          {resten.join('\n')}
        </Text>
      )}
    </View>
  )
}

function Sum({ label, verdi, sterk }: { label: string; verdi: string; sterk?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: sterk ? spacing.md : spacing.sm,
    }}>
      <Text style={sterk ? t.headline : t.subhead}>{label}</Text>
      <Text style={[sterk ? t.headline : t.subhead, { fontVariant: ['tabular-nums'] }]}>{verdi}</Text>
    </View>
  )
}

export default function FakturaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [order, setOrder] = useState<Order | null>(null)
  const [gruppering, setGruppering] = useState<Gruppering>('aktivitet')
  const [jobber, setJobber] = useState(false)

  useEffect(() => {
    if (!id) return
    const sub = database.get<Order>('orders').findAndObserve(id).subscribe({
      next: setOrder,
      error: () => setOrder(null),
    })
    return () => sub.unsubscribe()
  }, [id])

  const kunde = useKunde(order?.customerId)
  const grunnlag = useFakturagrunnlag(id ?? '', { gruppering })

  const erFakturert = !!order?.invoicedAt
  const materiell = grunnlag?.linjer.filter(l => l.kilde === 'materiell') ?? []
  const timer = grunnlag?.linjer.filter(l => l.kilde === 'timer') ?? []
  const kanFaktureres = !!grunnlag && grunnlag.linjer.length > 0 && !erFakturert

  async function del() {
    if (!grunnlag || !order) return
    const rader = grunnlag.linjer.map(l =>
      `${l.beskrivelse.split('\n')[0]}\t${antallTekst(l.antall)} ${l.enhet}\t${formatKr(l.enhetsprisOre)}\t${formatKr(l.nettoOre)}`,
    )
    const tekst = [
      `Ordre ${order.orderNumber ?? ''} — ${order.title}`.trim(),
      kunde ? kunde.name : order.customerName ?? '',
      order.address ?? '',
      '',
      ...rader,
      '',
      `Netto\t${formatKr(grunnlag.nettoOre)}`,
      `MVA\t${formatKr(grunnlag.mvaOre)}`,
      `Å betale\t${formatKr(grunnlag.bruttoOre)}`,
    ].filter(Boolean).join('\n')
    await Share.share({ message: tekst })
  }

  function bekreftFakturert() {
    if (!order || !grunnlag) return
    Alert.alert(
      'Marker som fakturert?',
      'Linjene låses mot ny fakturering. Dette sender ingenting til regnskapet — '
      + 'det gjør synken når Fiken er koblet.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Marker',
          onPress: async () => {
            setJobber(true)
            try {
              await markerFakturert(order, grunnlag, null)
            } catch (e) {
              // Faglig godkjenning mangler. Si HVA som må skje, ikke bare at det
              // ikke gikk — han skal vite hvem som må trykke.
              if (e instanceof ManglerGodkjenning) {
                Alert.alert(
                  'Mangler faglig godkjenning',
                  'Ordren må godkjennes av faglig ansvarlig før den kan faktureres. '
                  + 'Den ligger i «Til godkjenning» så snart den er satt fakturaklar.',
                )
              } else {
                throw e
              }
            } finally {
              setJobber(false)
            }
          },
        },
      ],
    )
  }

  function bekreftAngre() {
    if (!order) return
    Alert.alert('Angre fakturering?', 'Linjene låses opp og ordren går tilbake til Fakturaklar.', [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Angre',
        style: 'destructive',
        onPress: async () => {
          setJobber(true)
          try { await angreFakturert(order) } finally { setJobber(false) }
        },
      },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </Pressable>
        <Text style={t.headline}>Fakturagrunnlag</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl * 2 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Mangler kunde? Det stopper fakturaen, så det skal stå først og tydelig. */}
        {!kunde && (
          <ListCard style={{ marginBottom: spacing.lg, borderColor: colors.warning, backgroundColor: colors.warningSoft }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg }}>
              <AlertTriangle size={20} color={colors.warning} strokeWidth={sizes.lucideStroke} />
              <View style={{ flex: 1 }}>
                <Text style={t.bodyMedium}>Ingen kunde valgt</Text>
                <Text style={[t.footnote, { marginTop: 2 }]}>
                  {order?.customerName
                    ? `Ordren har navnet «${order.customerName}», men ikke en kunde i registeret. Regnskapet trenger en kunde med ID for å motta fakturaen.`
                    : 'Regnskapet trenger en kunde med ID for å motta fakturaen.'}
                </Text>
                <Pressable
                  onPress={() => router.push({ pathname: '/(app)/kunder/velg', params: { orderId: id } })}
                  style={{ marginTop: spacing.md }}
                >
                  <Text style={[t.subhead, { color: colors.brand, fontWeight: '600' }]}>Velg kunde</Text>
                </Pressable>
              </View>
            </View>
          </ListCard>
        )}

        {materiell.length > 0 && (
          <>
            <SectionHeader>Materiell</SectionHeader>
            <ListCard style={{ marginBottom: spacing.lg }}>
              {materiell.map((l, i) => (
                <Linje key={l.kildeIder.join('-')} linje={l} sist={i === materiell.length - 1} />
              ))}
            </ListCard>
          </>
        )}

        {timer.length > 0 && (
          <>
            <SectionHeader>Timer</SectionHeader>
            <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.screen, marginBottom: spacing.md }}>
              {GRUPPERINGER.map(g => (
                <Chip key={g.key} label={g.label} selected={gruppering === g.key} onPress={() => setGruppering(g.key)} />
              ))}
            </View>
            <ListCard style={{ marginBottom: spacing.lg }}>
              {timer.map((l, i) => (
                <Linje key={l.kildeIder.join('-')} linje={l} sist={i === timer.length - 1} />
              ))}
            </ListCard>
          </>
        )}

        {/*
          Det konkurrentene ikke gjør: si hva som IKKE er med, og hvorfor.
          En faktura som mangler materiell oppdages aldri av seg selv.
        */}
        {grunnlag && grunnlag.utelatt.length > 0 && (
          <>
            <SectionHeader>Ikke med på fakturaen</SectionHeader>
            <ListCard style={{ marginBottom: spacing.lg }}>
              {grunnlag.utelatt.map((u, i) => (
                <View
                  key={`${u.kilde}-${u.id}`}
                  style={{
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                    borderBottomWidth: i === grunnlag.utelatt.length - 1 ? 0 : 0.5,
                    borderBottomColor: colors.separator,
                  }}
                >
                  <Text style={[t.subhead, { flex: 1 }]} numberOfLines={1}>{u.beskrivelse}</Text>
                  <Text style={[t.caption, { color: KRITISKE_GRUNNER.includes(u.grunn) ? colors.warning : colors.tertiaryLabel }]}>
                    {UTELATT_GRUNN[u.grunn]}
                  </Text>
                </View>
              ))}
            </ListCard>
          </>
        )}

        {grunnlag && (
          <>
            <SectionHeader>Sum</SectionHeader>
            <ListCard>
              <Sum label="Netto" verdi={formatKr(grunnlag.nettoOre)} />
              {grunnlag.mvaFordeling.map(m => (
                <Sum key={m.mva} label={`MVA ${mvaLabel[m.mva]}`} verdi={formatKr(m.mvaOre)} />
              ))}
              <View style={{ height: 0.5, backgroundColor: colors.separator, marginHorizontal: spacing.lg }} />
              <Sum label="Å betale" verdi={formatKr(grunnlag.bruttoOre)} sterk />
            </ListCard>

            {/* Dekningsbidrag — tallet som avgjør om jobben var verdt det. */}
            {grunnlag.dbOre != null && (
              <View style={{ paddingHorizontal: spacing.screen + spacing.lg, marginTop: spacing.md }}>
                <Text style={t.footnote}>
                  Dekningsbidrag {formatKr(grunnlag.dbOre)} ({Math.round(grunnlag.dbProsent as number)} %)
                  {'  ·  '}vareforbruk {formatKr(grunnlag.kostOre)}
                </Text>
              </View>
            )}
          </>
        )}

        {erFakturert && (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg, marginTop: spacing.lg }}>
            <Text style={[t.footnote, { color: colors.brand }]}>
              Markert fakturert {order?.invoicedAt?.toLocaleDateString('nb-NO')}
              {order?.invoiceExternalId ? ` · ${order.invoiceExternalId}` : ''}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: spacing.screen, paddingTop: spacing.md,
        paddingBottom: insets.bottom + spacing.md,
        backgroundColor: colors.canvas, borderTopWidth: 0.5, borderTopColor: colors.separator,
        flexDirection: 'row', gap: spacing.md,
      }}>
        <Pressable
          onPress={del}
          disabled={!grunnlag || grunnlag.linjer.length === 0}
          style={{
            width: sizes.ctaHeight, height: sizes.ctaHeight, borderRadius: radius.xl,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: colors.border,
            opacity: grunnlag && grunnlag.linjer.length > 0 ? 1 : 0.35,
          }}
        >
          <Share2 size={20} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </Pressable>
        <Pressable
          haptic="medium"
          onPress={erFakturert ? bekreftAngre : bekreftFakturert}
          disabled={jobber || (!kanFaktureres && !erFakturert)}
          style={{
            flex: 1, height: sizes.ctaHeight, borderRadius: radius.xl,
            alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
            backgroundColor: erFakturert ? colors.fill : colors.cta,
            opacity: jobber || (!kanFaktureres && !erFakturert) ? 0.35 : 1,
          }}
        >
          {!erFakturert && <Check size={18} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />}
          <Text style={[t.headline, { color: erFakturert ? colors.label : colors.ctaLabel }]}>
            {erFakturert ? 'Angre fakturering' : 'Marker som fakturert'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

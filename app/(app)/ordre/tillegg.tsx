import { useEffect, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import { ChevronLeft, Trash2, Plus, Check, X, Lock } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader, Chip } from '../../../components/ui'
import { ChoiceSheet, PromptSheet } from '../../../components/sheet'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import {
  OrderExtra, godkjenningLabel, prisingLabel, tilleggStatusLabel,
  type GodkjenningsMate, type TilleggPrising,
} from '../../../lib/db/models/order-extra'
import { formatKr, tilOre } from '../../../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const PRISINGER: TilleggPrising[] = ['fastpris', 'medgatt']
const MATER: GodkjenningsMate[] = ['muntlig', 'sms', 'epost', 'signert']

function Rad({ extra }: { extra: OrderExtra }) {
  const laast = !!extra.invoicedAt
  const godkjent = extra.status === 'godkjent'
  const avvist = extra.status === 'avvist'

  async function slett() {
    if (laast) return
    await database.write(async () => { await extra.markAsDeleted() })
    syncQuietly()
  }

  /**
   * Godkjenning i to trinn: hvem, så hvordan. Navnet er det som faktisk teller i
   * en tvist, så det spørres om — men det er ett felt, ikke et skjema.
   *
   * Egne ark og ikke Alert.prompt: den finnes ikke på Android og gjør INGENTING
   * der. En godkjenningsknapp som er død på halvparten av enhetene er verre enn
   * ingen knapp.
   */
  const [spørNavn, setSpørNavn] = useState(false)
  const [spørMåte, setSpørMåte] = useState<string | null>(null)

  async function fullførGodkjenning(navn: string, mate: GodkjenningsMate) {
    await database.write(async () => {
      await extra.update(x => {
        x.status = 'godkjent'
        x.approvedBy = navn
        x.approvedAt = new Date()
        x.approvalMethod = mate
      })
    })
    syncQuietly()
  }

  async function avvis() {
    await database.write(async () => {
      await extra.update(x => { x.status = 'avvist'; x.approvedAt = new Date() })
    })
    syncQuietly()
  }

  const innhold = (
    <View style={{ padding: spacing.lg, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={t.bodyMedium}>{extra.title}</Text>
          {!!extra.description && (
            <Text style={[t.footnote, { marginTop: 2 }]}>{extra.description}</Text>
          )}
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {prisingLabel[extra.pricing]}
            {extra.pricing === 'medgatt' ? ' — dekkes av timer og materiell' : ''}
            {extra.approvedBy ? `  ·  ${extra.approvedBy}` : ''}
            {extra.approvalMethod ? ` (${godkjenningLabel[extra.approvalMethod].toLowerCase()})` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
          {extra.pricing === 'fastpris' && extra.price != null && (
            <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>
              {formatKr(tilOre(extra.price))}
            </Text>
          )}
          <View style={{
            paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill,
            backgroundColor: godkjent ? colors.successSoft : avvist ? colors.dangerSoft : colors.warningSoft,
          }}>
            <Text style={[t.caption, {
              color: godkjent ? colors.success : avvist ? colors.danger : colors.warning,
              fontWeight: '600',
            }]}>
              {tilleggStatusLabel[extra.status]}
            </Text>
          </View>
        </View>
        {laast && <Lock size={15} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />}
      </View>

      {/* Foreslått er den eneste tilstanden som krever en handling — derfor er
          knappene der og bare der. */}
      {extra.status === 'foreslatt' && !laast && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            haptic="medium"
            onPress={() => setSpørNavn(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
              paddingVertical: spacing.sm + 2, borderRadius: radius.md, backgroundColor: colors.successSoft,
            }}
          >
            <Check size={16} color={colors.success} strokeWidth={2.4} />
            <Text style={[t.subhead, { color: colors.success, fontWeight: '600' }]}>Godkjent</Text>
          </Pressable>
          <Pressable
            onPress={avvis}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
              borderRadius: radius.md, backgroundColor: colors.fill,
            }}
          >
            <X size={16} color={colors.secondaryLabel} strokeWidth={2.4} />
            <Text style={[t.subhead, { color: colors.secondaryLabel }]}>Avvist</Text>
          </Pressable>
        </View>
      )}
    </View>
  )

  const ark = (
    <>
      <PromptSheet
        synlig={spørNavn}
        tittel="Hvem godkjente?"
        forklaring="Det er dette som teller hvis det blir uenighet senere."
        plassholder="Fornavn Etternavn"
        knapp="Neste"
        onSvar={navn => { setSpørNavn(false); setSpørMåte(navn) }}
        onAvbryt={() => setSpørNavn(false)}
      />
      <ChoiceSheet<GodkjenningsMate>
        synlig={spørMåte !== null}
        tittel="Hvordan ble det godkjent?"
        forklaring="Skriftlig står sterkere enn muntlig, men muntlig med navn og dato er langt bedre enn ingenting."
        valg={MATER.map(m => ({ verdi: m, etikett: godkjenningLabel[m] }))}
        onVelg={async m => {
          const navn = spørMåte
          setSpørMåte(null)
          if (!navn) return
          // «Signert» uten en signatur er bare et ord. Send til signaturflaten
          // i stedet — den skriver godkjenningen selv når streken er der.
          if (m === 'signert') {
            router.push({ pathname: '/(app)/ordre/signatur', params: { id: extra.orderId, extraId: extra.id } })
            return
          }
          await fullførGodkjenning(navn, m)
        }}
        onAvbryt={() => setSpørMåte(null)}
      />
    </>
  )

  if (laast) return innhold
  return (
    <>
    {ark}
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          haptic="medium"
          onPress={slett}
          style={{ width: 84, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', gap: 2 }}
        >
          <Trash2 size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[t.caption, { color: '#fff', fontWeight: '700' }]}>Slett</Text>
        </Pressable>
      )}
    >
      {innhold}
    </ReanimatedSwipeable>
    </>
  )
}

export default function TilleggScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const [rader, setRader] = useState<OrderExtra[]>([])
  const [tittel, setTittel] = useState('')
  const [prising, setPrising] = useState<TilleggPrising>('fastpris')
  const [pris, setPris] = useState('')
  const [lagrer, setLagrer] = useState(false)

  useEffect(() => {
    if (!id) return
    const sub = database.get<OrderExtra>('order_extras')
      .query(Q.where('order_id', id), Q.sortBy('created_at', Q.desc))
      .observeWithColumns(['title', 'status', 'price', 'pricing', 'approved_by', 'invoiced_at'])
      .subscribe(setRader)
    return () => sub.unsubscribe()
  }, [id])

  const prisTall = parseFloat(pris.replace(',', '.'))
  const kanLagre = !!id && tittel.trim().length > 0 && !lagrer
    && (prising === 'medgatt' || (Number.isFinite(prisTall) && prisTall > 0))

  const ventende = rader.filter(x => x.status === 'foreslatt').length
  const godkjentOre = rader
    .filter(x => x.status === 'godkjent' && x.pricing === 'fastpris' && x.price != null)
    .reduce((a, x) => a + tilOre(x.price as number), 0)

  async function leggTil() {
    if (!kanLagre) return
    setLagrer(true)
    try {
      await database.write(async () => {
        await database.get<OrderExtra>('order_extras').create(x => {
          x.orderId = id as string
          x.title = tittel.trim()
          x.pricing = prising
          x.price = prising === 'fastpris' ? prisTall : null
          x.vatType = 'hoy'
          // Alltid foreslått. Et tillegg som fødes godkjent er et tillegg
          // ingen faktisk spurte kunden om.
          x.status = 'foreslatt'
        })
      })
      syncQuietly()
      setTittel(''); setPris('')
    } finally { setLagrer(false) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
          </Pressable>
          <Text style={t.headline}>Tilleggsarbeid</Text>
        </View>
        <AmpexMarkButton />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.xl }}>
          <Text style={t.display}>{godkjentOre > 0 ? formatKr(godkjentOre) : '—'}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {ventende > 0
              ? `${ventende} venter på godkjenning — de kan ikke faktureres før noen sier ja`
              : 'Godkjent tilleggsarbeid, eks. mva'}
          </Text>
        </View>

        <ListCard style={{ marginBottom: spacing.xl }}>
          <TextInput
            value={tittel}
            onChangeText={setTittel}
            placeholder="Hva skal gjøres i tillegg?"
            placeholderTextColor={colors.tertiaryLabel}
            style={[t.body, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
          />
          <View style={{
            flexDirection: 'row', gap: spacing.sm,
            paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
          }}>
            {PRISINGER.map(p => (
              <Chip key={p} label={prisingLabel[p]} selected={prising === p} onPress={() => setPrising(p)} />
            ))}
          </View>
          {prising === 'fastpris' && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
              borderTopWidth: 0.5, borderTopColor: colors.separator,
            }}>
              <Text style={[t.body, { flex: 1 }]}>Pris eks. mva</Text>
              <TextInput
                value={pris}
                onChangeText={setPris}
                placeholder="0"
                placeholderTextColor={colors.tertiaryLabel}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={[t.body, { minWidth: 80, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
              />
              <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>kr</Text>
            </View>
          )}
          <Pressable
            haptic="medium"
            onPress={leggTil}
            disabled={!kanLagre}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight, backgroundColor: colors.cta, opacity: kanLagre ? 1 : 0.35,
            }}
          >
            <Plus size={18} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Foreslå tillegg</Text>
          </Pressable>
        </ListCard>

        {rader.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              Ingen tillegg registrert.
            </Text>
            <Text style={[t.footnote, { marginTop: spacing.sm }]}>
              Arbeid kunden ikke bestilte må godkjennes før det kan faktureres.
              Registrer det med en gang — det er navnet på den som sa ja, og når,
              som avgjør hvis det blir uenighet senere.
            </Text>
          </View>
        ) : (
          <>
            <SectionHeader>{`${rader.length} tillegg`}</SectionHeader>
            <ListCard>
              {rader.map((x, i) => (
                <View key={x.id} style={i === rader.length - 1 ? undefined : {
                  borderBottomWidth: 0.5, borderBottomColor: colors.separator,
                }}>
                  <Rad extra={x} />
                </View>
              ))}
            </ListCard>
          </>
        )}
      </ScrollView>
    </View>
  )
}

import { useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import {
  ChevronLeft, Plus, Package, Clock, AlignLeft, Copy, Send,
  ChevronUp, ChevronDown, ArrowRight, CheckCircle2, Circle,
} from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader, AmbientBackdrop } from '../../../components/ui'
import { PromptSheet, ChoiceSheet, type Valg } from '../../../components/sheet'
import { QuoteLine } from '../../../lib/db/models/quote-line'
import { beslutningLabel, type BeslutningsMate } from '../../../lib/db/models/quote'
import {
  useEttTilbud, useTilbudslinjer, useTilbudssum, useTilbudsinnhold,
  markerSendt, angreSendt, registrerSvar, dupliserTilbud, byttPlassIGruppe, slettTilbud, velgTilvalg,
} from '../../../lib/quotes'
import { kanRedigeres, tilbudStatusLabel, type OmradeSum, type Tilbudslinje, type TilbudStatus } from '../../../lib/quoting'
import { formatKr } from '../../../lib/invoicing'
import { formatDate, formatFrist } from '../../../lib/format'
import { colors, spacing, radius, sizes, shadows, paperType as t } from '../../../lib/theme'
import { usePapirStatuslinje } from '../../../components/tool-surface'

const ART_IKON = { materiell: Package, arbeid: Clock, tekst: AlignLeft }

const statusFarge: Record<TilbudStatus, string> = {
  utkast: colors.paperTertiary,
  sendt: colors.brand,
  akseptert: colors.success,
  avslatt: colors.danger,
  utlopt: colors.warning,
}

type Ark = null | 'svar' | 'mate' | 'hvem' | 'notat'

export default function TilbudDetail() {
  // Mørk klokke og batteri: dette er papir, ikke brun grunn.
  usePapirStatuslinje()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const tilbud = useEttTilbud(id)
  const linjer = useTilbudslinjer(id)
  const sum = useTilbudssum(id)
  const innhold = useTilbudsinnhold(id)

  const [ark, setArk] = useState<Ark>(null)
  // Svaret bygges opp over flere ark: aksepterer/avslår → hvordan → hvem → notat.
  // Ingenting skrives før siste steg, så «Avbryt» underveis er helt uten følger.
  const [akseptert, setAkseptert] = useState(true)
  const [mate, setMate] = useState<BeslutningsMate | null>(null)
  const [hvem, setHvem] = useState('')
  const [busy, setBusy] = useState(false)

  if (!tilbud) return <View style={{ flex: 1, backgroundColor: colors.paperCanvas }} />

  const status = tilbud.visStatus
  const redigerbar = kanRedigeres(tilbud.status)
  const linjeById = new Map(linjer.map(l => [l.id, l]))

  async function fullforSvar(notat: string) {
    if (!tilbud || busy) return
    setBusy(true)
    try {
      const orderId = await registrerSvar(tilbud, {
        akseptert, av: hvem, mate, notat,
      })
      setArk(null)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (orderId) router.push({ pathname: '/(app)/ordre/[id]', params: { id: orderId } })
    } finally {
      setBusy(false)
    }
  }

  /** Pilene flytter innenfor gruppa linja står i — aldri ut av et område. */
  async function flytt(gruppe: Tilbudslinje[], indeks: number, retning: -1 | 1) {
    const rader = gruppe.map(l => linjeById.get(l.id)).filter((l): l is QuoteLine => !!l)
    if (rader.length !== gruppe.length) return
    await byttPlassIGruppe(rader, indeks, indeks + retning)
  }

  /**
   * Én linje. Samme rad enten den ligger løst eller i et område.
   *
   * Et TILVALG har en avkryssing i stedet for ikonet (Jobber-mønsteret): montøren
   * krysser av sammen med kunden, og summen følger. Lov også etter at tilbudet
   * er sendt, fram til det er besvart. Fravalgt står med prisen i parentes —
   * kunden skal se hva det koster å si ja.
   */
  function renderLinje(l: Tilbudslinje, gruppe: Tilbudslinje[], i: number, innrykk: number) {
    const Ikon = ART_IKON[l.art]
    const rad = linjeById.get(l.id)
    const kanVelge = l.valgfri && !!rad && status !== 'akseptert' && status !== 'avslatt'
    const fravalgt = l.valgfri && !l.valgt
    return (
      <View key={l.id} style={{ borderTopWidth: 0.5, borderTopColor: colors.paperSeparator }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'flex-start',
            paddingLeft: spacing.lg + innrykk * spacing.lg, paddingRight: spacing.lg, paddingVertical: spacing.md,
          }}
        >
          {l.valgfri ? (
            <Pressable hitSlop={10} haptic="light" disabled={!kanVelge}
              onPress={() => rad && velgTilvalg(rad, tilbud!, !l.valgt)}
              style={{ width: 26, alignItems: 'center', marginTop: 0 }}>
              {l.valgt
                ? <CheckCircle2 size={19} color={colors.paperLabel} strokeWidth={2.2} />
                : <Circle size={19} color={colors.paperTertiary} strokeWidth={2} />}
            </Pressable>
          ) : (
            <View style={{ width: 26, alignItems: 'center', marginTop: 2 }}>
              <Ikon size={15} color={colors.paperIcon} strokeWidth={2} />
            </View>
          )}
          <Pressable
            disabled={!redigerbar || !rad}
            onPress={() => rad && router.push({ pathname: '/(app)/tilbud/linje', params: { quoteId: tilbud!.id, lineId: rad.id } })}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start' }}
          >
            <View style={{ flex: 1, marginHorizontal: spacing.sm }}>
              <Text style={l.art === 'tekst' || fravalgt ? [t.subhead, { color: colors.paperSecondary }] : t.body}>
                {l.beskrivelse || '—'}
              </Text>
              {l.art !== 'tekst' && (
                <Text style={[t.caption, { color: colors.paperTertiary, marginTop: 2 }]}>
                  {`${String(l.antall).replace('.', ',')} ${l.enhet} × ${formatKr(l.enhetsprisOre)}`}
                  {l.rabattProsent > 0 ? ` · −${String(l.rabattProsent).replace('.', ',')} %` : ''}
                  {l.valgfri ? (l.valgt ? ' · tilvalg' : ' · tilvalg, ikke medregnet') : ''}
                </Text>
              )}
            </View>
            {l.art !== 'tekst' && (
              <Text style={[t.bodyMedium, { marginTop: 1, color: fravalgt ? colors.paperTertiary : undefined }]}>
                {fravalgt ? `(${formatKr(l.nettoOre)})` : formatKr(l.nettoOre)}
              </Text>
            )}
          </Pressable>
        </View>
        {redigerbar && gruppe.length > 1 && rad && (
          <View style={{ flexDirection: 'row', gap: spacing.md, paddingLeft: spacing.lg + innrykk * spacing.lg, paddingBottom: spacing.sm }}>
            <Pressable hitSlop={8} haptic="light" disabled={i === 0} onPress={() => flytt(gruppe, i, -1)}>
              <ChevronUp size={16} color={i === 0 ? colors.paperSeparator : colors.paperTertiary} strokeWidth={2.2} />
            </Pressable>
            <Pressable hitSlop={8} haptic="light" disabled={i === gruppe.length - 1} onPress={() => flytt(gruppe, i, 1)}>
              <ChevronDown size={16} color={i === gruppe.length - 1 ? colors.paperSeparator : colors.paperTertiary} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
      </View>
    )
  }

  /**
   * Områdehodet: navn til venstre, sum til høyre. Summen er halve poenget med
   * å ha området i det hele tatt — «hva koster bare kjøkkenet».
   *
   * Her er den BARE en visning. Områdene lages og endres på kontoret (desktop/
   * → Tilbud): kalkulasjonen er en skrivebordsjobb med mange kolonner, og en
   * montør på en stige skal se hva jobben er delt opp i, ikke bygge oppdelingen.
   */
  function renderOmradeHode(o: OmradeSum) {
    return (
      <View
        style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: colors.paperFill,
          borderTopWidth: 0.5, borderTopColor: colors.paperSeparator,
          paddingLeft: spacing.lg + o.niva * spacing.lg, paddingRight: spacing.lg,
          paddingVertical: spacing.sm + 2,
        }}
      >
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={[t.subhead, { fontWeight: '700' }]}>{o.navn || 'Uten navn'}</Text>
          <Text style={[t.caption, { color: colors.paperTertiary, marginTop: 1 }]}>
            {o.antallLinjer === 0 ? 'Tomt' : o.antallLinjer === 1 ? '1 linje' : `${o.antallLinjer} linjer`}
          </Text>
        </View>
        <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatKr(o.nettoOre)}</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paperCanvas }}>
      <AmbientBackdrop height={400} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} pressScale={0.92}
              style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.paperBg, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={sizes.icon} color={colors.paperLabel} strokeWidth={2.2} />
            </Pressable>
            <Pressable haptic="light" pressScale={0.94}
              onPress={async () => {
                const nyId = await dupliserTilbud(tilbud)
                router.replace({ pathname: '/(app)/tilbud/[id]', params: { id: nyId } })
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 34, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.paperFill }}>
              <Copy size={15} color={colors.paperLabel} strokeWidth={2.1} />
              <Text style={[t.subhead, { fontWeight: '600' }]}>Kopier</Text>
            </Pressable>
          </View>

          <Text style={[t.display, { marginTop: spacing.lg }]}>{tilbud.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
            <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.paperFill }}>
              <Text style={[t.caption, { color: statusFarge[status], fontWeight: '700' }]}>
                {tilbudStatusLabel[status].toUpperCase()}
              </Text>
            </View>
            {!!tilbud.quoteNumber && <Text style={t.footnote}>{`Tilbud #${tilbud.quoteNumber}`}</Text>}
          </View>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {[tilbud.customerName ?? 'Ingen kunde valgt', tilbud.address].filter(Boolean).join(' · ')}
          </Text>
          {!!tilbud.validUntil && (status === 'sendt' || status === 'utlopt' || status === 'utkast') && (
            <Text style={[t.footnote, {
              marginTop: 2,
              color: status === 'utlopt' ? colors.warning : colors.paperSecondary,
            }]}>
              {`Gyldig til ${formatDate(tilbud.validUntil)} — ${formatFrist(tilbud.validUntil)}`}
            </Text>
          )}
        </View>

        {/* Utfallet, når det finnes. Hvem som sa hva er hele poenget med å ha det. */}
        {(status === 'akseptert' || status === 'avslatt') && (
          <View style={{
            marginHorizontal: spacing.screen, marginBottom: spacing.lg,
            backgroundColor: status === 'akseptert' ? colors.successSoft : colors.dangerSoft,
            borderRadius: radius.lg, padding: spacing.lg,
          }}>
            <Text style={[t.subhead, { fontWeight: '700', color: status === 'akseptert' ? colors.success : colors.danger }]}>
              {status === 'akseptert' ? 'Akseptert' : 'Avslått'}
            </Text>
            <Text style={[t.footnote, { marginTop: 2 }]}>
              {[
                tilbud.decidedBy,
                tilbud.decisionMethod ? beslutningLabel[tilbud.decisionMethod].toLowerCase() : null,
                tilbud.decidedAt ? formatDate(tilbud.decidedAt) : null,
              ].filter(Boolean).join(' · ')}
            </Text>
            {!!tilbud.decisionNote && <Text style={[t.footnote, { marginTop: spacing.xs }]}>{tilbud.decisionNote}</Text>}
            {!!tilbud.orderId && (
              <Pressable haptic="light"
                onPress={() => router.push({ pathname: '/(app)/ordre/[id]', params: { id: tilbud.orderId! } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md }}>
                <Text style={[t.subhead, { color: colors.brand, fontWeight: '600' }]}>Åpne ordren</Text>
                <ArrowRight size={15} color={colors.brand} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        )}

        {/* Innhold — områder med egen sum, slik kunden spør: «hva koster
            bare kjøkkenet?». Et tilbud uten områder ser ut nøyaktig som før. */}
        <SectionHeader tone="papir">Innhold</SectionHeader>
        <View style={[{ backgroundColor: colors.paperBg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }, shadows.card]}>
          {sum.linjer.length === 0 && innhold.omrader.length === 0 && (
            <Text style={[t.footnote, { padding: spacing.lg, textAlign: 'center' }]}>
              Ingen linjer ennå. Legg til materiell, arbeid eller en tekst.
            </Text>
          )}

          {innhold.utenOmrade.map((l, i) => renderLinje(l, innhold.utenOmrade, i, 0))}

          {innhold.omrader.map(o => (
            <View key={o.id}>
              {renderOmradeHode(o)}
              {o.linjer.map((l, i) => renderLinje(l, o.linjer, i, o.niva + 1))}
            </View>
          ))}

          {redigerbar && (
            <Pressable haptic="medium"
              onPress={() => router.push({ pathname: '/(app)/tilbud/linje', params: { quoteId: tilbud.id } })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                paddingVertical: spacing.md, borderTopWidth: 0.5, borderTopColor: colors.paperSeparator,
              }}>
              <Plus size={17} color={colors.brand} strokeWidth={2.2} />
              <Text style={[t.subhead, { color: colors.brand, fontWeight: '600' }]}>Legg til linje</Text>
            </Pressable>
          )}
        </View>

        {/* Sum */}
        <View style={{ marginTop: spacing.lg, marginHorizontal: spacing.screen, backgroundColor: colors.paperBg, borderRadius: radius.lg, padding: spacing.lg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={t.subhead}>Sum eks. mva</Text>
            <Text style={t.bodyMedium}>{formatKr(sum.nettoOre)}</Text>
          </View>
          {sum.rabattOre > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>Herav rabatt</Text>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>{`− ${formatKr(sum.rabattOre)}`}</Text>
            </View>
          )}
          {sum.tilvalgUtenforOre > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>Tilvalg som kan legges til</Text>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>{formatKr(sum.tilvalgUtenforOre)}</Text>
            </View>
          )}
          {sum.mvaFordeling.map(g => (
            <View key={g.mva} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>{`Mva av ${formatKr(g.nettoOre)}`}</Text>
              <Text style={[t.footnote, { color: colors.paperSecondary }]}>{formatKr(g.mvaOre)}</Text>
            </View>
          ))}
          <View style={{ height: 0.5, backgroundColor: colors.paperSeparator, marginVertical: spacing.md }} />
          {/* Dette er tallet hele skjermen finnes for. Det skal ikke stå i
              samme vekt som linjene over det. */}
          <View style={{ marginTop: spacing.xs }}>
            <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.6 }]}>Totalt inkl. mva</Text>
            <Text style={[t.display, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
              {formatKr(sum.bruttoOre)}
            </Text>
          </View>
        </View>

        {/* Dekningsbidrag — vises FØR tilbudet sendes, ikke etter. */}
        {sum.dbOre !== null && (
          <View style={{
            marginTop: spacing.md, marginHorizontal: spacing.screen,
            backgroundColor: sum.dbOre < 0 ? colors.dangerSoft : colors.brandSoft,
            borderRadius: radius.lg, padding: spacing.lg,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.6 }]}>Dekningsbidrag</Text>
              <Text style={[t.title2, { color: sum.dbOre < 0 ? colors.danger : colors.paperLabel, fontVariant: ['tabular-nums'] }]}>
                {`${formatKr(sum.dbOre)}${sum.dbProsent !== null ? `  ·  ${String(sum.dbProsent).replace('.', ',')} %` : ''}`}
              </Text>
            </View>
            <Text style={[t.caption, { color: colors.paperTertiary, marginTop: spacing.xs }]}>
              Kost {formatKr(sum.kostOre)}. Vises aldri for kunden.
            </Text>
          </View>
        )}

        {/* Handlinger */}
        <View style={{ marginTop: spacing.xl, marginHorizontal: spacing.screen, gap: spacing.sm }}>
          {status === 'utkast' && (
            <Pressable
              haptic="medium"
              disabled={sum.linjer.length === 0 || !tilbud.customerId}
              onPress={() => markerSendt(tilbud)}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: sizes.ctaHeight, borderRadius: radius.xl,
                backgroundColor: sum.linjer.length > 0 && tilbud.customerId ? colors.brand : colors.paperFill,
              }}>
              <Send size={17} color={sum.linjer.length > 0 && tilbud.customerId ? colors.brandLabel : colors.paperTertiary} strokeWidth={2.2} />
              <Text style={[t.headline, { color: sum.linjer.length > 0 && tilbud.customerId ? colors.brandLabel : colors.paperTertiary }]}>
                Marker som sendt
              </Text>
            </Pressable>
          )}
          {status === 'utkast' && !tilbud.customerId && (
            <Text style={[t.footnote, { textAlign: 'center' }]}>Velg kunde før tilbudet kan sendes.</Text>
          )}

          {(status === 'sendt' || status === 'utlopt') && (
            <>
              <Pressable haptic="medium"
                onPress={() => { setAkseptert(true); setArk('mate') }}
                style={{
                  height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.brand,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Text style={[t.headline, { color: colors.brandLabel }]}>Kunden sa ja — opprett ordre</Text>
              </Pressable>
              <Pressable haptic="light"
                onPress={() => { setAkseptert(false); setArk('mate') }}
                style={{ alignItems: 'center', paddingVertical: spacing.md }}>
                <Text style={[t.body, { color: colors.paperSecondary }]}>Kunden sa nei</Text>
              </Pressable>
              <Pressable haptic="light" onPress={() => angreSendt(tilbud)} style={{ alignItems: 'center', paddingVertical: spacing.xs }}>
                <Text style={[t.footnote, { color: colors.paperTertiary }]}>Angre «sendt» og rediger videre</Text>
              </Pressable>
            </>
          )}

          {redigerbar && (
            <Pressable haptic="medium"
              onPress={async () => { await slettTilbud(tilbud); router.back() }}
              style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
              <Text style={[t.body, { color: colors.danger }]}>Slett tilbudet</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Svaret registreres i tre små steg. Hvem som sa ja er det som avgjør i en
          tvist — akkurat som på tilleggsarbeid. */}
      <ChoiceSheet<BeslutningsMate>
        synlig={ark === 'mate'}
        tittel={akseptert ? 'Hvordan sa kunden ja?' : 'Hvordan sa kunden nei?'}
        forklaring="Måten svaret kom på er det som teller hvis det senere blir uenighet."
        valg={(['muntlig', 'sms', 'epost', 'signert'] as BeslutningsMate[])
          .map<Valg<BeslutningsMate>>(m => ({ verdi: m, etikett: beslutningLabel[m] }))}
        valgt={mate ?? undefined}
        onVelg={m => { setMate(m); setArk('hvem') }}
        onAvbryt={() => setArk(null)}
      />

      <PromptSheet
        synlig={ark === 'hvem'}
        tittel="Hvem svarte?"
        forklaring="Tomt er lov, men da står det ingenting i en tvist."
        plassholder="F.eks. Kari Nordmann"
        knapp="Videre"
        onSvar={v => { setHvem(v); setArk('notat') }}
        onAvbryt={() => setArk(null)}
      />

      <PromptSheet
        synlig={ark === 'notat'}
        tittel={akseptert ? 'Noe å notere?' : 'Hvorfor ble det nei?'}
        forklaring={akseptert
          ? 'Forbehold eller avtaler som ikke står i linjene.'
          : 'Pris, tid, valgte en annen — det eneste som gjør tapte tilbud lærerike.'}
        plassholder={akseptert ? 'Valgfritt' : 'For dyrt, valgte konkurrent …'}
        knapp={akseptert ? 'Opprett ordre' : 'Registrer avslag'}
        onSvar={fullforSvar}
        onAvbryt={() => setArk(null)}
      />
    </View>
  )
}

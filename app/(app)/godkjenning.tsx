import { useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Animated, { FadeInDown } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Check, X, ShieldCheck, AlertTriangle, ChevronRight } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { SectionHeader, AmbientBackdrop } from '../../components/ui'
import { PromptSheet } from '../../components/sheet'
import { Order } from '../../lib/db/models/order'
import { useFakturagrunnlag } from '../../lib/order-billing'
import { useTilGodkjenning, useKanGodkjenne, useGrunnlag, registrerBeslutning } from '../../lib/approvals'
import { formatKr } from '../../lib/invoicing'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

/**
 * Én ordre, klar til beslutning.
 *
 * Alt faglig ansvarlig trenger for å si ja eller nei står på kortet — han skal
 * ikke måtte åpne fire skjermer for å bestemme. Det som MANGLER vises som
 * advarsel, ikke som en sperre: han er fagpersonen, og det er hans vurdering om
 * en jobb kan faktureres uten signatur, ikke systemets.
 */
function Kort({ order, indeks, kanGodkjenne, onBeslutt }: {
  order: Order
  indeks: number
  kanGodkjenne: boolean
  onBeslutt: (order: Order, sumOre: number, beslutning: 'godkjent' | 'avvist') => void
}) {
  const grunnlag = useFakturagrunnlag(order.id)
  const sumOre = grunnlag?.bruttoOre ?? 0
  const g = useGrunnlag(order.id, sumOre)

  const mangler: string[] = []
  if (g && !g.harKunde) mangler.push('Ingen kunde i registeret — kan ikke faktureres')
  if (g && g.antallFullforte === 0) mangler.push('Ingen fullført dokumentasjon')
  if (g && g.antallSignaturer === 0) mangler.push('Ingen kundesignatur')
  if (grunnlag && grunnlag.utelatt.length > 0) {
    mangler.push(`${grunnlag.utelatt.length} linjer er utelatt fra fakturagrunnlaget`)
  }

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).delay(Math.min(indeks, 8) * 50)}
      style={[{
        backgroundColor: colors.bg, borderRadius: radius.hero,
        marginHorizontal: spacing.screen, marginBottom: spacing.md, overflow: 'hidden',
      }, shadows.card]}
    >
      <Pressable onPress={() => router.push({ pathname: '/(app)/ordre/[id]', params: { id: order.id } })}
        style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={t.title3} numberOfLines={2}>{order.title}</Text>
            <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>
              {[order.orderNumber ? `#${order.orderNumber}` : null, order.customerName, order.address]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
          <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} style={{ marginTop: 4 }} />
        </View>

        {/* Summen er det han bestemmer seg på — den får display-vekt. */}
        <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.lg }]}>
          Til fakturering
        </Text>
        <Text style={[t.display, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>{formatKr(sumOre)}</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.md }}>
          <Tall etikett="Timer" verdi={g ? String(g.timer).replace('.', ',') : '—'} />
          <Tall etikett="Materiell" verdi={g ? String(g.antallMateriell) : '—'} />
          <Tall etikett="Dokumenter" verdi={g ? `${g.antallFullforte}/${g.antallDokumenter}` : '—'} />
          <Tall etikett="Signaturer" verdi={g ? String(g.antallSignaturer) : '—'} />
        </View>
      </Pressable>

      {mangler.length > 0 && (
        <View style={{
          backgroundColor: colors.warningSoft, marginTop: spacing.lg,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        }}>
          {mangler.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs + 2, marginTop: i === 0 ? 0 : 4 }}>
              <AlertTriangle size={13} color={colors.warning} strokeWidth={2.2} style={{ marginTop: 2 }} />
              <Text style={[t.footnote, { flex: 1 }]}>{m}</Text>
            </View>
          ))}
        </View>
      )}

      {kanGodkjenne && (
        <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: colors.separator }}>
          <Pressable
            haptic="light"
            onPress={() => onBeslutt(order, sumOre, 'avvist')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: spacing.xs, paddingVertical: spacing.md + 2,
              borderRightWidth: 0.5, borderRightColor: colors.separator,
            }}
          >
            <X size={16} color={colors.danger} strokeWidth={2.4} />
            <Text style={[t.subhead, { color: colors.danger, fontWeight: '600' }]}>Send tilbake</Text>
          </Pressable>
          <Pressable
            haptic="medium"
            onPress={() => onBeslutt(order, sumOre, 'godkjent')}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: spacing.xs, paddingVertical: spacing.md + 2, backgroundColor: colors.successSoft,
            }}
          >
            <Check size={16} color={colors.success} strokeWidth={2.4} />
            <Text style={[t.subhead, { color: colors.success, fontWeight: '700' }]}>Godkjenn</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  )
}

function Tall({ etikett, verdi }: { etikett: string; verdi: string }) {
  return (
    <View>
      <Text style={[t.caption, { color: colors.tertiaryLabel }]}>{etikett}</Text>
      <Text style={[t.bodyMedium, { marginTop: 1, fontVariant: ['tabular-nums'] }]}>{verdi}</Text>
    </View>
  )
}

/**
 * Faglig godkjenning — faglig ansvarliges skjerm.
 *
 * Én liste, alt han trenger å vite per ordre, to knapper. Ingen ordre kan bli
 * fakturert uten at han har vært innom; den sperren ligger i databasen, ikke i
 * denne skjermen.
 */
export default function Godkjenning() {
  const insets = useSafeAreaInsets()
  const ordre = useTilGodkjenning()
  const kanGodkjenne = useKanGodkjenne()
  const [avvis, setAvvis] = useState<{ order: Order; sumOre: number } | null>(null)

  async function beslutt(order: Order, sumOre: number, beslutning: 'godkjent' | 'avvist') {
    // Avslag krever en grunn — databasen håndhever det, så vi må spørre.
    if (beslutning === 'avvist') { setAvvis({ order, sumOre }); return }
    await registrerBeslutning({ orderId: order.id, beslutning: 'godkjent', sumOre })
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AmbientBackdrop height={360} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.display, { marginTop: spacing.lg }]}>Til godkjenning</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>
            {ordre.length === 0
              ? 'Ingenting venter.'
              : `${ordre.length} ${ordre.length === 1 ? 'ordre venter' : 'ordrer venter'} på faglig ansvarlig.`}
          </Text>
        </View>

        {ordre.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xxl }}>
            <View style={{
              width: sizes.iconChip + 12, height: sizes.iconChip + 12, borderRadius: radius.pill,
              backgroundColor: colors.successSoft, alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldCheck size={sizes.iconLg} color={colors.success} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.footnote, { marginTop: spacing.md, textAlign: 'center', paddingHorizontal: spacing.xxl }]}>
              Alt fakturaklart arbeid er gjennomgått.
            </Text>
          </View>
        ) : (
          <>
            <SectionHeader>Venter</SectionHeader>
            {ordre.map((o, i) => (
              <Kort key={o.id} order={o} indeks={i} kanGodkjenne={kanGodkjenne} onBeslutt={beslutt} />
            ))}
          </>
        )}

        {!kanGodkjenne && ordre.length > 0 && (
          <Text style={[t.footnote, { marginHorizontal: spacing.screen, marginTop: spacing.md }]}>
            Du kan se listen, men bare faglig ansvarlig kan godkjenne. Settes under Meg.
          </Text>
        )}
      </ScrollView>

      <PromptSheet
        synlig={!!avvis}
        tittel="Hvorfor sendes den tilbake?"
        forklaring="Begrunnelsen er det montøren har å gå etter. Ordren settes tilbake til pågår."
        plassholder="F.eks. mangler sluttkontroll på kurs 4"
        knapp="Send tilbake"
        onSvar={async grunn => {
          const valgt = avvis
          setAvvis(null)
          if (!valgt || !grunn.trim()) return
          await registrerBeslutning({
            orderId: valgt.order.id, beslutning: 'avvist',
            begrunnelse: grunn, sumOre: valgt.sumOre,
          })
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        }}
        onAvbryt={() => setAvvis(null)}
      />
    </View>
  )
}

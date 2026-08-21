import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Text } from './text'
import { ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react-native'
import { Pressable } from './pressable'
import { ToolCard, ToolSectionHeader } from './tool-surface'
import type { Order } from '../lib/db/models/order'
import { formatTime } from '../lib/format'
import {
  byggUkeplan, DAGER, flyttUke, standardDag, ukeEtikett, ukenummer, ukeStart,
} from '../lib/schedule-calc'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/** Søylehøyde. Samme høyde som timer-charten, så de to leses som slektninger. */
const SOYLE = 96
/** Flere enn dette får ikke plass som blokker — resten telles i tallet over. */
const MAKS_BLOKKER = 12

/**
 * Ordrekalenderen — uken som avtalte jobber.
 *
 * «Mine timer» viser uken som SØYLER av timer. Dette er den samme uken sett
 * forfra: hver blokk er en avtalt jobb, ikke en time. Derfor samme ukevelger,
 * samme mandagsuke og samme høyde på søylene — du skal kjenne igjen bildet.
 *
 * En dag med tre jobber ser tung ut på en meters avstand. Det er hele poenget:
 * overbooking er noe man skal SE, ikke regne seg fram til.
 */
export function OrdreKalender({ orders, onVelg }: { orders: Order[]; onVelg: (order: Order) => void }) {
  const [start, setStart] = useState(() => ukeStart(new Date()))
  // null = «ikke valgt manuelt» → dagen følger uken (i dag / første dag med
  // jobber). Uten dette ville et dagvalg i uke 34 fulgt med til uke 35.
  const [valgt, setValgt] = useState<number | null>(null)

  const plan = useMemo(() => byggUkeplan(start, orders), [start, orders])
  const idag = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [])

  const dagIndeks = valgt ?? standardDag(plan)
  const dag = plan.dager[dagIndeks]

  const bytt = (uker: number) => { setStart(s => flyttUke(s, uker)); setValgt(null) }

  return (
    <View>
      {/* Ukevelger — identisk med den i Mine timer */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginHorizontal: spacing.screen, marginBottom: spacing.md,
        backgroundColor: colors.toolRaised, borderRadius: radius.lg, padding: spacing.sm,
        borderWidth: 1, borderColor: colors.toolBorder,
      }}>
        <Pressable haptic="light" pressScale={0.92} onPress={() => bytt(-1)}
          style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={18} color={colors.toolLabel} strokeWidth={2.2} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={[t.headline, { color: colors.toolLabel }]}>{ukeEtikett(start)}</Text>
          <Text style={[t.caption, { color: colors.toolSecondary }]}>
            {`Uke ${ukenummer(start)} · ${start.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}–${plan.dager[6].dato.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}`}
          </Text>
        </View>
        <Pressable haptic="light" pressScale={0.92} onPress={() => bytt(1)}
          style={{ width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronRight size={18} color={colors.toolLabel} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Sum + søyler */}
      <ToolCard style={{ padding: spacing.lg }}>
        <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.toolTertiary }]}>Avtalt denne uken</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
          <Text style={[t.display, { color: colors.toolLabel }]}>{plan.sumJobber}</Text>
          <Text style={[t.footnote, { color: colors.toolSecondary }]}>
            {plan.sumJobber === 1 ? 'jobb' : 'jobber'}
          </Text>
        </View>
        {plan.utenDato.length > 0 && (
          <Text style={[t.footnote, { color: colors.warning, marginTop: 2 }]}>
            {`${plan.utenDato.length} ${plan.utenDato.length === 1 ? 'jobb er' : 'jobber er'} ikke satt opp`}
          </Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.lg }}>
          {plan.dager.map((d, i) => {
            const erIdag = d.dato.getTime() === idag
            const erValgt = i === dagIndeks
            const antall = d.jobber.length
            const blokker = Math.min(antall, MAKS_BLOKKER)
            // Blokkene deler søylehøyden mellom seg: en dag med fem jobber blir
            // ikke fem ganger så høy som en med én, den blir tettere.
            const h = blokker ? Math.max(4, Math.min(16, (SOYLE - (blokker - 1) * 3) / blokker)) : 0
            return (
              <Pressable
                key={i}
                haptic="light"
                pressScale={0.94}
                onPress={() => setValgt(i)}
                style={{ flex: 1, alignItems: 'center' }}
              >
                <Text style={[t.caption, { color: erValgt ? colors.toolSecondary : colors.toolTertiary, marginBottom: 4 }]}>
                  {antall > 0 ? String(antall) : ''}
                </Text>
                <View style={{ width: '100%', height: SOYLE, justifyContent: 'flex-end', gap: 3 }}>
                  {Array.from({ length: blokker }, (_, b) => (
                    <View key={b} style={{
                      width: '100%', height: h, borderRadius: radius.sm,
                      backgroundColor: colors.brand,
                      // Kobber er appens ENE aksent. Den valgte dagen får den
                      // for full styrke, resten av uken ligger dempet bak.
                      opacity: erValgt ? 1 : 0.42,
                    }} />
                  ))}
                </View>
                <Text style={[t.caption, { marginTop: spacing.xs, color: colors.toolTertiary }]}>{DAGER[i]}</Text>
                <View style={{
                  width: 24, height: 24, borderRadius: radius.pill, marginTop: 2,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: erIdag ? colors.brand : erValgt ? colors.toolRaisedStrong : 'transparent',
                }}>
                  <Text style={[t.caption, {
                    color: erIdag ? colors.toolLabel : erValgt ? colors.toolLabel : colors.toolSecondary,
                    fontWeight: erIdag || erValgt ? '700' : '500',
                    fontVariant: ['tabular-nums'],
                  }]}>
                    {d.dato.getDate()}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </ToolCard>

      {/* Den valgte dagen */}
      <View style={{ marginTop: spacing.xl }}>
        <ToolSectionHeader>
          {dag.dato.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })}
        </ToolSectionHeader>
        {dag.jobber.length === 0 ? (
          <ToolCard style={{ padding: spacing.lg, alignItems: 'center' }}>
            <Text style={[t.footnote, { color: colors.toolSecondary }]}>Ingen jobber satt opp denne dagen.</Text>
          </ToolCard>
        ) : (
          <ToolCard>
            {dag.jobber.map((o, i, arr) => (
              <DagRad key={o.id} order={o} last={i === arr.length - 1} onPress={() => onVelg(o)} />
            ))}
          </ToolCard>
        )}
      </View>

      {/* Jobbene uten dato. De hører ikke til i noen uke — og nettopp derfor
          er de det egentlige arbeidet på denne skjermen. */}
      {plan.utenDato.length > 0 && (
        <View style={{ marginTop: spacing.xl }}>
          <ToolSectionHeader>Ikke satt opp</ToolSectionHeader>
          <ToolCard>
            {plan.utenDato.map((o, i, arr) => (
              <DagRad key={o.id} order={o} last={i === arr.length - 1} onPress={() => onVelg(o)} />
            ))}
          </ToolCard>
        </View>
      )}
    </View>
  )
}

/** Én jobb i dagslista. Klokkeslettet står først — det er rekkefølgen på dagen. */
function DagRad({ order, last, onPress }: { order: Order; last: boolean; onPress: () => void }) {
  const tid = formatTime(order.scheduledAt)
  const under = [order.customerName, order.address].filter(Boolean).join(' · ')
  return (
    <Pressable
      onPress={onPress}
      style={[
        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.toolBorder },
      ]}
    >
      <View style={{ width: 46 }}>
        {tid ? (
          <Text style={[t.footnote, { color: colors.brand, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{tid}</Text>
        ) : (
          <CalendarOff size={15} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} />
        )}
      </View>
      {/* Samme kobberstrek som i ordrelista: pågår er den ene statusen som
          betyr noe når du ser på dagen. */}
      <View style={{
        width: 3, height: 28, borderRadius: 2, marginRight: spacing.md,
        backgroundColor: order.status === 'pagaar' ? colors.brand : colors.toolBorder,
      }} />
      <View style={{ flex: 1, marginRight: spacing.sm }}>
        <Text style={[t.bodyMedium, { color: colors.toolLabel }]} numberOfLines={1}>{order.title}</Text>
        {!!under && (
          <Text style={[t.footnote, { color: colors.toolSecondary, marginTop: 2 }]} numberOfLines={1}>{under}</Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.toolTertiary} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

import { View, Text } from 'react-native'
import { ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react-native'
import { ListCard } from './ui'
import { OrderApproval } from '../lib/db/models/order-approval'
import { finnAvvik, sisteBeslutning, type Grunnlag } from '../lib/approvals'
import { formatDateTime } from '../lib/format'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * Godkjenningsstatus på ordredetaljen.
 *
 * Det viktigste den gjør er å vise NÅR godkjenningen ikke lenger stemmer.
 * Godkjennes en ordre på 12 400 kr og noen fører to timer etterpå, ser alt
 * riktig ut med mindre noen sier fra. Snapshotet i `order_approvals`
 * sammenlignes derfor mot nåtilstanden, og avviket står svart på hvitt.
 *
 * Vi blokkerer ikke på avvik — det er en samtale mellom mennesker, ikke noe
 * systemet skal gjette på. Men usynlig skal det ikke være.
 */
export function GodkjenningKort({ godkjenninger, grunnlag }: {
  godkjenninger: OrderApproval[]
  grunnlag: Grunnlag | null
}) {
  const siste = sisteBeslutning(godkjenninger)
  if (!siste) return null

  const godkjent = siste.beslutning === 'godkjent'
  const avvik = godkjent && grunnlag ? finnAvvik(siste, grunnlag) : []

  return (
    <ListCard>
      <View style={{ padding: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {godkjent
            ? <ShieldCheck size={18} color={colors.success} strokeWidth={2.2} />
            : <ShieldAlert size={18} color={colors.danger} strokeWidth={2.2} />}
          <Text style={[t.headline, { color: godkjent ? colors.success : colors.danger }]}>
            {godkjent ? 'Faglig godkjent' : 'Sendt tilbake'}
          </Text>
        </View>
        <Text style={[t.footnote, { marginTop: spacing.xs }]}>
          {[siste.godkjennerNavn, formatDateTime(siste.besluttetAt)].filter(Boolean).join(' · ')}
        </Text>
        {!!siste.begrunnelse && (
          <Text style={[t.body, { marginTop: spacing.sm }]}>{siste.begrunnelse}</Text>
        )}

        {avvik.length > 0 && (
          <View style={{
            backgroundColor: colors.warningSoft, borderRadius: radius.md,
            padding: spacing.md, marginTop: spacing.md,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginBottom: spacing.xs }}>
              <AlertTriangle size={14} color={colors.warning} strokeWidth={2.2} />
              <Text style={[t.footnote, { color: colors.warning, fontWeight: '700' }]}>
                Endret etter godkjenningen
              </Text>
            </View>
            {avvik.map((a, i) => (
              <Text key={i} style={[t.footnote, { marginTop: i === 0 ? 0 : 2 }]}>{`· ${a}`}</Text>
            ))}
            <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: spacing.sm }]}>
              Godkjenningen gjelder tallene slik de sto. Skal den stå, bør faglig
              ansvarlig se over på nytt.
            </Text>
          </View>
        )}
      </View>
    </ListCard>
  )
}

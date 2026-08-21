import { useState } from 'react'
import { View, ActivityIndicator, Alert } from 'react-native'
import { Text } from './text'
import { Archive, Check, ShieldAlert } from 'lucide-react-native'
import { Pressable } from './pressable'
import { ListCard } from './ui'
import { Order } from '../lib/db/models/order'
import { frysOrdre, verifiserArkiv, useArkivFor, KanIkkeFryses } from '../lib/archive/freeze'
import { formatDate } from '../lib/format'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * Arkivstatus på ordredetaljen.
 *
 * «Kontroller» er ikke pynt: en pakke som ikke kan verifiseres er ikke et
 * arkiv, den er en fil. Hashen lagres nettopp for at noen skal kunne trykke her
 * om syv år og få et ja eller nei.
 */
export function ArkivKort({ order }: { order: Order }) {
  const arkiv = useArkivFor(order.id)
  const [jobber, setJobber] = useState(false)

  if (order.status !== 'fakturert') return null

  async function frys() {
    setJobber(true)
    try {
      await frysOrdre(order)
    } catch (e) {
      Alert.alert(
        'Kunne ikke arkivere',
        e instanceof KanIkkeFryses ? e.message : 'Noe gikk galt. Prøv igjen når du har nett.',
      )
    } finally {
      setJobber(false)
    }
  }

  async function kontroller() {
    if (!arkiv) return
    setJobber(true)
    try {
      const { ok } = await verifiserArkiv(arkiv)
      Alert.alert(
        ok ? 'Arkivet er uendret' : 'Arkivet stemmer IKKE',
        ok
          ? 'Sjekksummen matcher pakken som ble frosset.'
          : 'Pakken i lagringen er ikke den som ble frosset. Dette må undersøkes.',
      )
    } catch (e) {
      Alert.alert('Kunne ikke kontrollere', e instanceof Error ? e.message : 'Ukjent feil')
    } finally {
      setJobber(false)
    }
  }

  return (
    <ListCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
        <Archive size={18} color={arkiv ? colors.brand : colors.iconMuted} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={t.headline}>{arkiv ? 'Arkivert' : 'Ikke arkivert'}</Text>
          <Text style={[t.footnote, { marginTop: 1 }]}>
            {arkiv
              ? `Frosset ${formatDate(arkiv.frossetAt)} · oppbevares til ${formatDate(arkiv.oppbevaresTil)}`
              : 'Frys jobben når den er ferdig — da er den låst med en sjekksum.'}
          </Text>
        </View>
        {jobber ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <Pressable
            haptic="medium"
            onPress={arkiv ? kontroller : frys}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
              paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderRadius: radius.pill, backgroundColor: arkiv ? colors.fill : colors.brandSoft,
            }}
          >
            {arkiv
              ? <Check size={14} color={colors.label} strokeWidth={2.4} />
              : <ShieldAlert size={14} color={colors.brand} strokeWidth={2.4} />}
            <Text style={[t.subhead, { fontWeight: '600', color: arkiv ? colors.label : colors.brand }]}>
              {arkiv ? 'Kontroller' : 'Arkiver'}
            </Text>
          </Pressable>
        )}
      </View>
      {!!arkiv && (
        <Text style={[t.caption, {
          color: colors.tertiaryLabel, paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md, fontVariant: ['tabular-nums'],
        }]} numberOfLines={1}>
          {`sha256 ${arkiv.sha256.slice(0, 24)}…`}
        </Text>
      )}
    </ListCard>
  )
}

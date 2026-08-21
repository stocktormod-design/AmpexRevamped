import { useMemo, useState } from 'react'
import { View, FlatList, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Plus, ChevronRight, FileText } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Chip, GlassCard } from '../../../components/ui'
import { ToolGlow } from '../../../components/tool-surface'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { Quote } from '../../../lib/db/models/quote'
import { useTilbud } from '../../../lib/quotes'
import { tilbudStatusLabel, type TilbudStatus } from '../../../lib/quoting'
import { formatDate } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

type Filter = 'apne' | 'alle' | TilbudStatus

const filters: { key: Filter; label: string }[] = [
  { key: 'apne', label: 'Åpne' },
  { key: 'alle', label: 'Alle' },
  { key: 'utkast', label: tilbudStatusLabel.utkast },
  { key: 'sendt', label: tilbudStatusLabel.sendt },
  { key: 'akseptert', label: tilbudStatusLabel.akseptert },
  { key: 'avslatt', label: tilbudStatusLabel.avslatt },
  { key: 'utlopt', label: tilbudStatusLabel.utlopt },
]

/** Fargen er status, ikke pynt (DESIGN.md): grønn er vunnet, rød er tapt. */
const statusFarge: Record<TilbudStatus, string> = {
  utkast: colors.tertiaryLabel,
  sendt: colors.brand,
  akseptert: colors.success,
  avslatt: colors.danger,
  utlopt: colors.warning,
}

function TilbudRow({ tilbud, first, last }: { tilbud: Quote; first: boolean; last: boolean }) {
  const status = tilbud.visStatus
  return (
    <Pressable
      onPress={() => router.push(`/(app)/tilbud/${tilbud.id}`)}
      style={{
        backgroundColor: colors.cardGlassStrong,
        marginHorizontal: spacing.screen,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md + 2,
        flexDirection: 'row',
        alignItems: 'center',
        borderTopLeftRadius: first ? radius.hero : 0,
        borderTopRightRadius: first ? radius.hero : 0,
        borderBottomLeftRadius: last ? radius.hero : 0,
        borderBottomRightRadius: last ? radius.hero : 0,
      }}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{tilbud.title}</Text>
        <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={1}>
          {[tilbud.quoteNumber ? `#${tilbud.quoteNumber}` : null, tilbud.customerName].filter(Boolean).join(' · ') || 'Ingen kunde valgt'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginRight: spacing.sm }}>
        <Text style={[t.caption, { color: statusFarge[status], fontWeight: '600' }]}>
          {tilbudStatusLabel[status]}
        </Text>
        {!!tilbud.validUntil && status === 'sendt' && (
          <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2 }]}>
            {`gyldig til ${formatDate(tilbud.validUntil)}`}
          </Text>
        )}
      </View>
      <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
    </Pressable>
  )
}

export default function TilbudScreen() {
  const insets = useSafeAreaInsets()
  const [filter, setFilter] = useState<Filter>('apne')
  const alle = useTilbud()

  // Filtrering skjer på VIS-status, ikke lagret status: et tilbud som gikk ut
  // på dato i går skal ligge under «Utløpt», ikke fortsatt under «Sendt».
  const tilbud = useMemo(() => {
    if (filter === 'alle') return alle
    if (filter === 'apne') return alle.filter(q => q.visStatus === 'utkast' || q.visStatus === 'sendt')
    return alle.filter(q => q.visStatus === filter)
  }, [alle, filter])

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ToolGlow height={340} />
      <FlatList
        data={tilbud}
        keyExtractor={q => q.id}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xl,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <View style={{
              flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
              paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
            }}>
              <Text style={t.display}>Tilbud</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
                <AmpexMarkButton />
                <Pressable
                  haptic="medium" pressScale={0.92}
                  onPress={() => router.push('/(app)/tilbud/ny')}
                  style={{
                    width: 36, height: 36, borderRadius: radius.pill,
                    backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Plus size={sizes.icon} color={colors.brand} strokeWidth={2.2} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}
              style={{ marginBottom: spacing.lg }}
            >
              {filters.map(f => (
                <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </ScrollView>
          </>
        }
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: colors.cardGlassStrong, marginHorizontal: spacing.screen }}>
            <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: spacing.lg }} />
          </View>
        )}
        renderItem={({ item, index }) => (
          <TilbudRow tilbud={item} first={index === 0} last={index === tilbud.length - 1} />
        )}
        ListEmptyComponent={
          <GlassCard>
            <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
              <View style={{
                width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
                backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
              }}>
                <FileText size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
              </View>
              <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen tilbud her</Text>
              <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>
                Et tilbud som blir akseptert oppretter ordren automatisk.
              </Text>
            </View>
          </GlassCard>
        }
      />
    </View>
  )
}

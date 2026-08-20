import { View, Text } from 'react-native'
import { router } from 'expo-router'
import { FileText, ChevronRight } from 'lucide-react-native'
import { Pressable } from './pressable'
import { ListCard } from './ui'
import { useEttTilbud, useTilbudssum } from '../lib/quotes'
import { formatKr } from '../lib/invoicing'
import { formatDate } from '../lib/format'
import { colors, spacing, sizes, type as t } from '../lib/theme'

/**
 * Den avtalte prisen, på en ordre som kom fra et tilbud.
 *
 * Dette er ordredetaljens viktigste tall når det finnes: fakturagrunnlaget
 * regner ut hva jobben BLE, tilbudet sier hva den ble SOLGT for. Er den første
 * større enn den andre, har jobben tapt penger — og det skal ses på ordren, ikke
 * oppdages av regnskapsføreren en måned senere.
 */
export function AvtaltPrisKort({ quoteId }: { quoteId: string }) {
  const tilbud = useEttTilbud(quoteId)
  const sum = useTilbudssum(quoteId)
  if (!tilbud) return null

  return (
    <ListCard>
      <Pressable
        onPress={() => router.push({ pathname: '/(app)/tilbud/[id]', params: { id: quoteId } })}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        }}
      >
        <FileText size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
        <View style={{ flex: 1 }}>
          <Text style={t.headline}>Avtalt pris</Text>
          <Text style={[t.footnote, { marginTop: 1 }]}>
            {[
              tilbud.quoteNumber ? `Tilbud #${tilbud.quoteNumber}` : 'Fra tilbud',
              tilbud.decidedAt ? `akseptert ${formatDate(tilbud.decidedAt)}` : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Text style={[t.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatKr(sum.bruttoOre)}</Text>
        <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
      </Pressable>
    </ListCard>
  )
}

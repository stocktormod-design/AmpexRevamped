import { View } from 'react-native'
import { Text } from './text'
import { AlertTriangle } from 'lucide-react-native'
import { colors, spacing, radius, paperType as t } from '../lib/theme'

/**
 * Problemer som gjør en mal ubrukelig i felt (lib/forms/firm-schema.ts).
 *
 * Vises, og blokkerer lagring. En publisert mal går rett ut til montører som
 * bruker den som dokumentasjon — en klikkliste uten alternativer eller et punkt
 * som aldri kan vises er ikke et utkast, det er en felle.
 */
export function FormProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null
  return (
    <View style={{
      backgroundColor: colors.warningSoft, borderRadius: radius.lg,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.md,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginBottom: spacing.xs }}>
        <AlertTriangle size={15} color={colors.warning} strokeWidth={2.2} />
        <Text style={[t.footnote, { color: colors.warning, fontWeight: '700' }]}>
          {problems.length === 1 ? 'Én ting må rettes' : `${problems.length} ting må rettes`}
        </Text>
      </View>
      {problems.map((p, i) => (
        <Text key={i} style={[t.footnote, { marginTop: 2, lineHeight: 18 }]}>{`· ${p}`}</Text>
      ))}
    </View>
  )
}

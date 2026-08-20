import { View, Text, TextInput } from 'react-native'
import { Plus, X } from 'lucide-react-native'
import { Pressable } from './pressable'
import { Chip } from './ui'
import { FormField } from '../lib/forms/types'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/**
 * Ett felt i skjemaet — label over, input/chips under. Delt mellom
 * app/(app)/ordre/skjema.tsx og components/gap-check-review-sheet.tsx.
 *
 * Betinget visning avgjøres av kalleren (lib/forms/visibility.ts), ikke her —
 * et felt som ikke skal vises skal heller ikke rendres skjult.
 */

/** Etikett + valgfri veiledning. Veiledningen er der importerte skjema har «se pkt. 6.3». */
function Label({ field, gap }: { field: FormField; gap: number }) {
  return (
    <View style={{ marginBottom: field.help ? spacing.xs : gap }}>
      <Text style={t.footnote}>{field.label}</Text>
      {!!field.help && (
        <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2, marginBottom: gap, lineHeight: 16 }]}>
          {field.help}
        </Text>
      )}
    </View>
  )
}

export function FormFieldView({ field, value, onChange, readOnly }: {
  field: FormField
  value: string | Record<string, string>[] | undefined
  onChange: (v: string | Record<string, string>[]) => void
  readOnly: boolean
}) {
  if (field.type === 'info') {
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Text style={[t.footnote, { lineHeight: 19 }]}>{field.label}</Text>
      </View>
    )
  }

  if (field.type === 'choice') {
    const choices = field.choices ?? []
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Label field={field} gap={spacing.sm} />
        {choices.length === 0 ? (
          // Kan bare oppstå i en firmamal som ble lagret uten alternativer.
          // Vis det heller enn å rendre en tom rad ingen skjønner.
          <Text style={[t.caption, { color: colors.danger }]}>Ingen alternativer definert i malen.</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} pointerEvents={readOnly ? 'none' : 'auto'}>
            {choices.map(c => (
              <Chip key={c} label={c} selected={value === c} onPress={() => onChange(value === c ? '' : c)} />
            ))}
          </View>
        )}
      </View>
    )
  }

  if (field.type === 'table') {
    const rows = Array.isArray(value) ? value : []
    const cols = field.columns ?? []
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        {!!field.help && (
          <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.sm, lineHeight: 16 }]}>{field.help}</Text>
        )}
        {rows.map((row, i) => (
          <View key={i} style={{
            backgroundColor: colors.fill, borderRadius: radius.md,
            padding: spacing.md, marginBottom: spacing.sm,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={t.caption}>{`${field.label} ${i + 1}`}</Text>
              {!readOnly && (
                <Pressable onPress={() => onChange(rows.filter((_, j) => j !== i))} hitSlop={8}>
                  <X size={14} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </Pressable>
              )}
            </View>
            {cols.map(col => (
              <TextInput
                key={col.key}
                value={row[col.key] ?? ''}
                editable={!readOnly}
                onChangeText={v => onChange(rows.map((r, j) => j === i ? { ...r, [col.key]: v } : r))}
                placeholder={col.label}
                placeholderTextColor={colors.tertiaryLabel}
                style={[t.subhead, { paddingVertical: spacing.xs + 2, borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}
              />
            ))}
          </View>
        ))}
        {!readOnly && (
          <Pressable
            onPress={() => onChange([...rows, {}])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingVertical: spacing.sm }}
          >
            <Plus size={16} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.subhead, { color: colors.secondaryLabel }]}>{`Legg til ${field.label.toLowerCase()}`}</Text>
          </Pressable>
        )}
      </View>
    )
  }

  if (field.type === 'number') {
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Label field={field} gap={spacing.xs} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <TextInput
            value={typeof value === 'string' ? value : ''}
            editable={!readOnly}
            onChangeText={onChange}
            placeholder={field.placeholder}
            placeholderTextColor={colors.tertiaryLabel}
            // decimal-pad, ikke numeric: måleverdier har komma, og norsk
            // tastatur gir komma her. 'numeric' gir også bokstaver på Android.
            keyboardType="decimal-pad"
            style={[t.body, { flex: 1 }]}
          />
          {!!field.unit && <Text style={[t.subhead, { color: colors.secondaryLabel }]}>{field.unit}</Text>}
        </View>
      </View>
    )
  }

  // text / multiline
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <Label field={field} gap={spacing.xs} />
      <TextInput
        value={typeof value === 'string' ? value : ''}
        editable={!readOnly}
        onChangeText={onChange}
        placeholder={field.placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        multiline={field.type === 'multiline'}
        style={[t.body, field.type === 'multiline' && { minHeight: 64, textAlignVertical: 'top' }]}
      />
    </View>
  )
}

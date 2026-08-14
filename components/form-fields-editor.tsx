import { View, Text, TextInput } from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'
import { Plus, Trash2, SquareCheck, Type, Hash, Camera } from 'lucide-react-native'
import { Pressable } from './pressable'
import type { FormField, FormFieldType } from '../lib/db/models/form-template'
import { colors, spacing, radius, type as t } from '../lib/theme'

const TYPES: FormFieldType[] = ['check', 'text', 'number', 'photo']
const TYPE_ICON: Record<FormFieldType, typeof Type> = { check: SquareCheck, text: Type, number: Hash, photo: Camera }
const TYPE_LABEL: Record<FormFieldType, string> = { check: 'Avkryss', text: 'Tekst', number: 'Tall', photo: 'Foto' }

function newId(): string {
  return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Redigerbar liste av skjemafelt. Delt av «nytt skjema» og «ny revisjon». */
export function FieldsEditor({ items, onChange }: { items: FormField[]; onChange: (items: FormField[]) => void }) {
  function update(id: string, patch: Partial<FormField>) {
    onChange(items.map(f => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) { onChange(items.filter(f => f.id !== id)) }
  function cycleType(f: FormField) {
    const next = TYPES[(TYPES.indexOf(f.type) + 1) % TYPES.length]
    update(f.id, { type: next })
  }
  function add() { onChange([...items, { id: newId(), type: 'check', label: '', required: false }]) }

  return (
    <View>
      <Animated.View layout={LinearTransition.springify().damping(18).stiffness(220)}>
        {items.map((f) => {
          const Icon = TYPE_ICON[f.type]
          return (
            <View key={f.id} style={{ backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.sm + 2, marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pressable haptic="light" onPress={() => cycleType(f)}
                  style={{ width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={17} color={colors.label} strokeWidth={2} />
                </Pressable>
                <TextInput
                  value={f.label} onChangeText={v => update(f.id, { label: v })}
                  placeholder="Beskriv punktet…" placeholderTextColor={colors.tertiaryLabel}
                  style={[t.body, { flex: 1 }]}
                />
                <Pressable haptic="light" hitSlop={8} onPress={() => remove(f.id)}>
                  <Trash2 size={18} color={colors.tertiaryLabel} strokeWidth={2} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, marginLeft: 34 + spacing.sm }}>
                <Pressable haptic="light" onPress={() => cycleType(f)}
                  style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.fill }}>
                  <Text style={[t.caption, { color: colors.secondaryLabel }]}>{TYPE_LABEL[f.type]}</Text>
                </Pressable>
                <Pressable haptic="light" onPress={() => update(f.id, { required: !f.required })}
                  style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: f.required ? colors.label : colors.fill }}>
                  <Text style={[t.caption, { color: f.required ? colors.bg : colors.secondaryLabel, fontWeight: '600' }]}>Påkrevd</Text>
                </Pressable>
              </View>
            </View>
          )
        })}
      </Animated.View>

      <Pressable haptic="medium" onPress={add}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 46, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', marginTop: spacing.xs }}>
        <Plus size={18} color={colors.iconMuted} strokeWidth={2.2} />
        <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Legg til felt</Text>
      </Pressable>
    </View>
  )
}

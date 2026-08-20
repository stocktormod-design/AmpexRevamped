import { useState } from 'react'
import { View, Text, TextInput } from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'
import {
  Plus, Trash2, SquareCheck, Type, Hash, Camera, AlignLeft, List, Table2, Info,
  ChevronDown, ChevronRight, X, Eye,
} from 'lucide-react-native'
import { Pressable } from './pressable'
import { ChoiceSheet, type Valg } from './sheet'
import type {
  FormField, FormFieldType, FormSection,
} from '../lib/db/models/form-template'
import { JA_NEI_IA } from '../lib/forms/types'
import { colors, spacing, radius, type as t } from '../lib/theme'

const TYPES: FormFieldType[] = ['check', 'choice', 'text', 'multiline', 'number', 'table', 'photo', 'info']

const TYPE_ICON: Record<FormFieldType, typeof Type> = {
  check: SquareCheck, choice: List, text: Type, multiline: AlignLeft,
  number: Hash, table: Table2, photo: Camera, info: Info,
}
const TYPE_LABEL: Record<FormFieldType, string> = {
  check: 'Avkryss', choice: 'Klikkliste', text: 'Tekst', multiline: 'Fritekst',
  number: 'Tall', table: 'Tabell', photo: 'Foto', info: 'Informasjon',
}
const TYPE_HINT: Record<FormFieldType, string> = {
  check: 'Ja / Nei / Ikke aktuelt',
  choice: 'Egne alternativer — f.eks. OK / Avvik / Utbedret',
  text: 'Én linje',
  multiline: 'Flere linjer',
  number: 'Måleverdi, med enhet',
  table: 'Rader som gjentas — kursfortegnelse, måleprotokoll',
  photo: 'Bilde tas i appen',
  info: 'Tekst som bare skal leses — lagres ikke',
}

function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function newSection(title = ''): FormSection {
  return { id: newId('s'), title, fields: [] }
}

/** Alternativene et felt kan brukes til å betinge på — tomt hvis feltet ikke er et valg. */
function conditionOptions(f: FormField): string[] {
  if (f.type === 'check') return JA_NEI_IA
  if (f.type === 'choice') return f.choices ?? []
  return []
}

/* ── Små byggeklosser ─────────────────────────────────────────────────── */

function MiniInput({ value, onChangeText, placeholder, style }: {
  value: string; onChangeText: (v: string) => void; placeholder: string; style?: object
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.tertiaryLabel}
      style={[t.subhead, {
        backgroundColor: colors.fill, borderRadius: radius.md,
        paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm,
      }, style]}
    />
  )
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable haptic="light" onPress={onPress}
      style={{
        paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.sm,
        backgroundColor: on ? colors.label : colors.fill,
      }}>
      <Text style={[t.caption, { color: on ? colors.bg : colors.secondaryLabel, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  )
}

/** Redigerbar strengliste — brukt til både klikkliste-alternativer og tabellkolonner. */
function StringListEditor({ values, onChange, addLabel, placeholder }: {
  values: string[]; onChange: (v: string[]) => void; addLabel: string; placeholder: (i: number) => string
}) {
  return (
    <View>
      {values.map((v, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <MiniInput value={v} placeholder={placeholder(i)} style={{ flex: 1 }}
            onChangeText={next => onChange(values.map((x, j) => (j === i ? next : x)))} />
          <Pressable hitSlop={8} haptic="light" onPress={() => onChange(values.filter((_, j) => j !== i))}>
            <X size={15} color={colors.tertiaryLabel} strokeWidth={2} />
          </Pressable>
        </View>
      ))}
      <Pressable haptic="light" onPress={() => onChange([...values, ''])}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs }}>
        <Plus size={14} color={colors.secondaryLabel} strokeWidth={2.2} />
        <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>{addLabel}</Text>
      </Pressable>
    </View>
  )
}

/* ── Ett felt ─────────────────────────────────────────────────────────── */

function FieldCard({ field, candidates, onChange, onRemove }: {
  field: FormField
  /** Felt som kan betinges på — kun valg-felt som kommer FØR dette i malen */
  candidates: FormField[]
  onChange: (patch: Partial<FormField>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(!field.label)
  const [typeSheet, setTypeSheet] = useState(false)
  const [sourceSheet, setSourceSheet] = useState(false)
  const Icon = TYPE_ICON[field.type] ?? Type

  const source = field.showIf ? candidates.find(c => c.id === field.showIf!.field) : undefined
  const sourceOptions = source ? conditionOptions(source) : []

  function setType(next: FormFieldType) {
    // Rydd bort innstillinger som ikke gjelder den nye typen — ellers lagres en
    // klikkliste med tabellkolonner, og importøren senere tror de betyr noe.
    onChange({
      type: next,
      choices: next === 'choice' ? (field.choices ?? ['']) : undefined,
      columns: next === 'table' ? (field.columns ?? [{ key: newId('c'), label: '' }]) : undefined,
      unit: next === 'number' ? field.unit : undefined,
      required: next === 'info' ? false : field.required,
    })
    setTypeSheet(false)
  }

  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, padding: spacing.sm + 2, marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Pressable haptic="light" onPress={() => setTypeSheet(true)}
          style={{ width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={17} color={colors.label} strokeWidth={2} />
        </Pressable>
        <TextInput
          value={field.label} onChangeText={v => onChange({ label: v })}
          placeholder={field.type === 'info' ? 'Teksten som skal leses…' : 'Beskriv punktet…'}
          placeholderTextColor={colors.tertiaryLabel}
          multiline={field.type === 'info'}
          style={[t.body, { flex: 1 }]}
        />
        <Pressable haptic="light" hitSlop={8} onPress={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={18} color={colors.tertiaryLabel} strokeWidth={2} />
                : <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={2} />}
        </Pressable>
        <Pressable haptic="light" hitSlop={8} onPress={onRemove}>
          <Trash2 size={18} color={colors.tertiaryLabel} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Sammendragslinje når kortet er lukket */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, marginLeft: 34 + spacing.sm }}>
        <Pressable haptic="light" onPress={() => setTypeSheet(true)}
          style={{ paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.fill }}>
          <Text style={[t.caption, { color: colors.secondaryLabel }]}>{TYPE_LABEL[field.type]}</Text>
        </Pressable>
        {field.type !== 'info' && (
          <Toggle label="Påkrevd" on={!!field.required} onPress={() => onChange({ required: !field.required })} />
        )}
        {!!field.showIf && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Eye size={12} color={colors.tertiaryLabel} strokeWidth={2} />
            <Text style={[t.caption, { color: colors.tertiaryLabel }]}>betinget</Text>
          </View>
        )}
      </View>

      {open && (
        <View style={{ marginTop: spacing.md, marginLeft: 34 + spacing.sm, gap: spacing.md }}>
          {field.type !== 'info' && (
            <View>
              <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs }]}>Veiledning (valgfritt)</Text>
              <MiniInput value={field.help ?? ''} placeholder="Vises under punktet"
                onChangeText={v => onChange({ help: v || undefined })} />
            </View>
          )}

          {field.type === 'choice' && (
            <View>
              <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs }]}>Alternativer</Text>
              <StringListEditor
                values={field.choices ?? []}
                onChange={choices => onChange({ choices })}
                addLabel="Legg til alternativ"
                placeholder={i => `Alternativ ${i + 1}`}
              />
            </View>
          )}

          {field.type === 'table' && (
            <View>
              <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs }]}>Kolonner</Text>
              <StringListEditor
                values={(field.columns ?? []).map(c => c.label)}
                onChange={labels => onChange({
                  // Behold kolonne-key-ene som finnes: de er nøkkelen utfylte rader
                  // er lagret under. Ny kolonne får ny key.
                  columns: labels.map((label, i) => ({ key: field.columns?.[i]?.key ?? newId('c'), label })),
                })}
                addLabel="Legg til kolonne"
                placeholder={i => `Kolonne ${i + 1}`}
              />
            </View>
          )}

          {field.type === 'number' && (
            <View>
              <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs }]}>Enhet (valgfritt)</Text>
              <MiniInput value={field.unit ?? ''} placeholder="A, V, Ω, mm²…"
                onChangeText={v => onChange({ unit: v || undefined })} />
            </View>
          )}

          {/* Betinget visning */}
          <View>
            <Text style={[t.caption, { color: colors.tertiaryLabel, marginBottom: spacing.xs }]}>Vis punktet</Text>
            <Pressable haptic="light"
              onPress={() => (candidates.length > 0 ? setSourceSheet(true) : undefined)}
              style={{ backgroundColor: colors.fill, borderRadius: radius.md, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm }}>
              <Text style={[t.subhead, { color: source ? colors.label : colors.secondaryLabel }]}>
                {source ? `Bare når «${source.label || 'uten navn'}» er…` : 'Alltid'}
              </Text>
              {candidates.length === 0 && (
                <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2 }]}>
                  Krever et avkryss- eller klikklistepunkt lenger opp i skjemaet.
                </Text>
              )}
            </Pressable>

            {!!source && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                {sourceOptions.map(opt => {
                  const on = field.showIf?.equals.includes(opt) ?? false
                  return (
                    <Toggle key={opt} label={opt} on={on} onPress={() => {
                      const cur = field.showIf?.equals ?? []
                      const next = on ? cur.filter(v => v !== opt) : [...cur, opt]
                      // Ingen verdier igjen = betingelsen kan aldri bli sann.
                      // Da er «alltid» det brukeren mente, ikke «aldri».
                      onChange({ showIf: next.length > 0 ? { field: source.id, equals: next } : undefined })
                    }} />
                  )
                })}
              </View>
            )}
          </View>
        </View>
      )}

      <ChoiceSheet<FormFieldType>
        synlig={typeSheet}
        tittel="Type punkt"
        valgt={field.type}
        valg={TYPES.map<Valg<FormFieldType>>(ty => ({ verdi: ty, etikett: TYPE_LABEL[ty], underetikett: TYPE_HINT[ty] }))}
        onVelg={setType}
        onAvbryt={() => setTypeSheet(false)}
      />

      <ChoiceSheet<string>
        synlig={sourceSheet}
        tittel="Vis punktet bare når…"
        forklaring="Velg punktet som styrer. Etterpå huker du av hvilke svar som slår dette på."
        valgt={field.showIf?.field}
        valg={[
          { verdi: '', etikett: 'Alltid', underetikett: 'Ingen betingelse' },
          ...candidates.map<Valg<string>>(c => ({
            verdi: c.id,
            etikett: c.label || 'Uten navn',
            underetikett: conditionOptions(c).join(' · '),
          })),
        ]}
        onVelg={v => {
          if (!v) onChange({ showIf: undefined })
          else {
            const cand = candidates.find(c => c.id === v)
            onChange({ showIf: { field: v, equals: cand ? conditionOptions(cand).slice(0, 1) : [] } })
          }
          setSourceSheet(false)
        }}
        onAvbryt={() => setSourceSheet(false)}
      />
    </View>
  )
}

/* ── Hele skjemaet ────────────────────────────────────────────────────── */

/**
 * Redigerbare seksjoner med felt. Delt av «nytt skjema» og «ny revisjon».
 *
 * Betingelser kan bare peke BAKOVER (et punkt lenger opp i skjemaet). Det
 * fjerner sykluser uten en syklustest, og det er dessuten den eneste formen
 * som gir mening å lese ovenfra og ned.
 */
export function SectionsEditor({ sections, onChange }: {
  sections: FormSection[]
  onChange: (sections: FormSection[]) => void
}) {
  function patchSection(sid: string, patch: Partial<FormSection>) {
    onChange(sections.map(s => (s.id === sid ? { ...s, ...patch } : s)))
  }
  function patchField(sid: string, fid: string, patch: Partial<FormField>) {
    patchSection(sid, {
      fields: (sections.find(s => s.id === sid)?.fields ?? []).map(f => (f.id === fid ? { ...f, ...patch } : f)),
    })
  }

  const flat = sections.flatMap(s => s.fields)

  return (
    <View>
      <Animated.View layout={LinearTransition.springify().damping(18).stiffness(220)}>
        {sections.map((section, si) => (
          <View key={section.id} style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <TextInput
                value={section.title}
                onChangeText={v => patchSection(section.id, { title: v })}
                placeholder={sections.length === 1 ? 'Del av skjemaet (valgfritt)' : `Del ${si + 1}`}
                placeholderTextColor={colors.tertiaryLabel}
                style={[t.caption, { flex: 1, textTransform: 'uppercase', letterSpacing: 0.4, color: colors.secondaryLabel, marginLeft: spacing.xs }]}
              />
              {sections.length > 1 && (
                <Pressable hitSlop={8} haptic="light" onPress={() => onChange(sections.filter(s => s.id !== section.id))}>
                  <Trash2 size={15} color={colors.tertiaryLabel} strokeWidth={2} />
                </Pressable>
              )}
            </View>

            {section.fields.map(f => {
              const before = flat.slice(0, flat.indexOf(f))
              return (
                <FieldCard
                  key={f.id}
                  field={f}
                  candidates={before.filter(c => conditionOptions(c).length > 0)}
                  onChange={patch => patchField(section.id, f.id, patch)}
                  onRemove={() => {
                    // Rydd betingelser som pekte hit — ellers blir de usynlige for alltid.
                    const cleaned = sections.map(s => ({
                      ...s,
                      fields: s.fields
                        .filter(x => x.id !== f.id)
                        .map(x => (x.showIf?.field === f.id ? { ...x, showIf: undefined } : x)),
                    }))
                    onChange(cleaned)
                  }}
                />
              )
            })}

            <Pressable haptic="medium"
              onPress={() => patchSection(section.id, {
                fields: [...section.fields, { id: newId('f'), type: 'check', label: '', required: false }],
              })}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                height: 46, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border,
                borderStyle: 'dashed', marginTop: spacing.xs,
              }}>
              <Plus size={18} color={colors.iconMuted} strokeWidth={2.2} />
              <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Legg til punkt</Text>
            </Pressable>
          </View>
        ))}
      </Animated.View>

      <Pressable haptic="light" onPress={() => onChange([...sections, newSection()])}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md }}>
        <Plus size={15} color={colors.secondaryLabel} strokeWidth={2.2} />
        <Text style={[t.subhead, { color: colors.secondaryLabel, fontWeight: '600' }]}>Ny del</Text>
      </Pressable>
    </View>
  )
}

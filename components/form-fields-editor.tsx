import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Text, TextInput } from './text'
import Animated, {
  FadeIn, FadeOut, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import {
  Plus, Trash2, SquareCheck, Type, Hash, Camera, AlignLeft, List, Table2, Info,
  ChevronDown, ChevronUp, X, AlertTriangle, GripVertical,
} from 'lucide-react-native'
import { Pressable } from './pressable'
import { Segmented } from './segmented'
import { FormFieldView } from './form-field-view'
import { convertFirmField } from '../lib/forms/firm-schema'
import type {
  FormField, FormFieldType, FormSection,
} from '../lib/db/models/form-template'
import { JA_NEI_IA } from '../lib/forms/types'
import { ANSWER_TYPES, answerType, type AnswerType } from '../lib/forms/answer-types'
import { colors, spacing, radius, paperType as t } from '../lib/theme'

/**
 * Skjemabyggeren.
 *
 * ── Hvorfor den ser ut som skjemaet, ikke som et skjema over skjemaet ──────
 *
 * Første utgave var en kortstokk med typevelger, tekst og ekstrafelt om
 * hverandre. Tormod: «gir ikke helt mening for meg hva som er svar og
 * spørsmål». Her er hvert punkt derfor SPØRSMÅLET først, og under det hva det
 * SVARES MED — og «Se» viser nøyaktig den flaten montøren får, rendret av
 * `FormFieldView`, ikke en etterligning.
 *
 * ── Færrest mulig trykk ────────────────────────────────────────────────────
 *
 * Svartypen ligger som ikonpiller INNE i punktet, ikke i et ark bak en
 * chevron: å velge «Ja / Nei» er ett trykk, og alle åtte mulighetene står
 * synlig samtidig så ingen må gjette hva som finnes. Sjelden-brukte
 * innstillinger (påkrevd, betingelse, hjelpetekst) kommer først når punktet er
 * åpnet.
 *
 * ── Dra for å flytte ───────────────────────────────────────────────────────
 *
 * Håndtaket til venstre løfter punktet etter et langt trykk. Rekkefølgen er
 * innhold: et skjema leses ovenfra og ned, og betingelser kan bare peke
 * oppover. Pilene i den åpne editoren gjør det samme uten gest — dra er
 * raskere, men skal ikke være den eneste veien.
 */

/** Ordene er felles (`lib/forms/answer-types.ts`); bare ikonene er native. */
const ICONS: Record<AnswerType['icon'], typeof Type> = {
  check: SquareCheck,
  text: Type,
  multiline: AlignLeft,
  number: Hash,
  choice: List,
  table: Table2,
  photo: Camera,
  info: Info,
}

function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** Ny del. Ett tomt spørsmål med, så flaten aldri starter som et hvitt ark. */
export function newSection(title = ''): FormSection {
  return { id: newId('s'), title, fields: [newField()] }
}

function newField(): FormField {
  return { id: newId('f'), type: 'check', label: '', required: false }
}

/** Alternativene et felt kan brukes til å betinge på — tomt hvis feltet ikke er et valg. */
function conditionOptions(f: FormField): string[] {
  if (f.type === 'check') return JA_NEI_IA
  if (f.type === 'choice') return f.choices ?? []
  return []
}

/* ── Små byggeklosser ─────────────────────────────────────────────────── */

function MiniInput({ value, onChangeText, placeholder, style, multiline }: {
  value: string
  onChangeText: (v: string) => void
  placeholder: string
  style?: object
  multiline?: boolean
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.paperTertiary}
      multiline={multiline}
      style={[t.subhead, {
        backgroundColor: colors.paperFill, borderRadius: radius.md,
        paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm + 2,
      }, multiline && { minHeight: 64, textAlignVertical: 'top' }, style]}
    />
  )
}

/** Bryter som en pille — samme visning i typevalg, krav og betingelse. */
function Pille({ label, on, onPress, Icon }: {
  label: string
  on: boolean
  onPress: () => void
  Icon?: typeof Type
}) {
  return (
    <Pressable
      haptic="light"
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        minHeight: 44, paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        backgroundColor: on ? colors.paperLabel : colors.paperFill,
      }}
    >
      {Icon ? <Icon size={14} color={on ? colors.paperBg : colors.paperIcon} strokeWidth={2.2} /> : null}
      <Text style={[t.subhead, { fontWeight: '600', color: on ? colors.paperBg : colors.paperSecondary }]}>
        {label}
      </Text>
    </Pressable>
  )
}

/** Redigerbar strengliste — klikkliste-alternativer og tabellkolonner. */
function StringListEditor({ values, onChange, addLabel, placeholder }: {
  values: string[]
  onChange: (v: string[]) => void
  addLabel: string
  placeholder: (i: number) => string
}) {
  return (
    <View>
      {values.map((v, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <MiniInput
            value={v}
            placeholder={placeholder(i)}
            style={{ flex: 1 }}
            onChangeText={next => onChange(values.map((x, j) => (j === i ? next : x)))}
          />
          <Pressable hitSlop={8} haptic="light" onPress={() => onChange(values.filter((_, j) => j !== i))}>
            <X size={15} color={colors.paperTertiary} strokeWidth={2} />
          </Pressable>
        </View>
      ))}
      <Pressable
        haptic="light"
        onPress={() => onChange([...values, ''])}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs }}
      >
        <Plus size={14} color={colors.paperSecondary} strokeWidth={2.2} />
        <Text style={[t.caption, { color: colors.paperSecondary, fontWeight: '600' }]}>{addLabel}</Text>
      </Pressable>
    </View>
  )
}

/* ── Ett punkt ────────────────────────────────────────────────────────── */

function QuestionRow({
  field,
  nummer,
  flagg,
  candidates,
  onChange,
  onRemove,
  onMove,
  autoFocus,
}: {
  field: FormField
  /** Løpenummer i hele skjemaet — det montøren ser. */
  nummer: number
  /** Én setning om hvorfor punktet er usikkert (skjemaimport). */
  flagg?: string
  /** Felt som kan betinges på — kun valg-felt som kommer FØR dette punktet. */
  candidates: FormField[]
  onChange: (patch: Partial<FormField>) => void
  onRemove: () => void
  onMove: (steg: number) => void
  /** Nystartet spørsmål: markøren skal stå der, uten et ekstra trykk. */
  autoFocus?: boolean
}) {
  const [åpen, setÅpen] = useState(() => !field.label)
  const info = answerType(field.type) ?? ANSWER_TYPES[1]
  const Icon = ICONS[info.icon]

  const høyde = useRef(0)
  const ty = useSharedValue(0)
  const løft = useSharedValue(0)

  function dunk() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  // Langt trykk på håndtaket løfter punktet. Kortet følger fingeren; ved
  // slipp flyttes det like mange hele radhøyder som fingeren gikk.
  const dra = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      løft.value = withSpring(1, { damping: 18, stiffness: 240 })
      runOnJS(dunk)()
    })
    .onUpdate(e => { ty.value = e.translationY })
    .onEnd(e => {
      // Ett steg = én rad. Kortet kan være utvidet, men da ville én flytting
      // krevd en halv skjerm med fingergang — derfor er steglengden klemt.
      const rad = Math.max(56, Math.min(høyde.current, 120))
      const steg = Math.round(e.translationY / (rad + spacing.sm))
      if (steg !== 0) runOnJS(onMove)(steg)
    })
    .onFinalize(() => {
      ty.value = withSpring(0, { damping: 18, stiffness: 240 })
      løft.value = withSpring(0, { damping: 18, stiffness: 240 })
    })

  const stil = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + løft.value * 0.012 }],
    shadowOpacity: 0.04 + løft.value * 0.12,
    // Det løftede punktet skal ligge OVER naboen det dras forbi.
    zIndex: løft.value > 0.01 ? 20 : 0,
  }))

  const source = field.showIf ? candidates.find(c => c.id === field.showIf!.field) : undefined
  const sourceOptions = source ? conditionOptions(source) : []

  function setType(next: FormFieldType) {
    // Rydd bort innstillinger som ikke gjelder den nye typen — ellers lagres en
    // klikkliste med tabellkolonner, og importøren senere tror de betyr noe.
    onChange({
      type: next,
      choices: next === 'choice' ? (field.choices?.length ? field.choices : ['']) : undefined,
      columns: next === 'table' ? (field.columns?.length ? field.columns : [{ key: newId('c'), label: '' }]) : undefined,
      unit: next === 'number' ? field.unit : undefined,
      required: next === 'info' ? false : field.required,
    })
  }

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(20).stiffness(220)}
      onLayout={e => { høyde.current = e.nativeEvent.layout.height }}
      style={[{
        backgroundColor: colors.paperBg,
        borderRadius: radius.lg,
        marginBottom: spacing.sm,
        shadowColor: '#000',
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }, stil, !!flagg && { borderWidth: 1, borderColor: colors.warning }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, gap: spacing.sm }}>
        {/* Håndtaket er også en affordance: her kan du ta. Trefflaten er 44
            brei sjølv om streken er 17 — fingrar er større enn ikon. */}
        <GestureDetector gesture={dra}>
          <View
            hitSlop={{ top: 0, bottom: 0, left: 12, right: 12 }}
            style={{ width: 20, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm }}
          >
            <GripVertical size={18} color={colors.paperTertiary} strokeWidth={2} />
          </View>
        </GestureDetector>

        <Pressable
          haptic="none"
          onPress={() => setÅpen(o => !o)}
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          style={{ width: 22, paddingTop: 1, minHeight: 44, justifyContent: 'center' }}
          accessibilityLabel={`Punkt ${nummer}`}
        >
          <Text style={[t.caption, { color: colors.paperSecondary, fontVariant: ['tabular-nums'], fontWeight: '700' }]}>
            {nummer}
          </Text>
        </Pressable>

        <TextInput
          value={field.label}
          onChangeText={v => onChange({ label: v })}
          placeholder={field.type === 'info' ? 'Teksten som skal leses …' : (info.example)}
          placeholderTextColor={colors.paperTertiary}
          multiline={field.type === 'info'}
          autoFocus={autoFocus}
          onFocus={() => setÅpen(true)}
          style={[t.body, { flex: 1, minHeight: 44, paddingTop: 10, textAlignVertical: 'top' }]}
        />

        <Pressable
          haptic="light"
          onPress={() => setÅpen(o => !o)}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -spacing.sm }}
          accessibilityLabel={åpen ? 'Lukk punktet' : 'Åpne punktet'}
        >
          {åpen
            ? <ChevronUp size={18} color={colors.paperTertiary} strokeWidth={2} />
            : <ChevronDown size={18} color={colors.paperTertiary} strokeWidth={2} />}
        </Pressable>
      </View>

      {!!flagg && (
        <View style={{ flexDirection: 'row', gap: spacing.xs + 2, marginTop: 2, marginBottom: spacing.sm, paddingHorizontal: spacing.md, marginLeft: spacing.lg }}>
          <AlertTriangle size={13} color={colors.warning} strokeWidth={2.2} style={{ marginTop: 2 }} />
          <Text style={[t.caption, { flex: 1, color: colors.warning, lineHeight: 17 }]}>{flagg}</Text>
        </View>
      )}

      {/* Lukket: hvordan punktet svares, i ord. Det er «hva er spørsmål og hva
          er svar» på én linje — uten å åpne noe. */}
      {!åpen && (
        <Pressable
          haptic="none"
          onPress={() => setÅpen(true)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
            marginLeft: 18 + spacing.sm + 22 + spacing.sm, marginRight: spacing.md,
            minHeight: 44, paddingBottom: spacing.sm,
          }}
        >
          <Icon size={14} color={colors.paperSecondary} strokeWidth={2.2} />
          <View style={{ flex: 1 }}>
            <Text style={[t.footnote]} numberOfLines={1}>
              {field.type === 'choice'
                ? (field.choices ?? []).filter(Boolean).join(' · ') || info.label
                : field.type === 'table'
                  ? (field.columns ?? []).map(c => c.label).filter(Boolean).join(' · ') || info.label
                  : info.label}
            </Text>
            {!!field.showIf && (
              <Text style={[t.caption, { color: colors.paperSecondary, marginTop: 2 }]} numberOfLines={2}>
                {`Vises hvis «${source?.label || 'et tidligere spørsmål'}» = ${field.showIf.equals.join(' eller ')}`}
              </Text>
            )}
          </View>
          {!!field.required && <Text style={[t.caption, { color: colors.paperSecondary }]}>påkrevd</Text>}
        </Pressable>
      )}

      {åpen && (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)}
          style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, marginLeft: 18 + spacing.sm + 22 + spacing.sm }}>
          <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.4, color: colors.paperSecondary, marginBottom: spacing.sm }]}>
            {field.type === 'info' ? 'Vises som' : 'Svares med'}
          </Text>

          {/* Alle åtte, synlig samtidig. Ett trykk bytter. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 }}>
            {ANSWER_TYPES.map(ty => (
              <Pille
                key={ty.id}
                label={ty.label}
                Icon={ICONS[ty.icon]}
                on={field.type === ty.id}
                onPress={() => setType(ty.id)}
              />
            ))}
          </View>
          <Text style={[t.caption, { color: colors.paperTertiary, marginTop: spacing.xs + 2 }]}>
            {info.description} · f.eks. «{info.example}»
          </Text>

          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {field.type === 'choice' && (
              <View>
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.xs }]}>Alternativer</Text>
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
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.xs }]}>Kolonner</Text>
                <StringListEditor
                  values={(field.columns ?? []).map(c => c.label)}
                  onChange={labels => onChange({
                    // Behold kolonne-key-ene som finnes: de er nøkkelen utfylte
                    // rader er lagret under. Ny kolonne får ny key.
                    columns: labels.map((label, i) => ({ key: field.columns?.[i]?.key ?? newId('c'), label })),
                  })}
                  addLabel="Legg til kolonne"
                  placeholder={i => `Kolonne ${i + 1}`}
                />
              </View>
            )}

            {field.type === 'number' && (
              <View>
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.xs }]}>Enhet (valgfritt)</Text>
                <MiniInput value={field.unit ?? ''} placeholder="A, V, Ω, mm² …"
                  onChangeText={v => onChange({ unit: v || undefined })} />
              </View>
            )}

            {field.type !== 'info' && (
              <View>
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.xs }]}>Veiledning (valgfritt)</Text>
                <MiniInput value={field.help ?? ''} placeholder="Står under spørsmålet"
                  onChangeText={v => onChange({ help: v || undefined })} />
              </View>
            )}

            {field.type !== 'info' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pille label="Må besvares" on={!!field.required} onPress={() => onChange({ required: !field.required })} />
              </View>
            )}

            {/* Betinget visning — bare når noe over kan betinge. */}
            {candidates.length > 0 && (
              <View>
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.xs }]}>
                  Vis bare hvis
                </Text>
                <Text style={[t.caption, { color: colors.paperTertiary, marginBottom: spacing.sm, lineHeight: 17 }]}>
                  Spørsmålet vises først når et tidligere svar er gitt. «Alltid» betyr at alle ser det.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 }}>
                  <Pille
                    label="Alltid"
                    on={!field.showIf}
                    onPress={() => onChange({ showIf: undefined })}
                  />
                  {candidates.map(c => (
                    <Pille
                      key={c.id}
                      label={c.label || 'Uten navn'}
                      on={field.showIf?.field === c.id}
                      onPress={() => onChange({
                        showIf: { field: c.id, equals: conditionOptions(c).slice(0, 1) },
                      })}
                    />
                  ))}
                </View>

                {!!source && (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={[t.caption, { color: colors.paperSecondary, marginBottom: spacing.xs, fontWeight: '600' }]}>
                      {`Vises hvis «${source.label || 'uten navn'}» = ${(field.showIf?.equals ?? []).join(' eller ') || '…'}`}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {sourceOptions.map(opt => {
                        const on = field.showIf?.equals.includes(opt) ?? false
                        return (
                          <Pille key={opt} label={opt} on={on} onPress={() => {
                            const cur = field.showIf?.equals ?? []
                            const next = on ? cur.filter(v => v !== opt) : [...cur, opt]
                            // Ingen verdier igjen = betingelsen kan aldri bli sann.
                            // Da er «alltid» det brukeren mente, ikke «aldri».
                            onChange({ showIf: next.length > 0 ? { field: source.id, equals: next } : undefined })
                          }} />
                        )
                      })}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
            marginTop: spacing.md, paddingTop: spacing.sm,
            borderTopWidth: 0.5, borderTopColor: colors.paperSeparator,
          }}>
            <Pressable haptic="light" onPress={() => onMove(-1)}
              accessibilityLabel="Flytt opp"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronUp size={18} color={colors.paperSecondary} strokeWidth={2.2} />
            </Pressable>
            <Pressable haptic="light" onPress={() => onMove(1)}
              accessibilityLabel="Flytt ned"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <ChevronDown size={18} color={colors.paperSecondary} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              haptic="medium"
              onPress={onRemove}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: 'auto', minHeight: 44, paddingHorizontal: spacing.sm }}
            >
              <Trash2 size={16} color={colors.danger} strokeWidth={2} />
              <Text style={[t.subhead, { color: colors.danger, fontWeight: '600' }]}>Fjern</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </Animated.View>
  )
}

/* ── Forhåndsvisning ──────────────────────────────────────────────────── */

/**
 * Skjemaet slik montøren får det — rendret av den SAMME komponenten som
 * fyller det ut (`FormFieldView`). Ikke en etterligning: det som står her, er
 * det som møter dem i ordren.
 */
function Forhandsvisning({ tittel, sections }: { tittel?: string; sections: FormSection[] }) {
  const felter = sections.reduce((n, s) => n + s.fields.length, 0)
  return (
    <View>
      <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.4, color: colors.paperSecondary, marginBottom: spacing.sm, marginLeft: spacing.xs }]}>
        Slik ser montøren det
      </Text>
      <View style={{
        backgroundColor: colors.paperBg, borderRadius: radius.lg,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        marginBottom: spacing.md,
      }}>
        <Text style={t.title3}>{tittel?.trim() || 'Uten navn'}</Text>
        <Text style={[t.caption, { marginTop: 2 }]}>
          {felter === 1 ? '1 spørsmål' : `${felter} spørsmål`}
        </Text>
      </View>

      {sections.map(section => {
        if (section.fields.length === 0) return null
        return (
          <View key={section.id} style={{ marginBottom: spacing.md }}>
            {!!section.title.trim() && (
              <Text style={[t.caption, { textTransform: 'uppercase', letterSpacing: 0.4, color: colors.paperSecondary, marginBottom: spacing.xs, marginLeft: spacing.xs }]}>
                {section.title}
              </Text>
            )}
            <View style={{ backgroundColor: colors.paperBg, borderRadius: radius.lg, overflow: 'hidden' }}>
              {section.fields.map((f, i) => (
                <View key={f.id} style={i > 0 ? { borderTopWidth: 0.5, borderTopColor: colors.paperSeparator } : undefined}>
                  <FormFieldView field={convertFirmField(f)} value={undefined} onChange={() => {}} readOnly />
                </View>
              ))}
            </View>
          </View>
        )
      })}

      {felter === 0 && (
        <View style={{
          backgroundColor: colors.paperBg, borderRadius: radius.lg,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
        }}>
          <Text style={t.footnote}>Ingen spørsmål ennå</Text>
          <Text style={[t.caption, { color: colors.paperTertiary, marginTop: 4, lineHeight: 18 }]}>
            Legg til et i «Bygg», så står det her slik montøren ser det.
          </Text>
        </View>
      )}
    </View>
  )
}

/* ── Hele skjemaet ────────────────────────────────────────────────────── */

/**
 * Redigerbare seksjoner med felt. Delt av «nytt skjema», «ny revisjon» og
 * skjemaimporten — derfor er API-et uendret: `sections`, `onChange`, `flagg`.
 *
 * Betingelser kan bare peke BAKOVER (et punkt lenger opp i skjemaet). Det
 * fjerner sykluser uten en syklustest, og det er dessuten den eneste formen
 * som gir mening å lese ovenfra og ned.
 */
export function SectionsEditor({ sections, tittel, flagg, onChange }: {
  sections: FormSection[]
  /** Bare brukt i forhåndsvisningen — arket viser skjemaets navn. */
  tittel?: string
  /** id → hvorfor punktet er usikkert. Brukes av skjemaimporten. */
  flagg?: Record<string, string>
  onChange: (sections: FormSection[]) => void
}) {
  const [modus, setModus] = useState<'bygg' | 'se'>('bygg')
  /** Nylagt spørsmål som skal ha markøren — uten et ekstra trykk. */
  const [fokusId, setFokusId] = useState<string | null>(null)

  function leggTilSporsmal(sid: string) {
    const felt = newField()
    const eksisterende = sections.find(s => s.id === sid)?.fields ?? []
    patchSection(sid, { fields: [...eksisterende, felt] })
    setFokusId(felt.id)
  }

  function nyDel() {
    const seksjon = newSection()
    onChange([...sections, seksjon])
    setFokusId(seksjon.fields[0]?.id ?? null)
  }

  function patchSection(sid: string, patch: Partial<FormSection>) {
    onChange(sections.map(s => (s.id === sid ? { ...s, ...patch } : s)))
  }

  function patchField(sid: string, fid: string, patch: Partial<FormField>) {
    const eksisterende = sections.find(s => s.id === sid)?.fields ?? []
    patchSection(sid, { fields: eksisterende.map(f => (f.id === fid ? { ...f, ...patch } : f)) })
  }

  function flytt(sid: string, fid: string, steg: number) {
    const seksjon = sections.find(s => s.id === sid)
    if (!seksjon) return
    const fra = seksjon.fields.findIndex(f => f.id === fid)
    const til = Math.max(0, Math.min(seksjon.fields.length - 1, fra + steg))
    if (fra < 0 || til === fra) return
    const felt = [...seksjon.fields]
    const [flyttet] = felt.splice(fra, 1)
    felt.splice(til, 0, flyttet)
    patchSection(sid, { fields: felt })
  }

  function fjern(sid: string, fid: string) {
    // Rydd betingelser som pekte hit — ellers blir de usynlige for alltid.
    onChange(sections.map(s => ({
      ...s,
      fields: s.fields
        .filter(x => x.id !== fid)
        .map(x => (x.showIf?.field === fid ? { ...x, showIf: undefined } : x)),
    })))
  }

  // Løpenummer over hele skjemaet, ikke per del — montøren leser «punkt 7».
  const startnummer: Record<string, number> = {}
  let n = 0
  for (const s of sections) {
    for (const f of s.fields) startnummer[f.id] = ++n
  }

  return (
    <View>
      <View style={{ marginBottom: spacing.lg }}>
        <Segmented<'bygg' | 'se'>
          value={modus}
          onChange={setModus}
          options={[
            { key: 'bygg', label: 'Bygg' },
            { key: 'se', label: 'Se' },
          ]}
        />
        {/* Inntaket er ikke et eget format: det er del 1. Betingelser kan bare
            peke oppover, så det som står først er det som styrer resten. */}
        <Text style={[t.caption, { color: colors.paperTertiary, marginTop: spacing.sm, marginLeft: spacing.xs, lineHeight: 17 }]}>
          Del 1 svares først. Et spørsmål lenger ned kan vises bare når et tidligere svar er gitt.
        </Text>
      </View>

      {modus === 'se' ? (
        <Animated.View key="se" entering={FadeIn.duration(160)}>
          <Forhandsvisning tittel={tittel} sections={sections} />
        </Animated.View>
      ) : (
        <Animated.View key="bygg" entering={FadeIn.duration(160)}>
          {sections.map((section, si) => {
            const før = sections.slice(0, si).flatMap(s => s.fields)
            return (
              <View key={section.id} style={{ marginBottom: spacing.xl }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, minHeight: 44 }}>
                  <TextInput
                    value={section.title}
                    onChangeText={v => patchSection(section.id, { title: v })}
                    placeholder={sections.length === 1 ? 'Overskrift (valgfri)' : `Overskrift — del ${si + 1}`}
                    placeholderTextColor={colors.paperTertiary}
                    style={[t.caption, {
                      flex: 1, textTransform: 'uppercase', letterSpacing: 0.4,
                      color: colors.paperSecondary, marginLeft: spacing.xs, paddingVertical: 4,
                    }]}
                  />
                  {si === 0 && (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.paperFill }}>
                      <Text style={[t.caption, { color: colors.paperSecondary, fontWeight: '600' }]}>Innledende</Text>
                    </View>
                  )}
                  {sections.length > 1 && (
                    <Pressable
                      haptic="light"
                      onPress={() => onChange(sections.filter(s => s.id !== section.id))}
                      accessibilityLabel="Fjern delen"
                      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Trash2 size={16} color={colors.paperTertiary} strokeWidth={2} />
                    </Pressable>
                  )}
                </View>

                {section.fields.length === 0 && (
                  <View style={{
                    backgroundColor: colors.paperBg, borderRadius: radius.lg,
                    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.sm,
                  }}>
                    <Text style={t.footnote}>Ingen spørsmål i denne delen ennå</Text>
                    <Text style={[t.caption, { color: colors.paperTertiary, marginTop: 4 }]}>
                      F.eks. «Er jordfeilbryteren testet?»
                    </Text>
                  </View>
                )}

                {section.fields.map((f, fi) => {
                  // Betingelser kan bare peke på valg-felt lenger OPP.
                  const tidligere = før.concat(section.fields.slice(0, fi))
                  return (
                    <QuestionRow
                      key={f.id}
                      field={f}
                      nummer={startnummer[f.id]}
                      flagg={flagg?.[f.id]}
                      candidates={tidligere.filter(c => conditionOptions(c).length > 0)}
                      onChange={patch => patchField(section.id, f.id, patch)}
                      onRemove={() => fjern(section.id, f.id)}
                      onMove={steg => flytt(section.id, f.id, steg)}
                      autoFocus={fokusId === f.id}
                    />
                  )
                })}

                <Pressable
                  haptic="medium"
                  onPress={() => leggTilSporsmal(section.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
                    height: 48, borderRadius: radius.lg, marginTop: spacing.xs,
                    backgroundColor: colors.paperBg,
                  }}
                >
                  <Plus size={17} color={colors.paperLabel} strokeWidth={2.2} />
                  <Text style={[t.subhead, { color: colors.paperLabel, fontWeight: '600' }]}>Legg til spørsmål</Text>
                </Pressable>
              </View>
            )
          })}

          <Pressable
            haptic="light"
            onPress={() => nyDel()}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 44, paddingVertical: spacing.md }}
          >
            <Plus size={15} color={colors.paperSecondary} strokeWidth={2.2} />
            <Text style={[t.subhead, { color: colors.paperSecondary, fontWeight: '600' }]}>Ny del</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  )
}

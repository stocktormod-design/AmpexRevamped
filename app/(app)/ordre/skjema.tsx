import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus, X } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader, Chip } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { supabase } from '../../../lib/supabase'
import { Order } from '../../../lib/db/models/order'
import { OrderDocument } from '../../../lib/db/models/order-document'
import { getTemplate } from '../../../lib/forms/templates'
import { FormField, FormValues, FormPrefill } from '../../../lib/forms/types'
import { formatDateTime } from '../../../lib/format'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function prefillValue(kind: FormPrefill, order: Order): string {
  switch (kind) {
    case 'customerName': return order.customerName ?? ''
    case 'address': return order.address ?? ''
    case 'orderTitle': return order.title
    case 'orderDescription': return order.description ?? order.title
    case 'today': return new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
  }
}

/** Ett felt i skjemaet — label over, input/chips under */
function FieldView({ field, value, onChange, readOnly }: {
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
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        <Text style={[t.footnote, { marginBottom: spacing.sm }]}>{field.label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} pointerEvents={readOnly ? 'none' : 'auto'}>
          {(field.choices ?? []).map(c => (
            <Chip key={c} label={c} selected={value === c} onPress={() => onChange(value === c ? '' : c)} />
          ))}
        </View>
      </View>
    )
  }

  if (field.type === 'table') {
    const rows = Array.isArray(value) ? value : []
    const cols = field.columns ?? []
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
        {rows.map((row, i) => (
          <View key={i} style={{
            backgroundColor: colors.groupedBg, borderRadius: radius.md,
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

  // text / multiline
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <Text style={[t.footnote, { marginBottom: spacing.xs }]}>{field.label}</Text>
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

export default function SkjemaScreen() {
  const insets = useSafeAreaInsets()
  const { orderId, templateId } = useLocalSearchParams<{ orderId: string; templateId: string }>()
  const template = templateId ? getTemplate(templateId) : undefined

  const [values, setValues] = useState<FormValues>({})
  const [status, setStatus] = useState<'utkast' | 'fullfort'>('utkast')
  const [completedAt, setCompletedAt] = useState<Date | null>(null)
  const [ready, setReady] = useState(false)
  const docRef = useRef<OrderDocument | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Last eksisterende dokument, ellers prefill fra ordren (én gang)
  useEffect(() => {
    if (!template || !orderId) return
    let mounted = true
    ;(async () => {
      const [doc] = await database
        .get<OrderDocument>('order_documents')
        .query(Q.where('order_id', orderId), Q.where('template_id', template.id))
        .fetch()
      if (!mounted) return
      if (doc) {
        docRef.current = doc
        setValues(doc.data ? JSON.parse(doc.data) : {})
        setStatus(doc.status)
        setCompletedAt(doc.completedAt)
      } else {
        const order = await database.get<Order>('orders').find(orderId)
        if (!mounted) return
        const prefilled: FormValues = {}
        for (const s of template.sections) {
          for (const f of s.fields) {
            if (f.prefill) prefilled[f.key] = prefillValue(f.prefill, order)
          }
        }
        setValues(prefilled)
      }
      setReady(true)
    })()
    return () => { mounted = false }
  }, [template, orderId])

  /** Debouncet autolagring — rad opprettes lazily ved første endring («foreslått» → «utkast») */
  function scheduleSave(next: FormValues) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 600)
  }

  async function persist(next: FormValues, overrides?: Partial<{ status: 'utkast' | 'fullfort'; completedBy: string | null; completedAt: Date | null }>) {
    if (!template || !orderId) return
    const json = JSON.stringify(next)
    await database.write(async () => {
      if (docRef.current) {
        await docRef.current.update(d => {
          d.data = json
          if (overrides) {
            d.status = overrides.status ?? d.status
            d.completedBy = overrides.completedBy !== undefined ? overrides.completedBy : d.completedBy
            d.completedAt = overrides.completedAt !== undefined ? overrides.completedAt : d.completedAt
          }
        })
      } else {
        docRef.current = await database.get<OrderDocument>('order_documents').create(d => {
          d.orderId = orderId
          d.templateId = template.id
          d.templateVersion = template.version
          d.status = overrides?.status ?? 'utkast'
          d.data = json
          d.completedBy = overrides?.completedBy ?? null
          d.completedAt = overrides?.completedAt ?? null
        })
      }
    })
  }

  function onFieldChange(key: string, v: string | Record<string, string>[]) {
    const next = { ...values, [key]: v }
    setValues(next)
    scheduleSave(next)
  }

  async function fullfor() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const { data } = await supabase.auth.getSession()
    const now = new Date()
    await persist(values, { status: 'fullfort', completedBy: data.session?.user.id ?? null, completedAt: now })
    setStatus('fullfort')
    setCompletedAt(now)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    syncQuietly()
  }

  async function gjenapne() {
    await persist(values, { status: 'utkast', completedBy: null, completedAt: null })
    setStatus('utkast')
    setCompletedAt(null)
    syncQuietly()
  }

  if (!template) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />
  const readOnly = status === 'fullfort'

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.back()}
            pressScale={0.92}
            style={{
              width: 36, height: 36, borderRadius: radius.pill,
              backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>{template.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>{template.source}</Text>
        </View>

        {!!template.reviewNote && (
          <View style={{
            backgroundColor: colors.fillPressed, borderRadius: radius.md,
            marginHorizontal: spacing.screen, marginBottom: spacing.screen,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }}>
            <Text style={t.footnote}>{template.reviewNote}</Text>
          </View>
        )}

        {ready && template.sections.map(section => (
          <View key={section.title} style={{ marginBottom: spacing.screen }}>
            <SectionHeader>{section.title}</SectionHeader>
            <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
              {section.fields.map((f, i) => (
                <View key={f.key} style={i < section.fields.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator }}>
                  <FieldView field={f} value={values[f.key]} onChange={v => onFieldChange(f.key, v)} readOnly={readOnly} />
                </View>
              ))}
            </View>
          </View>
        ))}

        {ready && (readOnly ? (
          <View style={{ marginHorizontal: spacing.screen, alignItems: 'center', gap: spacing.md }}>
            <Text style={t.footnote}>{`Fullført ${formatDateTime(completedAt) ?? ''}`}</Text>
            <Pressable onPress={gjenapne} hitSlop={8}>
              <Text style={[t.subhead, { color: colors.secondaryLabel }]}>Gjenåpne</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            haptic="medium"
            onPress={fullfor}
            style={{
              height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
              alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.screen,
            }}
          >
            <Text style={[t.headline, { color: colors.ctaLabel }]}>Fullfør og signer</Text>
          </Pressable>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

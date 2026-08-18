import { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { SectionHeader } from '../../../components/ui'
import { FormFieldView } from '../../../components/form-field-view'
import { AmpexMarkButton } from '../../../components/ampex-mark-button'
import { GapCheckReviewSheet } from '../../../components/gap-check-review-sheet'
import { useVoiceSession } from '../../../lib/ai/voice-session'
import { loadDraft, clearDraft, listPendingDrafts } from '../../../lib/ai/voice-drafts'
import { runGapCheck, type GapCheckExtraction } from '../../../lib/forms/gap-check'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { supabase } from '../../../lib/supabase'
import { Order } from '../../../lib/db/models/order'
import { OrderDocument, type AiFieldOriginMap } from '../../../lib/db/models/order-document'
import { getTemplate } from '../../../lib/forms/templates'
import { resolveTemplate } from '../../../lib/forms/resolve'
import { FormValues, FormPrefill, type FormTemplate } from '../../../lib/forms/types'
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

export default function SkjemaScreen() {
  const insets = useSafeAreaInsets()
  const { orderId, templateId } = useLocalSearchParams<{ orderId: string; templateId: string }>()
  // Asynkron oppslag: malen kan være bundlet ('ampex.*') ELLER firmaets egen
  // (form_templates-rad, laget i skjema-editoren) — se lib/forms/resolve.ts.
  const [template, setTemplate] = useState<FormTemplate | undefined>(templateId ? getTemplate(templateId) : undefined)
  useEffect(() => {
    if (!templateId || template?.id === templateId) return
    let mounted = true
    resolveTemplate(templateId).then(t => { if (mounted) setTemplate(t) })
    return () => { mounted = false }
  }, [templateId, template?.id])
  const { lastCompletedSessionId, clearLastCompleted, beginSession } = useVoiceSession()

  const [values, setValues] = useState<FormValues>({})
  const [aiOrigin, setAiOrigin] = useState<AiFieldOriginMap>({})
  const [status, setStatus] = useState<'utkast' | 'fullfort'>('utkast')
  const [completedAt, setCompletedAt] = useState<Date | null>(null)
  const [ready, setReady] = useState(false)
  const [processingAi, setProcessingAi] = useState(false)
  const [review, setReview] = useState<GapCheckExtraction | null>(null)
  const docRef = useRef<OrderDocument | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reviewSessionIdRef = useRef<string | null>(null)

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
        setAiOrigin(doc.aiOriginMap)
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

  // Fant appen en allerede beriket, ikke-gjennomgått draft for nettopp dette skjemaet
  // (f.eks. retry.ts kjørte mens montøren var på en annen skjerm)? Vis gjennomgangen nå.
  useEffect(() => {
    if (!orderId || !templateId) return
    let mounted = true
    ;(async () => {
      const pending = await listPendingDrafts()
      const match = pending.find(d =>
        d.routeContext.screen === 'skjema' && d.routeContext.orderId === orderId &&
        d.routeContext.templateId === templateId && d.status === 'enriched' && d.extraction,
      )
      if (mounted && match) {
        reviewSessionIdRef.current = match.sessionId
        setReview(match.extraction as GapCheckExtraction)
      }
    })()
    return () => { mounted = false }
  }, [orderId, templateId])

  // Vår egen assistent-økt ble nettopp avsluttet — kjør gap-check og vis gjennomgangen.
  useEffect(() => {
    if (!lastCompletedSessionId || !orderId || !templateId) return
    const sessionId = lastCompletedSessionId
    let mounted = true
    ;(async () => {
      const draft = await loadDraft(sessionId)
      if (!draft || draft.routeContext.screen !== 'skjema') return
      if (draft.routeContext.orderId !== orderId || draft.routeContext.templateId !== templateId) return
      clearLastCompleted() // kun når draften faktisk er vår — andre lyttere (ordre-oppslag) kan ellers gå glipp av sin
      setProcessingAi(true)
      const result = await runGapCheck(draft)
      if (!mounted) return
      setProcessingAi(false)
      // ok:false → draften er lagret som 'enrich_failed', retry.ts prøver igjen senere
      // (neste forgrunn/synk-trigger) — ingenting mer å gjøre her, manuell utfylling uendret.
      if (result.ok) {
        reviewSessionIdRef.current = sessionId
        setReview(result.extraction)
      }
    })()
    return () => { mounted = false }
  }, [lastCompletedSessionId, orderId, templateId, clearLastCompleted])

  /** Debouncet autolagring — rad opprettes lazily ved første endring («foreslått» → «utkast») */
  function scheduleSave(next: FormValues) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next), 600)
  }

  async function persist(
    next: FormValues,
    overrides?: Partial<{ status: 'utkast' | 'fullfort'; completedBy: string | null; completedAt: Date | null; aiFieldOrigin: AiFieldOriginMap }>,
  ) {
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
            if (overrides.aiFieldOrigin) d.aiFieldOrigin = JSON.stringify(overrides.aiFieldOrigin)
          }
        })
      } else {
        docRef.current = await database.get<OrderDocument>('order_documents').create(d => {
          d.orderId = orderId
          d.templateId = template.id
          d.templateVersion = template.version
          d.status = overrides?.status ?? 'utkast'
          d.data = json
          d.aiFieldOrigin = overrides?.aiFieldOrigin ? JSON.stringify(overrides.aiFieldOrigin) : null
          d.completedBy = overrides?.completedBy ?? null
          d.completedAt = overrides?.completedAt ?? null
        })
      }
    })
  }

  function onFieldChange(key: string, v: string | Record<string, string>[]) {
    const next = { ...values, [key]: v }
    setValues(next)
    // Manuell redigering av et AI-foreslått felt betyr det ikke lenger er AI-opprinnelse.
    if (aiOrigin[key]) {
      const nextOrigin = { ...aiOrigin }
      delete nextOrigin[key]
      setAiOrigin(nextOrigin)
      scheduleSaveWithOrigin(next, nextOrigin)
    } else {
      scheduleSave(next)
    }
  }

  function scheduleSaveWithOrigin(next: FormValues, nextOrigin: AiFieldOriginMap) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(next, { aiFieldOrigin: nextOrigin }), 600)
  }

  /** "Bruk disse svarene" i gjennomgangen — skriver ALDRI status:'fullfort', kun 'utkast'. */
  async function applyReview(reviewedValues: FormValues, reviewedOrigin: AiFieldOriginMap) {
    const mergedOrigin = { ...aiOrigin, ...reviewedOrigin }
    setValues(reviewedValues)
    setAiOrigin(mergedOrigin)
    setReview(null)
    if (reviewSessionIdRef.current) await clearDraft(reviewSessionIdRef.current)
    reviewSessionIdRef.current = null
    await persist(reviewedValues, { aiFieldOrigin: mergedOrigin })
    syncQuietly()
  }

  /** Forkaster gjennomgangen uten å skrive noe — det som allerede lå lagret (utkast) er uendret. */
  async function discardReview() {
    setReview(null)
    if (reviewSessionIdRef.current) await clearDraft(reviewSessionIdRef.current)
    reviewSessionIdRef.current = null
  }

  /** "Ta opp mer" — lagrer det som er svart så langt (som ved bekreft), starter så en ny opptaksrunde. */
  async function recordMore(reviewedValues: FormValues, reviewedOrigin: AiFieldOriginMap) {
    await applyReview(reviewedValues, reviewedOrigin)
    beginSession()
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

  if (!template) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />
  const readOnly = status === 'fullfort'

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
            {!readOnly && <AmpexMarkButton />}
          </View>
          <Text style={[t.title1, { marginTop: spacing.lg }]}>{template.name}</Text>
          <Text style={[t.footnote, { marginTop: spacing.xs }]}>{template.source}</Text>
        </View>

        {processingAi && (
          <View style={{
            backgroundColor: colors.brandSoft, borderRadius: radius.md,
            marginHorizontal: spacing.screen, marginBottom: spacing.screen,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }}>
            <Text style={[t.footnote, { color: colors.brand }]}>Tenker på svarene dine …</Text>
          </View>
        )}

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
                  {aiOrigin[f.key]?.origin === 'ai' && (
                    <View style={{
                      alignSelf: 'flex-start', marginLeft: spacing.lg, marginTop: spacing.sm,
                      paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.pill,
                      backgroundColor: colors.brandSoft,
                    }}>
                      <Text style={[t.caption, { color: colors.brand }]}>AI-foreslått</Text>
                    </View>
                  )}
                  <FormFieldView field={f} value={values[f.key]} onChange={v => onFieldChange(f.key, v)} readOnly={readOnly} />
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

      {review && (
        <GapCheckReviewSheet
          template={template}
          baseValues={values}
          extraction={review}
          onConfirm={applyReview}
          onRecordMore={recordMore}
          onDiscard={discardReview}
        />
      )}
    </KeyboardAvoidingView>
  )
}

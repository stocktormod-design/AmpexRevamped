import * as FileSystem from 'expo-file-system/legacy'
import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Order } from '../db/models/order'
import { OrderDocument } from '../db/models/order-document'
import { resolveTemplate } from './resolve'
import type { FormField, FormTemplate, FormValues } from './types'
import { isFieldVisible, visibleFields } from './visibility'
import { aiKanFylle } from './ai-fill-rules'
import { callAiVoice } from '../ai/gemini-client'
import { audioSegmentPath, saveDraftMeta, type VoiceDraftSession } from '../ai/voice-drafts'

/** Hardt tak på AI-runder per økt — garanterer at oppfølgingsløkken alltid terminerer. */
export const MAX_GAP_CHECK_ROUNDS = 3

export type GapCheckExtractedField = { key: string; value: string; reason: string }
export type GapCheckFollowUp = { key: string; followUpQuestion: string }
export type GapCheckExtraction = {
  transcript: string
  extracted: GapCheckExtractedField[]
  stillMissing: GapCheckFollowUp[]
  spokenReply: string
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Felt som er required og fortsatt tomt — hopper over info-felt (lagres aldri)
 * og felt som er skjult av en betingelse. Et punkt som ikke vises kan ikke
 * være «manglende»: da ville AI-en spurt montøren om avviksbeskrivelsen på et
 * avvik som ikke finnes.
 */
export function findUnfilledRequired(template: FormTemplate, values: FormValues): FormField[] {
  const out: FormField[] = []
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.type === 'info' || !field.required) continue
      if (!isFieldVisible(field, values)) continue
      const v = values[field.key]
      const isEmpty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
      if (isEmpty) out.push(field)
    }
  }
  return out
}

/** Avviser choice-verdier som ikke er et eksakt match — se plan: "Kritisk forsvar". */
function isValidExtractedField(template: FormTemplate, e: GapCheckExtractedField, after: FormValues): boolean {
  const field = template.sections.flatMap(s => s.fields).find(f => f.key === e.key)
  if (!field) return false
  if (!aiKanFylle(field.type)) return false
  if (!isFieldVisible(field, after)) return false
  if (field.type === 'choice') return (field.choices ?? []).includes(e.value)
  return true
}

function coerceExtraction(raw: Record<string, unknown>, template: FormTemplate, currentValues: FormValues): GapCheckExtraction {
  const extracted = Array.isArray(raw.extracted) ? (raw.extracted as GapCheckExtractedField[]) : []
  const stillMissing = Array.isArray(raw.stillMissing) ? (raw.stillMissing as GapCheckFollowUp[]) : []
  const confidence = raw.confidence

  const wellFormed = extracted.filter(e => e && typeof e.key === 'string' && typeof e.value === 'string')
  // Synlighet vurderes ETTER at rundens egne svar er lagt på. «Det var avvik på
  // jordingen, kabelen var skadet» fyller både bryteren og beskrivelsen i samme
  // sving — måles beskrivelsen mot verdiene FØR runden, ville den blitt kastet.
  const after: FormValues = { ...currentValues, ...Object.fromEntries(wellFormed.map(e => [e.key, e.value])) }

  return {
    transcript: typeof raw.transcript === 'string' ? raw.transcript : '',
    extracted: wellFormed.filter(e => isValidExtractedField(template, e, after)),
    stillMissing: stillMissing.filter(m => m && typeof m.key === 'string' && typeof m.followUpQuestion === 'string'),
    spokenReply: typeof raw.spokenReply === 'string' ? raw.spokenReply : '',
    confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'low',
  }
}

/**
 * Kjører ett gap-check-kall mot siste lydsegment i draften. Kalles både rett etter
 * opptak (fra skjema-ai-flyten) OG fra lib/ai/retry.ts (utsatt — appen kan være
 * lukket eller montøren på en annen skjerm) — leser derfor alt fra lokal
 * WatermelonDB/disk, avhenger ikke av at noen bestemt skjerm er mountet.
 */
export async function runGapCheck(draft: VoiceDraftSession): Promise<{ ok: true; extraction: GapCheckExtraction } | { ok: false }> {
  if (draft.routeContext.screen !== 'skjema' || draft.audioSegments.length === 0) return { ok: false }
  const { orderId, templateId } = draft.routeContext
  const template = await resolveTemplate(templateId)
  if (!template) return { ok: false }

  // Alt herfra kan i prinsippet feile (disk, DB, nettverk) — skal ALDRI henge UI-et
  // eller kaste ut av denne funksjonen. Se lib/ai/gemini-client.ts for samme prinsipp.
  try {
    const order = await database.get<Order>('orders').find(orderId)

    const [existingDoc] = await database
      .get<OrderDocument>('order_documents')
      .query(Q.where('order_id', orderId), Q.where('template_id', templateId))
      .fetch()

    const priorExtraction = draft.extraction as GapCheckExtraction | undefined
    const currentValues: FormValues = {
      ...(existingDoc?.data ? JSON.parse(existingDoc.data) : {}),
      ...Object.fromEntries((priorExtraction?.extracted ?? []).map(e => [e.key, e.value])),
    }

    const latestSegment = draft.audioSegments[draft.audioSegments.length - 1]
    const base64 = await FileSystem.readAsStringAsync(audioSegmentPath(draft, latestSegment), { encoding: 'base64' })

    const context = {
      order: {
        title: order.title,
        description: order.description,
        customerName: order.customerName,
        address: order.address,
        status: order.status,
      },
      template: { id: template.id, name: template.name, source: template.source, reviewNote: template.reviewNote },
      // Kun felt som faktisk vises nå: skjulte punkt skal modellen verken se
      // eller kunne fylle. Blir de synlige av et svar i samme opptak, fanges de
      // opp av neste runde (MAX_GAP_CHECK_ROUNDS).
      // Tabeller og info-punkt holdes UTE av lista modellen ser. Å vise den et
      // felt den ikke får fylle er å invitere til et svar vi må kaste — og til
      // et oppfølgingsspørsmål montøren aldri kan besvare med stemmen.
      fields: visibleFields(template, currentValues)
        .filter(f => aiKanFylle(f.type))
        .map(f => ({ key: f.key, label: f.label, type: f.type, choices: f.choices, unit: f.unit, help: f.help, required: !!f.required })),
      currentValues,
      stillUnfilledKeys: findUnfilledRequired(template, currentValues)
        .filter(f => aiKanFylle(f.type))
        .map(f => f.key),
    }

    const result = await callAiVoice({
      mode: 'gap_check',
      routeContext: 'skjema',
      audio: { base64, mimeType: 'audio/aac' },
      context,
    })

    if (!result.ok) {
      await saveDraftMeta({ ...draft, status: 'enrich_failed', lastError: result.detail }).catch(() => {})
      return { ok: false }
    }

    const extraction = coerceExtraction(result, template, currentValues)
    await saveDraftMeta({ ...draft, status: 'enriched', extraction })
    return { ok: true, extraction }
  } catch (err) {
    await saveDraftMeta({
      ...draft,
      status: 'enrich_failed',
      lastError: err instanceof Error ? err.message : 'ukjent feil',
    }).catch(() => {})
    return { ok: false }
  }
}

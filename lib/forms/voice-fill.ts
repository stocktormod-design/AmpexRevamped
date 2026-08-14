import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Order } from '../db/models/order'
import { OrderDocument, type AiFieldOriginMap } from '../db/models/order-document'
import { findUnfilledRequired } from './gap-check'
import type { FormField, FormPrefill, FormTemplate, FormValues } from './types'

/**
 * Skjemautfylling for Live-assistenten (lib/ai/live-session.ts): modellen fyller
 * feltene interaktivt gjennom samtalen i stedet for én gap-check på et opptak.
 * Skriver til samme order_documents-rad som skjema-skjermen, med samme
 * ai_field_origin-sporing — mennesket verifiserer og fullfører ALLTID i appen
 * (status forblir 'utkast' her; fullføring finnes kun i UI-et, med vilje).
 */

// Samme prefill-semantikk som app/(app)/ordre/skjema.tsx sin prefillValue — én
// avvikende datoformattering her ville sett ut som en AI-feil for brukeren.
function prefillValue(kind: FormPrefill, order: Order): string {
  switch (kind) {
    case 'customerName': return order.customerName ?? ''
    case 'address': return order.address ?? ''
    case 'orderTitle': return order.title
    case 'orderDescription': return order.description ?? order.title
    case 'today': return new Date().toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })
  }
}

export type VoiceFillField = {
  key: string
  label: string
  type: FormField['type']
  choices?: string[]
  required: boolean
  verdi: string | null
}

export type VoiceFillState = {
  felter: VoiceFillField[]
  mangler_required: string[]
}

async function loadDoc(orderId: string, templateId: string): Promise<OrderDocument | null> {
  const [doc] = await database
    .get<OrderDocument>('order_documents')
    .query(Q.where('order_id', orderId), Q.where('template_id', templateId))
    .fetch()
  return doc ?? null
}

function describeState(template: FormTemplate, values: FormValues): VoiceFillState {
  const felter = template.sections.flatMap(s =>
    s.fields
      .filter(f => f.type !== 'info')
      .map(f => ({
        key: f.key,
        label: f.label,
        type: f.type,
        choices: f.choices,
        required: !!f.required,
        verdi: typeof values[f.key] === 'string' ? (values[f.key] as string) : Array.isArray(values[f.key]) ? '(tabell — fylles i appen)' : null,
      })),
  )
  return { felter, mangler_required: findUnfilledRequired(template, values).map(f => f.key) }
}

/** Åpne/opprett utkast for ordre+mal, med prefill fra ordren for tomme felt. */
export async function startVoiceFill(order: Order, template: FormTemplate): Promise<VoiceFillState> {
  const existing = await loadDoc(order.id, template.id)
  if (existing) return describeState(template, existing.data ? JSON.parse(existing.data) : {})

  const values: FormValues = {}
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.prefill && field.type !== 'info') {
        const v = prefillValue(field.prefill, order)
        if (v) values[field.key] = v
      }
    }
  }
  await database.write(async () => {
    await database.get<OrderDocument>('order_documents').create(d => {
      d.orderId = order.id
      d.templateId = template.id
      d.templateVersion = template.version
      d.status = 'utkast'
      d.data = JSON.stringify(values)
      d.aiFieldOrigin = JSON.stringify({})
    })
  })
  return describeState(template, values)
}

export type VoiceFillEntry = { key: string; verdi: string; begrunnelse: string }
export type VoiceFillResult = VoiceFillState & { avvist: { key: string; hvorfor: string }[] }

/**
 * Skriv felter modellen har utledet av samtalen. Avviser ukjente felt, tabell-/
 * info-felt og choice-verdier som ikke matcher alternativene ORDRETT (samme
 * forsvar som gap-check) — modellen får avvisningene tilbake og kan spørre igjen.
 */
export async function applyVoiceFill(order: Order, template: FormTemplate, entries: VoiceFillEntry[]): Promise<VoiceFillResult> {
  const doc = await loadDoc(order.id, template.id)
  if (!doc) {
    return { felter: [], mangler_required: [], avvist: entries.map(e => ({ key: e.key, hvorfor: 'Utkastet finnes ikke — kall start_skjema først.' })) }
  }

  const values: FormValues = doc.data ? JSON.parse(doc.data) : {}
  const origin: AiFieldOriginMap = doc.aiOriginMap
  const fieldByKey = new Map(template.sections.flatMap(s => s.fields).map(f => [f.key, f]))
  const avvist: { key: string; hvorfor: string }[] = []

  for (const entry of entries) {
    const field = fieldByKey.get(entry.key)
    if (!field || field.type === 'info') {
      avvist.push({ key: entry.key, hvorfor: 'Ukjent felt.' })
      continue
    }
    if (field.type === 'table') {
      avvist.push({ key: entry.key, hvorfor: 'Tabellfelt fylles i appen, ikke via tale.' })
      continue
    }
    if (field.type === 'choice' && !(field.choices ?? []).includes(entry.verdi)) {
      avvist.push({ key: entry.key, hvorfor: `Verdien må være ordrett ett av: ${(field.choices ?? []).join(', ')}.` })
      continue
    }
    values[entry.key] = entry.verdi
    origin[entry.key] = { origin: 'ai', reason: entry.begrunnelse || 'Fylt via samtale' }
  }

  await database.write(async () => {
    await doc.update(d => {
      d.data = JSON.stringify(values)
      d.aiFieldOrigin = JSON.stringify(origin)
    })
  })

  return { ...describeState(template, values), avvist }
}

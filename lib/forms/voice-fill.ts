import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Order } from '../db/models/order'
import { OrderDocument, type AiFieldOriginMap } from '../db/models/order-document'
import { findUnfilledRequired } from './gap-check'
import type { FormField, FormPrefill, FormTemplate, FormValues } from './types'
import { pruneHidden, visibleFields } from './visibility'
import { aiKanFylle, avvisningsgrunn } from './ai-fill-rules'

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
  /** Satt når punktet må fylles i appen (tabell). Modellen skal SI det, ikke prøve. */
  fylles_i_appen?: string
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
  // Kun synlige felt: et punkt som er skjult av en betingelse finnes ikke for
  // modellen — verken å spørre om eller å fylle.
  //
  // Tabeller er MED, men merket. Her, i motsetning til i gap-check, er lista
  // også en STATUSRAPPORT modellen leser opp — utelot vi kursfortegnelsen,
  // ville den sagt «skjemaet er ferdig» om et skjema som ikke er det.
  // Info-punkt er derimot ikke spørsmål og hører ikke hjemme i en status.
  const felter = visibleFields(template, values)
    .filter(f => f.type !== 'info')
    .map(f => {
      const rad: VoiceFillField = {
        key: f.key,
        label: f.label,
        type: f.type,
        choices: f.choices,
        required: !!f.required,
        verdi: typeof values[f.key] === 'string' ? (values[f.key] as string) : null,
      }
      if (!aiKanFylle(f.type)) {
        rad.fylles_i_appen = avvisningsgrunn(f.type) ?? 'Fylles i appen.'
        const rader = values[f.key]
        rad.verdi = Array.isArray(rader) ? `${rader.length} rader fylt i appen` : null
      }
      return rad
    })
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

  let values: FormValues = doc.data ? JSON.parse(doc.data) : {}
  const origin: AiFieldOriginMap = doc.aiOriginMap
  const fieldByKey = new Map(template.sections.flatMap(s => s.fields).map(f => [f.key, f]))
  const avvist: { key: string; hvorfor: string }[] = []
  const skrevet: string[] = []

  for (const entry of entries) {
    const field = fieldByKey.get(entry.key)
    if (!field) {
      avvist.push({ key: entry.key, hvorfor: 'Ukjent felt.' })
      continue
    }
    if (!aiKanFylle(field.type)) {
      avvist.push({ key: entry.key, hvorfor: avvisningsgrunn(field.type) ?? 'Feltet fylles i appen.' })
      continue
    }
    if (field.type === 'choice' && !(field.choices ?? []).includes(entry.verdi)) {
      avvist.push({ key: entry.key, hvorfor: `Verdien må være ordrett ett av: ${(field.choices ?? []).join(', ')}.` })
      continue
    }
    values[entry.key] = entry.verdi
    origin[entry.key] = { origin: 'ai', reason: entry.begrunnelse || 'Fylt via samtale' }
    skrevet.push(entry.key)
  }

  // Betingelser vurderes til slutt, ikke underveis: modellen kan sende
  // beskrivelsen før bryteren som gjør den synlig, og rekkefølgen i ett
  // verktøykall er ikke noe den er lovet å styre. Det som fortsatt er skjult
  // etter at ALT er lagt på, er derimot ekte feil — og sies tilbake.
  const beforePrune = values
  values = pruneHidden(template, values)
  for (const key of skrevet) {
    if (key in values) continue
    delete origin[key]
    const field = fieldByKey.get(key)
    avvist.push({
      key,
      hvorfor: `Punktet «${field?.label ?? key}» vises ikke med svarene som er gitt — svar på punktet som styrer det først.`,
    })
  }
  // Rydd også opprinnelsesmerker for felt som ble skjult av EN ANNEN endring.
  for (const key of Object.keys(origin)) if (!(key in values) && key in beforePrune) delete origin[key]

  await database.write(async () => {
    await doc.update(d => {
      d.data = JSON.stringify(values)
      d.aiFieldOrigin = JSON.stringify(origin)
    })
  })

  return { ...describeState(template, values), avvist }
}

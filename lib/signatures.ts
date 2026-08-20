import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from './db'
import { OrderSignature, type SignaturFormal, type SignaturStrok } from './db/models/order-signature'
import { OrderExtra } from './db/models/order-extra'
import { syncQuietly } from './db/sync'
import { supabase } from './supabase'

/**
 * Kundesignaturer. Alt leses/skrives lokalt (regel 2) — signaturen skal virke i
 * en kjeller uten dekning, som er nettopp der den oftest tas.
 */

export function useSignaturer(orderId: string | null | undefined): OrderSignature[] {
  const [rader, setRader] = useState<OrderSignature[]>([])
  useEffect(() => {
    if (!orderId) { setRader([]); return }
    const sub = database.get<OrderSignature>('order_signatures')
      .query(Q.where('order_id', orderId), Q.sortBy('signed_at', Q.desc))
      .observe().subscribe(setRader)
    return () => sub.unsubscribe()
  }, [orderId])
  return rader
}

export type SignaturInput = {
  orderId: string
  purpose: SignaturFormal
  signerName: string
  signerTitle?: string | null
  strokes: SignaturStrok[]
  aspect: number
  note?: string | null
  /** Signerer kunden ET bestemt tilleggsarbeid, settes denne. */
  extraId?: string | null
}

/**
 * Lagre en signatur.
 *
 * Gjelder den et tilleggsarbeid, settes tillegget samtidig til godkjent med
 * `approval_method = 'signert'` — ellers ville vi hatt en signatur som ingen
 * ting peker på, og et tillegg som fortsatt sto som «foreslått».
 */
export async function lagreSignatur(input: SignaturInput): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const brukerId = data.session?.user.id ?? null
  const naa = new Date()

  const tillegg = input.extraId
    ? await database.get<OrderExtra>('order_extras').find(input.extraId).catch(() => null)
    : null

  let id = ''
  await database.write(async () => {
    const rad = await database.get<OrderSignature>('order_signatures').create(s => {
      s.orderId = input.orderId
      s.extraId = input.extraId ?? null
      s.purpose = input.purpose
      s.signerName = input.signerName.trim()
      s.signerTitle = input.signerTitle?.trim() || null
      s.strokes = JSON.stringify(input.strokes)
      s.aspect = input.aspect
      s.note = input.note?.trim() || null
      s.signedAt = naa
      s.signedBy = brukerId
    })
    id = rad.id

    if (tillegg && tillegg.status !== 'godkjent') {
      await tillegg.update(e => {
        e.status = 'godkjent'
        e.approvedBy = input.signerName.trim()
        e.approvedAt = naa
        e.approvalMethod = 'signert'
      })
    }
  })
  syncQuietly()
  return id
}

/**
 * Soft delete (regel #5).
 *
 * En signatur er et bevis, så dette er ikke «rediger» — det er «denne ble tatt
 * ved en feil». Godkjenningen på et eventuelt tilleggsarbeid rulles IKKE
 * tilbake automatisk: at signaturen ble slettet betyr ikke at kunden ombestemte
 * seg, og å endre en godkjenning i stillhet er verre enn å la den stå.
 */
export async function slettSignatur(signatur: OrderSignature): Promise<void> {
  await database.write(async () => { await signatur.markAsDeleted() })
  syncQuietly()
}

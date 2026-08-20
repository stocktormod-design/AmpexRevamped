import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

export type SignaturFormal = 'ferdig' | 'overtakelse' | 'tillegg' | 'annet'

export const formalLabel: Record<SignaturFormal, string> = {
  ferdig: 'Arbeidet er utført',
  overtakelse: 'Overtakelse',
  tillegg: 'Godkjent tilleggsarbeid',
  annet: 'Annet',
}

export const formalForklaring: Record<SignaturFormal, string> = {
  ferdig: 'Kunden bekrefter at arbeidet er utført som avtalt.',
  overtakelse: 'Anlegget er overlevert og tatt i bruk.',
  tillegg: 'Kunden godkjenner arbeid utover det som var bestilt.',
  annet: 'Fri bekreftelse.',
}

/** Ett strøk: punkter i 0–1-koordinater, uavhengig av skjermstørrelse. */
export type SignaturStrok = { points: [number, number][] }

/**
 * Kundesignatur på en ordre.
 *
 * Lagres som VEKTORSTRØK, ikke som bilde. Tre grunner:
 *   1. Signaturen tas ofte i en kjeller uten dekning. Et bilde måtte lastes opp,
 *      og en opplasting som feiler er et bevis som forsvinner.
 *   2. JSON synker gjennom den samme veien som alt annet — ingen egen kode.
 *   3. Den kan rendres skarpt i hvilken som helst størrelse, også på en faktura.
 *
 * `signer_name` er kunden. `signed_by` er vår egen bruker som holdt telefonen —
 * begge trengs: den ene sier hvem som bekreftet, den andre hvem som var til stede.
 */
export class OrderSignature extends Model {
  static table = 'order_signatures'

  @text('order_id') orderId: string
  @text('extra_id') extraId: string | null
  @text('purpose') purpose: SignaturFormal
  @text('signer_name') signerName: string
  @text('signer_title') signerTitle: string | null
  @text('strokes') strokes: string
  /** Bredde/høyde på feltet signaturen ble tegnet i — så den rendres uten å strekkes. */
  @field('aspect') aspect: number
  @text('note') note: string | null
  @date('signed_at') signedAt: Date
  @text('signed_by') signedBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  get punkter(): SignaturStrok[] {
    try {
      const parsed = JSON.parse(this.strokes)
      return Array.isArray(parsed) ? (parsed as SignaturStrok[]) : []
    } catch {
      return []
    }
  }
}

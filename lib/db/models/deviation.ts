import { Model } from '@nozbe/watermelondb'
import { text, field, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Alvorlighet. «Kritisk» skiller seg fra «høy» ved konsekvensen, ikke ved
 * graden: kritisk betyr at arbeidet skal stanses, ikke planlegges.
 */
export type Alvorlighet = 'lav' | 'middels' | 'hoy' | 'kritisk'
export const alvorlighetLabel: Record<Alvorlighet, string> = {
  lav: 'Lav',
  middels: 'Middels',
  hoy: 'Høy',
  kritisk: 'Kritisk',
}

export type AvvikStatus = 'apent' | 'lukket'
export const avvikStatusLabel: Record<AvvikStatus, string> = {
  apent: 'Åpent',
  lukket: 'Lukket',
}

/**
 * Avvik funnet i felt. Egen livssyklus (funnet → lukket med tiltak), derfor
 * egen tabell og ikke et felt på ordren. Databasen håndhever at et lukket
 * avvik HAR et tiltak.
 */
export class Deviation extends Model {
  static table = 'deviations'

  @text('order_id') orderId: string | null
  @text('project_id') projectId: string | null
  @text('document_id') documentId: string | null
  @text('tittel') tittel: string
  @text('beskrivelse') beskrivelse: string | null
  @text('alvorlighet') alvorlighet: Alvorlighet
  @text('status') status: AvvikStatus
  @date('frist_at') fristAt: Date | null
  @text('sted') sted: string | null
  @text('funnet_av') funnetAv: string | null
  @date('funnet_at') funnetAt: Date
  @text('tiltak') tiltak: string | null
  @text('lukket_av') lukketAv: string | null
  @date('lukket_at') lukketAt: Date | null
  @field('foto_nokler') fotoNoklerJson: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date

  /** R2-nøkler til bilder. Tom liste når ingen er knyttet til. */
  get fotoNokler(): string[] {
    if (!this.fotoNoklerJson) return []
    try {
      const v = JSON.parse(this.fotoNoklerJson)
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }

  /** Forfalt: åpent OG over fristen. Regnes ut, lagres aldri. */
  get erForfalt(): boolean {
    return this.status === 'apent' && !!this.fristAt && this.fristAt.getTime() < Date.now()
  }
}

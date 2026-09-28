import { Model } from '@nozbe/watermelondb'
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators'

/**
 * Ett punkt i firmaets internkontrollsystem (2026-09-13). Skrives av kontoret
 * (`desktop/src/lib/ik-lager.ts`); montørappen LESER bare, offline som alt
 * annet. Kolonnene speiler `public.ik_punkter` minus de synken skjuler.
 */
export class IkPunkt extends Model {
  static table = 'ik_punkter'

  @text('nummer') nummer: string
  @text('tittel') tittel: string
  @text('hjemmel') hjemmel: string | null
  @text('formal') formal: string | null
  /** Historisk: rutinene ligger nå i `ik_rutiner`. Vises når punktet ikke har rutiner. */
  @text('innhold') innhold: string | null
  @text('ansvarlig') ansvarlig: string | null
  @text('status') status: 'utkast' | 'vedtatt' | 'utgatt'
  @field('gjennomgang_intervall_mnd') gjennomgangIntervallMnd: number
  /** ISO-dato («2026-03-01») — Postgres `date` kommer som tekst. */
  @text('sist_gjennomgatt') sistGjennomgatt: string | null
  @date('vedtatt_at') vedtattAt: Date | null
  @text('vedtatt_av') vedtattAv: string | null
  @field('gjeldende_versjon') gjeldendeVersjon: number
  @field('sort_order') sortOrder: number
  @text('created_by') createdBy: string | null
  @readonly @date('created_at') createdAt: Date
  @readonly @date('updated_at') updatedAt: Date
}

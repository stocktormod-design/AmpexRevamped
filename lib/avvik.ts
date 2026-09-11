/**
 * Avvik — funn i felt som må lukkes.
 *
 * FUNKSJON UTEN SKJERM. Et UI trenger bare `meldAvvik(...)`, `lukkAvvik(...)`
 * og hookene under; hvordan lista ser ut, om den er en fane eller et kort på
 * ordren, er UI-ets valg.
 *
 * Hvorfor dette ikke er en oppgave (`tasks`): en oppgave er noe noen skal
 * GJØRE, et avvik er noe som ER feil. Det har alvorlighetsgrad, det skal
 * kunne dokumenteres i ettertid (internkontroll), og det lukkes med en
 * beskrivelse av tiltaket — ikke med en avhuking. Blandes de, mister man
 * nettopp det et tilsyn spør etter.
 */
import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from './db'
import { Deviation, type Alvorlighet, type AvvikStatus } from './db/models/deviation'
import { supabase } from './supabase'

export type { Alvorlighet, AvvikStatus }
export { alvorlighetLabel, avvikStatusLabel } from './db/models/deviation'

/** Rekkefølge for visning: det farligste først, uansett dato. */
export const ALVORLIGHET_VEKT: Record<Alvorlighet, number> = {
  kritisk: 0, hoy: 1, middels: 2, lav: 3,
}

export type AvvikInn = {
  tittel: string
  beskrivelse?: string | null
  alvorlighet?: Alvorlighet
  /** Hvor det ble funnet — minst én av disse bør settes. */
  ordreId?: string | null
  prosjektId?: string | null
  dokumentId?: string | null
  sted?: string | null
  frist?: Date | null
  /** R2-nøkler fra `lib/foto.ts`. */
  fotoNokler?: string[]
}

/** Melder et avvik. Alt annet enn tittelen er valgfritt — i felt teller sekunder. */
export async function meldAvvik(inn: AvvikInn): Promise<Deviation> {
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  return database.write(async () =>
    database.get<Deviation>('deviations').create(d => {
      d.tittel = inn.tittel.trim()
      d.beskrivelse = inn.beskrivelse?.trim() || null
      d.alvorlighet = inn.alvorlighet ?? 'middels'
      d.status = 'apent'
      d.orderId = inn.ordreId ?? null
      d.projectId = inn.prosjektId ?? null
      d.documentId = inn.dokumentId ?? null
      d.sted = inn.sted?.trim() || null
      d.fristAt = inn.frist ?? null
      d.funnetAv = bruker
      d.funnetAt = new Date()
      d.fotoNoklerJson = JSON.stringify(inn.fotoNokler ?? [])
    }),
  )
}

/** Kastes når noen prøver å lukke uten å si hva som ble gjort. */
export class ManglerTiltak extends Error {
  constructor() {
    super('Et avvik lukkes med et tiltak — beskriv hva som ble gjort.')
    this.name = 'ManglerTiltak'
  }
}

/**
 * Lukker et avvik. Tiltaket er PÅKREVD, og det er ikke en UI-regel: databasen
 * har samme sjekk (`deviations_lukking_ck`). Uten den ville et avvik lukket
 * fra en annen klient sluppet gjennom, og «lukket» ville ikke betydd noe.
 */
export async function lukkAvvik(avvik: Deviation, tiltak: string): Promise<void> {
  const rent = tiltak.trim()
  if (!rent) throw new ManglerTiltak()
  const bruker = (await supabase.auth.getUser()).data.user?.id ?? null
  await database.write(async () =>
    avvik.update(d => {
      d.tiltak = rent
      d.status = 'lukket'
      d.lukketAv = bruker
      d.lukketAt = new Date()
    }),
  )
}

/** Gjenåpner et lukket avvik. Tiltaket blir stående — det ER historikken. */
export async function gjenapneAvvik(avvik: Deviation): Promise<void> {
  await database.write(async () =>
    avvik.update(d => {
      d.status = 'apent'
      d.lukketAt = null
      d.lukketAv = null
    }),
  )
}

export async function oppdaterAvvik(avvik: Deviation, endring: Partial<AvvikInn>): Promise<void> {
  await database.write(async () =>
    avvik.update(d => {
      if (endring.tittel !== undefined) d.tittel = endring.tittel.trim()
      if (endring.beskrivelse !== undefined) d.beskrivelse = endring.beskrivelse?.trim() || null
      if (endring.alvorlighet !== undefined) d.alvorlighet = endring.alvorlighet
      if (endring.sted !== undefined) d.sted = endring.sted?.trim() || null
      if (endring.frist !== undefined) d.fristAt = endring.frist ?? null
      if (endring.fotoNokler !== undefined) d.fotoNoklerJson = JSON.stringify(endring.fotoNokler)
    }),
  )
}

/** Soft delete (regel 5) — for feilmeldte avvik, ikke for lukking. */
export async function slettAvvik(avvik: Deviation): Promise<void> {
  await database.write(async () => avvik.markAsDeleted())
}

/* ── Lesing ────────────────────────────────────────────────────────────────── */

function sorter(rader: Deviation[]): Deviation[] {
  return [...rader].sort((a, b) => {
    const vekt = ALVORLIGHET_VEKT[a.alvorlighet] - ALVORLIGHET_VEKT[b.alvorlighet]
    if (vekt !== 0) return vekt
    // Deretter frist: det som forfaller først, først. Uten frist sist.
    const af = a.fristAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bf = b.fristAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (af !== bf) return af - bf
    return b.funnetAt.getTime() - a.funnetAt.getTime()
  })
}

function useAvvikSpoerring(betingelser: unknown[], nokler: unknown[]): Deviation[] {
  const [rader, setRader] = useState<Deviation[]>([])
  useEffect(() => {
    const sub = database
      .get<Deviation>('deviations')
      .query(...(betingelser as never[]))
      .observe()
      .subscribe(r => setRader(sorter(r)))
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, nokler)
  return rader
}

/** Åpne avvik i hele firmaet — det farligste øverst. */
export function useApneAvvik(): Deviation[] {
  return useAvvikSpoerring([Q.where('status', 'apent')], [])
}

/** Alle avvik på én ordre, åpne som lukkede. */
export function useAvvikPaaOrdre(orderId: string | null | undefined): Deviation[] {
  return useAvvikSpoerring(
    [Q.where('order_id', orderId ?? '__ingen__')],
    [orderId],
  )
}

export function useAvvikPaaProsjekt(projectId: string | null | undefined): Deviation[] {
  return useAvvikSpoerring(
    [Q.where('project_id', projectId ?? '__ingen__')],
    [projectId],
  )
}

/** Ett avvik, reaktivt. */
export function useEttAvvik(id: string | null | undefined): Deviation | null {
  const [rad, setRad] = useState<Deviation | null>(null)
  useEffect(() => {
    if (!id) { setRad(null); return }
    const sub = database.get<Deviation>('deviations').findAndObserve(id).subscribe(
      r => setRad(r),
      () => setRad(null),
    )
    return () => sub.unsubscribe()
  }, [id])
  return rad
}

/**
 * Tall til en oversikt: åpne, forfalte og kritiske. Regnes ut, lagres aldri —
 * en rad som må skrives om ved midnatt trenger en jobb ingen har skrevet.
 */
export function avviksTall(rader: Deviation[]): { apne: number; forfalte: number; kritiske: number } {
  const apne = rader.filter(r => r.status === 'apent')
  return {
    apne: apne.length,
    forfalte: apne.filter(r => r.erForfalt).length,
    kritiske: apne.filter(r => r.alvorlighet === 'kritisk').length,
  }
}

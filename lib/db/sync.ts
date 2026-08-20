import { useEffect, useState } from 'react'
import { synchronize } from '@nozbe/watermelondb/sync'
import { database } from './index'
import { supabase } from '../supabase'
import { etterFeil, etterVellykket, synkStatus, TOM_HELSE, type SynkHelse, type SynkStatus } from './sync-helse'

let inFlight: Promise<void> | null = null

/** Nøkkel i WatermelonDBs local_storage — overlever appstart, synkes ikke. */
const HELSE_NOKKEL = 'synk_helse'

/** Lyttere på helsa, så «Meg» kan vise den uten å spørre på timer (regel 8). */
const lyttere = new Set<(h: SynkHelse) => void>()
let helseCache: SynkHelse | null = null

async function lesHelse(): Promise<SynkHelse> {
  if (helseCache) return helseCache
  const lagret = (await database.localStorage.get(HELSE_NOKKEL)) as SynkHelse | undefined
  helseCache = lagret ?? TOM_HELSE
  return helseCache
}

async function skrivHelse(h: SynkHelse) {
  helseCache = h
  await database.localStorage.set(HELSE_NOKKEL, h)
  lyttere.forEach(f => f(h))
}

/**
 * Usynlig synk (regel #2): kalles ved innlogging, app-til-forgrunn og
 * nettverksretur — aldri fra en knapp, aldri på timer.
 * Protokoll: WatermelonDB pull/push mot Postgres-RPC (watermelon_pull/push),
 * RLS scoper alt til brukerens firma. Last-write-wins.
 */
export function sync(): Promise<void> {
  // Dedup: en synk som alt kjører gjenbrukes i stedet for å køes
  if (inFlight) return inFlight
  inFlight = doSync().finally(() => { inFlight = null })
  return inFlight
}

async function doSync() {
  try {
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        const { data, error } = await supabase.rpc('watermelon_pull', {
          last_pulled_at: lastPulledAt ?? 0,
        })
        if (error) throw error
        return { changes: data.changes, timestamp: data.timestamp }
      },
      pushChanges: async ({ changes, lastPulledAt }) => {
        const { error } = await supabase.rpc('watermelon_push', {
          changes,
          last_pulled_at: lastPulledAt,
        })
        if (error) throw error
      },
    })
    await skrivHelse(etterVellykket(Date.now()))
  } catch (err) {
    // Helsa skrives før feilen kastes videre — den som ba om synken kan velge å
    // svelge feilen (syncQuietly gjør det), men sporet skal finnes uansett.
    const melding = err instanceof Error ? err.message : String(err)
    await skrivHelse(etterFeil(await lesHelse(), melding, Date.now())).catch(() => {})
    throw err
  }
}

/** Synk som aldri kaster — for triggere der feil bare betyr «prøver igjen senere». */
export function syncQuietly() {
  sync().catch(err => console.log('[sync] utsatt:', err?.message ?? err))
}

/**
 * Statusen «Meg» viser. Ingen polling: helsa oppdateres når en synk faktisk har
 * skjedd, og klokkeslettet regnes ut på nytt hver gang skjermen rendres.
 */
export function useSynkStatus(): SynkStatus | null {
  const [helse, setHelse] = useState<SynkHelse | null>(null)
  useEffect(() => {
    let levende = true
    lesHelse().then(h => { if (levende) setHelse(h) })
    lyttere.add(setHelse)
    return () => { levende = false; lyttere.delete(setHelse) }
  }, [])
  return helse ? synkStatus(helse, Date.now()) : null
}

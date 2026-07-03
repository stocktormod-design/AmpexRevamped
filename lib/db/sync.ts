import { synchronize } from '@nozbe/watermelondb/sync'
import { database } from './index'
import { supabase } from '../supabase'

let inFlight: Promise<void> | null = null

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
}

/** Synk som aldri kaster — for triggere der feil bare betyr «prøver igjen senere». */
export function syncQuietly() {
  sync().catch(err => console.log('[sync] utsatt:', err?.message ?? err))
}

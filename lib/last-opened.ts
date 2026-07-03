import { useEffect, useSyncExternalStore } from 'react'
import { database } from './db'

/**
 * «Sist innom»-sporing for ordre. Bevisst i WatermelonDB localStorage
 * (lokal KV, aldri synket) — å legge kolonnen i orders-skjemaet ville
 * pushet den gjennom synk-protokollen og krevd serverendring.
 */
const KEY = 'order_last_opened_v1'
const MAX = 30

let cache: Record<string, number> = {}
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(l => l())
}

async function load() {
  if (loaded) return
  loaded = true
  const stored = (await database.localStorage.get(KEY)) as Record<string, number> | undefined
  if (stored) {
    cache = stored
    emit()
  }
}

export function markOrderOpened(id: string) {
  const next = { ...cache, [id]: Date.now() }
  // Behold bare de MAX sist åpnede så lagringen ikke vokser evig
  cache = Object.fromEntries(
    Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, MAX),
  )
  database.localStorage.set(KEY, cache)
  emit()
}

/** Reaktivt kart ordreId → epoch ms for når den sist ble åpnet */
export function useLastOpened(): Record<string, number> {
  useEffect(() => { load() }, [])
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
    () => cache,
  )
}

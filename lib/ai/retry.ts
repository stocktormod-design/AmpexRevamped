import { listPendingDrafts, type VoiceDraftSession, type VoiceRouteContext } from './voice-drafts'

type DraftHandler = (draft: VoiceDraftSession) => Promise<unknown>

const handlers: Partial<Record<VoiceRouteContext['screen'], DraftHandler>> = {}

/**
 * Fase 1/2/3 registrerer sin egen berikelses-logikk her (f.eks. gap-check for
 * 'skjema'-drafts) — retry.ts selv vet ingenting om skjemafelt eller Gemini-modus,
 * kun at en pending draft finnes og hvilken skjerm den ble startet fra.
 */
export function registerDraftHandler(screen: VoiceRouteContext['screen'], handler: DraftHandler) {
  handlers[screen] = handler
}

/**
 * Kalt fra app/_layout.tsx sine eksisterende syncQuietly()-triggerpunkt
 * (sesjonsgjenoppretting + AppState-forgrunn) — ingen ny listener, ingen polling.
 * Svelger alle feil selv, akkurat som syncQuietly (se lib/db/sync.ts): en mislykket
 * berikelse skal aldri kræsje appen, bare prøves igjen neste trigger.
 */
export async function retryPendingAiEnrichment(): Promise<void> {
  const pending = await listPendingDrafts()
  for (const draft of pending) {
    const handler = handlers[draft.routeContext.screen]
    if (!handler) continue
    try {
      await handler(draft)
    } catch (err) {
      console.warn('[ai-retry] utsatt:', err)
    }
  }
}

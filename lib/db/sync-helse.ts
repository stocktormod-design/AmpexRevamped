/**
 * ── Synkhelse ───────────────────────────────────────────────────────────────
 *
 * Regel 2 sier at synken skal være USYNLIG: ingen synk-knapp, ingen spinner,
 * ingen «trykk her for å laste opp». Det står ved lag. Men usynlig og STUM er
 * ikke det samme, og forskjellen kostet oss dyrt: åtte rader med base62-id
 * blokkerte hele pushen i ukevis, og det eneste sporet var en console.log
 * ingen leser fra en telefon i en kjeller.
 *
 * Skillet som gjør dette brukbart er mellom å være UTEN NETT og å bli AVVIST.
 * Uten nett er normaltilstanden i en kjeller — det skal ikke varsles, appen er
 * bygget for det. Å bli avvist av serveren tre ganger på rad er en defekt: den
 * fjerde gangen går heller ikke bra, og noen må vite det.
 *
 * Ren logikk, ingen WatermelonDB — lib/db/sync.ts eier lagringen.
 */

export type SynkHelse = {
  /** Siste gang en full rundtur gikk gjennom. */
  sistVellykket: number | null
  /** Siste gang vi prøvde, uansett utfall. */
  sisteForsok: number | null
  /** Avvisninger på rad. Nullstilles av et vellykket forsøk OG av manglende nett. */
  feilPaaRad: number
  sisteFeil: string | null
}

export const TOM_HELSE: SynkHelse = { sistVellykket: null, sisteForsok: null, feilPaaRad: 0, sisteFeil: null }

/** Tre avvisninger på rad. Den fjerde kommer til å gå like dårlig. */
export const BLOKKERT_ETTER = 3

const NETTVERK = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'internet connection appears to be offline',
  'network error',
  'timed out',
  'timeout',
  'econnrefused',
  'enotfound',
  'econnreset',
]

/**
 * Er dette bare manglende nett? Da er det ikke en feil, det er en kjeller.
 * Vi gjetter på meldingen fordi det er det Supabase-klienten gir oss — men vi
 * gjetter i FORSIKTIG retning: kjenner vi ikke igjen meldingen, regnes den som
 * en avvisning. Å overse en ekte defekt er dyrere enn å telle en nettverksfeil.
 */
export function erNettverksfeil(melding: string): boolean {
  const m = melding.toLowerCase()
  return NETTVERK.some(n => m.includes(n))
}

export function etterVellykket(naa: number): SynkHelse {
  return { sistVellykket: naa, sisteForsok: naa, feilPaaRad: 0, sisteFeil: null }
}

export function etterFeil(forrige: SynkHelse, melding: string, naa: number): SynkHelse {
  if (erNettverksfeil(melding)) {
    // Teller IKKE opp. Ellers ville en uke i en kjeller sett ut som en defekt.
    return { ...forrige, sisteForsok: naa }
  }
  return { ...forrige, sisteForsok: naa, feilPaaRad: forrige.feilPaaRad + 1, sisteFeil: melding }
}

export type SynkStatus = { nivaa: 'ok' | 'venter' | 'blokkert'; tekst: string; detalj: string | null }

/**
 * Hva brukeren skal se, hvis noe. `nivaa: 'ok'` er den stille tilstanden — den
 * vises som én linje, ikke som et varsel.
 */
export function synkStatus(helse: SynkHelse, naa: number): SynkStatus {
  if (helse.feilPaaRad >= BLOKKERT_ETTER) {
    return {
      nivaa: 'blokkert',
      tekst: 'Synken står',
      detalj: helse.sisteFeil,
    }
  }
  if (helse.sistVellykket === null) {
    return { nivaa: 'venter', tekst: 'Ikke synkronisert ennå', detalj: null }
  }
  const timer = (naa - helse.sistVellykket) / 3_600_000
  if (timer >= 24) {
    const dager = Math.floor(timer / 24)
    return {
      nivaa: 'venter',
      tekst: dager === 1 ? 'Sist synkronisert i går' : `Sist synkronisert for ${dager} dager siden`,
      detalj: null,
    }
  }
  return { nivaa: 'ok', tekst: 'Alt er lagret og sendt', detalj: null }
}

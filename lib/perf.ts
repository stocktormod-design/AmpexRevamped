/**
 * TRYKK-KØEN — hvor lenge et trykk lå og ventet på JS-tråden.
 *
 * Bakgrunn (Tormod 2026-08-30: «fiks raskere trykk på ui, den er litt delayed»).
 * En berøring går native → JS-tråd. Er JS-tråden opptatt med å rendre, ligger
 * trykket i kø til den er ledig, og BÅDE haptikken, skaleringen og handlingen
 * kommer for sent. Det føles som treghet, men er kø.
 *
 * Køen kan ikke måles fra JS-tråden alene — den som er forsinket kan ikke måle
 * sin egen forsinkelse. Derfor tar `components/pressable.tsx` tiden to steder:
 * på UI-tråden i det fingeren treffer (Gesture Handler ser berøringen med én
 * gang), og på JS-tråden når `onPressIn` endelig kjører. Differansen ER
 * forsinkelsen. Begge trådene er Hermes-runtimes i samme prosess og deler
 * `performance.now()`-basis, så differansen er direkte sammenlignbar.
 *
 * Kun i __DEV__: i release skal ingenting av dette koste noe.
 */

const TAK = 60

let koer: number[] = []

/** Kalles fra Pressable med målt kø i ms. */
export function noterKo(ms: number) {
  if (!__DEV__) return
  // Negativt eller absurd = klokkene lot seg ikke sammenligne. Kast heller
  // målingen enn å pynte statistikken med søppel.
  if (!(ms >= 0) || ms > 5000) return
  koer.push(ms)
  if (koer.length > TAK) koer.shift()
}

export type TrykkProve = {
  antall: number
  median: number
  p90: number
  verst: number
}

export function trykkProve(): TrykkProve | null {
  if (koer.length === 0) return null
  const s = [...koer].sort((a, b) => a - b)
  const ved = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return {
    antall: s.length,
    median: Math.round(ved(0.5)),
    p90: Math.round(ved(0.9)),
    verst: Math.round(s[s.length - 1]),
  }
}

export function nullstillTrykk() {
  koer = []
}

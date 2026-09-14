import { useSyncExternalStore } from 'react'

/**
 * Temaet: hvilken av de to palettene i `styles.css` som gjelder.
 *
 * `hvit` er standard (regel 9 i CLAUDE.md, byttet 2026-09-14). `papir` er
 * kontorets opprinnelige papir-og-kobber, beholdt som valg fordi den satt i
 * øynene på dem som har brukt kontoret siden august.
 *
 * Valget er per maskin, ikke per bruker, og ligger derfor i localStorage og
 * ikke i `profiles`: kontor-PC-en deles gjerne, og skjermen er den samme for
 * den som logger inn etterpå. `index.html` leser samme nøkkel FØR React er
 * lastet, så siden ikke blinker hvitt og så brunt.
 */

export type Tema = 'hvit' | 'papir'

export const TEMAER: { id: Tema; navn: string; om: string }[] = [
  { id: 'hvit', navn: 'Hvit', om: 'Hvit grunn, sort blekk. Standard.' },
  { id: 'papir', navn: 'Papir', om: 'Kremet papir og kobber, brun sidemeny.' },
]

/** Samme nøkkel står i `index.html`. Endres den ene, må den andre. */
const NOKKEL = 'ampex.kontor.tema'

/** Fargen nettleseren maler fanelinja med — følger kromet. */
const FANEFARGE: Record<Tema, string> = { hvit: '#F5F5F7', papir: '#211C15' }

function erTema(v: unknown): v is Tema {
  return v === 'hvit' || v === 'papir'
}

export function lesTema(): Tema {
  try {
    const v = localStorage.getItem(NOKKEL)
    return erTema(v) ? v : 'hvit'
  } catch {
    return 'hvit'
  }
}

const lyttere = new Set<() => void>()

/** Skriv temaet til dokumentet. `hvit` er standard og skrives som fravær. */
function bruk(t: Tema) {
  const rot = document.documentElement
  if (t === 'hvit') delete rot.dataset.tema
  else rot.dataset.tema = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', FANEFARGE[t])
}

export function settTema(t: Tema) {
  try { localStorage.setItem(NOKKEL, t) } catch { /* privat modus — gjelder da bare økta */ }
  bruk(t)
  for (const l of lyttere) l()
}

/** Temaet som React-tilstand. Én kilde (localStorage), alle lesere oppdateres. */
export function useTema(): [Tema, (t: Tema) => void] {
  const tema = useSyncExternalStore(
    lytt => { lyttere.add(lytt); return () => { lyttere.delete(lytt) } },
    lesTema,
    () => 'hvit' as Tema,
  )
  return [tema, settTema]
}

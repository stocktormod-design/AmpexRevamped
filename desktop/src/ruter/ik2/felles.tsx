import { ChevronRight } from 'lucide-react'

/**
 * Det IK v2-sidene deler: stien i hash-en, datoformatet, lista-raden og
 * lesering. Egen fil så klossene i `Oversikt.tsx` kan brukes uten å importere
 * hele ruta.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

export function dato(v: string | Date | null | undefined): string {
  if (!v) return '–'
  return DATO.format(typeof v === 'string' ? new Date(v) : v)
}

export type Ansatt = { id: string; full_name: string; role: string }

/**
 * De som skal lese håndboka og ha FSE. Regnskapsføreren står utenfor: hen
 * arbeider ikke på eller nær anlegg, og å telle hen med ville gjort
 * «i orden» umulig i et firma med ekstern regnskapsfører.
 */
export function feltfolk(ansatte: Ansatt[]): Ansatt[] {
  return ansatte.filter(a => a.role !== 'regnskapsforer')
}

/** Stien i hash-en: `#/ik2/<kapittel>/<punkt>/<rutine>`. */
export function lesSti(): string[] {
  return window.location.hash.replace(/^#\//, '').split('/').filter(Boolean).slice(1)
}

export function gaa(...sti: (string | null | undefined)[]) {
  window.location.hash = ['#/ik2', ...sti.filter(Boolean)].join('/')
}

/** En rad i en liste: tittel, litt til høyre, hele raden trykkbar. */
export function Rad({ nr, tittel, mer, hoyre, under, onClick }: {
  nr?: string
  tittel: string
  mer?: string
  hoyre?: React.ReactNode
  under?: string
  onClick: () => void
}) {
  return (
    <button className="ik2-rad" onClick={onClick}>
      {nr ? <span className="ik2-rad-nr">{nr}</span> : null}
      <span className="ik2-rad-tekst">
        <span className="ik2-rad-tittel">{tittel}</span>
        {under ? <span className="ik2-rad-under">{under}</span> : null}
      </span>
      {mer ? <span className="ik2-rad-mer">{mer}</span> : null}
      {hoyre}
      <ChevronRight size={16} strokeWidth={2} className="ik2-rad-pil" />
    </button>
  )
}

/**
 * Liten ring for «lest av X av Y», som Vantas «Personnel acceptance». Sort
 * blekk på grå — farge er semantikk, og fullt lest er ikke en alarm.
 */
export function Ring({ av, totalt, str = 16 }: { av: number; totalt: number; str?: number }) {
  const r = (str - 3) / 2
  const omkrets = 2 * Math.PI * r
  const andel = totalt > 0 ? Math.min(1, av / totalt) : 0
  return (
    <svg width={str} height={str} viewBox={`0 0 ${str} ${str}`} className="ik2-ring" aria-hidden>
      <circle cx={str / 2} cy={str / 2} r={r} className="ik2-ring-bak" />
      {andel > 0 ? (
        <circle cx={str / 2} cy={str / 2} r={r} className="ik2-ring-fyll"
          strokeDasharray={`${omkrets * andel} ${omkrets}`}
          transform={`rotate(-90 ${str / 2} ${str / 2})`} />
      ) : null}
    </svg>
  )
}

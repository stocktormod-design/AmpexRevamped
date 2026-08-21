import { erForfalt, fullstendighet } from '@delt/ik/skjelett'
import { supabase } from '@/supabase'
import { hentPunkter } from '@/lib/ik-lager'

/**
 * Tallene til forsiden.
 *
 * Ett oppslag per område, alle parallelt, og bare det som trengs for å svare på
 * ett spørsmål: **hva må noen gjøre noe med i dag?**
 *
 * Forsiden regner ikke penger. Fakturagrunnlaget må hentes per ordre og er
 * dyrt; å gjøre det for hele porteføljen for å vise ett tall på en forside ville
 * gjort at flaten tok flere sekunder å åpne. Kroner står på ordredetaljen, der
 * de hører hjemme.
 */

export type Oppgave = {
  id: string
  /** Hva som venter, i klartekst. */
  tekst: string
  /** Hvor mange det gjelder. 0 skjules — en forside skal ikke liste opp det som er i orden. */
  antall: number
  /** Hash-ruta som løser den. */
  rute: string
  /** Verdt å se på nå. Farger linja i kobber. */
  haster: boolean
}

export type Oversikt = {
  ordre: { mottatt: number; pagaar: number; fakturaklar: number }
  tilbudUte: number
  tilbudUtlopt: number
  timerDenneUka: number
  ik: { kreves: number; paPlass: number; forfalte: number; opprettet: boolean } | null
  oppgaver: Oppgave[]
}

function tell<T>(liste: T[], pred: (x: T) => boolean): number {
  return liste.filter(pred).length
}

export async function hentOversikt(kanSeIk: boolean, kanSeTilbud: boolean): Promise<Oversikt> {
  const uke = new Date()
  uke.setDate(uke.getDate() - 7)

  const [o, q, t, punkter] = await Promise.all([
    supabase.from('orders').select('status').is('deleted_at', null),
    kanSeTilbud
      ? supabase.from('quotes').select('status,valid_until').is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('time_entries').select('hours').gte('date', uke.toISOString()).is('deleted_at', null),
    kanSeIk ? hentPunkter().catch(() => []) : Promise.resolve([]),
  ])

  const forste = [o, q, t].find(r => r.error)
  if (forste?.error) throw new Error(forste.error.message)

  const ordrer = (o.data ?? []) as { status: string }[]
  const tilbud = (q.data ?? []) as { status: string; valid_until: string | null }[]
  const timer = (t.data ?? []) as { hours: number }[]

  const naa = new Date()
  const mottatt = tell(ordrer, x => x.status === 'mottatt')
  const pagaar = tell(ordrer, x => x.status === 'pagaar')
  const fakturaklar = tell(ordrer, x => x.status === 'fakturaklar')

  // Et sendt tilbud som gikk ut på dato er ikke lenger «ute» — det er tapt med
  // mindre noen ringer. Skillet er hele grunnen til at datoen finnes.
  const sendte = tilbud.filter(x => x.status === 'sendt')
  const utlopt = tell(sendte, x => !!x.valid_until && new Date(x.valid_until) < naa)
  const ute = sendte.length - utlopt

  const ikStatus = punkter.length
    ? fullstendighet(punkter.map(p => ({
        nummer: p.nummer, innhold: p.innhold, status: p.status, maaVaereSkriftlig: p.maaVaereSkriftlig,
      })))
    : null
  const forfalte = tell(punkter, p => erForfalt(p.sist_gjennomgatt, p.gjennomgang_intervall_mnd, naa))

  const oppgaver: Oppgave[] = [
    { id: 'fakturaklar', tekst: 'ordrer står klare til fakturering', antall: fakturaklar, rute: '#/ordre', haster: true },
    { id: 'mottatt', tekst: 'ordrer er ikke planlagt', antall: mottatt, rute: '#/ordre', haster: false },
    { id: 'utlopt', tekst: 'tilbud har gått ut på dato', antall: kanSeTilbud ? utlopt : 0, rute: '#/tilbud', haster: true },
    { id: 'ik-forfalt', tekst: 'internkontrollpunkter er forfalt til gjennomgang', antall: forfalte, rute: '#/ik', haster: true },
    {
      id: 'ik-mangler',
      tekst: 'lovpålagte internkontrollpunkter mangler ennå',
      antall: ikStatus ? ikStatus.kreves - ikStatus.pa_plass : 0,
      rute: '#/ik',
      haster: false,
    },
  ].filter(x => x.antall > 0)

  return {
    ordre: { mottatt, pagaar, fakturaklar },
    tilbudUte: ute,
    tilbudUtlopt: utlopt,
    timerDenneUka: timer.reduce((n, x) => n + (x.hours ?? 0), 0),
    ik: ikStatus
      ? { kreves: ikStatus.kreves, paPlass: ikStatus.pa_plass, forfalte, opprettet: true }
      : kanSeIk
        ? { kreves: 5, paPlass: 0, forfalte: 0, opprettet: false }
        : null,
    oppgaver,
  }
}

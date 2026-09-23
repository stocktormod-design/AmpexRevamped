/**
 * «Er internkontrollen i orden, og hva må gjøres nå?» — svaret forsida på
 * IK v2 åpner med. Ren logikk, ingen database. Selvtestes i
 * `npm run verify:ik-tilstand`.
 *
 * Mønsteret er lånt fra compliance-verktøyene (Vanta, Drata; se
 * docs/IK_KONKURRENTER.md): ett tall brutt ned i tellbare enheter, og en kø
 * med neste handling. Reglene er våre egne og norske:
 *
 *   - Et kapittel er **i orden** når det har skrevne rutiner, er vedtatt, ikke
 *     har passert gjennomgangsfristen og er lest av alle som skal lese det.
 *     Ingen delpoeng: tre av fire er «ikke i orden», og manglene sier hvorfor.
 *   - Internkontrollforskriften § 5 tredje ledd: nr. 4–8 SKAL være skriftlige.
 *     De teller for seg, og står først i køen når de mangler.
 *   - FSE § 7: opplæring i sikkerhet og førstehjelp hvert år for alle som
 *     arbeider på eller nær elektriske anlegg. Utgått eller manglende FSE er
 *     noe som må gjøres NÅ, ikke en statistikk.
 *   - Avvik over frist og kritiske avvik står i køen; resten er tellere.
 */

import { erForfalt, nesteGjennomgang } from './skjelett'

export type KapittelInn = {
  id: string
  nummer: string
  tittel: string
  status: string
  maaVaereSkriftlig: boolean
  /** Minst én rutine under kapittelet har tekst. */
  harRutine: boolean
  sistGjennomgatt: string | null
  intervallMnd: number
  versjon: number
  /** Hvor mange som har bekreftet GJELDENDE versjon. */
  lestAv: number
  /** Hvor mange som skal lese. 0 = ingen å spørre, og da mangler ingen lesing. */
  skalLese: number
}

/** Det som står mellom kapittelet og «i orden», i den rekkefølgen det må gjøres. */
export type Mangel = 'ikke_skrevet' | 'ikke_vedtatt' | 'gjennomgang_forfalt' | 'ikke_lest'

export type KapittelTilstand = {
  kapittel: KapittelInn
  iOrden: boolean
  mangler: Mangel[]
  /** Neste gjennomgang. null når kapittelet aldri er vedtatt. */
  frist: Date | null
  /** Dager til fristen; negativ når den er passert. null uten frist. */
  dagerTilFrist: number | null
}

const DAG = 86_400_000

export function kapittelTilstand(k: KapittelInn, naa: Date): KapittelTilstand {
  const mangler: Mangel[] = []
  if (!k.harRutine) mangler.push('ikke_skrevet')
  if (k.status !== 'vedtatt') mangler.push('ikke_vedtatt')
  if (k.status === 'vedtatt' && erForfalt(k.sistGjennomgatt, k.intervallMnd, naa)) mangler.push('gjennomgang_forfalt')
  // Lesing teller først når det finnes noe vedtatt å lese.
  if (k.status === 'vedtatt' && k.skalLese > 0 && k.lestAv < k.skalLese) mangler.push('ikke_lest')
  const frist = k.status === 'vedtatt' ? nesteGjennomgang(k.sistGjennomgatt, k.intervallMnd) : null
  return {
    kapittel: k,
    iOrden: mangler.length === 0,
    mangler,
    frist,
    dagerTilFrist: frist ? Math.floor((frist.getTime() - naa.getTime()) / DAG) : null,
  }
}

export type Svar = {
  kapitler: KapittelTilstand[]
  iOrden: number
  totalt: number
  /** § 5 nr. 4–8 for seg: uten dem finnes det ikke et IK-system. */
  lovpalagtIOrden: number
  lovpalagtTotalt: number
  /** Den nærmeste gjennomgangsfristen blant kapitlene som er i orden. */
  nesteFrist: Date | null
}

export function svar(kapitler: KapittelInn[], naa: Date): Svar {
  const t = kapitler.map(k => kapittelTilstand(k, naa))
  const lov = t.filter(x => x.kapittel.maaVaereSkriftlig)
  const frister = t.filter(x => x.iOrden && x.frist).map(x => x.frist as Date)
  return {
    kapitler: t,
    iOrden: t.filter(x => x.iOrden).length,
    totalt: t.length,
    lovpalagtIOrden: lov.filter(x => x.iOrden).length,
    lovpalagtTotalt: lov.length,
    nesteFrist: frister.length ? new Date(Math.min(...frister.map(d => d.getTime()))) : null,
  }
}

// ── Neste-køen ─────────────────────────────────────────────────────────────

export type AvvikInn = {
  id: string
  tittel: string
  alvorlighet: string
  status: string
  /** ISO-dato eller -tidspunkt. */
  frist: string | null
}

export type KursInn = {
  userId: string
  navn: string
  type: 'fse' | 'forstehjelp'
  status: 'gyldig' | 'utgaar' | 'utgatt' | 'mangler'
}

/**
 * Hvor mye det haster. `na`: frist passert eller lovbrudd nå. `snart`: innen
 * en måned. `gjore`: arbeid som gjenstår før systemet er i orden, uten frist.
 */
export type Grad = 'na' | 'snart' | 'gjore'

export type Oppgave =
  | { type: 'kapittel'; grad: Grad; mangel: Mangel | 'gjennomgang_snart'; tilstand: KapittelTilstand }
  | { type: 'avvik'; grad: Grad; avvik: AvvikInn; overFrist: boolean }
  | { type: 'kurs'; grad: Grad; kurs: 'fse' | 'forstehjelp'; hvem: string[]; status: 'utgaar' | 'utgatt' | 'mangler' }

const GRAD_ORDEN: Record<Grad, number> = { na: 0, snart: 1, gjore: 2 }

/** Fristen på et avvik som dager fra i dag. Dato uten klokkeslett teller hele dagen. */
function dagerTilAvvikfrist(frist: string, naa: Date): number {
  const d = new Date(`${frist.slice(0, 10)}T23:59:59`)
  return Math.floor((d.getTime() - naa.getTime()) / DAG)
}

export function nesteKo(
  s: Svar,
  avvik: AvvikInn[],
  kurs: KursInn[],
  naa: Date,
): Oppgave[] {
  const ut: Oppgave[] = []

  for (const t of s.kapitler) {
    const m = t.mangler[0]
    if (m === 'gjennomgang_forfalt') ut.push({ type: 'kapittel', grad: 'na', mangel: m, tilstand: t })
    else if (m) ut.push({ type: 'kapittel', grad: 'gjore', mangel: m, tilstand: t })
    else if (t.dagerTilFrist !== null && t.dagerTilFrist <= 30) {
      ut.push({ type: 'kapittel', grad: 'snart', mangel: 'gjennomgang_snart', tilstand: t })
    }
  }

  for (const a of avvik) {
    if (a.status !== 'apent') continue
    const overFrist = a.frist !== null && dagerTilAvvikfrist(a.frist, naa) < 0
    if (overFrist || a.alvorlighet === 'kritisk') ut.push({ type: 'avvik', grad: 'na', avvik: a, overFrist })
    else if (a.alvorlighet === 'hoy') ut.push({ type: 'avvik', grad: 'snart', avvik: a, overFrist: false })
  }

  // Samlet per kurs og status: «2 mangler gyldig FSE» er én ting å gjøre,
  // ikke to rader som sier det samme.
  for (const type of ['fse', 'forstehjelp'] as const) {
    for (const status of ['utgatt', 'mangler', 'utgaar'] as const) {
      const hvem = kurs.filter(k => k.type === type && k.status === status).map(k => k.navn)
      if (hvem.length) ut.push({ type: 'kurs', grad: status === 'utgaar' ? 'snart' : 'na', kurs: type, hvem, status })
    }
  }

  // Innen samme grad: lovpålagte kapitler før andre, deretter nummerorden.
  const vekt = (o: Oppgave) =>
    o.type === 'kapittel' ? (o.tilstand.kapittel.maaVaereSkriftlig ? 0 : 2) : 1
  const nr = (o: Oppgave) => (o.type === 'kapittel' ? Number(o.tilstand.kapittel.nummer) || 99 : 0)
  return ut.sort((a, b) => GRAD_ORDEN[a.grad] - GRAD_ORDEN[b.grad] || vekt(a) - vekt(b) || nr(a) - nr(b))
}

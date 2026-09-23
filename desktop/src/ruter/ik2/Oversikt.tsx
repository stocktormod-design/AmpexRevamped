import { IK_GRUPPENAVN, IK_SKJELETT } from '@delt/ik/skjelett'
import type { KapittelTilstand, Mangel, Oppgave, Svar } from '@delt/ik/tilstand'
import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { ALVORLIGHET_NAVN, type Alvorlighet } from '@/lib/avvik-lager'
import { stk } from '@/ui/kit'
import { dato, gaa, Rad, Ring } from './felles'

/**
 * Forsida på IK v2, i tre klosser som kan brukes hver for seg:
 *
 *   SvarKort       «9 av 14 kapitler i orden» + tellerne for avvik og FSE
 *   NesteKo        det som må gjøres, det som haster først
 *   KapittelTabell håndboka med fire faste statusspalter
 *
 * UI-mønsteret er Vanta/Drata (docs/IK_KONKURRENTER.md): vis svaret før
 * dokumentet. Reglene bak svaret ligger i `lib/ik/tilstand.ts` og er norske.
 */

/* ── Svaret ─────────────────────────────────────────────────────────── */

export type Registertall = {
  apneAvvik: number
  avvikOverFrist: number
  fseGyldige: number
  fseTotalt: number
}

export function SvarKort({ svar, tall }: { svar: Svar; tall: Registertall }) {
  const alt = svar.totalt > 0 && svar.iOrden === svar.totalt
  const andel = svar.totalt > 0 ? svar.iOrden / svar.totalt : 0
  const fseMangler = tall.fseTotalt - tall.fseGyldige
  return (
    <section className="ik2-svar">
      <div className="ik2-svar-hode">
        <span className="ik2-svar-tall">{svar.iOrden}</span>
        <span className="ik2-svar-av">av {svar.totalt} kapitler i orden</span>
        {alt ? <CircleCheck size={22} strokeWidth={2} className="ik2-svar-ok" /> : null}
      </div>
      <div className="ik2-svar-stolpe" role="progressbar" aria-valuenow={svar.iOrden} aria-valuemax={svar.totalt}>
        <span style={{ width: `${andel * 100}%` }} />
      </div>
      <p className="ik2-svar-under">
        {alt
          ? `Alt er i orden.${svar.nesteFrist ? ` Neste gjennomgang ${dato(svar.nesteFrist)}.` : ''}`
          : `${svar.lovpalagtIOrden} av ${svar.lovpalagtTotalt} lovpålagte kapitler er i orden. Et kapittel er i orden når det er skrevet, vedtatt, gjennomgått innen fristen og lest av alle ansatte.`}
      </p>

      {/* Det DLE ber om å se først på tilsyn. Tallene er knapper. */}
      <div className="ik2-tellere">
        <button className="ik2-teller" onClick={() => gaa('avvik')}>
          <span className={`ik2-teller-tall${tall.avvikOverFrist > 0 ? ' ik2-varsel' : ''}`}>{tall.apneAvvik}</span>
          <span className="ik2-teller-navn">
            {tall.apneAvvik === 1 ? 'åpent avvik' : 'åpne avvik'}
            {tall.avvikOverFrist > 0 ? <span className="ik2-varsel"> · {tall.avvikOverFrist} over frist</span> : null}
          </span>
        </button>
        <button className="ik2-teller" onClick={() => gaa('opplaering')}>
          <span className={`ik2-teller-tall${fseMangler > 0 ? ' ik2-varsel' : ''}`}>
            {tall.fseGyldige}<span className="ik2-teller-av">/{tall.fseTotalt}</span>
          </span>
          <span className="ik2-teller-navn">med gyldig FSE</span>
        </button>
      </div>
    </section>
  )
}

/* ── Neste ──────────────────────────────────────────────────────────── */

const KURS = { fse: 'FSE', forstehjelp: 'førstehjelp' } as const

function kapNavn(t: KapittelTilstand) {
  return `«${t.kapittel.tittel}»`
}

function stor(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Én oppgave som en setning med verbet først: det man skal GJØRE. */
function tekst(o: Oppgave): { tittel: string; mer: string; til: string[] } {
  if (o.type === 'kapittel') {
    const t = o.tilstand
    const k = t.kapittel
    const kap = `Kapittel ${k.nummer}`
    switch (o.mangel) {
      case 'ikke_skrevet': return { tittel: `Skriv ${kapNavn(t)}`, mer: k.maaVaereSkriftlig ? `${kap} · lovpålagt skriftlig` : kap, til: [k.id] }
      case 'ikke_vedtatt': return { tittel: `Vedta ${kapNavn(t)}`, mer: `${kap} · skrevet, ikke vedtatt`, til: [k.id] }
      case 'endret_etter_vedtak': return { tittel: `Vedta endringene i ${kapNavn(t)}`, mer: `${kap} · endret etter vedtaket`, til: [k.id] }
      case 'gjennomgang_forfalt': return { tittel: `Gjennomgå ${kapNavn(t)}`, mer: `${kap} · fristen gikk ut ${dato(t.frist)}`, til: [k.id] }
      case 'gjennomgang_snart': return { tittel: `Gjennomgå ${kapNavn(t)}`, mer: `${kap} · frist ${dato(t.frist)}`, til: [k.id] }
      case 'ikke_lest': return { tittel: `Få alle til å lese ${kapNavn(t)}`, mer: `${kap} · ${k.lestAv} av ${k.skalLese} har lest versjon ${k.versjon}`, til: [k.id] }
    }
  }
  if (o.type === 'avvik') {
    return {
      tittel: `Lukk avvik: ${o.avvik.tittel}`,
      mer: o.overFrist ? `Fristen gikk ut ${dato(o.avvik.frist)}` : `Alvorlighet: ${(ALVORLIGHET_NAVN[o.avvik.alvorlighet as Alvorlighet] ?? '').toLowerCase()}`,
      til: ['avvik', o.avvik.id],
    }
  }
  const hvem = o.hvem.length === 1 ? o.hvem[0] : `${o.hvem.length} ansatte`
  const kurs = KURS[o.kurs]
  return {
    tittel: o.status === 'mangler' ? `${hvem} mangler ${kurs}`
      : o.status === 'utgatt' ? `${stor(kurs)} har gått ut for ${hvem}`
      : `${stor(kurs)} går snart ut for ${hvem}`,
    mer: o.hvem.length > 1 ? o.hvem.join(', ') : 'Registrer kurs',
    til: ['opplaering'],
  }
}

const VIS = 5

export function NesteKo({ ko }: { ko: Oppgave[] }) {
  const [alle, setAlle] = useState(false)
  if (ko.length === 0) return null
  const synlige = alle ? ko : ko.slice(0, VIS)
  return (
    <section className="ik2-avsnitt ik2-neste">
      <div className="ik2-avsnitt-hode">
        <span className="ik2-etikett">Neste</span>
        <span className="ik2-rad-mer">{stk(ko.length, 'oppgave', 'oppgaver')}</span>
      </div>
      {synlige.map((o, i) => {
        const t = tekst(o)
        return (
          <Rad
            key={i}
            tittel={t.tittel}
            under={t.mer}
            hoyre={<span className={`ik2-prikk ik2-prikk-${o.grad}`} aria-hidden />}
            onClick={() => gaa(...t.til)}
          />
        )
      })}
      {ko.length > VIS ? (
        <button className="ik2-lenke ik2-neste-alle" onClick={() => setAlle(v => !v)}>
          {alle ? 'Vis færre' : `Vis alle ${ko.length}`}
        </button>
      ) : null}
    </section>
  )
}

/* ── Kapitlene ──────────────────────────────────────────────────────── */

const GRUPPE_FOR: Record<string, string> = Object.fromEntries(
  IK_SKJELETT.map(p => [p.nummer, IK_GRUPPENAVN[p.gruppe]]),
)

const MANGEL_TEKST: Record<Mangel, string> = {
  ikke_skrevet: 'Ikke skrevet',
  ikke_vedtatt: 'Ikke vedtatt',
  endret_etter_vedtak: 'Endret etter vedtak',
  gjennomgang_forfalt: 'Gjennomgang forfalt',
  ikke_lest: 'Ikke lest av alle',
}

/** Status-spalten: «I orden», eller det første som mangler. */
export function KapittelStatus({ t }: { t: KapittelTilstand }) {
  if (t.iOrden) {
    return <span className="ik2-tilstand ik2-tilstand-ok"><CircleCheck size={14} strokeWidth={2} />I orden</span>
  }
  const m = t.mangler[0]
  const stil = m === 'gjennomgang_forfalt' || m === 'endret_etter_vedtak' ? 'varsel' : m === 'ikke_skrevet' ? 'dempet' : 'stille'
  return <span className={`ik2-tilstand ik2-tilstand-${stil}`}>{MANGEL_TEKST[m]}</span>
}

/**
 * Håndboka som tabell, som Vantas policyliste: hver rad svarer på «må jeg
 * gjøre noe her?» uten å åpnes. Rekkefølgen er forskriftens, gruppert som i
 * skjelettet — køen over står for prioriteringen.
 */
export function KapittelTabell({ kapitler, telling }: {
  kapitler: KapittelTilstand[]
  /** Punkter og rutiner per kapittel-id, til undertittelen. */
  telling: Map<string, { punkter: number; rutiner: number }>
}) {
  const grupper: { navn: string; rader: KapittelTilstand[] }[] = []
  for (const t of kapitler) {
    const navn = t.kapittel.maaVaereSkriftlig ? 'Lovpålagt skriftlig' : (GRUPPE_FOR[t.kapittel.nummer] ?? 'Egne kapitler')
    const siste = grupper[grupper.length - 1]
    if (siste && siste.navn === navn) siste.rader.push(t)
    else grupper.push({ navn, rader: [t] })
  }

  return (
    <div className="ik2-ktabell" role="table">
      <div className="ik2-ktabell-hode" role="row">
        <span />
        <span>Kapittel</span>
        <span>Vedtatt</span>
        <span>Gjennomgås innen</span>
        <span>Lest</span>
        <span>Status</span>
      </div>
      {grupper.map(g => (
        <div key={g.navn} role="rowgroup">
          <div className="ik2-liste-hode">{g.navn}</div>
          {g.rader.map(t => {
            const k = t.kapittel
            const n = telling.get(k.id)
            const vedtatt = k.status === 'vedtatt'
            return (
              <button key={k.id} className="ik2-ktabell-rad" role="row" onClick={() => gaa(k.id)}>
                <span className="ik2-rad-nr">{k.nummer}</span>
                <span className="ik2-ktabell-navn">
                  <span className="ik2-rad-tittel">{k.tittel}</span>
                  <span className="ik2-rad-under">
                    {n && n.punkter > 0 ? `${stk(n.punkter, 'punkt', 'punkter')} · ${stk(n.rutiner, 'rutine', 'rutiner')}` : 'Ingen punkter ennå'}
                  </span>
                </span>
                <span className="ik2-ktabell-celle">{vedtatt ? `v${k.versjon}` : '–'}</span>
                <span className={`ik2-ktabell-celle${t.mangler.includes('gjennomgang_forfalt') ? ' ik2-varsel' : ''}`}>
                  {t.frist ? dato(t.frist) : '–'}
                </span>
                <span className="ik2-ktabell-celle ik2-ktabell-lest">
                  {vedtatt && k.skalLese > 0 ? <><Ring av={k.lestAv} totalt={k.skalLese} />{k.lestAv}/{k.skalLese}</> : '–'}
                </span>
                <span className="ik2-ktabell-status"><KapittelStatus t={t} /></span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

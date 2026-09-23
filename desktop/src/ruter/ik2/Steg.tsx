import type { KapittelTilstand } from '@delt/ik/tilstand'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Felt, Knapp } from '@/ui/kit'
import { dato, Ring } from './felles'

/**
 * «Veien til i orden» for ett kapittel: fire steg, som kravlista på en
 * kontroll hos Drata. Hvert steg er enten gjort (hake) eller ikke (tom ring),
 * og handlingen står på det FØRSTE steget som ikke er gjort — der man er.
 * Stegene etter er dempet: de kan ikke gjøres ennå, men man ser at de kommer.
 *
 *   1 Skrevet             minst én rutine med tekst
 *   2 Vedtatt             og ikke endret siden (ellers: vedta på nytt)
 *   3 Gjennomgått i tide  årlig, eller det intervallet kapittelet har
 *   4 Lest av alle        gjeldende versjon, alle feltfolk
 *
 * Reglene står i `lib/ik/tilstand.ts`; her er bare visningen og knappene.
 */
export function Stegene({ t, rutiner, skrevne, versjon, vedtattAt, sistEndret, mangler, kanSkrive, jegHarLest, jobber, handling }: {
  t: KapittelTilstand
  rutiner: number
  skrevne: number
  versjon: number
  vedtattAt: string | null
  sistEndret: string | null
  /** Navnene på dem som ikke har lest gjeldende versjon. */
  mangler: string[]
  kanSkrive: boolean
  jegHarLest: boolean
  jobber: boolean
  handling: {
    vedta: () => void
    vedtaPaaNytt: (notat: string) => void
    gjennomgatt: () => void
    lest: () => void
  }
}) {
  const [notat, setNotat] = useState('')
  const m = new Set(t.mangler)
  const k = t.kapittel
  const vedtatt = k.status === 'vedtatt'

  const steg = [
    {
      navn: 'Skrevet',
      gjort: !m.has('ikke_skrevet'),
      tekst: rutiner === 0 ? 'Ingen rutiner ennå. Legg til et punkt og skriv rutinene under det.'
        : `${skrevne} av ${rutiner} ${rutiner === 1 ? 'rutine' : 'rutiner'} har tekst.`,
      handling: null as React.ReactNode,
    },
    {
      navn: m.has('endret_etter_vedtak') ? 'Vedta endringene' : 'Vedtatt',
      gjort: vedtatt && !m.has('endret_etter_vedtak'),
      tekst: m.has('endret_etter_vedtak')
        ? `Rutinene ble endret ${dato(sistEndret)}, etter vedtaket ${dato(vedtattAt)}. Når du vedtar på nytt, blir det versjon ${versjon + 1}, og alle må lese kapittelet igjen.`
        : vedtatt ? `Versjon ${versjon}, vedtatt ${dato(vedtattAt)}.` : 'Faglig ansvarlig eller daglig leder vedtar kapittelet når det er skrevet.',
      handling: !kanSkrive ? null : m.has('endret_etter_vedtak') ? (
        <form className="ik2-steg-skjema" onSubmit={e => { e.preventDefault(); if (notat.trim()) handling.vedtaPaaNytt(notat) }}>
          <Felt firkant value={notat} onChange={e => setNotat(e.target.value)}
            placeholder="Hva ble endret? F.eks. ny rutine for arbeid i høyden" />
          <Knapp stil="primar" type="submit" disabled={!notat.trim() || jobber}>{jobber ? 'Vedtar …' : `Vedta versjon ${versjon + 1}`}</Knapp>
        </form>
      ) : !vedtatt && !m.has('ikke_skrevet') ? (
        <Knapp stil="primar" disabled={jobber} onClick={handling.vedta}>{jobber ? 'Vedtar …' : 'Vedta kapittelet'}</Knapp>
      ) : null,
    },
    {
      navn: 'Gjennomgått',
      gjort: vedtatt && !m.has('gjennomgang_forfalt'),
      varsel: m.has('gjennomgang_forfalt'),
      tekst: !t.frist ? 'Fristen settes når kapittelet vedtas.'
        : m.has('gjennomgang_forfalt') ? `Fristen gikk ut ${dato(t.frist)}. Les gjennom kapittelet og bekreft.`
        : `Neste gjennomgang innen ${dato(t.frist)}.`,
      // Gjennomgangen kan kvitteres når som helst etter vedtaket, ikke bare
      // når den er forfalt — men den er bare framhevet når den haster.
      handling: kanSkrive && vedtatt && !m.has('endret_etter_vedtak') ? (
        <Knapp stil={m.has('gjennomgang_forfalt') || (t.dagerTilFrist ?? 999) <= 30 ? 'primar' : 'stille'} disabled={jobber} onClick={handling.gjennomgatt}>
          {jobber ? 'Registrerer …' : 'Gjennomgått, ingen endringer'}
        </Knapp>
      ) : null,
      alltid: true,
    },
    {
      navn: 'Lest av alle',
      gjort: vedtatt && !m.has('endret_etter_vedtak') && !m.has('ikke_lest'),
      tekst: !vedtatt ? 'Når kapittelet er vedtatt, bekrefter de ansatte at de har lest det.'
        : k.skalLese === 0 ? 'Ingen ansatte registrert.'
        : m.has('ikke_lest') ? `${k.lestAv} av ${k.skalLese} har lest versjon ${versjon}. Ikke lest: ${mangler.join(', ')}.`
        : `Alle ${k.skalLese} har lest versjon ${versjon}.`,
      ring: vedtatt && k.skalLese > 0,
      handling: vedtatt && !jegHarLest && !m.has('endret_etter_vedtak') ? (
        <Knapp stil="stille" disabled={jobber} onClick={handling.lest}>{jobber ? 'Bekrefter …' : 'Jeg har lest dette'}</Knapp>
      ) : null,
      alltid: true,
    },
  ]

  // Det er én vei: et steg er ikke gjort før stegene foran er det. Et
  // kapittel uten tekst har ikke «gjennomgått i tide», selv om datoen stemmer.
  for (let i = 1; i < steg.length; i++) if (!steg[i - 1].gjort) steg[i].gjort = false
  const her = steg.findIndex(s => !s.gjort)
  return (
    <ol className="ik2-steg">
      {steg.map((s, i) => {
        const tilstand = s.gjort ? 'gjort' : i === her ? 'her' : 'senere'
        // Handlingen står på steget man er på. Gjennomgang og lesing kan også
        // gjøres fra et ferdig steg (kvittere tidlig, lese selv om andre mangler).
        const vis = i === her || ('alltid' in s && s.alltid && tilstand !== 'senere')
        return (
          <li key={s.navn} className={`ik2-steg-ledd ik2-steg-${tilstand}${'varsel' in s && s.varsel ? ' ik2-steg-varsel' : ''}`}>
            <span className="ik2-steg-merke" aria-hidden>
              {s.gjort ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <div className="ik2-steg-kropp">
              <div className="ik2-steg-navn">{s.navn}</div>
              <p className="ik2-steg-tekst">
                {'ring' in s && s.ring ? <Ring av={k.lestAv} totalt={k.skalLese} /> : null}
                {s.tekst}
              </p>
              {vis && s.handling ? <div className="ik2-steg-handling">{s.handling}</div> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

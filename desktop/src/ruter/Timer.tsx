import { DAGER, flyttUke, formatTimer, ukeEtikett, ukeSlutt, ukeStart } from '@delt/timesheet-calc'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { hentTimerIPerioden, type Timerad } from '@/lib/kontor-lager'
import { Beskjed, Ikonknapp, Knapp, Kort, Sidehode, stk } from '@/ui/kit'

/**
 * Timelista for hele firmaet, uke for uke.
 *
 * Ukeinndelingen kommer fra `lib/timesheet-calc.ts` — mandagsstart, sommertid
 * og ukenummer er selvtestet i `verify:timesheet`, og det er ikke noe man
 * skriver om igjen. En uke som starter på feil dag flytter timer mellom to
 * lønnskjøringer.
 *
 * Kontoret leser to ting her: fikk alle ført, og hvor mye er fakturerbart.
 * Derfor er kolonnene dager og ikke ordrer — hull i uka er det man ser etter.
 */

export function Timer() {
  const [start, setStart] = useState(() => ukeStart(new Date()))
  const [rader, setRader] = useState<Timerad[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    let avbrutt = false
    setLaster(true)
    hentTimerIPerioden(start, ukeSlutt(start))
      .then(r => { if (!avbrutt) { setRader(r); setFeil(null) } })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!avbrutt) setLaster(false) })
    return () => { avbrutt = true }
  }, [start])

  /**
   * Én rad per person, sju kolonner. Dagindeksen regnes fra ukestart og ikke
   * fra `getDay()`, så mandag blir 0 uten en modulo-øvelse som ryker ved
   * sommertid.
   */
  const personer = useMemo(() => {
    const per = new Map<string, { navn: string; dager: number[]; sum: number; fakturerbart: number }>()
    for (const t of rader) {
      const rad = per.get(t.user_id) ?? {
        navn: t.user_name ?? 'Ukjent',
        dager: [0, 0, 0, 0, 0, 0, 0],
        sum: 0,
        fakturerbart: 0,
      }
      const d = new Date(t.date)
      const i = Math.floor((d.getTime() - start.getTime()) / 86_400_000)
      if (i >= 0 && i < 7) rad.dager[i] += t.hours
      rad.sum += t.hours
      if (t.billable !== false) rad.fakturerbart += t.hours
      per.set(t.user_id, rad)
    }
    return [...per.values()].sort((a, b) => a.navn.localeCompare(b.navn, 'nb'))
  }, [rader, start])

  const sum = personer.reduce((n, p) => n + p.sum, 0)
  const fakturerbart = personer.reduce((n, p) => n + p.fakturerbart, 0)
  const denneUka = ukeStart(new Date()).getTime() === start.getTime()

  return (
    <>
      <Sidehode
        tittel="Timer"
        under={`${formatTimer(sum)} ført · ${formatTimer(fakturerbart)} fakturerbart · ${stk(personer.length, 'person', 'personer')}`}
        handling={
          <div className="rad">
            <Ikonknapp onClick={() => setStart(flyttUke(start, -1))} title="Forrige uke" aria-label="Forrige uke">
              <ChevronLeft size={18} strokeWidth={2} />
            </Ikonknapp>
            <span style={{ minWidth: 168, textAlign: 'center', fontWeight: 500 }}>
              {ukeEtikett(start)}
            </span>
            <Ikonknapp onClick={() => setStart(flyttUke(start, 1))} title="Neste uke" aria-label="Neste uke">
              <ChevronRight size={18} strokeWidth={2} />
            </Ikonknapp>
            {!denneUka ? (
              <Knapp stil="stille" onClick={() => setStart(ukeStart(new Date()))}>
                Denne uka
              </Knapp>
            ) : null}
          </div>
        }
      />


      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Kort tittel="Uka" merkelapp={laster ? 'Henter …' : stk(rader.length, 'føring', 'føringer')}>
        {personer.length === 0 ? (
          <p className="kort-hjelp">
            {laster ? 'Henter timene …' : 'Ingen timer ført denne uka.'}
          </p>
        ) : (
          <table className="linjer">
            <thead>
              <tr>
                <th>Person</th>
                {DAGER.map(d => (
                  <th key={d} className="h" style={{ width: 62 }}>{d}</th>
                ))}
                <th className="h" style={{ width: 80 }}>Sum</th>
                <th className="h" style={{ width: 110 }}>Fakturerbart</th>
              </tr>
            </thead>
            <tbody>
              {personer.map(p => (
                <tr key={p.navn}>
                  <td style={{ fontWeight: 500 }}>{p.navn}</td>
                  {p.dager.map((t, i) => (
                    // En tom dag skrives som ingenting, ikke som 0. Nullene ville
                    // fylt tabellen med støy, og det er hullene man ser etter.
                    <td key={i} className="h">
                      {t === 0 ? <span className="dempet-mer">·</span> : formatTimer(t)}
                    </td>
                  ))}
                  <td className="h" style={{ fontWeight: 600 }}>{formatTimer(p.sum)}</td>
                  <td className="h dempet">{formatTimer(p.fakturerbart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Kort>
    </>
  )
}

import { kan } from '@delt/kontor-tilgang'
import { DAGER, flyttUke, formatTimer, ukeEtikett, ukeSlutt, ukeStart } from '@delt/timesheet-calc'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { hentOrdrer, type Ordrerad } from '@/lib/ordre-lager'
import {
  forTimer,
  hentAktiviteter,
  hentFirma,
  hentTimerIPerioden,
  type Aktivitet,
  type Ansatt,
  type Timerad,
} from '@/lib/kontor-lager'
import { Beskjed, Felt, Ikonknapp, Knapp, Kort, Sidehode, stk } from '@/ui/kit'

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
 *
 * Og når hullet er funnet, skal det kunne tettes her. Skjemaet nederst fører
 * timer på vegne av en annen: `user_id` er montøren timen gjelder, `created_by`
 * er den som sitter på kontoret, og de to skilles med vilje. En time ført fra
 * kontoret skal kunne kjennes igjen som det.
 */

/** I dag, som «2026-08-23». Datofeltet i HTML vil ha nøyaktig den formen. */
function iDagIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

export function Timer() {
  const [start, setStart] = useState(() => ukeStart(new Date()))
  const [rader, setRader] = useState<Timerad[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [versjon, setVersjon] = useState(0)

  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'timer.skriv')
  const [apen, setApen] = useState(false)
  const [ansatte, setAnsatte] = useState<Ansatt[]>([])
  const [ordrer, setOrdrer] = useState<Ordrerad[]>([])
  const [aktiviteter, setAktiviteter] = useState<Aktivitet[]>([])
  const [ny, setNy] = useState({
    ordreId: '',
    brukerId: '',
    dato: iDagIso(),
    timer: '',
    aktivitetId: '',
    notat: '',
  })
  const [jobber, setJobber] = useState(false)
  const [skjemafeil, setSkjemafeil] = useState<string | null>(null)
  const [kvittering, setKvittering] = useState<string | null>(null)

  useEffect(() => {
    let avbrutt = false
    setLaster(true)
    hentTimerIPerioden(start, ukeSlutt(start))
      .then(r => { if (!avbrutt) { setRader(r); setFeil(null) } })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!avbrutt) setLaster(false) })
    return () => { avbrutt = true }
  }, [start, versjon])

  // Valglistene hentes én gang, og bare for den som faktisk kan føre timer.
  // Ansattlista og ordrelista er ikke gratis, og en regnskapsfører som bare
  // leser uka skal ikke betale for et skjema hun ikke får åpne.
  const lastValg = useCallback(async () => {
    if (!kanSkrive || ansatte.length > 0) return
    try {
      const [f, o, a] = await Promise.all([hentFirma(), hentOrdrer({}), hentAktiviteter()])
      setAnsatte(f.ansatte)
      setOrdrer(o)
      setAktiviteter(a)
    } catch (e) {
      setSkjemafeil(e instanceof Error ? e.message : String(e))
    }
  }, [kanSkrive, ansatte.length])

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

        {kanSkrive ? (
          <div className="inviter-boks">
            {!apen ? (
              <div className="stabel">
                {kvittering ? <Beskjed stil="ok">{kvittering}</Beskjed> : null}
                <div>
                  <Knapp
                    stil="merke"
                    onClick={() => { setApen(true); setKvittering(null); void lastValg() }}
                  >
                    Før timer
                  </Knapp>
                </div>
              </div>
            ) : (
              <form
                className="stabel"
                onSubmit={async ev => {
                  ev.preventDefault()
                  setJobber(true)
                  setSkjemafeil(null)
                  try {
                    const person = ansatte.find(a => a.id === ny.brukerId)
                    await forTimer(
                      {
                        ordreId: ny.ordreId,
                        brukerId: ny.brukerId,
                        brukerNavn: person?.full_name ?? '',
                        dato: ny.dato,
                        timer: Number(ny.timer.replace(',', '.')),
                        aktivitetId: ny.aktivitetId || null,
                        notat: ny.notat,
                      },
                      profil?.id ?? '',
                    )
                    setKvittering(`${ny.timer} timer ført på ${person?.full_name ?? 'personen'}.`)
                    setNy(n => ({ ...n, timer: '', notat: '' }))
                    setVersjon(v => v + 1)
                  } catch (e) {
                    setSkjemafeil(e instanceof Error ? e.message : String(e))
                  }
                  setJobber(false)
                }}
              >
                <div className="inviter-felt">
                  <label className="felt felt-firkant">
                    <span className="felt-etikett">Hvem</span>
                    <select
                      className="felt-inn"
                      value={ny.brukerId}
                      onChange={e => setNy(n => ({ ...n, brukerId: e.target.value }))}
                    >
                      <option value="">Velg person …</option>
                      {ansatte.map(a => (
                        <option key={a.id} value={a.id}>{a.full_name}</option>
                      ))}
                    </select>
                  </label>
                  {/* Ordren er påkrevd, og det er ikke et skjemavalg: en time er
                      noe som ble brukt PÅ noe, og fakturagrunnlaget grupperer
                      per ordre. Tid som ikke hører til en jobb føres på en
                      intern ordre med en ikke-fakturerbar aktivitet. */}
                  <label className="felt felt-firkant">
                    <span className="felt-etikett">Ordre</span>
                    <select
                      className="felt-inn"
                      value={ny.ordreId}
                      onChange={e => setNy(n => ({ ...n, ordreId: e.target.value }))}
                    >
                      <option value="">Velg ordre …</option>
                      {ordrer.map(o => (
                        <option key={o.id} value={o.id}>
                          {o.order_number != null ? `#${o.order_number} · ` : ''}{o.title}
                        </option>
                      ))}
                    </select>
                    <span className="felt-hjelp">Timene henger på ordren. Fakturaen finner dem der.</span>
                  </label>
                </div>
                <div className="inviter-felt">
                  <Felt
                    firkant
                    etikett="Dato"
                    type="date"
                    value={ny.dato}
                    onChange={e => setNy(n => ({ ...n, dato: e.target.value }))}
                  />
                  <Felt
                    firkant
                    etikett="Timer"
                    inputMode="decimal"
                    placeholder="7,5"
                    value={ny.timer}
                    onChange={e => setNy(n => ({ ...n, timer: e.target.value }))}
                  />
                </div>
                <div className="inviter-felt">
                  {/* Fakturerbarheten settes ikke her. Den arves fra aktiviteten
                      ved fakturering (`verify:timesheet` dekker arven), så en
                      aktivitet som senere gjøres ikke-fakturerbar slår gjennom
                      på timer som ennå ikke er fakturert. */}
                  <label className="felt felt-firkant">
                    <span className="felt-etikett">Aktivitet</span>
                    <select
                      className="felt-inn"
                      value={ny.aktivitetId}
                      onChange={e => setNy(n => ({ ...n, aktivitetId: e.target.value }))}
                    >
                      <option value="">Ingen — regnes som fakturerbar</option>
                      {aktiviteter.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.billable ? '' : ' (ikke fakturerbar)'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Felt
                    firkant
                    etikett="Notat"
                    placeholder="Hva ble gjort"
                    value={ny.notat}
                    onChange={e => setNy(n => ({ ...n, notat: e.target.value }))}
                  />
                </div>
                {skjemafeil ? <Beskjed stil="feil">{skjemafeil}</Beskjed> : null}
                <div className="rad">
                  <Knapp
                    stil="merke"
                    type="submit"
                    disabled={jobber || !ny.brukerId || !ny.ordreId || !ny.timer.trim()}
                  >
                    {jobber ? 'Fører …' : 'Før timene'}
                  </Knapp>
                  <Knapp type="button" onClick={() => { setApen(false); setSkjemafeil(null) }}>
                    Lukk
                  </Knapp>
                  {/* Skjemaet blir stående åpent etter lagring, med person og
                      ordre beholdt. Kontoret fører sjelden én rad — det er en
                      uke som skal etterregistreres. */}
                  <span className="felt-hjelp">Skjemaet står åpent, så flere dager kan føres etter hverandre.</span>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </Kort>
    </>
  )
}

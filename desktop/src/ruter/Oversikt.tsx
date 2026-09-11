import { kan } from '@delt/kontor-tilgang'
import { arbeidsperiode, byggUkeplan, DAGER, flyttUke, ukeSlutt, ukeStart } from '@delt/schedule-calc'
import { ChevronLeft, ChevronRight, CircleCheck, FileSpreadsheet, FileText, Package, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { hentOrdrer, type Ordrerad } from '@/lib/ordre-lager'
import { hentOversikt, type Oversikt as Data } from '@/lib/oversikt-lager'
import { antall, Beskjed, Ikonknapp, Knapp, Kort, Sidehode, stk } from '@/ui/kit'

/**
 * Forsiden.
 *
 * Tre ting, i den rekkefølgen kontoret trenger dem:
 *
 *   1. UKA. Hva er avtalt, og når. Samme ukeplan som telefonen viser, bygget av
 *      `lib/schedule-calc.ts` — mandagsstart og sommertid er selvtestet der.
 *   2. VENTER PÅ DEG. Ordrene som står klare til godkjenning eller fakturering,
 *      med navn og nummer. Ikke et tall man må klikke for å forstå.
 *   3. HURTIGVALG. Det rollen faktisk gjør, som én knapp.
 *
 * Den gamle forsiden var fem nøkkeltall og tre tellelinjer. Den fortalte at noe
 * ventet, men aldri HVA — og et tall man må klikke for å forstå er et tall som
 * like gjerne kunne stått et annet sted.
 */

const DAG = new Intl.DateTimeFormat('nb-NO', { day: 'numeric' })
const TID = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit' })
/** «17.–23. aug. 2026» — mandag til søndag, uten at man må lese ukenummeret. */
const SPENN = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })

export function Oversikt() {
  const { profil } = useAuth()
  const rolle = profil?.role
  const seIk = kan(rolle, 'ik.les')
  const seTilbud = kan(rolle, 'tilbud.les')
  const skriveIk = kan(rolle, 'ik.skriv')
  const fakturere = kan(rolle, 'faktura.marker')
  const importere = kan(rolle, 'priser.importer')

  const [data, setData] = useState<Data | null>(null)
  const [ordrer, setOrdrer] = useState<Ordrerad[]>([])
  const [start, setStart] = useState(() => ukeStart(new Date()))
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    hentOversikt(seIk, seTilbud)
      .then(setData)
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
  }, [seIk, seTilbud])

  useEffect(() => {
    hentOrdrer({}).then(setOrdrer).catch(() => setOrdrer([]))
  }, [])

  // Ukeplanen bygges av den delte funksjonen, ikke av en egen dato-runde her.
  // En uke som starter på feil dag flytter en avtale mellom to uker.
  const plan = useMemo(
    () => byggUkeplan(start, ordrer.map(o => ({ ...o, scheduledAt: o.scheduled_at ? new Date(o.scheduled_at) : null }))),
    [start, ordrer],
  )

  const tilGodkjenning = ordrer.filter(o => o.bolk === 'godkjenning' && !o.godkjent)
  const klarTilFaktura = ordrer.filter(o => o.bolk === 'godkjenning' && o.godkjent)
  const iDag = new Date().toDateString()
  const denneUka = ukeStart(new Date()).getTime() === start.getTime()
  const fornavn = profil?.full_name.split(' ')[0] ?? ''

  const hurtig = [
    skriveIk ? { navn: 'Internkontroll', ikon: ShieldCheck, rute: '#/ik' } : null,
    skriveIk ? { navn: 'Skjemaer', ikon: FileText, rute: '#/skjema' } : null,
    importere ? { navn: 'Importer prisfil', ikon: FileSpreadsheet, rute: '#/prisfil' } : null,
    { navn: 'Varekartotek', ikon: Package, rute: '#/varer' },
  ].filter((x): x is { navn: string; ikon: typeof Package; rute: string } => x !== null)

  return (
    <>
      <Sidehode
        tittel={fornavn ? `God dag, ${fornavn}` : 'Oversikt'}
        under={arbeidsperiode(start, new Date())}
        handling={
          <div className="rad">
            <Ikonknapp onClick={() => setStart(flyttUke(start, -1))} title="Forrige uke" aria-label="Forrige uke">
              <ChevronLeft size={17} strokeWidth={2} />
            </Ikonknapp>
            <Ikonknapp onClick={() => setStart(flyttUke(start, 1))} title="Neste uke" aria-label="Neste uke">
              <ChevronRight size={17} strokeWidth={2} />
            </Ikonknapp>
            {!denneUka ? (
              <Knapp stil="stille" onClick={() => setStart(ukeStart(new Date()))}>Denne uka</Knapp>
            ) : null}
          </div>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      {/* Uka. Samme sju kolonner som telefonen, så det er den samme uka man
          ser uansett hvor man står. */}
      <Kort tittel="Uka" merkelapp={SPENN.formatRange(start, ukeSlutt(start))}>
        <div className="uke">
          {plan.dager.map((d, i) => (
            <div key={i} className={d.dato.toDateString() === iDag ? 'uke-dag uke-dag-idag' : 'uke-dag'}>
              <div className="uke-hode">
                <span className="uke-navn">{DAGER[i]}</span>
                <span className="uke-tall">{DAG.format(d.dato)}</span>
              </div>
              <div className="uke-jobber">
                {d.jobber.length === 0 ? (
                  <span className="uke-tom">–</span>
                ) : (
                  d.jobber.map(o => (
                    <a key={o.id} className="uke-jobb" href="#/ordre" title={o.title}>
                      <span className="uke-jobb-tid">
                        {o.scheduled_at ? TID.format(new Date(o.scheduled_at)) : ''}
                      </span>
                      <span className="uke-jobb-tittel">{o.title}</span>
                    </a>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Kort>

      {/* Med navn og nummer. «1 ordre venter» tvinger et klikk for å finne ut
          hvilken — og da er tallet bare en dør. */}
      <Kort
        tittel="Venter på deg"
        merkelapp={
          tilGodkjenning.length + klarTilFaktura.length === 0
            ? undefined
            : stk(tilGodkjenning.length + klarTilFaktura.length, 'ordre', 'ordrer')
        }
      >
        {tilGodkjenning.length === 0 && klarTilFaktura.length === 0 && (data?.oppgaver.length ?? 0) === 0 ? (
          <div className="rad" style={{ color: 'var(--gronn)' }}>
            <CircleCheck size={18} strokeWidth={1.9} />
            <span>Ingenting venter. Alt er planlagt, godkjent og fakturert.</span>
          </div>
        ) : (
          <div className="oppgaver">
            {tilGodkjenning.map(o => (
              <a key={o.id} className="oppgave" href="#/ordre">
                <span className="oppgave-nr">#{o.order_number ?? '—'}</span>
                <span className="oppgave-tekst">{o.title}</span>
                <span className="oppgave-merke" style={{ color: 'var(--gul)' }}>Til godkjenning</span>
              </a>
            ))}
            {klarTilFaktura.map(o => (
              <a key={o.id} className="oppgave" href="#/ordre">
                <span className="oppgave-nr">#{o.order_number ?? '—'}</span>
                <span className="oppgave-tekst">{o.title}</span>
                <span className="oppgave-merke" style={{ color: 'var(--gronn)' }}>
                  {fakturere ? 'Klar til faktura' : 'Godkjent'}
                </span>
              </a>
            ))}
            {(data?.oppgaver ?? [])
              // Ordrene står allerede med navn over. Her blir bare det som ikke
              // er en ordre igjen: uplanlagt arbeid, utløpte tilbud, IK-hull.
              .filter(o => o.id !== 'fakturaklar')
              .map(o => (
                <a key={o.id} className="oppgave" href={o.rute}>
                  <span className="oppgave-nr">{antall(o.antall)}</span>
                  <span className="oppgave-tekst">{o.tekst}</span>
                </a>
              ))}
          </div>
        )}
      </Kort>

      <Kort tittel="Snarveier">
        <div className="snarveier">
          {hurtig.map(h => (
            <a key={h.rute} className="snarvei" href={h.rute}>
              <h.ikon size={18} strokeWidth={1.8} />
              {h.navn}
            </a>
          ))}
        </div>
      </Kort>
    </>
  )
}

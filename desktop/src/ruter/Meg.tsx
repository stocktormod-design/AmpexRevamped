import { rollenavn } from '@delt/kontor-tilgang'
import { DAGER, flyttUke, formatTimer, ukeEtikett, ukeSlutt, ukeStart } from '@delt/timesheet-calc'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { slettMeg } from '@/lib/brukere'
import { hentMineTimer, type Timerad } from '@/lib/kontor-lager'
import { hentOrdrer, type Ordrerad } from '@/lib/ordre-lager'
import { TEMAER, useTema } from '@/lib/tema'
import { bekreftKode, kobleFra, meldPa, verifisertFaktor, type Pamelding } from '@/lib/tofaktor'
import { supabase } from '@/supabase'
import { Beskjed, Felt, Ikonknapp, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Meg: det som gjelder DEG, ikke firmaet.
 *
 * Fire ting, og alle er personlige: hvordan skjermen ser ut, timene du selv
 * har ført, autentiseringsappen din, og kontoen — logg ut, eller slett den.
 * Firmaets timeliste, ansatte og innstillinger bor på Firma og Timer; det som
 * står her skal ikke trenge en rettighet ut over å være logget inn.
 *
 * Sletting er en rett (personvernforordningen art. 17), og den skal kunne
 * utøves uten å be noen om det. Men den er ikke en angreknapp: den krever
 * passordet på nytt, forklarer hva som beholdes og hvorfor, og gjøres av
 * `supabase/functions/slett-bruker` med `service_role` — se kommentaren der
 * for hvorfor en klient ikke kan gjøre det selv.
 */

export function Meg() {
  const { profil, sesjon, loggUt } = useAuth()
  const epost = sesjon?.user.email ?? ''

  return (
    <>
      <Sidehode tittel="Meg" under={profil ? `${profil.full_name} · ${rollenavn(profil.role)}` : undefined} />

      <div className="to-spalter">
        <div className="stabel">
          <MineTimer brukerId={profil?.id ?? ''} />
          <Totrinn />
        </div>
        <div className="stabel">
          <Utseende />
          <Kort tittel="Konto">
            <div className="fakta meg-fakta">
              <div>
                <div className="fakta-navn">Navn</div>
                <div className="fakta-verdi">{profil?.full_name || '—'}</div>
              </div>
              <div>
                <div className="fakta-navn">E-post</div>
                <div className="fakta-verdi valgbar">{epost || '—'}</div>
              </div>
              <div>
                <div className="fakta-navn">Rolle</div>
                <div className="fakta-verdi">{rollenavn(profil?.role)}</div>
              </div>
            </div>
            <div className="inviter-boks">
              <Knapp onClick={loggUt}>Logg ut</Knapp>
            </div>
          </Kort>
          <SlettKonto epost={epost} />
        </div>
      </div>
    </>
  )
}

// ── Utseende ──────────────────────────────────────────────────────────────

function Utseende() {
  const [tema, sett] = useTema()
  return (
    <Kort tittel="Utseende" merkelapp="Gjelder denne maskinen">
      <div className="temaer" role="radiogroup" aria-label="Tema">
        {TEMAER.map(t => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={tema === t.id}
            className="tema"
            onClick={() => sett(t.id)}
          >
            <Prove tema={t.id} />
            <div>
              <div className="tema-navn">{t.navn}</div>
              <div className="tema-om">{t.om}</div>
            </div>
          </button>
        ))}
      </div>
    </Kort>
  )
}

/**
 * Miniatyren av temaet, tegnet med temaets egne farger — ikke lest fra CSS-
 * variablene, for da ville begge prøvene vist det som gjelder NÅ.
 */
function Prove({ tema }: { tema: 'hvit' | 'papir' }) {
  const f = tema === 'hvit'
    ? { krom: '#F5F5F7', strek: '#1D1D1F', flate: '#FFFFFF', kort: '#FFFFFF', kant: '#E5E5EA' }
    : { krom: '#211C15', strek: '#B98A5C', flate: '#EFEAE1', kort: '#FFFFFF', kant: '#DED6C7' }
  return (
    <div className="tema-prove" style={{ borderColor: f.kant }} aria-hidden>
      <div className="tema-prove-rail" style={{ background: f.krom }}>
        <i style={{ background: f.strek }} />
        <i style={{ background: f.strek }} />
        <i style={{ background: f.strek }} />
      </div>
      <div className="tema-prove-flate" style={{ background: f.flate }}>
        <div className="tema-prove-kort" style={{ background: f.kort, borderColor: f.kant }} />
      </div>
    </div>
  )
}

// ── Mine timer ────────────────────────────────────────────────────────────

/**
 * Uka di, dag for dag. Samme ukeregning som Timer-flata (`lib/timesheet-calc`),
 * men bare dine egne rader — og derfor uten `timer.les`: dine timer er dine.
 */
function MineTimer({ brukerId }: { brukerId: string }) {
  const [start, setStart] = useState(() => ukeStart(new Date()))
  const [rader, setRader] = useState<Timerad[]>([])
  const [ordrer, setOrdrer] = useState<Map<string, Ordrerad>>(new Map())
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    if (!brukerId) return
    let avbrutt = false
    setLaster(true)
    hentMineTimer(brukerId, start, ukeSlutt(start))
      .then(r => { if (!avbrutt) { setRader(r); setFeil(null) } })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!avbrutt) setLaster(false) })
    return () => { avbrutt = true }
  }, [brukerId, start])

  // Ordretitlene hentes én gang. Feiler det, står timene der likevel — bare
  // uten navn på jobben.
  useEffect(() => {
    let avbrutt = false
    hentOrdrer({})
      .then(o => { if (!avbrutt) setOrdrer(new Map(o.map(x => [x.id, x]))) })
      .catch(() => { /* titlene er pynt her */ })
    return () => { avbrutt = true }
  }, [])

  const dager = useMemo(() => {
    const d: { timer: number; rader: Timerad[] }[] = Array.from({ length: 7 }, () => ({ timer: 0, rader: [] }))
    for (const t of rader) {
      const i = Math.floor((new Date(t.date).getTime() - start.getTime()) / 86_400_000)
      if (i < 0 || i > 6) continue
      d[i].timer += t.hours
      d[i].rader.push(t)
    }
    return d
  }, [rader, start])

  const sum = dager.reduce((n, d) => n + d.timer, 0)
  const fakturerbart = rader.reduce((n, t) => n + (t.billable !== false ? t.hours : 0), 0)
  const denneUka = ukeStart(new Date()).getTime() === start.getTime()
  const iDag = Math.floor((ukeStart(new Date()).getTime() - start.getTime()) / 86_400_000) === 0
    ? (new Date().getDay() + 6) % 7
    : -1

  return (
    <Kort
      tittel="Mine timer"
      merkelapp={laster ? 'Henter …' : `${formatTimer(sum)} ført · ${formatTimer(fakturerbart)} fakturerbart · ${stk(rader.length, 'føring', 'føringer')}`}
      verktoy={
        <div className="rad">
          <Ikonknapp onClick={() => setStart(flyttUke(start, -1))} title="Forrige uke" aria-label="Forrige uke">
            <ChevronLeft size={18} strokeWidth={2} />
          </Ikonknapp>
          <span style={{ minWidth: 150, textAlign: 'center', fontWeight: 500 }}>{ukeEtikett(start)}</span>
          <Ikonknapp onClick={() => setStart(flyttUke(start, 1))} title="Neste uke" aria-label="Neste uke">
            <ChevronRight size={18} strokeWidth={2} />
          </Ikonknapp>
          {!denneUka ? <Knapp onClick={() => setStart(ukeStart(new Date()))}>Denne uka</Knapp> : null}
        </div>
      }
    >
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      <div className="uke">
        {dager.map((d, i) => (
          <div key={i} className={i === iDag ? 'uke-dag uke-dag-idag' : 'uke-dag'}>
            <div className="uke-hode">
              <span className="uke-navn">{DAGER[i]}</span>
              <span className={d.timer === 0 ? 'uke-sum uke-sum-tom' : 'uke-sum'}>
                {d.timer === 0 ? '·' : formatTimer(d.timer)}
              </span>
            </div>
            <div className="uke-jobber">
              {d.rader.map(t => {
                const o = t.order_id ? ordrer.get(t.order_id) : undefined
                return (
                  <a key={t.id} className="uke-jobb" href="#/ordre">
                    <span className="uke-jobb-tid">{formatTimer(t.hours)}{t.billable === false ? ' · ikke fakturerbar' : ''}</span>
                    <span className="uke-jobb-tittel">
                      {o ? `${o.order_number != null ? `#${o.order_number} ` : ''}${o.title}` : 'Ordre'}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Kort>
  )
}

// ── Totrinnsbekreftelse ───────────────────────────────────────────────────

type TotrinnSteg = 'henter' | 'av' | 'pamelding' | 'pa' | 'kobler-fra'

/**
 * Autentiseringsappen din.
 *
 * Kontoret krever den for å invitere ansatte (`ui/Inviter.tsx`), men den skal
 * kunne kobles FØR man står i den situasjonen — og kobles fra igjen når
 * telefonen byttes. Frakobling krever en kode fra den gamle appen: Supabase
 * nekter uansett å fjerne en verifisert faktor fra en økt uten `aal2`, og det
 * er riktig — ellers kunne en åpen økt på en ulåst PC skru av sperren.
 */
function Totrinn() {
  const [steg, setSteg] = useState<TotrinnSteg>('henter')
  const [faktorId, setFaktorId] = useState<string | null>(null)
  const [pamelding, setPamelding] = useState<Pamelding | null>(null)
  const [kode, setKode] = useState('')
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)
  const [kvittering, setKvittering] = useState<string | null>(null)

  useEffect(() => {
    let avbrutt = false
    verifisertFaktor()
      .then(id => { if (!avbrutt) { setFaktorId(id); setSteg(id ? 'pa' : 'av') } })
      .catch(e => { if (!avbrutt) { setFeil(e instanceof Error ? e.message : String(e)); setSteg('av') } })
    return () => { avbrutt = true }
  }, [])

  async function start() {
    setJobber(true); setFeil(null); setKvittering(null)
    try {
      const ny = await meldPa()
      setPamelding(ny)
      setFaktorId(ny.faktorId)
      setSteg('pamelding')
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  async function bekreft(ev: React.FormEvent) {
    ev.preventDefault()
    if (!faktorId) return
    setJobber(true); setFeil(null)
    try {
      await bekreftKode(faktorId, kode)
      setKode(''); setPamelding(null)
      setSteg('pa')
      setKvittering('Autentiseringsappen er koblet.')
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  async function fjern(ev: React.FormEvent) {
    ev.preventDefault()
    if (!faktorId) return
    setJobber(true); setFeil(null)
    try {
      await kobleFra(faktorId, kode)
      setKode(''); setFaktorId(null)
      setSteg('av')
      setKvittering('Autentiseringsappen er koblet fra.')
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  const merke = steg === 'pa' || steg === 'kobler-fra'
    ? <Merke stil="ny">Koblet</Merke>
    : steg === 'henter' ? null : <Merke>Ikke koblet</Merke>

  return (
    <Kort tittel="Totrinnsbekreftelse" verktoy={merke}>
      <div className="stabel">
        {kvittering ? <Beskjed stil="ok">{kvittering}</Beskjed> : null}

        {steg === 'henter' ? <p className="kort-hjelp">Henter …</p> : null}

        {steg === 'av' ? (
          <>
            <p className="kort-hjelp">
              En autentiseringsapp gir en engangskode i tillegg til passordet. Kontoret spør etter
              den når du inviterer ansatte, og den gjør kontoen din vesentlig vanskeligere å kapre.
            </p>
            {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
            <div>
              <Knapp stil="merke" disabled={jobber} onClick={start}>
                {jobber ? 'Åpner …' : 'Koble autentiseringsapp'}
              </Knapp>
            </div>
          </>
        ) : null}

        {steg === 'pamelding' ? (
          <form className="stabel" onSubmit={bekreft}>
            <div className="qr-rad">
              {pamelding ? <img className="qr" src={pamelding.qr} alt="QR-kode for autentiseringsappen" /> : null}
              <div className="stabel">
                <p className="felt-hjelp">
                  Skann koden med Google Authenticator, Microsoft Authenticator, 1Password eller en
                  annen app som lager engangskoder.
                </p>
                <p className="felt-hjelp">
                  Får du ikke skannet, skriv inn denne i appen i stedet:
                  {' '}<code className="valgbar">{pamelding?.hemmelighet}</code>
                </p>
              </div>
            </div>
            <Felt
              etikett="Kode fra appen"
              firkant
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              hjelp="Seks siffer."
              value={kode}
              onChange={e => setKode(e.target.value)}
            />
            {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
            <div className="rad">
              <Knapp stil="merke" type="submit" disabled={jobber || kode.replace(/\s/g, '').length < 6}>
                {jobber ? 'Bekrefter …' : 'Koble appen'}
              </Knapp>
              <Knapp type="button" onClick={() => { setSteg('av'); setKode(''); setFeil(null); setPamelding(null) }}>
                Avbryt
              </Knapp>
            </div>
          </form>
        ) : null}

        {steg === 'pa' ? (
          <>
            <p className="kort-hjelp">
              Autentiseringsappen er koblet til kontoen din. Bytter du telefon, koble den fra her
              først og koble den nye til etterpå.
            </p>
            {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
            <div>
              <Knapp onClick={() => { setSteg('kobler-fra'); setFeil(null); setKvittering(null) }}>
                Koble fra
              </Knapp>
            </div>
          </>
        ) : null}

        {steg === 'kobler-fra' ? (
          <form className="stabel" onSubmit={fjern}>
            <p className="kort-hjelp">
              Skriv inn en kode fra appen for å bekrefte at det er du som kobler den fra.
            </p>
            <Felt
              etikett="Kode fra appen"
              firkant
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={kode}
              onChange={e => setKode(e.target.value)}
            />
            {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
            <div className="rad">
              <Knapp stil="fare" type="submit" disabled={jobber || kode.replace(/\s/g, '').length < 6}>
                {jobber ? 'Kobler fra …' : 'Koble fra appen'}
              </Knapp>
              <Knapp type="button" onClick={() => { setSteg('pa'); setKode(''); setFeil(null) }}>Avbryt</Knapp>
            </div>
          </form>
        ) : null}
      </div>
    </Kort>
  )
}

// ── Slett kontoen ─────────────────────────────────────────────────────────

function SlettKonto({ epost }: { epost: string }) {
  const [apen, setApen] = useState(false)
  const [passord, setPassord] = useState('')
  const [forstatt, setForstatt] = useState(false)
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)
  const [ferdig, setFerdig] = useState(false)

  async function slett(ev: React.FormEvent) {
    ev.preventDefault()
    setJobber(true); setFeil(null)
    try {
      await slettMeg(passord)
      setFerdig(true)
      // Kontoen finnes ikke lenger, så utloggingen kan feile mot serveren.
      // Den lokale økta skal bort uansett.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
      setPassord('')
    }
    setJobber(false)
  }

  if (ferdig) {
    return (
      <Kort tittel="Slett brukeren">
        <Beskjed stil="ok">Brukeren din er slettet. Du logges ut.</Beskjed>
      </Kort>
    )
  }

  return (
    <Kort tittel="Slett brukeren">
      <div className="stabel">
        <p className="kort-hjelp">
          Du kan slette brukeren din selv. Navn, telefon og innlogging fjernes, og e-postadressen
          frigjøres. Timer, signaturer og dokumenter du har vært med på beholdes hos firmaet så
          lenge bokføringsloven krever, uten kobling til deg som person utover det loven krever.
        </p>
        {!apen ? (
          <div>
            <Knapp stil="fare" onClick={() => setApen(true)}>Slett brukeren min …</Knapp>
          </div>
        ) : (
          <form className="stabel" onSubmit={slett}>
            <Felt
              etikett={`Passordet for ${epost}`}
              firkant
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passord}
              onChange={e => setPassord(e.target.value)}
            />
            <label className="rad" style={{ alignItems: 'flex-start', gap: 10 }}>
              <input
                type="checkbox"
                checked={forstatt}
                onChange={e => setForstatt(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span className="felt-hjelp">
                Jeg forstår at dette ikke kan angres, og at jeg må inviteres på nytt for å komme
                tilbake.
              </span>
            </label>
            {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
            <div className="rad">
              <Knapp stil="fare" type="submit" disabled={jobber || !forstatt || passord.length === 0}>
                {jobber ? 'Sletter …' : 'Slett brukeren min'}
              </Knapp>
              <Knapp type="button" onClick={() => { setApen(false); setPassord(''); setFeil(null); setForstatt(false) }}>
                Avbryt
              </Knapp>
            </div>
          </form>
        )}
      </div>
    </Kort>
  )
}

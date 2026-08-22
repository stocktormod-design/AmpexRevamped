import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { useAuth } from '@/auth'
import { lenke, lenkeType, supabase, tilbakeUrl } from '@/supabase'
import { AmpexLogo } from '@/ui/AmpexLogo'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/** Samme testkonto som montørappens innlogging bruker. */
const TEST = { epost: 'test@ampex.no', passord: 'ampex-test-2026' }

/** Adressen forrige innlogging brukte. Se `husk`. */
const HUSKET = 'ampex.kontor.epost'

/** Supabase krever seks. Åtte er husets krav, og det står i klartekst i feltet. */
const MINSTE_PASSORD = 8

/**
 * Supabase svarer på engelsk, og med utviklerens ordvalg.
 *
 * Den som står på et kontor og har tastet feil skal ikke måtte oversette
 * «Invalid login credentials», og skal aller minst få «Failed to fetch» når
 * det egentlig er nettet som er nede. Ukjente feil slipper gjennom som de er:
 * en uoversatt beskjed er bedre enn en oppdiktet.
 */
function norsk(melding: string): string {
  const m = melding.toLowerCase()
  if (/invalid login credentials|invalid credentials/.test(m)) return 'Feil e-post eller passord.'
  if (/email not confirmed/.test(m)) return 'E-postadressen er ikke bekreftet ennå. Se etter bekreftelsen i innboksen.'
  if (/email address .* is invalid|invalid email/.test(m)) return 'Det ser ikke ut som en gyldig e-postadresse.'
  if (/rate limit|too many requests|for security purposes/.test(m)) return 'For mange forsøk. Vent et minutt og prøv igjen.'
  if (/failed to fetch|networkerror|network request failed|load failed/.test(m)) return 'Får ikke kontakt med Ampex. Sjekk nettforbindelsen og prøv igjen.'
  if (/user not found/.test(m)) return 'Fant ingen konto på den adressen.'
  if (/same password/.test(m)) return 'Det nye passordet er det samme som det gamle. Velg et annet.'
  if (/password should be at least/.test(m)) return `Passordet må ha minst ${MINSTE_PASSORD} tegn.`
  if (/weak password/.test(m)) return 'Passordet er for svakt. Velg et lengre, med flere slags tegn.'
  if (/expired|invalid/.test(m) && /session|jwt|token/.test(m)) return 'Økta er utløpt. Logg inn på nytt.'
  return melding
}

/**
 * Adressen fylles ut på forhånd, passordet aldri.
 *
 * Kontor-PC-en deles ofte, og e-post er ikke en hemmelighet — men det er
 * forskjell på å slippe å taste adressen sin hver morgen og på å legge igjen en
 * nøkkel i låsen. Derfor bare den ene halvparten, og derfor `localStorage` og
 * ikke sesjonen: poenget er nettopp at den overlever at maskina skrus av.
 */
function husk(epost: string) {
  try { window.localStorage.setItem(HUSKET, epost) } catch { /* privat modus */ }
}
function husket(): string {
  try { return window.localStorage.getItem(HUSKET) ?? '' } catch { return '' }
}

/**
 * Passordfelt med øye.
 *
 * To ting her er ikke pynt. Caps Lock-varselet, fordi «feil passord» tre ganger
 * på rad nesten alltid er den tasten. Og at knappen står UTENFOR `<label>`-en:
 * et klikk på en knapp inni en label aktiverer også labelen, og feltet ville
 * rykket i fokus hver gang du bare ville se hva du skrev.
 */
function Passordfelt({
  etikett,
  hjelp,
  felt,
  ...rest
}: {
  etikett: string
  hjelp?: string
  felt?: RefObject<HTMLInputElement | null>
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const [synlig, setSynlig] = useState(false)
  const [caps, setCaps] = useState(false)

  const sjekkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCaps(e.getModifierState('CapsLock'))
  }

  return (
    <div className="felt felt-firkant">
      <label className="felt-etikett" htmlFor={id}>{etikett}</label>
      <div className="felt-med-knapp">
        <input
          {...rest}
          id={id}
          ref={felt}
          className="felt-inn"
          type={synlig ? 'text' : 'password'}
          onKeyDown={sjekkCaps}
          onKeyUp={sjekkCaps}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="felt-vis"
          onClick={() => setSynlig(v => !v)}
          title={synlig ? 'Skjul passordet' : 'Vis passordet'}
          aria-label={synlig ? 'Skjul passordet' : 'Vis passordet'}
          aria-pressed={synlig}
          tabIndex={-1}
        >
          {synlig ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}
        </button>
      </div>
      {caps ? <span className="felt-hjelp felt-caps">Caps Lock er på.</span> : null}
      {hjelp && !caps ? <span className="felt-hjelp">{hjelp}</span> : null}
    </div>
  )
}

/**
 * Beskjedene bor i et levende felt.
 *
 * `aria-live` er hele grunnen til at dette er en egen komponent: en feilmelding
 * som bare dukker opp i DOM-en blir aldri lest opp, og den som navigerer med
 * tastatur står igjen med en knapp som tilsynelatende ikke gjorde noe.
 */
function Meldinger({ feil, ok }: { feil: string | null; ok?: string | null }) {
  return (
    <div role="status" aria-live="polite" className="logginn-meldinger">
      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
      {ok ? <Beskjed stil="ok">{ok}</Beskjed> : null}
    </div>
  )
}

/** Rammen de tre skjermene deler: merket, kortet, linja under. */
function Flate({ under, children }: { under: ReactNode; children: ReactNode }) {
  return (
    <div className="logginn">
      <div className="logginn-boks">
        <div className="logginn-merke">
          <AmpexLogo size={44} />
          <div className="logginn-navn">Ampex Kontor</div>
          <div className="logginn-under">Samme konto som i appen</div>
        </div>
        {children}
        <p className="logginn-bunn">{under}</p>
      </div>
    </div>
  )
}

type Modus = 'logg-inn' | 'glemt'

/**
 * Innlogging.
 *
 * Dette er den ENESTE skjermen uten sidemeny, og det avgjør utseendet: når
 * møbelet er borte, blir kromet hele flaten og kortet er papiret. Samme forhold
 * som resten av appen, bare uten rammen rundt — så den som logger inn har sett
 * fargene før han er innenfor.
 *
 * «Glemt passord» er en tilstand i det samme kortet, ikke en egen rute. Flaten
 * har ingen adresselinje å rute med, og å bytte hele kortet for ett felt og én
 * knapp leser som at man har havnet et helt annet sted.
 */
export function Logginn() {
  const { lenkefeil } = useAuth()
  const [modus, setModus] = useState<Modus>('logg-inn')
  const [epost, setEpost] = useState(husket)
  const [passord, setPassord] = useState('')
  const [feil, setFeil] = useState<string | null>(lenkefeil)

  // `verifyOtp` er et nettverkskall, så en død lenke kan komme fram ETTER at
  // skjermen er tegnet. Uten dette ville brukeren sett et blankt skjema og
  // trodd at han bare hadde klikket feil.
  useEffect(() => { if (lenkefeil) setFeil(lenkefeil) }, [lenkefeil])
  const [sendt, setSendt] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)
  const passordfelt = useRef<HTMLInputElement>(null)

  // Er adressen husket fra sist, er det passordet som mangler. Da skal
  // skrivemerket stå der, og ikke i et felt som allerede er fylt ut.
  useEffect(() => { if (husket()) passordfelt.current?.focus() }, [])

  const nullstill = () => { setFeil(null); setSendt(null) }

  async function signIn(e: string, p: string) {
    setJobber(true)
    nullstill()
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p })
    if (error) setFeil(norsk(error.message))
    else husk(e)
    setJobber(false)
  }

  function logginn(ev: React.FormEvent) {
    ev.preventDefault()
    // Adressen renses før den sendes. En kopiert e-post drar med seg mellomrom,
    // og «Ola@Ampex.no» er samme konto som «ola@ampex.no» — men ikke for
    // signInWithPassword.
    const e = epost.trim().toLowerCase()
    if (!e) { setFeil('Skriv e-postadressen din.'); return }
    if (!passord) { setFeil('Skriv passordet ditt.'); return }
    setEpost(e)
    void signIn(e, passord)
  }

  async function glemt(ev: React.FormEvent) {
    ev.preventDefault()
    const e = epost.trim().toLowerCase()
    if (!e) { setFeil('Skriv e-postadressen din.'); return }
    setEpost(e)
    setJobber(true)
    nullstill()
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: tilbakeUrl })
    // Svaret er det samme enten kontoen finnes eller ikke. Et skjema som sier
    // «fant ingen konto» forteller hvem som jobber i firmaet til hvem som helst
    // som gidder å gjette adresser. Bare bremsen fra Supabase slipper gjennom,
    // for den må den som venter på e-posten faktisk forholde seg til.
    if (error && /rate limit|for security purposes|too many/i.test(error.message)) {
      setFeil(norsk(error.message))
    } else {
      setSendt(`Finnes det en konto på ${e}, ligger det en lenke i innboksen nå.`)
    }
    setJobber(false)
  }

  if (modus === 'glemt') {
    return (
      <Flate under="Kommer det ingen e-post, se i søppelposten — eller be installatøren i firmaet nullstille for deg.">
        <form className="logginn-kort stabel" onSubmit={glemt}>
          <div className="logginn-tittel">
            <h2>Glemt passord</h2>
            <p className="felt-hjelp">Vi sender en lenke som lar deg sette et nytt.</p>
          </div>
          <Felt
            etikett="E-post"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            firkant
            value={epost}
            onChange={e => setEpost(e.target.value)}
          />
          <Meldinger feil={feil} ok={sendt} />
          <Knapp stil="merke" type="submit" disabled={jobber}>
            {jobber ? 'Sender …' : 'Send lenke'}
          </Knapp>
          <Knapp stil="naken" type="button" onClick={() => { setModus('logg-inn'); nullstill() }}>
            <ArrowLeft size={16} strokeWidth={1.8} /> Tilbake til innlogging
          </Knapp>
        </form>
      </Flate>
    )
  }

  return (
    <Flate under="Konto opprettes av installatøren i firmaet.">
      <form className="logginn-kort stabel" onSubmit={logginn}>
        <Felt
          etikett="E-post"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus={!husket()}
          firkant
          value={epost}
          onChange={e => setEpost(e.target.value)}
        />
        <Passordfelt
          etikett="Passord"
          autoComplete="current-password"
          felt={passordfelt}
          value={passord}
          onChange={e => setPassord(e.target.value)}
        />
        <div className="logginn-rad">
          <button type="button" className="logginn-lenke" onClick={() => { setModus('glemt'); nullstill() }}>
            Glemt passord?
          </button>
        </div>
        <Meldinger feil={feil} ok={sendt} />
        <Knapp stil="merke" type="submit" disabled={jobber}>
          {jobber ? 'Logger inn …' : 'Logg inn'}
        </Knapp>

        {/* KUN i utviklingsbygg.
            Montørappen viser den samme knappen i Release, og det er forsvarlig
            der: en app-binær går til en kjent flåte. Et nettsted gjør ikke det.
            En knapp som logger hvem som helst inn som eier, på en offentlig
            URL, er en dør uten lås — og `import.meta.env.DEV` er false i alt
            `vite build` lager. Verifisert på ampex.no: strengen finnes ikke i
            produksjonsbundelen. */}
        {import.meta.env.DEV ? (
          <Knapp
            stil="naken"
            type="button"
            disabled={jobber}
            onClick={() => void signIn(TEST.epost, TEST.passord)}
          >
            Test-innlogging <span className="dempet-mer">dev</span>
          </Knapp>
        ) : null}
      </form>
    </Flate>
  )
}

/**
 * Passordskjermen bak en e-postlenke.
 *
 * Vises i stedet for kontoret så lenge `gjenoppretting` står — se `auth.tsx`.
 * Lenka er i praksis en innlogging uten passord, og den skal rekke å gjøre én
 * ting før den er brukt opp.
 *
 * To lenker ender her, og de er ikke det samme for den som står foran skjermen.
 * «Glemt passord» er noe du ba om selv. En invitasjon er første gang du ser
 * Ampex i det hele tatt, og da er «velg et NYTT passord» feil på et vis som gjør
 * folk usikre: nytt i forhold til hva? Derfor to sett med ord, og bare det.
 */
export function NyttPassord() {
  const { ferdigGjenopprettet, loggUt } = useAuth()
  const invitert = lenkeType === 'invite' || lenke?.type === 'invite'
  const [passord, setPassord] = useState('')
  const [igjen, setIgjen] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)

  async function lagre(ev: React.FormEvent) {
    ev.preventDefault()
    if (passord.length < MINSTE_PASSORD) {
      setFeil(`Passordet må ha minst ${MINSTE_PASSORD} tegn.`)
      return
    }
    if (passord !== igjen) { setFeil('De to passordene er ikke like.'); return }
    setJobber(true)
    setFeil(null)
    const { error } = await supabase.auth.updateUser({ password: passord })
    if (error) setFeil(norsk(error.message))
    else ferdigGjenopprettet()
    setJobber(false)
  }

  return (
    <Flate under="Passordet gjelder både her og i appen på telefonen.">
      <form className="logginn-kort stabel" onSubmit={lagre}>
        <div className="logginn-tittel">
          <h2>{invitert ? 'Velkommen til Ampex' : 'Velg et nytt passord'}</h2>
          <p className="felt-hjelp">
            {invitert
              ? 'Velg et passord, så er du inne. Det er det eneste som mangler.'
              : 'Lenka er brukt opp når dette er lagret.'}
          </p>
        </div>
        <Passordfelt
          etikett={invitert ? 'Passord' : 'Nytt passord'}
          autoComplete="new-password"
          autoFocus
          hjelp={`Minst ${MINSTE_PASSORD} tegn.`}
          value={passord}
          onChange={e => setPassord(e.target.value)}
        />
        <Passordfelt
          etikett="Gjenta passordet"
          autoComplete="new-password"
          value={igjen}
          onChange={e => setIgjen(e.target.value)}
        />
        <Meldinger feil={feil} />
        <Knapp stil="merke" type="submit" disabled={jobber}>
          {jobber ? 'Lagrer …' : invitert ? 'Sett passord og kom i gang' : 'Lagre og fortsett'}
        </Knapp>
        <Knapp stil="naken" type="button" onClick={() => void loggUt()}>
          Avbryt
        </Knapp>
      </form>
    </Flate>
  )
}

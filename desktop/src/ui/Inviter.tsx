import { rollenavn, type Rolle } from '@delt/kontor-tilgang'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  inviterAnsatte,
  MAKS_PER_INVITASJON,
  type Invitert,
  type Utfall,
} from '@/lib/brukere'
import { bekreftKode, meldPa, verifisertFaktor, type Pamelding } from '@/lib/tofaktor'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/**
 * Invitasjonsskjemaet, med totrinnsbekreftelse foran.
 *
 * ── Hvorfor en kode akkurat her ───────────────────────────────────────────
 *
 * Invitasjonen er den ene handlingen i kontoret som lager en NY dør inn i
 * firmaet, og den som inviterer setter rollen — altså hvem som får se lønn,
 * dekningsbidrag og kunderegister. Kaprer noen en eiers økt på en ulåst
 * kontor-PC, er dette skjemaet den korteste veien til en permanent bakdør.
 *
 * Derfor kreves koden HVER gang, ikke bare ved innlogging. Det er serveren som
 * håndhever det; se `supabase/functions/inviter-ansatt`.
 *
 * ── Hvorfor ti om gangen, og bare én kode ─────────────────────────────────
 *
 * Et firma ansetter i puljer — tre lærlinger i august, ikke én i uka. Å be om
 * en ny kode per person ville gjort ti invitasjoner til ti anledninger til å
 * taste feil, uten å gjøre noe tryggere: koden beviser hvem som sitter der, og
 * han sitter der én gang.
 */

const ROLLEVALG: Rolle[] = ['montor', 'laerling', 'bas', 'installator', 'regnskapsforer', 'admin', 'owner']

const TOM: Invitert = { navn: '', epost: '', rolle: 'montor' }

type Steg = 'lukket' | 'henter' | 'pamelding' | 'skjema'

export function Inviter({ ferdig }: { ferdig: () => void }) {
  const [steg, setSteg] = useState<Steg>('lukket')
  const [faktorId, setFaktorId] = useState<string | null>(null)
  const [pamelding, setPamelding] = useState<Pamelding | null>(null)

  const [rader, setRader] = useState<Invitert[]>([{ ...TOM }])
  const [kode, setKode] = useState('')
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)
  const [utfall, setUtfall] = useState<Utfall[] | null>(null)

  // Hvilket steg vi skal inn på avgjøres av om autentiseringsappen allerede er
  // koblet. Spørres når skjemaet åpnes, ikke ved hver tast.
  useEffect(() => {
    if (steg !== 'henter') return
    let avbrutt = false
    verifisertFaktor()
      .then(async id => {
        if (avbrutt) return
        if (id) { setFaktorId(id); setSteg('skjema'); return }
        const ny = await meldPa()
        if (avbrutt) return
        setPamelding(ny)
        setFaktorId(ny.faktorId)
        setSteg('pamelding')
      })
      .catch(e => { if (!avbrutt) { setFeil(e instanceof Error ? e.message : String(e)); setSteg('lukket') } })
    return () => { avbrutt = true }
  }, [steg])

  function lukk() {
    setSteg('lukket'); setRader([{ ...TOM }]); setKode(''); setFeil(null); setPamelding(null)
  }

  function endre(i: number, felt: keyof Invitert, verdi: string) {
    setRader(r => r.map((rad, j) => (j === i ? { ...rad, [felt]: verdi } : rad)))
  }

  async function bekreftPamelding(ev: React.FormEvent) {
    ev.preventDefault()
    if (!faktorId) return
    setJobber(true); setFeil(null)
    try {
      await bekreftKode(faktorId, kode)
      setKode('')
      setPamelding(null)
      setSteg('skjema')
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  async function send(ev: React.FormEvent) {
    ev.preventDefault()
    if (!faktorId) return

    const klare = rader
      .map(r => ({ navn: r.navn.trim(), epost: r.epost.trim().toLowerCase(), rolle: r.rolle }))
      .filter(r => r.navn || r.epost)

    if (klare.length === 0) { setFeil('Fyll ut minst én rad.'); return }
    const mangler = klare.find(r => !r.navn || !r.epost)
    if (mangler) { setFeil('Alle radene trenger både navn og e-post.'); return }

    // Samme adresse to ganger i samme bunke: den andre ville uansett kommet
    // tilbake som «finnes allerede», men da har vi brukt en invitasjon på å
    // fortelle deg noe du kunne fått vite her.
    const duplikat = klare.find((r, i) => klare.findIndex(a => a.epost === r.epost) !== i)
    if (duplikat) { setFeil(`${duplikat.epost} står to ganger i lista.`); return }

    setJobber(true); setFeil(null)
    try {
      await bekreftKode(faktorId, kode)
      const { resultat } = await inviterAnsatte(klare)
      setUtfall(resultat)
      setRader([{ ...TOM }])
      setKode('')
      setSteg('lukket')
      ferdig()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
      setKode('')
    }
    setJobber(false)
  }

  // ── Lukket ──────────────────────────────────────────────────────────────
  if (steg === 'lukket' || steg === 'henter') {
    return (
      <div className="stabel">
        {utfall ? <Kvittering utfall={utfall} /> : null}
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <div>
          <Knapp
            stil="merke"
            disabled={steg === 'henter'}
            onClick={() => { setUtfall(null); setFeil(null); setSteg('henter') }}
          >
            {steg === 'henter' ? 'Åpner …' : 'Inviter ansatte'}
          </Knapp>
        </div>
      </div>
    )
  }

  // ── Påmelding: koble autentiseringsappen ────────────────────────────────
  if (steg === 'pamelding') {
    return (
      <form className="stabel" onSubmit={bekreftPamelding}>
        <div className="logginn-tittel">
          <h3>Koble en autentiseringsapp</h3>
          <p className="felt-hjelp">
            Å invitere noen er å lage en ny dør inn i firmaet, og å bestemme hvor mye den
            personen får se. Derfor spør vi om en kode først — denne ene gangen for å koble
            appen, og siden hver gang du inviterer.
          </p>
        </div>

        <div className="qr-rad">
          {pamelding ? <img className="qr" src={pamelding.qr} alt="QR-kode for autentiseringsappen" /> : null}
          <div className="stabel">
            <p className="felt-hjelp">
              Skann koden med Google Authenticator, Microsoft Authenticator, 1Password eller
              en annen app som lager engangskoder.
            </p>
            {/* Fallback for den som sitter PÅ telefonen og ikke kan skanne sin
                egen skjerm, eller som har kamera som ikke vil. */}
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
          <Knapp type="button" onClick={lukk}>Avbryt</Knapp>
        </div>
      </form>
    )
  }

  // ── Skjemaet ────────────────────────────────────────────────────────────
  return (
    <form className="stabel" onSubmit={send}>
      {rader.map((rad, i) => (
        <div className="inviter-felt" key={i}>
          <Felt
            etikett={i === 0 ? 'Navn' : undefined}
            firkant
            autoFocus={i === 0}
            value={rad.navn}
            onChange={e => endre(i, 'navn', e.target.value)}
          />
          <Felt
            etikett={i === 0 ? 'E-post' : undefined}
            type="email"
            inputMode="email"
            firkant
            value={rad.epost}
            onChange={e => endre(i, 'epost', e.target.value)}
          />
          <label className="felt felt-firkant">
            {i === 0 ? <span className="felt-etikett">Rolle</span> : null}
            <select
              className="velger"
              value={rad.rolle}
              onChange={e => endre(i, 'rolle', e.target.value)}
            >
              {ROLLEVALG.map(r => <option key={r} value={r}>{rollenavn(r)}</option>)}
            </select>
          </label>
          {rader.length > 1 ? (
            <button
              type="button"
              className="inviter-fjern"
              title="Fjern raden"
              aria-label="Fjern raden"
              onClick={() => setRader(r => r.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      ))}

      {rader.length < MAKS_PER_INVITASJON ? (
        <div>
          <Knapp type="button" onClick={() => setRader(r => [...r, { ...TOM }])}>
            <Plus size={16} strokeWidth={1.8} /> Én til
          </Knapp>
        </div>
      ) : (
        <p className="felt-hjelp">Ti om gangen er taket. Send disse først, så tar du resten etterpå.</p>
      )}

      <Felt
        etikett="Kode fra autentiseringsappen"
        firkant
        inputMode="numeric"
        autoComplete="one-time-code"
        hjelp="Seks siffer. Kreves hver gang det inviteres, ikke bare ved innlogging."
        value={kode}
        onChange={e => setKode(e.target.value)}
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="rad">
        <Knapp stil="merke" type="submit" disabled={jobber || kode.replace(/\s/g, '').length < 6}>
          {jobber ? 'Sender …' : `Send ${rader.length === 1 ? 'invitasjon' : 'invitasjoner'}`}
        </Knapp>
        <Knapp type="button" onClick={lukk}>Avbryt</Knapp>
        <span className="strekk" />
        <span className="dempet-mer">Rollen kan endres etterpå.</span>
      </div>
    </form>
  )
}

/**
 * Hva som faktisk skjedde, per person.
 *
 * En bunke på ti kan ha ti forskjellige utfall, og «sendt» over det hele ville
 * vært en løgn i det øyeblikket én av adressene tilhørte et annet firma.
 */
function Kvittering({ utfall }: { utfall: Utfall[] }) {
  const ord: Record<Utfall['status'], string> = {
    invitert: 'invitasjon sendt',
    'lagt-til': 'hadde konto fra før, lagt til i firmaet',
    finnes: 'sto allerede i firmaet',
    avvist: 'avvist',
  }
  const noe_gikk_galt = utfall.some(u => u.status === 'avvist')
  return (
    <Beskjed stil={noe_gikk_galt ? 'varsel' : 'ok'}>
      <ul className="kvittering">
        {utfall.map(u => (
          <li key={u.epost}>
            <strong>{u.navn || u.epost}</strong> — {ord[u.status]}
            {u.grunn ? `: ${u.grunn}` : ''}
          </li>
        ))}
      </ul>
    </Beskjed>
  )
}

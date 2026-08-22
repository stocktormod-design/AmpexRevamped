import { useState } from 'react'
import { supabase } from '@/supabase'
import { AmpexLogo } from '@/ui/AmpexLogo'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/** Samme testkonto som montørappens innlogging bruker. */
const TEST = { epost: 'test@ampex.no', passord: 'ampex-test-2026' }

/**
 * Innlogging.
 *
 * Dette er den ENESTE skjermen uten sidemeny, og det avgjør utseendet: når
 * møbelet er borte, blir kromet hele flaten og kortet er papiret. Samme forhold
 * som resten av appen, bare uten rammen rundt — så den som logger inn har sett
 * fargene før han er innenfor.
 *
 * Forrige versjon sto på `className="panel …"`, og `.panel` finnes ikke i
 * styles.css. Kortet hadde derfor verken bakgrunn, kant eller luft: krem på
 * krem, med sidemenyens lille avatarprikk lånt som logo.
 */
export function Logginn() {
  const [epost, setEpost] = useState('')
  const [passord, setPassord] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)

  async function signIn(e: string, p: string) {
    setJobber(true)
    setFeil(null)
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p })
    // Supabase svarer «Invalid login credentials» på engelsk. Den som står ute
    // og har tastet feil skal ikke måtte oversette.
    if (error) {
      setFeil(
        /invalid login credentials/i.test(error.message)
          ? 'Feil e-post eller passord.'
          : error.message,
      )
    }
    setJobber(false)
  }

  function logginn(e: React.FormEvent) {
    e.preventDefault()
    void signIn(epost, passord)
  }

  return (
    <div className="logginn">
      <div className="logginn-boks">
        <div className="logginn-merke">
          <AmpexLogo size={44} />
          <div className="logginn-navn">Ampex Kontor</div>
          <div className="logginn-under">Samme konto som i appen</div>
        </div>

        <form className="logginn-kort stabel" onSubmit={logginn}>
          <Felt
            etikett="E-post"
            type="email"
            autoComplete="username"
            autoFocus
            value={epost}
            onChange={e => setEpost(e.target.value)}
          />
          <Felt
            etikett="Passord"
            type="password"
            autoComplete="current-password"
            value={passord}
            onChange={e => setPassord(e.target.value)}
          />
          {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
          <Knapp stil="primar" type="submit" disabled={jobber || !epost || !passord}>
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

        <p className="logginn-bunn">
          Konto opprettes av installatøren i firmaet.
        </p>
      </div>
    </div>
  )
}

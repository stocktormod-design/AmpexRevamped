import { useState } from 'react'
import { supabase } from '@/supabase'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/** Samme testkonto som montørappens innlogging bruker. */
const TEST = { epost: 'test@ampex.no', passord: 'ampex-test-2026' }

export function Logginn() {
  const [epost, setEpost] = useState('')
  const [passord, setPassord] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [jobber, setJobber] = useState(false)

  async function signIn(e: string, p: string) {
    setJobber(true)
    setFeil(null)
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p })
    if (error) setFeil(error.message)
    setJobber(false)
  }

  function logginn(e: React.FormEvent) {
    e.preventDefault()
    void signIn(epost, passord)
  }

  return (
    <div className="logginn">
      <form className="panel logginn-kort stabel" onSubmit={logginn}>
        <div className="rad">
          <div className="rail-merke-prikk">A</div>
          <div>
            <div className="rail-merke-navn">Ampex Kontor</div>
            <div className="rail-merke-rolle">Samme konto som i appen</div>
          </div>
        </div>
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
            `vite build` lager. */}
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
    </div>
  )
}

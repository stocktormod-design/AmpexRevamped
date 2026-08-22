import type { Rolle } from '@delt/kontor-tilgang'
import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { lenkeType, supabase } from '@/supabase'

export type Profil = {
  id: string
  company_id: string | null
  role: Rolle
  full_name: string
}

type Auth = {
  sesjon: Session | null
  profil: Profil | null
  laster: boolean
  feil: string | null
  /**
   * Sant når økta kom fra en e-postlenke: «glemt passord» eller en invitasjon.
   *
   * Begge er en innlogging UTEN passord, sendt på e-post. Uten dette flagget
   * ville lenka sluppet deg rett inn — med det gamle passordet fortsatt
   * gyldig, eller uten at det finnes et i det hele tatt. Flagget holder deg på
   * skjermen som setter et, og slås av først når passordet faktisk er lagret.
   */
  gjenoppretting: boolean
  ferdigGjenopprettet: () => void
  loggUt: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesjon, setSesjon] = useState<Session | null>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [laster, setLaster] = useState(true)
  const [feil, setFeil] = useState<string | null>(null)
  // Settes FØR første render, fra hash-en, og ikke av `PASSWORD_RECOVERY`
  // alene: en invitasjon fyrer `SIGNED_IN` som alle andre innlogginger, og er
  // umulig å kjenne igjen på hendelsen. Se `lenkeType` i supabase.ts.
  const [gjenoppretting, setGjenoppretting] = useState(lenkeType !== null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesjon(data.session)
      if (!data.session) setLaster(false)
    })
    const { data } = supabase.auth.onAuthStateChange((hendelse, s) => {
      if (hendelse === 'PASSWORD_RECOVERY') setGjenoppretting(true)
      // Kun på SIGNED_OUT. `INITIAL_SESSION` kan komme med null mens
      // supabase-js fortsatt holder på med tokenene i hash-en, og en nullstilling
      // der ville sendt den som klikket på lenka til innloggingsskjemaet.
      if (hendelse === 'SIGNED_OUT') setGjenoppretting(false)
      setSesjon(s)
      if (!s) { setProfil(null); setLaster(false) }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const bruker = sesjon?.user
    if (!bruker) return
    let avbrutt = false
    setLaster(true)
    supabase
      .from('profiles')
      .select('id,company_id,role,full_name')
      .eq('id', bruker.id)
      .is('deleted_at', null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (avbrutt) return
        if (error) setFeil(error.message)
        else if (!data) setFeil('Brukeren har ingen profil. Be en administrator legge deg til i firmaet.')
        else { setProfil(data as Profil); setFeil(null) }
        setLaster(false)
      })
    return () => { avbrutt = true }
  }, [sesjon])

  const loggUt = async () => { await supabase.auth.signOut() }
  const ferdigGjenopprettet = () => setGjenoppretting(false)

  return (
    <Ctx.Provider
      value={{ sesjon, profil, laster, feil, gjenoppretting, ferdigGjenopprettet, loggUt }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth utenfor AuthProvider')
  return v
}

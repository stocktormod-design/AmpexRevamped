import type { Rolle } from '@delt/kontor-tilgang'
import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/supabase'

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
  loggUt: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesjon, setSesjon] = useState<Session | null>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [laster, setLaster] = useState(true)
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesjon(data.session)
      if (!data.session) setLaster(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_, s) => {
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

  return <Ctx.Provider value={{ sesjon, profil, laster, feil, loggUt }}>{children}</Ctx.Provider>
}

export function useAuth(): Auth {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth utenfor AuthProvider')
  return v
}

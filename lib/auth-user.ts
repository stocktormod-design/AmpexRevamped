import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/** Innlogget brukers id (for «tildelt meg»-filtre o.l.). */
export function useUserId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data }) => { if (mounted) setId(data.user?.id ?? null) })
    return () => { mounted = false }
  }, [])
  return id
}

/** Innlogget brukers firmarolle (profiles.role) — for rollestyrt UI/navigasjon (regel 4). */
export function useUserRole(): string | null {
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      if (mounted) setRole(profile?.role ?? null)
    })
    return () => { mounted = false }
  }, [])
  return role
}

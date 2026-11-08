import { useEffect, useState } from 'react'
import { supabase } from '@/supabase'
import { Tegnemodus } from '@/tegnemodus/Tegnemodus'

/**
 * Tegnemodusen på en tegning som alt ligger i prosjektets mappetre (Tormod 30.10: «i prosjekt
 * skal dette være bygget på allerede»). Planen er tegningen selv og byttes ikke her; laget som
 * tegnes oppå lagres i `tegningslag` med tegningens id.
 */
export function ProsjektTegning({ prosjektId, tegningId }: { prosjektId: string; tegningId: string }) {
  const [t, setT] = useState<{ navn: string; prosjekt: string; filePath: string | null; tekst: string } | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  useEffect(() => {
    let levende = true
    Promise.all([
      supabase.from('drawings').select('name, file_path, plan, discipline').eq('id', tegningId).single(),
      supabase.from('projects').select('name, customer_name').eq('id', prosjektId).single(),
    ]).then(([d, p]) => {
      if (!levende) return
      if (d.error) { setFeil(`Fant ikke tegningen: ${d.error.message}`); return }
      const x = d.data as { name: string; file_path: string | null; plan: string | null; discipline: string | null }
      const pr = p.data as { name?: string; customer_name?: string | null } | null
      setT({ navn: x.name, prosjekt: pr?.name ?? 'Prosjektet', filePath: x.file_path, tekst: [pr?.name, x.plan, x.discipline, x.name].filter(Boolean).join('\n') })
    })
    return () => { levende = false }
  }, [prosjektId, tegningId])
  if (feil) return <div className="tm"><div className="tm-tom">{feil}</div></div>
  if (!t) return <div className="tm"><div className="tm-tom">Henter tegningen …</div></div>
  if (!t.filePath) return <div className="tm"><div className="tm-tom">Tegningen har ingen PDF ennå. <a href={`#/prosjekt/${prosjektId}`}>Tilbake</a></div></div>
  const type = /\.(png|jpe?g)$/i.test(t.filePath) ? 'bilde' as const : 'pdf' as const
  return (
    <Tegnemodus eier={{ tegning: tegningId }} tittel={t.navn} tilbake={`#/prosjekt/${prosjektId}`}
      sti={[{ navn: 'Prosjekter', href: '#/prosjekt' }, { navn: t.prosjekt, href: `#/prosjekt/${prosjektId}` }]}
      fastPlan={{ key: t.filePath, type }} jobbtekst={t.tekst} />
  )
}

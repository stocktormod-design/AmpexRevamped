import { useEffect, useState } from 'react'
import { supabase } from '@/supabase'
import { Tegnemodus } from '@/tegnemodus/Tegnemodus'

/**
 * Tegningen på ordren (Verona, 30.10): tegnemodusen med planen lastet opp på ordren. Det
 * risikoforslagene leser i tillegg til tegningen er ordrens tittel, beskrivelse og materiell.
 */
export function OrdreTegning({ ordreId }: { ordreId: string }) {
  const [hode, setHode] = useState<{ navn: string; jobbtekst: string } | null>(null)
  useEffect(() => {
    let levende = true
    Promise.all([
      supabase.from('orders').select('title, order_number, description').eq('id', ordreId).single(),
      supabase.from('order_materials').select('description').eq('order_id', ordreId).is('deleted_at', null),
    ]).then(([p, m]) => {
      if (!levende) return
      const o = p.data as { title?: string; order_number?: number | null; description?: string | null } | null
      setHode({
        navn: o ? [o.order_number != null ? `#${o.order_number}` : '', o.title ?? ''].filter(Boolean).join(' ') : 'Ordren',
        jobbtekst: [o?.title, o?.description, ...((m.data ?? []) as { description: string | null }[]).map(x => x.description)].filter(Boolean).join('\n'),
      })
    })
    return () => { levende = false }
  }, [ordreId])
  return (
    <Tegnemodus eier={{ ordre: ordreId }} tittel="Tegning og risiko" tilbake={`#/ordre/${ordreId}`}
      sti={[{ navn: 'Ordre', href: '#/ordre' }, { navn: hode?.navn ?? '…', href: `#/ordre/${ordreId}` }]} jobbtekst={hode?.jobbtekst ?? ''} />
  )
}

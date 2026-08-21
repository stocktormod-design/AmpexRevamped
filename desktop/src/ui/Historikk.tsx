import { byggHistorikk, type Auditrad, type Hendelseslag, type Revisjonsrad } from '@delt/ik/hendelser'
import { CircleCheck, CirclePlus, Eye, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Historikken til ÉN ting: en internkontrollrutine, en skjemamal.
 *
 * Det finnes ingen samlet endringslogg-flate, og det er en bevisst beslutning.
 * En tabell med alle firmaets hendelser er utviklerens utsyn på databasen. Det
 * kontoret faktisk lurer på er «hva har skjedd med DENNE rutinen», og da hører
 * sporet til på rutinen — ikke tre klikk unna i et eget arkiv man må huske at
 * finnes.
 *
 * Sammenslåingen av revisjoner og audit-rader gjøres i `lib/ik/hendelser.ts`,
 * som er ren og selvtestet. Den viktigste regelen der er at én lagring skriver
 * begge slags rader, og bare skal telles én gang.
 */

const KLOKKE = new Intl.DateTimeFormat('nb-NO', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

const IKON: Record<Hendelseslag, { tegn: typeof Pencil; farge: string }> = {
  opprettet: { tegn: CirclePlus, farge: 'var(--blekk-3)' },
  revisjon: { tegn: Pencil, farge: 'var(--kobber-dyp)' },
  vedtatt: { tegn: CircleCheck, farge: 'var(--gronn)' },
  utgatt: { tegn: Trash2, farge: 'var(--blekk-3)' },
  gjennomgang: { tegn: Eye, farge: 'var(--gronn)' },
  endret: { tegn: Pencil, farge: 'var(--blekk-3)' },
}

export function Historikk({
  hentRevisjoner,
  hentAudit,
  seAudit,
  tom = 'Ingenting har skjedd ennå.',
}: {
  hentRevisjoner: () => Promise<Revisjonsrad[]>
  /**
   * Databasens spor. Utelates når rollen ikke skal se det — revisjonene er en
   * del av dokumentet og leses av alle, mens auditsporet er tilsyn.
   */
  hentAudit: (() => Promise<Auditrad[]>) | null
  seAudit: boolean
  tom?: string
}) {
  const [revisjoner, setRevisjoner] = useState<Revisjonsrad[]>([])
  const [audit, setAudit] = useState<Auditrad[]>([])
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    let avbrutt = false
    setLaster(true)
    Promise.all([hentRevisjoner(), seAudit && hentAudit ? hentAudit() : Promise.resolve([])])
      .then(([r, a]) => { if (!avbrutt) { setRevisjoner(r); setAudit(a); setFeil(null) } })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!avbrutt) setLaster(false) })
    return () => { avbrutt = true }
  }, [hentRevisjoner, hentAudit, seAudit])

  const hendelser = byggHistorikk(revisjoner, audit)

  if (laster) return <p className="dempet-mer">Henter historikken …</p>
  if (feil) return <p className="dempet-mer">{feil}</p>
  if (hendelser.length === 0) return <p className="dempet-mer">{tom}</p>

  return (
    <ol className="tidslinje">
      {hendelser.map(h => {
        const { tegn: Tegn, farge } = IKON[h.slag]
        return (
          <li key={h.id} className="tidslinje-rad">
            <span className="tidslinje-prikk" style={{ color: farge }}>
              <Tegn size={15} strokeWidth={1.9} />
            </span>
            <div className="tidslinje-innhold">
              <div className="tidslinje-topp">
                {h.versjon != null ? <span className="teller">v{h.versjon}</span> : null}
                <span className="tidslinje-tekst valgbar">{h.tekst}</span>
              </div>
              <div className="tidslinje-under">
                {KLOKKE.format(new Date(h.tid))}
                {h.hvem ? ` · ${h.hvem}` : ''}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

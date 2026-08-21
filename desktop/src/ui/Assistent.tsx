import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AmpexLogo } from '@/ui/AmpexLogo'

/**
 * Assistenten.
 *
 * I appen er Ampex-merket den synlige inngangen: du trykker på det, sier hva du
 * vil, og assistenten gjør det. Kontoret arver den regelen — merket øverst i
 * sidemenyen åpner denne skuffen, og Ctrl+K gjør det samme uten mus.
 *
 * **Den talende assistenten er ikke koblet på kontoret ennå**, og skuffen later
 * ikke som noe annet. Det som ligger her i dag er kommandopaletten: skriv hva
 * du vil se, trykk Enter. Det er den samme inngangen, og den samme vanen — når
 * modellen kobles på, er det her den kommer.
 */

export type Kommando = {
  id: string
  navn: string
  gruppe: string
  hint?: string
  kjor: () => void
}

export function Assistent({
  apen,
  lukk,
  kommandoer,
}: {
  apen: boolean
  lukk: () => void
  kommandoer: Kommando[]
}) {
  const [sok, setSok] = useState('')
  const [valgt, setValgt] = useState(0)
  const feltet = useRef<HTMLInputElement>(null)

  const treff = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s) return kommandoer
    return kommandoer.filter(k => `${k.navn} ${k.gruppe}`.toLowerCase().includes(s))
  }, [kommandoer, sok])

  // Nullstill ved åpning. En palett som husker forrige søk gjør at neste trykk
  // åpner et filtrert bilde uten at man skjønner hvorfor.
  useEffect(() => {
    if (!apen) return
    setSok('')
    setValgt(0)
    feltet.current?.focus()
  }, [apen])

  useEffect(() => { setValgt(0) }, [sok])

  if (!apen) return null

  function påTast(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); lukk() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setValgt(i => Math.min(i + 1, treff.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setValgt(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      const k = treff[valgt]
      if (k) { k.kjor(); lukk() }
    }
  }

  return (
    <div className="skuff-bak" onMouseDown={lukk}>
      <aside
        className="skuff"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={påTast}
        role="dialog"
        aria-label="Assistent"
      >
        <header className="skuff-hode">
          <span className="skuff-merke"><AmpexLogo size={20} /></span>
          <div>
            <div className="skuff-tittel">Assistent</div>
            <div className="skuff-under">Skriv hva du vil se</div>
          </div>
        </header>

        <div className="skuff-sok">
          <Search size={17} strokeWidth={1.9} className="dempet-mer" />
          <input
            ref={feltet}
            className="skuff-felt"
            placeholder="Hva vil du se?"
            value={sok}
            onChange={e => setSok(e.target.value)}
          />
        </div>

        <div className="skuff-liste">
          {treff.length === 0 ? (
            <p className="dempet-mer" style={{ padding: '16px 18px' }}>Ingen treff.</p>
          ) : (
            treff.map((k, i) => (
              <button
                key={k.id}
                className="skuff-rad"
                aria-selected={i === valgt}
                onMouseEnter={() => setValgt(i)}
                onClick={() => { k.kjor(); lukk() }}
              >
                <span className="skuff-rad-navn">{k.navn}</span>
                <span className="skuff-rad-gruppe">{k.gruppe}</span>
                {i === valgt ? <CornerDownLeft size={14} strokeWidth={2} className="dempet-mer" /> : null}
              </button>
            ))
          )}
        </div>

        {/* Ærlig om hva som mangler. Å late som modellen er her ville vært verre
            enn å ikke ha knappen. */}
        <footer className="skuff-bunn">
          <p className="felt-hjelp">
            Den talende assistenten fra appen er ikke koblet på kontoret ennå. Når den kobles på, er
            det her den kommer — samme inngang, samme vane.
          </p>
        </footer>
      </aside>
    </div>
  )
}

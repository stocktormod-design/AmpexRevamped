import { MapPin, Phone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hentOrdredetalj, type Ordredetalj, type Ordrestatus } from '@/lib/ordre-lager'
import { Merke, stk } from '@/ui/kit'

/**
 * Ordren slik MONTØREN ser den.
 *
 * Dette er ikke kontorets ordredetalj i mindre utgave. Kontoret ser
 * fakturagrunnlag, dekningsbidrag, godkjenningshistorikk og eksport — fordi
 * kontoret skal ta en beslutning om penger. Montøren skal gjøre en jobb, og
 * spørsmålene hans er andre: hvor er det, hvem ringer jeg, hva skal gjøres, og
 * hva har jeg ført.
 *
 * **Ingen priser her.** Verken kostpris, utpris eller sum. Det er ikke en
 * sperre — RLS slipper radene ut, og materiellet har `unit_price` i seg — men
 * en montørflate som viser hva firmaet tar for jobben er en flate som blir vist
 * fram til feil person på feil tidspunkt. Antall og beskrivelse er det han
 * trenger for å vite hva som er ført.
 *
 * Brukes av både `MinDag` og `MineOrdre`, som er hele grunnen til at den er en
 * egen fil: de to flatene skal aldri kunne komme i utakt om hva en ordre er.
 */

const STATUSNAVN: Record<Ordrestatus, string> = {
  mottatt: 'Mottatt',
  planlagt: 'Planlagt',
  pagaar: 'Pågår',
  fakturaklar: 'Ferdig',
  fakturert: 'Fakturert',
}

export function planlagtTekst(iso: string | null): string {
  if (!iso) return 'Ikke planlagt'
  const d = new Date(iso)
  const dag = d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })
  const kl = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  return `${dag} kl. ${kl}`
}

export function MontorOrdre({ ordreId, brukerId }: { ordreId: string; brukerId: string }) {
  const [detalj, setDetalj] = useState<Ordredetalj | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    let avbrutt = false
    setDetalj(null)
    setFeil(null)
    hentOrdredetalj(ordreId)
      .then(d => { if (!avbrutt) setDetalj(d) })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
    return () => { avbrutt = true }
  }, [ordreId])

  if (feil) return <div className="tomt-mykt"><p>{feil}</p></div>
  if (!detalj) return <div className="tomt-mykt"><p>Henter ordren …</p></div>

  const o = detalj.ordre
  const mine = detalj.timer.filter(t => t.user_id === brukerId)
  const mineTimer = mine.reduce((s, t) => s + (t.hours ?? 0), 0)

  return (
    <>
      <div className="hero">
        <div className="hero-topp">
          {o.order_number ? <span className="hero-nr">#{o.order_number}</span> : null}
          <Merke stil="noytral">{STATUSNAVN[o.status]}</Merke>
        </div>
        <h1 className="hero-tittel valgbar">{o.title}</h1>
        <div className="hero-linje">
          <span>{planlagtTekst(o.scheduled_at)}</span>
        </div>
      </div>

      <div className="detalj-kropp">
        <div className="blokker">
          <div className="blokk">
            <div className="blokk-hode"><span className="blokk-tittel">Hvor</span></div>
            {/* Adresse og telefon er HANDLINGER på en telefon, ikke tekst.
                `tel:` og `geo:`-lenker åpner det man faktisk skal gjøre med
                dem — ringe kunden, og få veibeskrivelse. */}
            {o.address ? (
              <a className="montor-handling" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`} target="_blank" rel="noreferrer">
                <MapPin size={18} strokeWidth={1.8} />
                <span className="valgbar">{o.address}</span>
              </a>
            ) : <p className="dempet">Ingen adresse på ordren.</p>}
            {o.customer_phone ? (
              <a className="montor-handling" href={`tel:${o.customer_phone.replace(/\s/g, '')}`}>
                <Phone size={18} strokeWidth={1.8} />
                <span className="valgbar">{o.customer_phone}</span>
                <span className="dempet">{o.customer_name ?? ''}</span>
              </a>
            ) : o.customer_name ? (
              <p className="dempet">{o.customer_name} — ingen telefon registrert.</p>
            ) : null}
          </div>

          <div className="blokk">
            <div className="blokk-hode"><span className="blokk-tittel">Jobben</span></div>
            {o.description
              ? <p className="valgbar" style={{ whiteSpace: 'pre-wrap' }}>{o.description}</p>
              : <p className="dempet">Ingen beskrivelse.</p>}
          </div>

          <div className="blokk">
            <div className="blokk-hode">
              <span className="blokk-tittel">Mine timer</span>
              <span className="blokk-tall">{mineTimer.toLocaleString('nb-NO')} t</span>
            </div>
            {mine.length === 0 ? (
              <p className="dempet">Du har ikke ført timer på denne ordren.</p>
            ) : (
              mine.map(t => (
                <div key={t.id} className="fakta">
                  <span className="fakta-navn">{new Date(t.date).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="fakta-verdi">{t.hours.toLocaleString('nb-NO')} t{t.note ? ` · ${t.note}` : ''}</span>
                </div>
              ))
            )}
          </div>

          <div className="blokk">
            <div className="blokk-hode">
              <span className="blokk-tittel">Materiell</span>
              <span className="blokk-tall">{stk(detalj.materiell.length, 'linje', 'linjer')}</span>
            </div>
            {detalj.materiell.length === 0 ? (
              <p className="dempet">Ingenting ført.</p>
            ) : (
              detalj.materiell.map(m => (
                <div key={m.id} className="fakta">
                  <span className="fakta-navn">{m.description ?? m.elnummer ?? '—'}</span>
                  <span className="fakta-verdi">{m.quantity.toLocaleString('nb-NO')} {m.unit ?? ''}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}

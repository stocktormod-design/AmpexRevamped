import { MessageSquare, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/auth'
import { hentMeldinger, lyttPaaChat, sendMelding, slettMelding, type Melding } from '@/lib/chat-lager'

/**
 * Firmachatten, nede i høyre hjørne av kontoret.
 *
 * Den finnes fordi veien fra «dette burde stått annerledes» til at det står
 * skrevet ned skal være ett trykk. Faglig ansvarlig ser flata foran seg mens
 * han skriver — da blir endringsønsket konkret, og ikke «noe med
 * internkontrollen» tre dager senere.
 *
 * Boblen ligger i skallet og følger derfor med på hver flate. Den åpner et
 * panel, ikke en side: forlater du flata for å skrive, mister du det du så.
 *
 * Uleste telles LOKALT (siste leste tidspunkt i localStorage). Å føre lesing i
 * basen ville krevd en rad per melding per bruker for å løse noe to personer
 * ikke har: tvil om hvem som har sett hva.
 */

const LEST_NOKKEL = 'ampex-chat-lest'

function klokke(iso: string): string {
  const d = new Date(iso)
  const i_dag = new Date().toDateString() === d.toDateString()
  return i_dag
    ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })
      + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

export function Chatboble() {
  const { profil } = useAuth()
  const [apen, setApen] = useState(false)
  const [meldinger, setMeldinger] = useState<Melding[]>([])
  const [utkast, setUtkast] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [sistLest, setSistLest] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(LEST_NOKKEL) ?? 0)
    } catch {
      return 0
    }
  })
  const bunn = useRef<HTMLDivElement | null>(null)

  const firmaId = profil?.company_id ?? null
  const brukerId = profil?.id ?? null

  useEffect(() => {
    if (!firmaId) return
    let montert = true
    hentMeldinger()
      .then(m => { if (montert) setMeldinger(m) })
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))

    // Nye meldinger kommer inn mens fanen står åpen — også når panelet er
    // lukket, slik at telleren på boblen stemmer.
    const stopp = lyttPaaChat(firmaId, ny => {
      setMeldinger(m => (m.some(x => x.id === ny.id) ? m : [...m, ny]))
    })
    return () => { montert = false; stopp() }
  }, [firmaId])

  // Ruller til nyeste når panelet åpnes og når det kommer noe nytt.
  useEffect(() => {
    if (apen) bunn.current?.scrollIntoView({ block: 'end' })
  }, [apen, meldinger.length])

  const merkLest = useCallback(() => {
    const naa = Date.now()
    setSistLest(naa)
    try {
      localStorage.setItem(LEST_NOKKEL, String(naa))
    } catch {
      // Privat vindu eller avslått lagring: telleren blir stående, chatten virker.
    }
  }, [])

  useEffect(() => { if (apen) merkLest() }, [apen, meldinger.length, merkLest])

  if (!profil || !firmaId || !brukerId) return null

  const uleste = meldinger.filter(
    m => m.bruker_id !== brukerId && new Date(m.created_at).getTime() > sistLest,
  ).length

  async function send() {
    const tekst = utkast.trim()
    if (!tekst || !brukerId || !firmaId) return
    setUtkast('')
    setFeil(null)
    try {
      await sendMelding(brukerId, profil?.full_name ?? '', tekst, firmaId)
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
      setUtkast(tekst) // teksten skal ikke forsvinne fordi nettet gjorde det
    }
  }

  return (
    <>
      {apen ? (
        <div className="chat-panel" role="dialog" aria-label="Firmachat">
          <div className="chat-hode">
            <div>
              <div className="chat-tittel">Chat</div>
              <div className="chat-under">Mellom dere i firmaet</div>
            </div>
            <button className="ikonknapp" onClick={() => setApen(false)} title="Lukk">
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          <div className="chat-kropp">
            {meldinger.length === 0 ? <p className="kort-hjelp">Ingen meldinger.</p> : null}

            {meldinger.map(m => {
              const min = m.bruker_id === brukerId
              return (
                <div key={m.id} className={min ? 'chat-melding chat-min' : 'chat-melding'}>
                  <div className="chat-meta">
                    <span>{min ? 'Du' : m.navn || 'Ukjent'}</span>
                    <span className="chat-tid">{klokke(m.created_at)}</span>
                    {min ? (
                      <button
                        className="chat-slett"
                        title="Slett meldingen"
                        onClick={() => {
                          void slettMelding(m.id)
                            .then(() => setMeldinger(v => v.filter(x => x.id !== m.id)))
                            .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
                        }}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                  <div className="chat-tekst">{m.tekst}</div>
                </div>
              )
            })}
            <div ref={bunn} />
          </div>

          {feil ? <div className="chat-feil">{feil}</div> : null}

          <div className="chat-skriv">
            <textarea
              className="felt-inn"
              rows={2}
              value={utkast}
              placeholder="Hva vil du ha endret?"
              onChange={e => setUtkast(e.target.value)}
              onKeyDown={e => {
                // Enter sender, skift+enter gir ny linje. Dette er en samtale,
                // ikke et skjema — å måtte sikte på en knapp for hver setning
                // er det som gjør at folk lar være å skrive.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button className="chat-send" onClick={() => void send()} disabled={!utkast.trim()} title="Send">
              <Send size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}

      <button
        className="chat-boble"
        onClick={() => setApen(v => !v)}
        title="Chat med firmaet"
        aria-label={uleste > 0 ? `Chat, ${uleste} uleste` : 'Chat'}
      >
        <MessageSquare size={20} strokeWidth={1.9} />
        {uleste > 0 && !apen ? <span className="chat-prikk">{uleste > 9 ? '9+' : uleste}</span> : null}
      </button>
    </>
  )
}

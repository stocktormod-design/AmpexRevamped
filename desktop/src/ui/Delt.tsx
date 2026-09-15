import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'

/**
 * Delt visning: liste til venstre, detalj til høyre — og på telefon ÉN av dem.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Hvorfor dette ikke er ren CSS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Selve omleggingen ER ren CSS: `.delt` er et rutenett med to spalter på skjerm
 * og en stabel på telefon, og `data-valgt` bestemmer hvilken av de to som
 * tegnes. Se `styles.css`, telefonbolken nederst.
 *
 * To ting kan CSS likevel ikke gjøre, og de er grunnen til at dette er en
 * komponent:
 *
 * 1. **Tilbake-bevegelsen.** En app som er lagt på hjemskjermen har ingen
 *    adresselinje. Uten et historikksteg per åpnet detalj ville Androids
 *    tilbakeknapp lukket hele appen i stedet for å gå ett hakk opp. Hash-en
 *    røres ikke — ruta er den samme flata, det er dybden som endrer seg.
 * 2. **Hvilken flate man lander på.** Se `paaTelefon()` under.
 */

/**
 * Samme grense som telefonbolken i stilarket, og de MÅ være like.
 *
 * Grensa er 820 px og ikke 768: en iPad mini i portrett er 744 px og skal ha
 * telefonformen, mens en liten laptop på 1024 skal ha spaltene.
 */
export const TELEFON = '(max-width: 820px)'

/**
 * Er vi på telefonformen akkurat nå?
 *
 * Brukes av flatene til å la være å velge første rad automatisk. På skjerm er
 * autovalget riktig — en tom høyrespalte er bortkastet plass. På telefon ville
 * det samme valget kastet deg rett inn i detaljen til den første ordren i lista
 * hver gang du åpnet flata, uten at du ba om det.
 */
export function paaTelefon(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(TELEFON).matches
}

export function Delt({
  valgt,
  tilbake,
  children,
}: {
  /** Står det noe i detaljen? Styrer hvilken flate telefonen viser. */
  valgt: boolean
  /** Lukk detaljen. Kalles både av knappen og av tilbake-bevegelsen. */
  tilbake: () => void
  children: React.ReactNode
}) {
  // Holdes i en ref så historikk-effekten under bare avhenger av `valgt`.
  // Ellers ville en ny funksjonsidentitet per rendring lagt på et
  // historikksteg for hver tegning av flata.
  const lukk = useRef(tilbake)
  lukk.current = tilbake

  useEffect(() => {
    if (!valgt || !paaTelefon()) return

    history.pushState({ ampexDetalj: true }, '')
    const paaTilbake = () => lukk.current()
    window.addEventListener('popstate', paaTilbake)

    return () => {
      window.removeEventListener('popstate', paaTilbake)
      // Ble detaljen lukket med KNAPPEN, ligger steget vårt fortsatt i
      // historikken og må tas bort — ellers hoper det seg opp ett steg per
      // åpning, og tilbake-bevegelsen må trykkes like mange ganger.
      // Kom vi hit via selve bevegelsen, er steget allerede borte.
      if (history.state?.ampexDetalj) history.back()
    }
  }, [valgt])

  return (
    <div className="delt" data-valgt={valgt ? '1' : '0'}>
      {/* Skjult på skjerm med `display: none`, som også tar den ut av
          rutenettet — derfor forblir spaltene to. */}
      <button className="delt-tilbake" onClick={tilbake}>
        <ChevronLeft size={18} strokeWidth={2} />
        Tilbake
      </button>
      {children}
    </div>
  )
}

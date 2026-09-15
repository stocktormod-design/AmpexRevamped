import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import { hentOrdrer, type Ordrerad } from '@/lib/ordre-lager'
import { Delt } from '@/ui/Delt'
import { Beskjed, Sidehode, stk } from '@/ui/kit'
import { MontorOrdre, planlagtTekst } from '@/ui/MontorOrdre'

/**
 * HJEM for montøren og lærlingen — morgenspørsmålet, og ingenting annet.
 *
 * Flata svarer på ett spørsmål: har jeg jobb i dag, og hvor. Alt annet er
 * lenger ned eller på en annen flate.
 *
 * **Ingen «Start dagen»-knapp, og ingen timeføring øverst.** En knapp som ikke
 * gjør noe annet enn å bekrefte at du er våken er krom, og timelista er noe du
 * fyller når jobben er gjort — ikke det første du ser. Dette er samme regel som
 * appens Hjem er bygget på, og den skal ikke vike fordi flata er web.
 *
 * **Været mangler her, i motsetning til i appen.** `lib/weather.ts` setter et
 * `User-Agent`-hode, slik met.no og Nominatim krever, og det har en nettleser
 * ikke lov til å gjøre — headeren er på fetch-spesifikasjonens forbudte liste.
 * Skal været hit, må det gå gjennom en edge function som legger på headeren.
 */

function erSammeDag(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function MinDag() {
  const { profil } = useAuth()
  const [rader, setRader] = useState<Ordrerad[]>([])
  const [laster, setLaster] = useState(true)
  const [feil, setFeil] = useState<string | null>(null)
  const [valgt, setValgt] = useState<string | null>(null)

  useEffect(() => {
    if (!profil) return
    let avbrutt = false
    setLaster(true)
    // `bareMine` er det som gjør flata til MIN dag: tildelte ordrer og dem jeg
    // står som deltaker på. RLS slipper hele firmaet gjennom, så filteret er en
    // visning — men det er visningen som er hele poenget her.
    hentOrdrer({ bareMine: profil.id, statuser: ['mottatt', 'planlagt', 'pagaar'] })
      .then(ut => { if (!avbrutt) { setRader(ut); setFeil(null) } })
      .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!avbrutt) setLaster(false) })
    return () => { avbrutt = true }
  }, [profil?.id])

  const { idag, senere, uplanlagt } = useMemo(() => {
    const naa = new Date()
    const idag: Ordrerad[] = []
    const senere: Ordrerad[] = []
    const uplanlagt: Ordrerad[] = []
    for (const r of rader) {
      if (!r.scheduled_at) { uplanlagt.push(r); continue }
      const d = new Date(r.scheduled_at)
      if (erSammeDag(d, naa)) idag.push(r)
      else if (d > naa) senere.push(r)
      // Planlagt i fortida og fortsatt åpen hører hjemme under «i dag» — den
      // skulle vært gjort, og å gjemme den under «senere» er å gjemme den.
      else idag.push(r)
    }
    const påTid = (a: Ordrerad, b: Ordrerad) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')
    return { idag: idag.sort(påTid), senere: senere.sort(påTid), uplanlagt }
  }, [rader])

  const aktiv = rader.find(r => r.id === valgt) ?? null
  const datoen = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <Sidehode
        tittel={laster ? 'I dag' : idag.length === 0 ? 'Ingen jobb i dag' : stk(idag.length, 'jobb i dag', 'jobber i dag')}
        under={datoen.charAt(0).toUpperCase() + datoen.slice(1)}
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <Delt valgt={!!aktiv} tilbake={() => setValgt(null)}>
          <div className="liste">
            <div className="liste-kropp">
              {laster ? (
                <div className="liste-gruppe">Henter …</div>
              ) : rader.length === 0 ? (
                <div className="tomt-mykt"><p>Du står ikke på noen åpne ordrer.</p></div>
              ) : (
                <>
                  <Bolk navn="I dag" rader={idag} valgt={valgt} velg={setValgt} tomtSvar="Ingenting planlagt i dag." />
                  <Bolk navn="Senere" rader={senere} valgt={valgt} velg={setValgt} />
                  <Bolk navn="Ikke planlagt" rader={uplanlagt} valgt={valgt} velg={setValgt} />
                </>
              )}
            </div>
          </div>

          <div className="detalj">
            {!aktiv || !profil
              ? <div className="tomt-mykt"><p>Velg en ordre</p></div>
              : <MontorOrdre key={aktiv.id} ordreId={aktiv.id} brukerId={profil.id} />}
          </div>
        </Delt>
      </div>
    </>
  )
}

function Bolk({
  navn,
  rader,
  valgt,
  velg,
  tomtSvar,
}: {
  navn: string
  rader: Ordrerad[]
  valgt: string | null
  velg: (id: string) => void
  /** Vises når bolken er tom. Uten den tegnes ikke bolken i det hele tatt. */
  tomtSvar?: string
}) {
  if (rader.length === 0 && !tomtSvar) return null
  return (
    <div>
      <div className="liste-gruppe">{navn}</div>
      {rader.length === 0 ? (
        <p className="dempet" style={{ padding: '2px 12px 10px' }}>{tomtSvar}</p>
      ) : (
        rader.map(r => (
          <button key={r.id} className="ordrerad" aria-selected={r.id === valgt} onClick={() => velg(r.id)}>
            <div className="ordrerad-topp">
              {r.order_number ? <span className="ordrerad-nr">#{r.order_number}</span> : null}
              <span className="ordrerad-tittel">{r.title}</span>
            </div>
            <div className="ordrerad-bunn">
              <span className="ordrerad-kunde">{r.address ?? r.customer_name ?? 'Ingen adresse'}</span>
              <span className="ordrerad-dato">{planlagtTekst(r.scheduled_at).replace('Ikke planlagt', '—')}</span>
            </div>
          </button>
        ))
      )}
    </div>
  )
}

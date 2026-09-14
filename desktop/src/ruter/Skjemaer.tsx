import { kan } from '@delt/kontor-tilgang'
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  hentAuditFor,
  hentMalrevisjoner,
  hentMalSkjema,
  hentPunkter,
  hentSkjemakoblinger,
  hentSkjemamaler,
  knyttSkjema,
  lagreMalversjon,
  loesnaSkjema,
  opprettMal,
  type IkPunkt,
  type Skjemamal,
} from '@/lib/ik-lager'
import { Historikk } from '@/ui/Historikk'
import { antall, Beskjed, Felt, Knapp, Kort, Merke, Sidehode, stk } from '@/ui/kit'
import { Malbygger, tomSeksjon, type Malutkast } from '@/ui/Malbygger'

/**
 * Skjemamalene: lage dem, versjonere dem, og knytte dem til et
 * internkontrollpunkt.
 *
 * Koblingen er ikke pynt. Et IK-punkt om sluttkontroll som ikke peker på
 * sluttkontrollskjemaet er en rutine uten verktøy, og et skjema som ikke hører
 * til noen rutine er et skjema ingen vet hvorfor de fyller ut.
 *
 * Malene lages HER (14. september) med `ui/Malbygger.tsx`. Kvalitetsporten er
 * fortsatt `validateFirmSections()` — den samme appen og en importør må
 * gjennom — og en mal endres aldri in-place: hver lagring er en ny versjon
 * med endringsnotat, og gamle utfylte skjemaer peker på versjonen de ble
 * fylt ut mot.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

export function Skjemaer() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'skjema.skriv') && !!profil?.company_id
  const seAudit = kan(profil?.role, 'logg.les')

  const [maler, setMaler] = useState<Skjemamal[]>([])
  const [punkter, setPunkter] = useState<IkPunkt[]>([])
  const [koblet, setKoblet] = useState<Map<string, { koblingId: string; punkt: IkPunkt }>>(new Map())
  const [valgt, setValgt] = useState<string | null>(null)
  const [nyMal, setNyMal] = useState(false)
  const [sok, setSok] = useState('')
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  const last = useCallback(async () => {
    setLaster(true)
    try {
      const [m, p, k] = await Promise.all([hentSkjemamaler(), hentPunkter(), hentSkjemakoblinger()])
      setMaler(m)
      setPunkter(p)
      // Snur koblingen: fra punkt→skjemaer til skjema→punkt, som er retningen
      // denne flaten leser i.
      const per = new Map<string, { koblingId: string; punkt: IkPunkt }>()
      for (const [punktId, liste] of k) {
        const punkt = p.find(x => x.id === punktId)
        if (!punkt) continue
        for (const s of liste) per.set(s.template_id, { koblingId: s.id, punkt })
      }
      setKoblet(per)
      setFeil(null)
      setValgt(v => (v && m.some(x => x.id === v) ? v : (m[0]?.id ?? null)))
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    } finally {
      setLaster(false)
    }
  }, [])

  useEffect(() => { void last() }, [last])

  const synlige = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s) return maler
    return maler.filter(m => [m.title, m.category, m.key].some(v => v?.toLowerCase().includes(s)))
  }, [maler, sok])

  const kategorier = useMemo(() => [...new Set(maler.map(m => m.category).filter(Boolean))].sort(), [maler])
  const uknyttede = maler.filter(m => !koblet.has(m.id)).length
  const publiserte = maler.filter(m => m.status === 'published').length
  const aktiv = maler.find(m => m.id === valgt) ?? null

  async function knytt(templateId: string, punktId: string) {
    try {
      const eksisterende = koblet.get(templateId)
      if (eksisterende) await loesnaSkjema(eksisterende.koblingId)
      if (punktId) await knyttSkjema(punktId, templateId)
      await last()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
  }

  async function opprett(utkast: Malutkast) {
    if (!profil?.company_id) throw new Error('Du hører ikke til et firma.')
    const id = await opprettMal(utkast, { id: profil.id, companyId: profil.company_id })
    setNyMal(false)
    await last()
    setValgt(id)
  }

  const nyMalKnapp = kanSkrive ? (
    <Knapp stil="merke" onClick={() => setNyMal(true)} disabled={nyMal}>
      <Plus size={15} strokeWidth={2} />
      Ny mal
    </Knapp>
  ) : null

  if (!laster && maler.length === 0 && !nyMal) {
    return (
      <>
        <Sidehode tittel="Skjemaer" under="Firmaets maler" handling={nyMalKnapp} />
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <Kort tittel="Ingen skjemamaler ennå">
          <p className="kort-hjelp">
            En mal er firmaets eget skjema — sluttkontroll, SJA, kursfortegnelse — som montøren
            fyller ut på ordren. Lag den her, punkt for punkt, og knytt den til riktig punkt i
            internkontrollen. Ampex-malene i appen finnes uansett.
          </p>
          {kanSkrive ? (
            <div style={{ marginTop: 16 }}>
              <Knapp stil="merke" onClick={() => setNyMal(true)}>
                <Plus size={15} strokeWidth={2} />
                Lag den første malen
              </Knapp>
            </div>
          ) : null}
        </Kort>
      </>
    )
  }

  return (
    <>
      <Sidehode
        tittel="Skjemaer"
        under={`${stk(maler.length, 'mal', 'maler')} · ${antall(publiserte)} publisert${uknyttede > 0 ? ` · ${antall(uknyttede)} uten IK-punkt` : ''}`}
        handling={
          <>
            <div style={{ width: 250 }}>
              <Felt
                placeholder="Søk tittel eller kategori …"
                value={sok}
                onChange={e => setSok(e.target.value)}
              />
            </div>
            {nyMalKnapp}
          </>
        }
      />

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <div className="arbeidsflate">
        <div className="delt">
          <div className="liste">
            <div className="liste-verktoy">
              <div className="dempet-mer" style={{ fontSize: 12 }}>
                {laster ? 'Henter …' : stk(synlige.length, 'mal', 'maler')}
              </div>
            </div>
            <div className="liste-kropp">
              {synlige.map(m => {
                const k = koblet.get(m.id)
                return (
                  <button
                    key={m.id}
                    className="ordrerad"
                    aria-selected={m.id === valgt && !nyMal}
                    onClick={() => { setValgt(m.id); setNyMal(false) }}
                  >
                    <div className="ordrerad-topp">
                      <span className="ordrerad-nr">v{m.current_version}</span>
                      <span className="ordrerad-tittel">{m.title}</span>
                    </div>
                    <div className="ordrerad-bunn">
                      <span className="ordrerad-kunde">{m.category}</span>
                      {k ? (
                        <span className="teller">{k.punkt.nummer}</span>
                      ) : (
                        <span className="ordrerad-dato" style={{ color: 'var(--gul)' }}>uten punkt</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="detalj">
            {nyMal ? (
              <>
                <div className="hero">
                  <div className="hero-topp"><span className="hero-nr">Ny mal</span></div>
                  <h1 className="hero-tittel">Nytt skjema</h1>
                  <div className="hero-linje">
                    <span>Blir versjon 1. Montøren får den i appen ved neste synk.</span>
                  </div>
                </div>
                <div className="detalj-kropp">
                  <Malbygger
                    start={{ tittel: '', kategori: '', seksjoner: [tomSeksjon()] }}
                    kategorier={kategorier}
                    lagreTekst="Lagre malen"
                    onLagre={opprett}
                    onAvbryt={() => setNyMal(false)}
                  />
                </div>
              </>
            ) : !aktiv ? (
              <div className="tomt-mykt"><p>Velg en mal</p></div>
            ) : (
              <Mal
                key={aktiv.id}
                mal={aktiv}
                punkter={punkter}
                kobling={koblet.get(aktiv.id) ?? null}
                kategorier={kategorier}
                kanSkrive={kanSkrive}
                seAudit={seAudit}
                knytt={knytt}
                etterEndring={last}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Mal({
  mal,
  punkter,
  kobling,
  kategorier,
  kanSkrive,
  seAudit,
  knytt,
  etterEndring,
}: {
  mal: Skjemamal
  punkter: IkPunkt[]
  kobling: { koblingId: string; punkt: IkPunkt } | null
  kategorier: string[]
  kanSkrive: boolean
  seAudit: boolean
  knytt: (templateId: string, punktId: string) => Promise<void>
  etterEndring: () => Promise<void>
}) {
  const { profil } = useAuth()
  const [utkast, setUtkast] = useState<Malutkast | null>(null)
  const [henter, setHenter] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)

  // Stabile referanser, ellers henter <Historikk> på nytt ved hver render.
  const hentRev = useCallback(() => hentMalrevisjoner(mal.id), [mal.id])
  const hentAud = useCallback(() => hentAuditFor('form_templates', mal.id), [mal.id])

  async function startNyVersjon() {
    setHenter(true); setFeil(null)
    try {
      const seksjoner = await hentMalSkjema(mal.id, mal.current_version)
      setUtkast({ tittel: mal.title, kategori: mal.category, seksjoner: seksjoner.length ? seksjoner : [tomSeksjon()] })
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setHenter(false)
  }

  async function lagre(u: Malutkast, notat: string) {
    if (!profil?.company_id) throw new Error('Du hører ikke til et firma.')
    await lagreMalversjon(mal, u, notat, { id: profil.id, companyId: profil.company_id })
    setUtkast(null)
    await etterEndring()
  }

  return (
    <>
      <div className="hero">
        <div className="hero-topp">
          <span className="hero-nr">Versjon {mal.current_version}</span>
          {mal.status === 'published'
            ? <Merke stil="ny">Publisert</Merke>
            : <Merke stil="noytral">Utkast</Merke>}
          {!kobling ? <Merke stil="varsel">Uten IK-punkt</Merke> : null}
        </div>
        <h1 className="hero-tittel valgbar">{mal.title}</h1>
        <div className="hero-linje">
          <span>{mal.category}</span>
          {mal.key ? <span className="valgbar">{mal.key}</span> : null}
          <span>Endret {DATO.format(new Date(mal.updated_at))}</span>
        </div>
      </div>

      <div className="detalj-kropp">
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

        {utkast ? (
          <div className="seksjon seksjon-redigerer">
            <div className="seksjon-hode">
              <div className="seksjon-tittel">Redigerer malen</div>
              <Merke stil="endret">Blir versjon {mal.current_version + 1}</Merke>
            </div>
            <Malbygger
              start={utkast}
              kategorier={kategorier}
              lagreTekst={`Lagre som versjon ${mal.current_version + 1}`}
              krevNotat
              onLagre={lagre}
              onAvbryt={() => setUtkast(null)}
            />
          </div>
        ) : (
          <div className="to-spalter">
            <div className="blokker">
              <div className="blokk">
                <div className="blokk-hode">
                  <div className="blokk-tittel">Innhold</div>
                  {kanSkrive ? (
                    <Knapp stil="stille" onClick={startNyVersjon} disabled={henter}>
                      {henter ? 'Henter …' : 'Ny versjon'}
                    </Knapp>
                  ) : null}
                </div>
                <p className="kort-hjelp">
                  Malen endres aldri på stedet. «Ny versjon» åpner den slik den er nå; det du
                  lagrer blir versjon {mal.current_version + 1} med endringsnotat, og skjemaer som
                  alt er fylt ut peker fortsatt på versjonen de ble fylt ut mot.
                </p>
              </div>
              <div className="blokk">
                <div className="blokk-hode"><div className="blokk-tittel">Historikk</div></div>
                <Historikk
                  hentRevisjoner={hentRev}
                  hentAudit={hentAud}
                  seAudit={seAudit}
                  tom="Ingen revisjoner. Malen står slik den ble laget."
                />
              </div>
            </div>

            <div className="blokker">
              <div className="blokk">
                <div className="blokk-hode"><div className="blokk-tittel">Internkontrollpunkt</div></div>
                {/* Et skjema som ikke hører til noen rutine er et skjema ingen vet
                    hvorfor de fyller ut. Derfor står koblingen her og ikke gjemt
                    i en kolonne. */}
                {kanSkrive ? (
                  <select
                    className="velger"
                    style={{ width: '100%', height: 40 }}
                    value={kobling?.punkt.id ?? ''}
                    onChange={e => void knytt(mal.id, e.target.value)}
                  >
                    <option value="">Ikke knyttet</option>
                    {punkter.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nummer}. {p.tittel}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="fakta-verdi">
                    {kobling ? `${kobling.punkt.nummer}. ${kobling.punkt.tittel}` : 'Ikke knyttet'}
                  </p>
                )}
                {punkter.length === 0 ? (
                  <p className="felt-hjelp" style={{ marginTop: 12 }}>
                    Internkontrollen er ikke opprettet ennå.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

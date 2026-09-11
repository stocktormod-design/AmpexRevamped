import { kan } from '@delt/kontor-tilgang'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  hentAuditFor,
  hentMalrevisjoner,
  hentPunkter,
  hentSkjemakoblinger,
  knyttSkjema,
  loesnaSkjema,
  type IkPunkt,
  type Skjemamal,
  hentSkjemamaler,
} from '@/lib/ik-lager'
import { Historikk } from '@/ui/Historikk'
import { antall, Beskjed, Felt, Kort, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Skjemamalene, og hvilket internkontrollpunkt de hører til.
 *
 * Koblingen er ikke pynt. Et IK-punkt om sluttkontroll som ikke peker på
 * sluttkontrollskjemaet er en rutine uten verktøy, og et skjema som ikke hører
 * til noen rutine er et skjema ingen vet hvorfor de fyller ut. Denne flaten
 * finnes for å lukke det gapet begge veier.
 *
 * Selve MALEN redigeres i appen, der `validateFirmSections()` er kvalitetsporten
 * — en mal som ikke kan brukes i felt skal ikke kunne lagres. Herfra ser man
 * hvilken versjon som gjelder, hva som har skjedd med den, og knytter den til
 * riktig punkt.
 */

const DATO = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })

export function Skjemaer() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'skjema.skriv')
  const seAudit = kan(profil?.role, 'logg.les')

  const [maler, setMaler] = useState<Skjemamal[]>([])
  const [punkter, setPunkter] = useState<IkPunkt[]>([])
  const [koblet, setKoblet] = useState<Map<string, { koblingId: string; punkt: IkPunkt }>>(new Map())
  const [valgt, setValgt] = useState<string | null>(null)
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

  if (!laster && maler.length === 0) {
    return (
      <>
        <Sidehode tittel="Skjemaer" under="Firmaets maler" />
        {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}
        <Kort tittel="Ingen skjemamaler ennå">
          <p className="kort-hjelp">
            Malene lages i appen, eller importeres fra et PDF eller et bilde av firmaets eget skjema.
            Herfra ser du hvilken versjon som gjelder, hva som har skjedd med den, og knytter den til
            riktig punkt i internkontrollen.
          </p>
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
          <div style={{ width: 250 }}>
            <Felt
              placeholder="Søk tittel eller kategori …"
              value={sok}
              onChange={e => setSok(e.target.value)}
            />
          </div>
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
                    aria-selected={m.id === valgt}
                    onClick={() => setValgt(m.id)}
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
            {!aktiv ? (
              <div className="tomt-mykt"><p>Velg en mal</p></div>
            ) : (
              <Mal
                key={aktiv.id}
                mal={aktiv}
                punkter={punkter}
                kobling={koblet.get(aktiv.id) ?? null}
                kanSkrive={kanSkrive}
                seAudit={seAudit}
                knytt={knytt}
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
  kanSkrive,
  seAudit,
  knytt,
}: {
  mal: Skjemamal
  punkter: IkPunkt[]
  kobling: { koblingId: string; punkt: IkPunkt } | null
  kanSkrive: boolean
  seAudit: boolean
  knytt: (templateId: string, punktId: string) => Promise<void>
}) {
  // Stabile referanser, ellers henter <Historikk> på nytt ved hver render.
  const hentRev = useCallback(() => hentMalrevisjoner(mal.id), [mal.id])
  const hentAud = useCallback(() => hentAuditFor('form_templates', mal.id), [mal.id])

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
        <div className="to-spalter">
          <div className="stabel">
            <div className="seksjon">
              <div className="seksjon-tittel">Historikk</div>
              <Historikk
                hentRevisjoner={hentRev}
                hentAudit={hentAud}
                seAudit={seAudit}
                tom="Ingen revisjoner. Malen står slik den ble laget."
              />
            </div>

            <div className="seksjon">
              <div className="seksjon-tittel">Redigering</div>
              <p className="kort-hjelp">
                Selve malen redigeres i appen. Der er <code>validateFirmSections()</code>{' '}
                kvalitetsporten: en mal som ikke kan brukes i felt skal ikke kunne lagres, og den
                porten gjelder importerte maler like mye som håndlagde.
              </p>
            </div>
          </div>

          <div className="stabel">
            <div className="seksjon">
              <div className="seksjon-tittel">Internkontrollpunkt</div>
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
      </div>
    </>
  )
}

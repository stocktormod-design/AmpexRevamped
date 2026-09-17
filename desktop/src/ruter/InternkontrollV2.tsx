import { kan } from '@delt/kontor-tilgang'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth'
import {
  endre, hentIk2, hentRammeverket, nyRutine, nyttFormal, nyttPunkt, slett, taggene,
  type Ik2Formal, type Ik2Punkt, type Ik2Rutine,
} from '@/lib/ik2-lager'
import { Beskjed, Felt, Knapp, Merke, Sidehode, stk } from '@/ui/kit'

/**
 * Internkontroll v2 — PRØVEFLATE ved siden av den som virker.
 *
 * Tre nivåer, som faglig ansvarlig ba om:
 *
 *   Overordnet formål  «Vi skal ikke skade noen»
 *     └ Punkt          «Arbeid under spenning»
 *         └ Rutine     «AUS-arbeid på tavle under 1000 V»   [HMS]
 *
 * Rutinen henger ALLTID på et punkt. Det er hele forskjellen fra v1, der de
 * fjorten kapitlene fra forskriften hadde rutinene direkte under seg — og
 * grunnen han ba om et nivå til: «Kartlegging av farer» er ikke én ting, det
 * er tavle, høyden, AUS og graving.
 *
 * Taggen er én fritekst per rutine, med forslag fra dem som alt er i bruk.
 * Søket leter i overskrift, tekst OG tagg, så «HMS» finner alt som er merket
 * slik uansett hvilket punkt det står under.
 *
 * **Denne flata skal kunne slettes.** Den deler ingen rader med v1. Se
 * `src/lib/ik2-lager.ts` for hva som må bort.
 */

function Skrivefelt({ verdi, lagre, plassholder, rader = 3, laast }: {
  verdi: string
  lagre: (v: string) => void
  plassholder?: string
  rader?: number
  laast?: boolean
}) {
  const [utkast, setUtkast] = useState(verdi)
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) return <p className="kort-hjelp valgbar">{verdi || '—'}</p>

  return (
    <textarea
      className="felt-inn skrivefelt skrivefelt-lav"
      rows={rader}
      value={utkast}
      placeholder={plassholder}
      onChange={e => setUtkast(e.target.value)}
      onBlur={() => { if (utkast !== verdi) lagre(utkast) }}
    />
  )
}

/** Overskrift som redigeres der den står. Ett klikk, ingen dialog. */
function Overskrift({ verdi, lagre, laast, stor }: {
  verdi: string
  lagre: (v: string) => void
  laast?: boolean
  stor?: boolean
}) {
  const [utkast, setUtkast] = useState(verdi)
  useEffect(() => { setUtkast(verdi) }, [verdi])

  if (laast) return <span style={{ fontWeight: stor ? 600 : 500 }}>{verdi || 'Uten navn'}</span>

  return (
    <input
      className="celle-inn"
      style={{ fontWeight: stor ? 600 : 500, fontSize: stor ? 16 : 14, flex: 1, textAlign: 'left' }}
      value={utkast}
      onChange={e => setUtkast(e.target.value)}
      onBlur={() => { if (utkast.trim() && utkast !== verdi) lagre(utkast.trim()) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

export function InternkontrollV2() {
  const { profil } = useAuth()
  const kanSkrive = kan(profil?.role, 'ik.skriv')

  const [tre, setTre] = useState<Ik2Formal[]>([])
  const [sok, setSok] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)
  const [apne, setApne] = useState<Set<string>>(new Set())
  const [nyRutinePa, setNyRutinePa] = useState<string | null>(null)
  const [rutineutkast, setRutineutkast] = useState({ tittel: '', tag: '' })

  const last = useCallback(async () => { setTre(await hentIk2()) }, [])

  useEffect(() => {
    setLaster(true)
    last()
      .catch(e => setFeil(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaster(false))
  }, [last])

  const skriv = useCallback(async (gjor: () => Promise<unknown>) => {
    setFeil(null)
    try {
      await gjor()
      await last()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
  }, [last])

  const tagger = useMemo(() => taggene(tre), [tre])

  // Søket filtrerer RUTINENE, men beholder veien ned til dem: et treff er
  // verdiløst uten å vite hvilket punkt og hvilket formål det hører under.
  const synlig = useMemo(() => {
    const s = sok.trim().toLowerCase()
    if (!s && !tagFilter) return tre
    const treffer = (r: Ik2Rutine) =>
      (!tagFilter || r.tag === tagFilter)
      && (!s || [r.tittel, r.innhold ?? '', r.tag ?? ''].some(v => v.toLowerCase().includes(s)))

    return tre
      .map(f => ({
        ...f,
        punkter: f.punkter
          .map(p => ({ ...p, rutiner: p.rutiner.filter(treffer) }))
          .filter(p => p.rutiner.length > 0 || (!tagFilter && !!s && p.tittel.toLowerCase().includes(s))),
      }))
      .filter(f => f.punkter.length > 0)
  }, [tre, sok, tagFilter])

  const antallRutiner = tre.reduce((n, f) => n + f.punkter.reduce((m, p) => m + p.rutiner.length, 0), 0)

  function veksle(id: string) {
    setApne(v => {
      const neste = new Set(v)
      if (neste.has(id)) neste.delete(id)
      else neste.add(id)
      return neste
    })
  }

  function rutinerad(r: Ik2Rutine) {
    const apen = apne.has(r.id)
    return (
      <div key={r.id} className="ik2-rutine">
        <div className="ik2-rad">
          <button className="ik2-pil" onClick={() => veksle(r.id)} title={apen ? 'Lukk' : 'Åpne'}>
            {apen ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </button>
          <Overskrift
            verdi={r.tittel}
            laast={!kanSkrive}
            lagre={v => void skriv(() => endre('ik2_rutiner', r.id, { tittel: v }))}
          />
          {r.tag ? (
            <button className="ik2-tag" onClick={() => setTagFilter(t => (t === r.tag ? null : r.tag))}>
              {r.tag}
            </button>
          ) : null}
          {kanSkrive ? (
            <button className="ikonknapp" title="Slett rutinen"
              onClick={() => void skriv(() => slett('rutine', r.id))}>
              <Trash2 size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        {apen ? (
          <div className="ik2-innhold">
            <Skrivefelt
              verdi={r.innhold ?? ''}
              laast={!kanSkrive}
              rader={6}
              plassholder="Hvordan arbeidet gjøres. Hvem gjør hva, i hvilken rekkefølge, og hvordan vet man at det er gjort?"
              lagre={v => void skriv(() => endre('ik2_rutiner', r.id, { innhold: v.trim() || null }))}
            />
            {kanSkrive ? (
              <div style={{ maxWidth: 240, marginTop: 8 }}>
                <Felt
                  firkant
                  etikett="Tagg"
                  list="ik2-tagger"
                  defaultValue={r.tag ?? ''}
                  placeholder="HMS, AUS, tavle …"
                  onBlur={e => {
                    const v = e.target.value.trim() || null
                    if (v !== r.tag) void skriv(() => endre('ik2_rutiner', r.id, { tag: v }))
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  function punktkort(p: Ik2Punkt) {
    return (
      <div key={p.id} className="ik2-punkt">
        <div className="ik2-rad">
          <Overskrift
            verdi={p.tittel}
            laast={!kanSkrive}
            lagre={v => void skriv(() => endre('ik2_punkter', p.id, { tittel: v }))}
          />
          <span className="blokk-tall">{stk(p.rutiner.length, 'rutine', 'rutiner')}</span>
          {kanSkrive ? (
            <>
              <Knapp stil="stille" onClick={() => { setNyRutinePa(p.id); setRutineutkast({ tittel: '', tag: '' }) }}>
                <Plus size={14} strokeWidth={1.9} /> Ny rutine
              </Knapp>
              <button className="ikonknapp" title="Slett punktet og rutinene under det"
                onClick={() => void skriv(() => slett('punkt', p.id))}>
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </>
          ) : null}
        </div>

        {p.rutiner.length === 0 && nyRutinePa !== p.id ? (
          <p className="kort-hjelp">Ingen rutiner ennå. Rutinene hører hjemme her, ikke på formålet over.</p>
        ) : null}

        {p.rutiner.map(rutinerad)}

        {nyRutinePa === p.id ? (
          <form
            className="ik2-ny"
            onSubmit={ev => {
              ev.preventDefault()
              const { tittel, tag } = rutineutkast
              if (!tittel.trim()) return
              setNyRutinePa(null)
              void skriv(() => nyRutine(p.id, tittel, tag || null))
            }}
          >
            <Felt
              firkant autoFocus placeholder="Hva heter rutinen?"
              value={rutineutkast.tittel}
              onChange={e => setRutineutkast(v => ({ ...v, tittel: e.target.value }))}
            />
            <div style={{ width: 160 }}>
              <Felt
                firkant list="ik2-tagger" placeholder="Tagg"
                value={rutineutkast.tag}
                onChange={e => setRutineutkast(v => ({ ...v, tag: e.target.value }))}
              />
            </div>
            <Knapp stil="primar" type="submit">Legg til</Knapp>
            <Knapp stil="naken" type="button" onClick={() => setNyRutinePa(null)}>Avbryt</Knapp>
          </form>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <Sidehode
        tittel="Internkontroll v2"
        under={laster
          ? 'Henter …'
          : `Prøveflate · ${stk(tre.length, 'formål', 'formål')} · ${stk(antallRutiner, 'rutine', 'rutiner')}`}
        handling={
          <>
            <div style={{ width: 240 }}>
              <Felt
                placeholder="Søk i rutiner og tagger …"
                value={sok}
                onChange={e => setSok(e.target.value)}
              />
            </div>
            {kanSkrive ? (
              <Knapp
                stil="merke"
                onClick={() => {
                  const t = window.prompt('Overordnet formål — hva skal dette sikre?')
                  if (t?.trim()) void skriv(() => nyttFormal(t))
                }}
              >
                Nytt overordnet formål
              </Knapp>
            ) : null}
          </>
        }
      />

      <datalist id="ik2-tagger">
        {tagger.map(t => <option key={t} value={t} />)}
      </datalist>

      {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

      <Beskjed stil="varsel">
        Dette er en prøveflate. Internkontrollen som gjelder ligger fortsatt under
        «Internkontroll», og deler ingen data med denne.
      </Beskjed>

      {tagger.length > 0 ? (
        <div className="filter">
          {tagger.map(t => (
            <button
              key={t}
              className="filter-knapp"
              aria-pressed={tagFilter === t}
              onClick={() => setTagFilter(v => (v === t ? null : t))}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}

      {!laster && tre.length === 0 ? (
        <div className="tomt-mykt">
          <p>Tomt. Hent de fjorten punktene fra forskriften, så står rammeverket klart.</p>
          {kanSkrive ? (
            <div style={{ marginTop: 12 }}>
              <Knapp stil="primar" onClick={() => void skriv(() => hentRammeverket())}>
                Hent de fjorten punktene
              </Knapp>
            </div>
          ) : null}
        </div>
      ) : null}

      {synlig.map(f => (
        <div key={f.id} className="kort">
          <div className="ik2-rad">
            {f.nummer ? <Merke stil="noytral">Punkt {f.nummer}</Merke> : null}
            <Overskrift
              stor
              verdi={f.tittel}
              laast={!kanSkrive}
              lagre={v => void skriv(() => endre('ik2_formal', f.id, { tittel: v }))}
            />
            {f.skriftlig ? <Merke stil="varsel">Lovpålagt skriftlig</Merke> : null}
            <Merke stil="noytral">{stk(f.punkter.length, 'punkt', 'punkter')}</Merke>
            {kanSkrive ? (
              <>
                <Knapp
                  stil="stille"
                  onClick={() => {
                    const t = window.prompt(`Nytt punkt under «${f.tittel}»`)
                    if (t?.trim()) void skriv(() => nyttPunkt(f.id, t))
                  }}
                >
                  <Plus size={14} strokeWidth={1.9} /> Nytt punkt
                </Knapp>
                <button className="ikonknapp" title="Slett formålet med alt under"
                  onClick={() => void skriv(() => slett('formal', f.id))}>
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </>
            ) : null}
          </div>

          {f.hjemmel ? <div className="ik2-hjemmel">{f.hjemmel}</div> : null}

          {/* Tomt formål ber deg SKRIVE det. Ampex fyller ikke ut formål — se
              lib/ik/skjelett.ts. */}
          {!f.tekst && !kanSkrive ? (
            <p className="kort-hjelp">Ikke skrevet ennå.</p>
          ) : (
            <Skrivefelt
              verdi={f.tekst ?? ''}
              laast={!kanSkrive}
              plassholder="Ikke skrevet ennå. Skriv hva dette punktet skal sikre hos dere."
              lagre={v => void skriv(() => endre('ik2_formal', f.id, { tekst: v.trim() || null }))}
            />
          )}

          {f.punkter.length === 0 ? (
            <p className="kort-hjelp" style={{ marginTop: 12 }}>
              Ingen punkter ennå. Rutiner kan ikke ligge rett under formålet — lag et punkt først.
            </p>
          ) : null}

          {f.punkter.map(punktkort)}
        </div>
      ))}
    </>
  )
}

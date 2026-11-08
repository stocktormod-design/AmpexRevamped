import { validateFirmSections } from '@delt/forms/firm-schema'
import { ANSWER_TYPES, answerType, type AnswerType } from '@delt/forms/answer-types'
import type { FormField, FormFieldType, FormSection } from '@delt/forms/schema'
import {
  AlignLeft, Camera, ChevronDown, ChevronUp, GripVertical, Hash, Info,
  List, Plus, SquareCheck, Table2, Type, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/**
 * Malbyggeren: firmaets eget skjema, seksjon for seksjon, spørsmål for
 * spørsmål.
 *
 * Formatet er `lib/forms/schema.ts` (v2), det samme appen leser og renderer.
 * Kvalitetsporten er `validateFirmSections()` fra `lib/forms/firm-schema.ts`:
 * en mal som ikke kan brukes i felt kan ikke lagres — verken herfra, fra
 * appen eller fra en importør. Feilene vises rått, slik funksjonen skriver
 * dem, fordi de er skrevet for å leses av den som redigerer.
 *
 * ── Spørsmål og svar, ikke «felt» ─────────────────────────────────────────
 *
 * Første utgave hadde én rad per punkt: typevelger, tekst, ekstrafelt. Tormod:
 * «gir ikke helt mening for meg hva som er svar og spørsmål». Nå er hvert
 * punkt to linjer — SPØRSMÅLET montøren får, og under det hva det SVARES MED —
 * og ved siden av står skjemaet slik montøren faktisk ser det. Byggeren og
 * forhåndsvisningen leser samme tilstand, så det du skriver dukker opp til
 * høyre idet du skriver det.
 */

export type Malutkast = { tittel: string; kategori: string; seksjoner: FormSection[] }

/** Ordene og rekkefølgen er felles (`lib/forms/answer-types.ts`); bare ikonene er web. */
const IKONER: Record<AnswerType['icon'], typeof Type> = {
  check: SquareCheck,
  text: Type,
  multiline: AlignLeft,
  number: Hash,
  choice: List,
  table: Table2,
  photo: Camera,
  info: Info,
}

const PLASSHOLDER = Object.fromEntries(
  ANSWER_TYPES.map(type => [type.id, type.example]),
) as Record<FormFieldType, string>

function nyId(prefiks: string): string {
  return `${prefiks}-${crypto.randomUUID().slice(0, 8)}`
}

export function tomSeksjon(tittel = ''): FormSection {
  return { id: nyId('s'), title: tittel, fields: [nyttPunkt()] }
}

function nyttPunkt(): FormField {
  return { id: nyId('f'), type: 'check', label: '' }
}

/** Kommaseparert tekst ↔ liste. Tom streng blir tom liste, ikke `['']`. */
const tilListe = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean)

/** Svarene et felt kan betinge på — samme regel som appen (JA_NEI_IA for check). */
function conditionOptions(f: FormField): string[] {
  if (f.type === 'check') return ['Ja', 'Nei', 'Ikke aktuelt']
  if (f.type === 'choice') return (f.choices ?? []).filter(v => v.trim().length > 0)
  return []
}

export function Malbygger({
  start,
  kategorier,
  lagreTekst,
  krevNotat,
  onLagre,
  onAvbryt,
}: {
  start: Malutkast
  /** Kategorier som finnes fra før — forslag, ikke sperre. */
  kategorier: string[]
  lagreTekst: string
  /** Sant ved ny versjon av en eksisterende mal: endringsnotatet er påkrevd. */
  krevNotat?: boolean
  onLagre: (utkast: Malutkast, notat: string) => Promise<void>
  onAvbryt: () => void
}) {
  const [tittel, setTittel] = useState(start.tittel)
  const [kategori, setKategori] = useState(start.kategori)
  const [seksjoner, setSeksjoner] = useState<FormSection[]>(
    start.seksjoner.length > 0 ? start.seksjoner : [tomSeksjon()],
  )
  const [notat, setNotat] = useState('')
  const [jobber, setJobber] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)
  /** Sant etter første forsøk på å lagre. Før det vises ingen problemliste:
   *  et tomt spørsmål man er i ferd med å skrive er ikke en feil ennå. */
  const [provd, setProvd] = useState(false)
  /** Punktet som dras — HTML5-dra. Slipp på et annet punkt i SAMME del. */
  const [drar, setDrar] = useState<{ seksjon: number; punkt: number } | null>(null)
  /** Spørsmålsfeltene, så Enter kan flytte markøren til det nye punktet. */
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
  const [fokusId, setFokusId] = useState<string | null>(null)

  useEffect(() => {
    if (!fokusId) return
    inputRefs.current.get(fokusId)?.focus()
    setFokusId(null)
  }, [fokusId])

  // Porten sier «(f-3a9c…)» om punktene. Her heter de «spørsmål 3», som i
  // byggeren og i forhåndsvisningen.
  const problemer = useMemo(() => {
    const nummer = new Map<string, number>()
    let n = 0
    for (const s of seksjoner) for (const f of s.fields) nummer.set(f.id, ++n)
    return validateFirmSections(seksjoner).map(p =>
      p.replace(/[«(]([sfk]-[0-9a-f]{8})[»)]/g, (hele, id: string) =>
        nummer.has(id) ? `(spørsmål ${nummer.get(id)})` : hele),
    )
  }, [seksjoner])
  const antallPunkter = seksjoner.reduce((n, s) => n + s.fields.length, 0)
  const klar = tittel.trim().length > 0 && antallPunkter > 0 && (!krevNotat || notat.trim())

  function endreSeksjon(i: number, endring: Partial<FormSection>) {
    setSeksjoner(s => s.map((x, j) => (j === i ? { ...x, ...endring } : x)))
  }
  function endrePunkt(i: number, k: number, endring: Partial<FormField>) {
    setSeksjoner(s => s.map((x, j) => j !== i ? x : {
      ...x,
      fields: x.fields.map((f, l) => (l === k ? { ...f, ...endring } : f)),
    }))
  }
  /** Enter i et spørsmål gir neste spørsmål, rett under — og markøren der.
   *  Å skrive en sjekkliste er én ting per linje; å måtte gripe musa mellom
   *  hver linje er den tregheten tastaturet finnes for å fjerne. */
  function leggTilPunktEtter(i: number, k: number) {
    const nytt = nyttPunkt()
    setSeksjoner(s => s.map((x, j) => {
      if (j !== i) return x
      const felt = [...x.fields]
      felt.splice(k + 1, 0, nytt)
      return { ...x, fields: felt }
    }))
    setFokusId(nytt.id)
  }

  function flyttPunkt(i: number, k: number, retning: -1 | 1) {
    setSeksjoner(s => s.map((x, j) => {
      if (j !== i) return x
      const m = k + retning
      if (m < 0 || m >= x.fields.length) return x
      const f = [...x.fields]
      ;[f[k], f[m]] = [f[m], f[k]]
      return { ...x, fields: f }
    }))
  }

  /** Slipp av et dratt punkt. Samme del bare: rekkefølgen på tvers av deler
   *  er en flyttejobb brukeren ikke ba om, og en del er en leserekkefølge. */
  function slippPå(i: number, k: number) {
    if (!drar || drar.seksjon !== i || drar.punkt === k) { setDrar(null); return }
    const fra = drar.punkt
    setSeksjoner(s => s.map((x, j) => {
      if (j !== i) return x
      const felt = [...x.fields]
      const [flyttet] = felt.splice(fra, 1)
      felt.splice(k, 0, flyttet)
      return { ...x, fields: felt }
    }))
    setDrar(null)
  }

  /** Bytte svartype. Innstillinger som hører til den gamle typen ryddes bort,
   *  så en klikkliste ikke lagrer tabellkolonner ingen leser. */
  function settType(i: number, k: number, f: FormField, next: FormFieldType) {
    endrePunkt(i, k, {
      type: next,
      choices: next === 'choice' ? (f.choices?.length ? f.choices : ['']) : undefined,
      columns: next === 'table' ? (f.columns?.length ? f.columns : [{ key: nyId('k'), label: '' }]) : undefined,
      unit: next === 'number' ? f.unit : undefined,
      required: next === 'info' ? false : f.required,
    })
  }

  async function lagre(ev: React.FormEvent) {
    ev.preventDefault()
    if (!klar) return
    if (problemer.length > 0) { setProvd(true); return }
    setJobber(true); setFeil(null)
    try {
      // Tomme valgfrie felt skal ikke lagres som tomme strenger.
      const rene = seksjoner.map(s => ({
        ...s,
        title: s.title.trim(),
        fields: s.fields.map(f => {
          const ut: FormField = { id: f.id, type: f.type, label: f.label.trim() }
          if (f.required) ut.required = true
          if (f.help?.trim()) ut.help = f.help.trim()
          // Betinget visning redigeres ikke her, men den må OVERLEVE en tur
          // gjennom kontoret: uten denne linja ville et skjema laget på
          // telefonen mistet alle betingelsene sine ved første lagring her.
          if (f.showIf) ut.showIf = f.showIf
          if (f.type === 'choice') ut.choices = f.choices ?? []
          if (f.type === 'table') ut.columns = f.columns ?? []
          if (f.type === 'number' && f.unit?.trim()) ut.unit = f.unit.trim()
          return ut
        }),
      }))
      await onLagre({ tittel: tittel.trim(), kategori: kategori.trim() || 'Diverse', seksjoner: rene }, notat.trim())
    } catch (e) {
      setFeil(e instanceof Error ? e.message : String(e))
    }
    setJobber(false)
  }

  let lopenr = 0
  /** Flat rekkefølge, for å finne feltene som kommer FØR dette punktet. */
  const flat = seksjoner.flatMap(s => s.fields)

  return (
    <form className="malbygger" onSubmit={lagre}>
      <div className="malbygger-spalter">
        <div className="malbygger-skjema">
          <div className="inviter-felt">
            <Felt
              firkant
              etikett="Navn"
              placeholder="Skjemaets navn — f.eks. Sluttkontroll bolig"
              autoFocus={!start.tittel}
              value={tittel}
              onChange={e => setTittel(e.target.value)}
            />
            <label className="felt felt-firkant">
              <span className="felt-etikett">Kategori</span>
              <input
                className="felt-inn"
                list="mal-kategorier"
                placeholder="Sluttkontroll"
                value={kategori}
                onChange={e => setKategori(e.target.value)}
              />
              <datalist id="mal-kategorier">
                {kategorier.map(k => <option key={k} value={k} />)}
              </datalist>
            </label>
          </div>

          {/* Inntaket er del 1, ikke et eget format: betingelser kan bare peke
              oppover, så det som står først styrer resten. */}
          <p className="mal-hint">
            Del 1 svares først. Et spørsmål lenger ned kan vises bare når et tidligere svar er gitt.
          </p>

          {seksjoner.map((s, i) => (
            <div key={s.id} className="mal-seksjon">
              <div className="mal-seksjon-hode">
                <input
                  className="mal-seksjon-tittel"
                  placeholder={seksjoner.length === 1 ? 'Overskrift (valgfri)' : `Del ${i + 1}`}
                  value={s.title}
                  onChange={e => endreSeksjon(i, { title: e.target.value })}
                  aria-label="Seksjonstittel"
                />
                {i === 0 ? (
                  <span className="mal-merke" title="Svares først; resten av skjemaet kan betinges på disse svarene.">
                    Innledende
                  </span>
                ) : null}
                {seksjoner.length > 1 ? (
                  <button
                    type="button"
                    className="mal-fjern"
                    title="Fjern seksjonen"
                    onClick={() => setSeksjoner(x => x.filter((_, j) => j !== i))}
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                ) : null}
              </div>

              {s.fields.map((f, k) => {
                lopenr += 1
                const erInfo = f.type === 'info'
                const type = answerType(f.type)
                return (
                  <div
                    key={f.id}
                    className={`mal-punkt${drar?.seksjon === i && drar.punkt === k ? ' mal-punkt-dras' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); slippPå(i, k) }}
                  >
                    <span
                      className="mal-grip"
                      draggable
                      title="Dra for å flytte spørsmålet"
                      aria-hidden="true"
                      onDragStart={() => setDrar({ seksjon: i, punkt: k })}
                      onDragEnd={() => setDrar(null)}
                    >
                      <GripVertical size={14} strokeWidth={2} />
                    </span>
                    <span className="mal-nr">{lopenr}</span>
                    <div className="mal-punkt-kropp">
                      <input
                        className="mal-sporsmal"
                        ref={el => {
                          if (el) inputRefs.current.set(f.id, el)
                          else inputRefs.current.delete(f.id)
                        }}
                        placeholder={PLASSHOLDER[f.type]}
                        value={f.label}
                        onChange={e => endrePunkt(i, k, { label: e.target.value })}
                        onKeyDown={e => {
                          // Enter = neste spørsmål. Skift+Enter beholdes til
                          // nettleserens egen oppførsel/IME.
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            leggTilPunktEtter(i, k)
                          }
                        }}
                        aria-label={erInfo ? 'Teksten' : 'Spørsmålet'}
                      />
                      <div className="mal-svar">
                        <span className="mal-svar-etikett">{erInfo ? 'Vises som' : 'Svares med'}</span>
                        {/* Alle åtte svartypene står synlig samtidig: å bytte er
                            ett klikk, og ingen må gjette hva som finnes. */}
                        <div className="mal-svar-piller" role="group" aria-label="Svartype">
                          {ANSWER_TYPES.map(ty => {
                            const Ikon = IKONER[ty.icon]
                            return (
                              <button
                                key={ty.id}
                                type="button"
                                className="mal-type-pille"
                                aria-pressed={f.type === ty.id}
                                title={ty.description}
                                onClick={() => settType(i, k, f, ty.id)}
                              >
                                <Ikon size={13} strokeWidth={2} />
                                {ty.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <div className="mal-type-hjelp">
                        {type ? `${type.description} · f.eks. «${type.example}»` : ''}
                      </div>

                      <div className="mal-svar-ekstra">
                        {f.type === 'choice' ? (
                          <input
                            className="felt-inn mal-ekstra"
                            placeholder="TN, IT, TT — kommaseparert"
                            value={(f.choices ?? []).join(', ')}
                            onChange={e => endrePunkt(i, k, { choices: tilListe(e.target.value) })}
                            aria-label="Valgene"
                          />
                        ) : f.type === 'table' ? (
                          <input
                            className="felt-inn mal-ekstra"
                            placeholder="Kurs, Vern, Kabel — kommaseparert"
                            value={(f.columns ?? []).map(c => c.label).join(', ')}
                            onChange={e => endrePunkt(i, k, {
                              columns: tilListe(e.target.value).map((label, n) => ({
                                key: f.columns?.[n]?.key ?? nyId('k'),
                                label,
                              })),
                            })}
                            aria-label="Kolonnene"
                          />
                        ) : f.type === 'number' ? (
                          <input
                            className="felt-inn mal-ekstra mal-enhet"
                            placeholder="Enhet: MΩ"
                            value={f.unit ?? ''}
                            onChange={e => endrePunkt(i, k, { unit: e.target.value })}
                            aria-label="Enhet"
                          />
                        ) : null}
                        {!erInfo ? (
                          <button
                            type="button"
                            className="mal-bryter"
                            aria-pressed={!!f.required}
                            onClick={() => endrePunkt(i, k, { required: !f.required })}
                          >
                            Må besvares
                          </button>
                        ) : null}
                      </div>

                      {/* Betinget visning. Kandidatene er bare feltene som
                          kommer FØR dette — samme regel som porten håndhever. */}
                      {(() => {
                        const tidligere = flat.slice(0, flat.indexOf(f))
                          .filter(c => conditionOptions(c).length > 0)
                        if (tidligere.length === 0) return null
                        const kilde = f.showIf ? flat.find(x => x.id === f.showIf!.field) : undefined
                        const valg = kilde ? conditionOptions(kilde) : []
                        return (
                          <div className="mal-betingelse">
                            <span className="mal-svar-etikett">Vis bare hvis</span>
                            <select
                              className="velger mal-betingelse-velger"
                              aria-label="Vis bare hvis"
                              value={f.showIf?.field ?? ''}
                              onChange={e => {
                                const id = e.target.value
                                if (!id) return endrePunkt(i, k, { showIf: undefined })
                                const nyKilde = flat.find(x => x.id === id)
                                endrePunkt(i, k, {
                                  showIf: { field: id, equals: nyKilde ? conditionOptions(nyKilde).slice(0, 1) : [] },
                                })
                              }}
                            >
                              <option value="">Alltid</option>
                              {tidligere.map(c => (
                                <option key={c.id} value={c.id}>{c.label || 'Uten navn'}</option>
                              ))}
                            </select>
                            {valg.map(opt => {
                              const on = f.showIf?.equals.includes(opt) ?? false
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  className="mal-bryter mal-betingelse-valg"
                                  aria-pressed={on}
                                  onClick={() => {
                                    const cur = f.showIf?.equals ?? []
                                    const next = on ? cur.filter(v => v !== opt) : [...cur, opt]
                                    // Ingen verdier igjen = betingelsen kan aldri bli sann.
                                    // Da er «alltid» det brukeren mente.
                                    endrePunkt(i, k, {
                                      showIf: next.length > 0 ? { field: f.showIf!.field, equals: next } : undefined,
                                    })
                                  }}
                                >
                                  {opt}
                                </button>
                              )
                            })}
                            {f.showIf && kilde ? (
                              <span className="mal-betingelse-svar">
                                {`Vises hvis «${kilde.label || 'uten navn'}» = ${f.showIf.equals.join(' eller ')}`}
                              </span>
                            ) : null}
                          </div>
                        )
                      })()}
                    </div>
                    <span className="mal-verktoy">
                      <button type="button" className="mal-fjern" title="Flytt opp" disabled={k === 0} onClick={() => flyttPunkt(i, k, -1)}>
                        <ChevronUp size={14} strokeWidth={2} />
                      </button>
                      <button type="button" className="mal-fjern" title="Flytt ned" disabled={k === s.fields.length - 1} onClick={() => flyttPunkt(i, k, 1)}>
                        <ChevronDown size={14} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className="mal-fjern"
                        title="Fjern spørsmålet"
                        onClick={() => endreSeksjon(i, { fields: s.fields.filter((_, l) => l !== k) })}
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </span>
                  </div>
                )
              })}

              {s.fields.length === 0 ? (
                <div className="mal-tomt-punkt">
                  <strong>Ingen spørsmål i denne delen ennå</strong>
                  <span>F.eks. «Er jordfeilbryteren testet?»</span>
                </div>
              ) : null}

              <button
                type="button"
                className="mal-legg-til"
                onClick={() => {
                  const nytt = nyttPunkt()
                  endreSeksjon(i, { fields: [...s.fields, nytt] })
                  setFokusId(nytt.id)
                }}
              >
                <Plus size={14} strokeWidth={2} /> Legg til spørsmål
              </button>
            </div>
          ))}

          <div>
            <Knapp type="button" onClick={() => setSeksjoner(s => [...s, tomSeksjon()])}>
              <Plus size={15} strokeWidth={1.9} /> Ny del
            </Knapp>
          </div>

          {krevNotat ? (
            <Felt
              firkant
              etikett="Hva ble endret, og hvorfor?"
              placeholder="La til måling av jordfeilbryter"
              value={notat}
              onChange={e => setNotat(e.target.value)}
            />
          ) : null}

          {provd && problemer.length > 0 ? (
            <Beskjed stil="varsel">
              <ul className="kvittering">
                {problemer.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Beskjed>
          ) : null}
          {feil ? <Beskjed stil="feil">{feil}</Beskjed> : null}

          <div className="rad">
            <Knapp stil="merke" type="submit" disabled={!klar || jobber}>
              {jobber ? 'Lagrer …' : lagreTekst}
            </Knapp>
            <Knapp type="button" onClick={onAvbryt} disabled={jobber}>Avbryt</Knapp>
            <span className="felt-hjelp">
              {antallPunkter === 0
                ? 'Legg til minst ett spørsmål.'
                : !tittel.trim()
                  ? 'Skjemaet trenger et navn.'
                  : `${antallPunkter} spørsmål${seksjoner.length > 1 ? ` i ${seksjoner.length} deler` : ''}.`}
            </span>
          </div>
        </div>

        <Forhandsvisning tittel={tittel} seksjoner={seksjoner} />
      </div>
    </form>
  )
}

/**
 * Skjemaet slik montøren ser det på telefonen. Ikke appens renderer — det
 * ville betydd delt UI, som `desktop/README.md` forbyr — men samme rekkefølge,
 * samme etiketter, samme slags svarfelt. Poenget er å vise hva som er
 * spørsmål og hva som er svar, ikke å være pikselnøyaktig.
 */
function Forhandsvisning({ tittel, seksjoner }: { tittel: string; seksjoner: FormSection[] }) {
  let lopenr = 0
  return (
    <aside className="mal-vis" aria-label="Slik ser montøren skjemaet">
      <div className="mal-vis-hode">Slik ser montøren det</div>
      <div className="mal-vis-ark">
        <div className="mal-vis-tittel">{tittel.trim() || <span className="mal-vis-tom">Skjemaets navn …</span>}</div>
        {seksjoner.map(s => (
          <div key={s.id} className="mal-vis-del">
            {s.title.trim() ? <div className="mal-vis-del-tittel">{s.title}</div> : null}
            {s.fields.map(f => {
              lopenr += 1
              const navn = f.label.trim()
              if (f.type === 'info') {
                return (
                  <p key={f.id} className="mal-vis-info">
                    {navn || <span className="mal-vis-tom">Tekst montøren leser …</span>}
                  </p>
                )
              }
              return (
                <div key={f.id} className="mal-vis-punkt">
                  <div className="mal-vis-sporsmal">
                    <span className="mal-vis-nr">{lopenr}</span>
                    <span>{navn || <span className="mal-vis-tom">{PLASSHOLDER[f.type]}</span>}</span>
                    {f.required ? <span className="mal-vis-krav" title="Må besvares">*</span> : null}
                  </div>
                  <Svarfelt f={f} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}

function Svarfelt({ f }: { f: FormField }) {
  switch (f.type) {
    case 'check':
      return (
        <div className="mal-vis-chips">
          {['Ja', 'Nei', 'Ikke aktuelt'].map(v => <span key={v} className="mal-vis-chip">{v}</span>)}
        </div>
      )
    case 'choice': {
      const valg = (f.choices ?? []).filter(v => v.trim())
      return valg.length === 0
        ? <div className="mal-vis-chips"><span className="mal-vis-chip mal-vis-chip-tom">Ingen valg ennå</span></div>
        : <div className="mal-vis-chips">{valg.map(v => <span key={v} className="mal-vis-chip">{v}</span>)}</div>
    }
    case 'number':
      return (
        <div className="mal-vis-felt mal-vis-tall">
          <span className="mal-vis-tom">0</span>
          {f.unit?.trim() ? <span className="mal-vis-enhet">{f.unit}</span> : null}
        </div>
      )
    case 'multiline':
      return <div className="mal-vis-felt mal-vis-hoy" />
    case 'table': {
      const kol = (f.columns ?? []).filter(c => c.label.trim())
      return (
        <div className="mal-vis-tabell">
          {kol.length === 0
            ? <span className="mal-vis-tom">Ingen kolonner ennå</span>
            : kol.map(c => <span key={c.key} className="mal-vis-kolonne">{c.label}</span>)}
        </div>
      )
    }
    case 'photo':
      return <div className="mal-vis-felt mal-vis-bilde"><Camera size={16} strokeWidth={1.8} /> Ta bilde</div>
    default:
      return <div className="mal-vis-felt" />
  }
}

import { validateFirmSections } from '@delt/forms/firm-schema'
import type { FormField, FormFieldType, FormSection } from '@delt/forms/schema'
import { Camera, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
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

/** Svartypene, i ord montøren ville brukt. Rekkefølgen er vanligst først. */
const SVAR: { id: FormFieldType; navn: string }[] = [
  { id: 'check', navn: 'Ja / Nei / Ikke aktuelt' },
  { id: 'text', navn: 'Kort tekst' },
  { id: 'multiline', navn: 'Lengre tekst' },
  { id: 'number', navn: 'Et tall' },
  { id: 'choice', navn: 'Ett av flere valg' },
  { id: 'table', navn: 'Tabell med rader' },
  { id: 'photo', navn: 'Et bilde' },
  { id: 'info', navn: 'Ingen svar — bare tekst' },
]

const PLASSHOLDER: Record<FormFieldType, string> = {
  check: 'Er jordfeilbryteren testet?',
  text: 'Hvem utførte kontrollen?',
  multiline: 'Beskriv avvik og tiltak',
  number: 'Isolasjonsmotstand',
  choice: 'Hvilket nettsystem?',
  table: 'Kursfortegnelse',
  photo: 'Bilde av tavla etter arbeidet',
  info: 'Tekst montøren skal lese før neste punkt',
}

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

  return (
    <form className="malbygger" onSubmit={lagre}>
      <div className="malbygger-spalter">
        <div className="malbygger-skjema">
          <div className="inviter-felt">
            <Felt
              firkant
              etikett="Skjemaet heter"
              placeholder="Sluttkontroll bolig"
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
                return (
                  <div key={f.id} className="mal-punkt">
                    <span className="mal-nr">{lopenr}</span>
                    <div className="mal-punkt-kropp">
                      <input
                        className="mal-sporsmal"
                        placeholder={PLASSHOLDER[f.type]}
                        value={f.label}
                        onChange={e => endrePunkt(i, k, { label: e.target.value })}
                        aria-label={erInfo ? 'Teksten' : 'Spørsmålet'}
                      />
                      <div className="mal-svar">
                        <span className="mal-svar-etikett">{erInfo ? 'Vises som' : 'Svares med'}</span>
                        <select
                          className="velger mal-type"
                          value={f.type}
                          aria-label="Svartype"
                          onChange={e => endrePunkt(i, k, { type: e.target.value as FormFieldType })}
                        >
                          {SVAR.map(t => <option key={t.id} value={t.id}>{t.navn}</option>)}
                        </select>
                        {f.type === 'choice' ? (
                          <input
                            className="felt-inn mal-ekstra"
                            placeholder="Valgene, med komma: TN, IT, TT"
                            value={(f.choices ?? []).join(', ')}
                            onChange={e => endrePunkt(i, k, { choices: tilListe(e.target.value) })}
                            aria-label="Valgene"
                          />
                        ) : f.type === 'table' ? (
                          <input
                            className="felt-inn mal-ekstra"
                            placeholder="Kolonnene, med komma: Kurs, Vern, Kabel"
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
                          <label className="mal-pakrevd" title="Montøren får ikke fullført skjemaet uten svar her">
                            <input
                              type="checkbox"
                              checked={!!f.required}
                              onChange={e => endrePunkt(i, k, { required: e.target.checked })}
                            />
                            Må besvares
                          </label>
                        ) : null}
                      </div>
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

              <button
                type="button"
                className="mal-legg-til"
                onClick={() => endreSeksjon(i, { fields: [...s.fields, nyttPunkt()] })}
              >
                <Plus size={14} strokeWidth={2} /> Nytt spørsmål
              </button>
            </div>
          ))}

          <div>
            <Knapp type="button" onClick={() => setSeksjoner(s => [...s, tomSeksjon()])}>
              <Plus size={15} strokeWidth={1.9} /> Ny del med egen overskrift
            </Knapp>
          </div>

          {krevNotat ? (
            <Felt
              firkant
              etikett="Hva ble endret, og hvorfor?"
              placeholder="La til måling av jordfeilbryter"
              hjelp="Påkrevd. Blir stående i historikken."
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
        <div className="mal-vis-tittel">{tittel.trim() || <span className="mal-vis-tom">Skjemaet heter …</span>}</div>
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

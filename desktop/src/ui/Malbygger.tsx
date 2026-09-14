import { validateFirmSections } from '@delt/forms/firm-schema'
import type { FormField, FormFieldType, FormSection } from '@delt/forms/schema'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Beskjed, Felt, Knapp } from '@/ui/kit'

/**
 * Malbyggeren: firmaets eget skjema, seksjon for seksjon, punkt for punkt.
 *
 * Formatet er `lib/forms/schema.ts` (v2), det samme appen leser og renderer.
 * Kvalitetsporten er `validateFirmSections()` fra `lib/forms/firm-schema.ts`:
 * en mal som ikke kan brukes i felt kan ikke lagres — verken herfra, fra
 * appen eller fra en importør. Feilene vises rått, slik funksjonen skriver
 * dem, fordi de er skrevet for å leses av den som redigerer.
 *
 * Bygget for kontoret: tett, tastaturvennlig, én rad per punkt. Det er her
 * skjemaene faktisk lages — montøren fyller dem ut, hun skriver dem ikke.
 */

export type Malutkast = { tittel: string; kategori: string; seksjoner: FormSection[] }

const TYPER: { id: FormFieldType; navn: string }[] = [
  { id: 'check', navn: 'Ja / Nei / Ikke aktuelt' },
  { id: 'text', navn: 'Kort tekst' },
  { id: 'multiline', navn: 'Fritekst' },
  { id: 'number', navn: 'Tall' },
  { id: 'choice', navn: 'Klikkliste' },
  { id: 'table', navn: 'Tabell' },
  { id: 'info', navn: 'Info-tekst' },
  { id: 'photo', navn: 'Bilde' },
]

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

  const problemer = useMemo(() => validateFirmSections(seksjoner), [seksjoner])
  const antallPunkter = seksjoner.reduce((n, s) => n + s.fields.length, 0)
  const klar = tittel.trim().length > 0 && antallPunkter > 0 && problemer.length === 0 && (!krevNotat || notat.trim())

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

  return (
    <form className="malbygger" onSubmit={lagre}>
      <div className="inviter-felt">
        <Felt
          firkant
          etikett="Tittel"
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
              placeholder={seksjoner.length === 1 ? 'Seksjonstittel (valgfri)' : `Del ${i + 1}`}
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

          <div className="mal-punkter">
            {s.fields.map((f, k) => (
              <div key={f.id} className="mal-punkt">
                <select
                  className="velger mal-type"
                  value={f.type}
                  aria-label="Type"
                  onChange={e => endrePunkt(i, k, { type: e.target.value as FormFieldType })}
                >
                  {TYPER.map(t => <option key={t.id} value={t.id}>{t.navn}</option>)}
                </select>
                <input
                  className="felt-inn mal-etikett"
                  placeholder={f.type === 'info' ? 'Teksten som vises' : 'Hva skal kontrolleres?'}
                  value={f.label}
                  onChange={e => endrePunkt(i, k, { label: e.target.value })}
                  aria-label="Punkt"
                />
                {f.type === 'choice' ? (
                  <input
                    className="felt-inn mal-ekstra"
                    placeholder="Alternativer, adskilt med komma"
                    value={(f.choices ?? []).join(', ')}
                    onChange={e => endrePunkt(i, k, { choices: tilListe(e.target.value) })}
                    aria-label="Alternativer"
                  />
                ) : f.type === 'table' ? (
                  <input
                    className="felt-inn mal-ekstra"
                    placeholder="Kolonner, adskilt med komma"
                    value={(f.columns ?? []).map(c => c.label).join(', ')}
                    onChange={e => endrePunkt(i, k, {
                      columns: tilListe(e.target.value).map((label, n) => ({
                        key: f.columns?.[n]?.key ?? nyId('k'),
                        label,
                      })),
                    })}
                    aria-label="Kolonner"
                  />
                ) : f.type === 'number' ? (
                  <input
                    className="felt-inn mal-ekstra mal-enhet"
                    placeholder="Enhet"
                    value={f.unit ?? ''}
                    onChange={e => endrePunkt(i, k, { unit: e.target.value })}
                    aria-label="Enhet"
                  />
                ) : null}
                {f.type !== 'info' ? (
                  <label className="mal-pakrevd" title="Påkrevd — AI-utfyllingen spør etter feltet om det står tomt">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={e => endrePunkt(i, k, { required: e.target.checked })}
                    />
                    Påkrevd
                  </label>
                ) : <span className="mal-pakrevd" />}
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
                    title="Fjern punktet"
                    onClick={() => endreSeksjon(i, { fields: s.fields.filter((_, l) => l !== k) })}
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mal-legg-til"
            onClick={() => endreSeksjon(i, { fields: [...s.fields, nyttPunkt()] })}
          >
            <Plus size={14} strokeWidth={2} /> Punkt
          </button>
        </div>
      ))}

      <div>
        <Knapp type="button" onClick={() => setSeksjoner(s => [...s, tomSeksjon()])}>
          <Plus size={15} strokeWidth={1.9} /> Ny seksjon
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

      {problemer.length > 0 ? (
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
            ? 'Legg til minst ett punkt.'
            : !tittel.trim()
              ? 'Malen trenger en tittel.'
              : `${antallPunkter} punkt${antallPunkter === 1 ? '' : 'er'} i ${seksjoner.length} seksjon${seksjoner.length === 1 ? '' : 'er'}.`}
        </span>
      </div>
    </form>
  )
}

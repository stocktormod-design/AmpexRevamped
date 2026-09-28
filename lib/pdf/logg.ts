/**
 * Læretidsloggen som PDF — ren HTML, ingen database. Selvtestes i
 * `npm run verify:laeretid`.
 *
 * Malen sier selv hva som skal skje: «Lagre dokumentet som pdf-fil, last opp i
 * Fagbrev.io og kryss av alle relevante læreplanmål.» Denne PDF-en er derfor
 * leveransen, og den skal se ut som Word-malen fra opplæringskontoret: tittel,
 * seksjonsoverskriftene i malens rekkefølge, og tabellene med malens faste
 * spørsmål. Ikke Ampex-profil — det er lærlingens dokument, ikke vårt.
 *
 * NEK-henvisningene står under utførelsen: punkt og side, og hans egen
 * forklaring når han har skrevet en. Uten forklaring står henvisningen alene.
 */
import { esc, datoNo } from './dokument'
import { nekFelter, nekHenvisningstekst, type Mal, type Utfylling } from '../laeretid/mal'

export type LoggPdfData = {
  tittel: string
  arbeidsdato: string | null
  laerling?: string | null
  mal: Mal
  utfylling: Utfylling
  /** Bildene i tidsrekkefølge, med notatet ordrett. `src` er en data-URI når bildet finnes på telefonen. */
  bilder: { tid: string | null; notat: string; src?: string | null }[]
}

const STIL = `
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1d1d1f; font-size: 10.5pt; line-height: 1.45; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  .meta { color: #555; font-size: 9.5pt; margin-bottom: 14pt; }
  h2 { font-size: 12.5pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.2pt solid #1d1d1f; }
  p { margin: 0 0 6pt; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; margin: 2pt 0 6pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border: 0.8pt solid #9a9a9a; padding: 4pt 5pt; vertical-align: top; text-align: left; font-size: 9.5pt; }
  th { background: #ececec; font-weight: 600; }
  td.sp { width: 38%; }
  td.jn { width: 9%; text-align: center; }
  .tom { color: #999; font-style: italic; }
  .nek { margin: 6pt 0; padding: 6pt 8pt; border: 0.8pt solid #9a9a9a; }
  .bilder { display: flex; flex-wrap: wrap; gap: 8pt; }
  figure { width: calc(50% - 4pt); margin: 0; page-break-inside: avoid; }
  figure img { width: 100%; max-height: 220pt; object-fit: cover; border: 0.8pt solid #9a9a9a; }
  figcaption { font-size: 9.5pt; margin-top: 3pt; }
  .nek .ref { font-weight: 600; font-size: 9.5pt; }
  .nek .hva { color: #555; font-size: 9.5pt; }
`

function tekst(v: string | undefined): string {
  return v && v.trim() ? `<p>${esc(v.trim())}</p>` : `<p class="tom">Ikke fylt ut.</p>`
}

/** Hele loggen som HTML, klar for expo-print. */
export function loggPdfHtml(d: LoggPdfData): string {
  const deler: string[] = []
  const nek = nekFelter(d.utfylling)

  for (const s of d.mal.seksjoner) {
    deler.push(`<h2>${esc(s.tittel)}</h2>`)
    const v = d.utfylling[s.id]

    if (s.slag === 'tekst') {
      deler.push(tekst(typeof v === 'string' ? v : ''))
      if (s.id === 'utforelse' && nek.length) {
        deler.push(`<div class="nek"><div class="ref">Henvisning til forskrifter</div>${nek.map(f => f.begrunnelse.trim()
          ? `<p><b>${esc(nekHenvisningstekst(f))}</b><br>${esc(f.begrunnelse.trim())}</p>`
          : `<p><b>${esc(nekHenvisningstekst(f))}</b></p>`).join('')}</div>`)
      }
      continue
    }

    if (s.slag === 'bilder') {
      deler.push(d.bilder.length
        ? `<div class="bilder">${d.bilder.map(b => `<figure>${b.src ? `<img src="${b.src}">` : ''}`
          + `<figcaption>${b.tid ? `<b>${esc(b.tid)}</b> ` : ''}${b.notat.trim() ? esc(b.notat) : '<span class="tom">Uten forklaring.</span>'}</figcaption></figure>`).join('')}</div>`
        : `<p class="tom">Ingen bilder.</p>`)
      continue
    }

    // Tabell. Faste rader står alltid, i malens rekkefølge.
    const rader = Array.isArray(v) ? v : []
    const hode = (s.faste ? [s.radkolonne ?? ''] : []).concat(s.kolonner)
    const kropp = s.faste
      ? s.faste.map((sp, i) => {
        const rad = rader[i] ?? []
        return `<tr><td class="sp">${esc(sp)}</td>${s.kolonner.map((k, j) =>
          `<td${k === 'Ja/nei' ? ' class="jn"' : ''}>${esc(rad[j] ?? '')}</td>`).join('')}</tr>`
      })
      : rader.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`)
    deler.push(`<table><tr>${hode.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${
      kropp.length ? kropp.join('') : `<tr><td colspan="${hode.length}" class="tom">Ikke fylt ut.</td></tr>`}</table>`)
  }

  const meta = [d.laerling, d.arbeidsdato ? datoNo(d.arbeidsdato) : null].filter(Boolean).map(x => esc(x)).join(' · ')
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><style>${STIL}</style></head><body>`
    + `<h1>${esc(d.tittel || 'Uten tittel')}</h1>${meta ? `<div class="meta">${meta}</div>` : ''}`
    + deler.join('\n')
    + `</body></html>`
}

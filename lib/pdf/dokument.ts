/**
 * Dokumentskallet — HTML som skal bli PDF.
 *
 * REN funksjon, ingen database og ingen React: dokumentet er leveransen i dette
 * faget, og en leveranse skal kunne selvtestes uten en telefon
 * (`npm run verify:pdf`). Selve rendringen (HTML → PDF → del) ligger i
 * `lib/pdf/skriv.ts`, som er det eneste stedet expo-print nevnes.
 *
 * Designet er Ampex' papir: varmt ark, blekk, messing brukt gjerrig — men
 * TRYKKBART. Skjermens paletter er ikke kopiert rått: en flate som ser rolig ut
 * på en telefon blir grå gjørme i en laserskriver, og kunden skriver dette ut.
 *
 * Fonten er en systemstack med vilje. PDF-en lages ofte i en kjeller uten
 * dekning; en webfont som ikke lastes gir et dokument i Times New Roman.
 */

export type Dokumentmeta = {
  /** «Sluttkontroll», «Tilbud», «Fakturagrunnlag» — dokumentets art. */
  type: string
  /** Nummeret kunden refererer til: ordrenummer, tilbudsnummer. */
  nummer?: string | null
  tittel: string
  /** Dato dokumentet gjelder (ISO), ikke tidspunktet det ble skrevet ut. */
  dato?: string | null
}

export type Avsender = {
  navn: string
  orgnr?: string | null
  adresse?: string | null
  telefon?: string | null
  epost?: string | null
}

export type Mottaker = {
  navn?: string | null
  adresse?: string | null
}

/** HTML-escaping. Alt brukergitt innhold MÅ gjennom denne. */
export function esc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Beløp formateres med appens EGEN funksjon (`formatKr`, øre som heltall).
// En egen kopi her ville betydd at PDF-en og skjermen kunne vise ulike tall
// for samme ordre — og det er dokumentet kunden regner etter.
export { formatKr } from '../invoicing'
import { signaturSti } from '../signature-path'

/** ISO → «29.08.2026». Tom streng for tomt, aldri «Invalid Date». */
export function datoNo(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

const STIL = `
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #1C1712;
    -webkit-print-color-adjust: exact;
  }
  .brevhode {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 10pt; border-bottom: 2pt solid #C4A574; margin-bottom: 18pt;
  }
  .firma { font-size: 13pt; font-weight: 700; letter-spacing: -0.2pt; }
  .firma-detalj, .meta-rad { font-size: 8.5pt; color: #6F675D; line-height: 1.5; }
  .dok-type {
    font-size: 8.5pt; font-weight: 700; letter-spacing: 1.2pt;
    text-transform: uppercase; color: #8A6A3E; text-align: right;
  }
  .dok-nummer { font-size: 12pt; font-weight: 700; text-align: right; }
  h1 { font-size: 17pt; font-weight: 700; letter-spacing: -0.4pt; margin: 0 0 3pt; }
  .partier { display: flex; gap: 20pt; margin: 14pt 0 18pt; }
  .parti { flex: 1; }
  .parti-merke {
    font-size: 7.5pt; font-weight: 700; letter-spacing: 0.9pt;
    text-transform: uppercase; color: #8A8175; margin-bottom: 3pt;
  }
  h2 {
    font-size: 8.5pt; font-weight: 700; letter-spacing: 0.9pt; text-transform: uppercase;
    color: #4A4238; margin: 16pt 0 6pt; padding-bottom: 3pt;
    border-bottom: 0.5pt solid #D8D0C2;
    /* En seksjonsoverskrift alene nederst på en side er en løs tråd. */
    page-break-after: avoid;
  }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th {
    text-align: left; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.6pt;
    text-transform: uppercase; color: #6F675D;
    border-bottom: 0.75pt solid #C9C0B2; padding: 0 6pt 4pt 0;
  }
  td { padding: 4pt 6pt 4pt 0; border-bottom: 0.5pt solid #E8E1D5; vertical-align: top; }
  td.tall, th.tall { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  .sum-rad td { border-bottom: none; padding-top: 6pt; font-weight: 600; }
  .sum-total td { border-top: 1.25pt solid #1C1712; font-size: 11.5pt; font-weight: 700; }
  .punkt { page-break-inside: avoid; padding: 5pt 0; border-bottom: 0.5pt solid #EDE7DB; }
  .punkt-sporsmal { font-weight: 600; }
  .punkt-svar { margin-top: 1pt; }
  .punkt-hjelp { font-size: 8.5pt; color: #6F675D; margin-top: 1pt; }
  .avvik { color: #A8460A; font-weight: 700; }
  .tomt { color: #9A9186; font-style: italic; }
  .signaturer { display: flex; gap: 24pt; margin-top: 20pt; page-break-inside: avoid; }
  .signatur { flex: 1; }
  .signatur-felt {
    height: 78pt; border: 0.5pt solid #D8D0C2; border-radius: 3pt;
    background: #FFFDF9; display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .signatur-navn { font-size: 9.5pt; font-weight: 600; margin-top: 4pt; }
  .signatur-tid { font-size: 8pt; color: #6F675D; }
  .bunn {
    margin-top: 22pt; padding-top: 8pt; border-top: 0.5pt solid #D8D0C2;
    font-size: 7.5pt; color: #8A8175; display: flex; justify-content: space-between;
  }
`

/**
 * Bygger hele dokumentet. `innhold` er ferdig HTML fra dokumenttypen — den
 * eier innholdet, dette eier papiret.
 */
export function dokumentHtml(opts: {
  meta: Dokumentmeta
  avsender: Avsender
  mottaker?: Mottaker | null
  /** Ekstra metalinjer i brevhodet: «Ordre 2026-014», «Anlegg: Bjørndalen 12». */
  metalinjer?: string[]
  innhold: string
  /**
   * Bunnteksten skal si hva dokumentet ER, ikke når det ble skrevet ut:
   * et utskriftstidspunkt gjør to identiske dokumenter ulike, og da kan de
   * ikke sammenlignes i en tvist.
   */
  bunntekst?: string
}): string {
  const { meta, avsender, mottaker, metalinjer = [], innhold, bunntekst } = opts

  const firmaDetalj = [
    avsender.orgnr ? `Org.nr ${esc(avsender.orgnr)}` : '',
    esc(avsender.adresse),
    [avsender.telefon, avsender.epost].filter(Boolean).map(esc).join(' · '),
  ].filter(Boolean).join('<br>')

  const partier = mottaker && (mottaker.navn || mottaker.adresse)
    ? `<div class="partier">
         <div class="parti">
           <div class="parti-merke">Kunde</div>
           <div>${esc(mottaker.navn)}</div>
           ${mottaker.adresse ? `<div class="firma-detalj">${esc(mottaker.adresse)}</div>` : ''}
         </div>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="nb"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.tittel)}</title>
<style>${STIL}</style></head>
<body>
  <div class="brevhode">
    <div>
      <div class="firma">${esc(avsender.navn)}</div>
      <div class="firma-detalj">${firmaDetalj}</div>
    </div>
    <div>
      <div class="dok-type">${esc(meta.type)}</div>
      ${meta.nummer ? `<div class="dok-nummer">${esc(meta.nummer)}</div>` : ''}
      ${meta.dato ? `<div class="meta-rad" style="text-align:right">${esc(datoNo(meta.dato))}</div>` : ''}
    </div>
  </div>

  <h1>${esc(meta.tittel)}</h1>
  ${metalinjer.length ? `<div class="meta-rad">${metalinjer.map(esc).join(' &middot; ')}</div>` : ''}
  ${partier}

  ${innhold}

  <div class="bunn">
    <span>${esc(bunntekst ?? `${meta.type}${meta.nummer ? ` ${meta.nummer}` : ''}`)}</span>
    <span>${esc(avsender.navn)}</span>
  </div>
</body></html>`
}

/**
 * Signaturstrøk → SVG. Strøkene lagres som vektorer (ikke bilde) nettopp for at
 * de skal kunne rendres skarpt her; en opplasting som feiler i en kjeller er et
 * bevis som forsvinner.
 */
export function signaturSvg(
  strok: { points: [number, number][] }[],
  bredde: number,
  hoyde: number,
): string {
  // Samme sti-generator som tegneflaten og gjengivelsen i appen bruker — en
  // egen konvertering her ville betydd at signaturen kunne se annerledes ut på
  // dokumentet enn den kunden faktisk skrev under på.
  const baner = strok
    .map(s => signaturSti(s.points, bredde, hoyde))
    .filter(Boolean)
    .map(d => `<path d="${d}" fill="none" stroke="#1C1712" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('')
  if (!baner) return ''
  return `<svg viewBox="0 0 ${bredde} ${hoyde}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${baner}</svg>`
}

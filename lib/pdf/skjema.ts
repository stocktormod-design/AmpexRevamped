/**
 * Utfylt skjema → HTML. Sluttkontroll, samsvarserklæring, risikovurdering.
 *
 * Dette er dokumentet DSB og kunden faktisk skal ha, og derfor det viktigste
 * av de tre. REN modul: ingen database, ingen React — se `lib/pdf/skriv.ts`
 * for selve utskriften.
 *
 * To regler som avgjør om dokumentet er til å stole på:
 *
 *  1. **Ubesvarte punkter skrives ut som ubesvarte.** Å utelate dem ville gjort
 *     dokumentet mer komplett enn jobben var — nøyaktig den løgnen en
 *     sluttkontroll ikke tåler.
 *  2. **Skjulte punkter skrives ikke ut.** Svarte du «nei» på avvik, finnes
 *     ikke avviksbeskrivelsen (den er allerede fjernet ved lagring av
 *     `pruneHidden`), og spørsmålet hører heller ikke hjemme på arket.
 */
import { esc, signaturSvg } from './dokument'

export type SkjemaPunkt = {
  nokkel: string
  sporsmal: string
  type: string
  enhet?: string | null
  alternativer?: string[] | null
  hjelp?: string | null
  kolonner?: { key: string; label: string }[] | null
  svar: unknown
}

export type SkjemaSeksjon = { tittel: string; punkter: SkjemaPunkt[] }

export type SkjemaSignatur = {
  navn: string
  tittel?: string | null
  formal: string
  signertTid?: string | null
  /** Strøk som normaliserte punkter (0–1), slik de lagres. */
  strok: { points: [number, number][] }[]
  /** Flatens sideforhold (bredde/høyde) da signaturen ble tatt. */
  aspekt?: number | null
}

/** Ord som gjør et svar til et avvik — de skal være synlige på arket. */
const AVVIKSORD = ['avvik', 'ikke ok', 'ikke godkjent', 'feil', 'mangel']

function erAvvik(svar: unknown): boolean {
  if (typeof svar !== 'string') return false
  const s = svar.toLowerCase().trim()
  return AVVIKSORD.some(ord => s === ord || s.startsWith(`${ord} `))
}

function svarHtml(p: SkjemaPunkt): string {
  const svar = p.svar

  if (Array.isArray(svar)) {
    const rader = svar as Record<string, unknown>[]
    if (rader.length === 0) return `<div class="punkt-svar tomt">Ingen rader</div>`
    const kol = p.kolonner?.length
      ? p.kolonner
      : Object.keys(rader[0] ?? {}).map(k => ({ key: k, label: k }))
    return `<table style="margin-top:4pt">
      <thead><tr>${kol.map(k => `<th>${esc(k.label)}</th>`).join('')}</tr></thead>
      <tbody>${rader.map(r => `<tr>${kol.map(k => `<td>${esc(r[k.key])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`
  }

  const tekst = svar === null || svar === undefined ? '' : String(svar).trim()
  if (!tekst) return `<div class="punkt-svar tomt">Ikke besvart</div>`
  const medEnhet = p.enhet ? `${tekst} ${p.enhet}` : tekst
  const klasse = erAvvik(tekst) ? 'punkt-svar avvik' : 'punkt-svar'
  // Fritekst kan ha linjeskift — de skal overleve inn i dokumentet.
  return `<div class="${klasse}">${esc(medEnhet).replace(/\n/g, '<br>')}</div>`
}

export function skjemaInnholdHtml(opts: {
  seksjoner: SkjemaSeksjon[]
  signaturer?: SkjemaSignatur[]
  /** Punkter som er påkrevd og ikke fylt ut — skrives som en tydelig blokk. */
  mangler?: string[]
}): string {
  const { seksjoner, signaturer = [], mangler = [] } = opts

  const seksjonerHtml = seksjoner
    .filter(s => s.punkter.length > 0)
    .map(s => `
      <h2>${esc(s.tittel)}</h2>
      ${s.punkter.map(p => `
        <div class="punkt">
          <div class="punkt-sporsmal">${esc(p.sporsmal)}</div>
          ${svarHtml(p)}
          ${p.hjelp ? `<div class="punkt-hjelp">${esc(p.hjelp)}</div>` : ''}
        </div>`).join('')}
    `).join('')

  const manglerHtml = mangler.length
    ? `<h2>Ikke ferdig utfylt</h2>
       <div class="punkt"><div class="punkt-svar avvik">
         ${mangler.map(esc).join('<br>')}
       </div></div>`
    : ''

  const signaturerHtml = signaturer.length
    ? `<h2>Signaturer</h2>
       <div class="signaturer">
         ${signaturer.map(s => {
           const bredde = 240
           const hoyde = Math.round(bredde / (s.aspekt && s.aspekt > 0 ? s.aspekt : 2))
           const svg = signaturSvg(s.strok, bredde, hoyde)
           return `<div class="signatur">
             <div class="signatur-felt">${svg}</div>
             <div class="signatur-navn">${esc(s.navn)}</div>
             <div class="signatur-tid">${esc([s.tittel, s.formal].filter(Boolean).join(' · '))}${
               s.signertTid ? ` · ${esc(s.signertTid)}` : ''}</div>
           </div>`
         }).join('')}
       </div>`
    : ''

  return `${seksjonerHtml}${manglerHtml}${signaturerHtml}`
}

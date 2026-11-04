/**
 * Boksen på EFObasens produktside: firmaets grossistpriser og «Legg i kurv».
 *
 * EFObasen er katalogen, Ampex er handlekurven. Vi leser BARE el-nummeret av
 * adressen (`elnummerFraEfobasen`) og legger en egen boks over siden, i en
 * shadow root, så verken stilen deres lekker inn eller vår lekker ut. Vi rører
 * ikke innholdet deres og henter ingenting fra det — boksen overlever at de
 * bygger om siden, og vi tar ingen data vi ikke har lov til.
 *
 * EFObasen er en ensidesapp: adressen byttes uten ny sidelasting. Derfor
 * lyttes det på nettleserens navigasjon, med en observatør som reserve.
 */
import { elnummerFraEfobasen } from '@delt/pricefile/varekort'
import { spor, type Svar, type Vare } from './meldinger'

const STIL = `
  :host { all: initial; }
  .boks { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 300px;
    font: 14px/1.4 -apple-system, "Geist", Helvetica, Arial, sans-serif; color: #1d1d1f;
    background: #fff; border: 0.5px solid rgba(0,0,0,.14); border-radius: 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,.14); overflow: hidden; }
  .topp { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 0.5px solid rgba(0,0,0,.1); }
  .merke { font-weight: 700; letter-spacing: .2px; }
  .el { color: #6e6e73; font-size: 12px; margin-left: auto; }
  .lukk { border: 0; background: none; font-size: 16px; color: #6e6e73; cursor: pointer; padding: 0 0 0 6px; }
  .navn { padding: 10px 14px 4px; font-weight: 600; }
  .rad { display: flex; align-items: center; gap: 8px; padding: 8px 14px; }
  .rad + .rad { border-top: 0.5px solid rgba(0,0,0,.08); }
  .g { flex: 1; }
  .g small { display: block; color: #6e6e73; font-size: 11px; }
  .pris { font-variant-numeric: tabular-nums; font-weight: 600; }
  .billigst { color: #1a7f37; }
  .knapp { border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12px; font-weight: 600;
    background: #f2f2f4; color: #1d1d1f; cursor: pointer; }
  .knapp.cta { background: #1d1d1f; color: #fff; }
  .knapp:disabled { opacity: .5; cursor: default; }
  .antall { display: flex; align-items: center; gap: 8px; padding: 8px 14px 12px; color: #6e6e73; font-size: 12px; }
  .antall input { width: 64px; padding: 5px 8px; border: 0.5px solid rgba(0,0,0,.2); border-radius: 8px; font: inherit; color: #1d1d1f; }
  .melding { padding: 10px 14px 12px; color: #6e6e73; font-size: 13px; }
  .ok { color: #1a7f37; }
  .feil { color: #c62828; }
`

const kr = (n: number) => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr'

let vert: HTMLElement | null = null
let rot: ShadowRoot | null = null
let gjeldende: string | null = null
let lukket = new Set<string>()

function sikreBoks(): ShadowRoot {
  if (rot && vert?.isConnected) return rot
  vert = document.createElement('ampex-priser')
  rot = vert.attachShadow({ mode: 'closed' })
  document.documentElement.appendChild(vert)
  return rot
}

function fjern() {
  vert?.remove()
  vert = null
  rot = null
}

function tegn(html: string) {
  const r = sikreBoks()
  r.innerHTML = `<style>${STIL}</style><div class="boks">${html}</div>`
  r.querySelector('.lukk')?.addEventListener('click', () => {
    if (gjeldende) lukket.add(gjeldende)
    fjern()
  })
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function topp(elnummer: string) {
  return `<div class="topp"><span class="merke">Ampex</span><span class="el">EL ${esc(elnummer)}</span><button class="lukk" title="Skjul">×</button></div>`
}

function visVare(v: Vare, melding: string | null = null, feil = false) {
  const rader = v.priser.map((p, i) => `
    <div class="rad">
      <div class="g">${esc(p.grossist)}
        <small>${[
          p.erListepris ? 'Listepris' : null,
          p.lagerfort === true ? 'Lagerført' : p.lagerfort === false ? 'Ikke lagerført' : null,
          p.utgaar ? 'Utgått' : null,
        ].filter(Boolean).join(' · ')}</small>
      </div>
      <span class="pris ${v.billigste === p.grossist ? 'billigst' : ''}">${kr(p.pris)}</span>
      <button class="knapp ${i === 0 ? 'cta' : ''}" data-grossist="${esc(p.grossist)}">Legg i kurv</button>
    </div>`).join('')
  tegn(`${topp(v.elnummer)}
    ${v.navn ? `<div class="navn">${esc(v.navn)}</div>` : ''}
    ${v.priser.length ? rader : '<div class="melding">Ingen av prisfilene deres har denne varen.</div>'}
    ${v.priser.length ? `<label class="antall">Antall <input type="number" min="1" step="1" value="1"> ${esc(v.enhet)}</label>` : ''}
    ${melding ? `<div class="melding ${feil ? 'feil' : 'ok'}">${esc(melding)}</div>` : ''}`)

  rot!.querySelectorAll<HTMLButtonElement>('button[data-grossist]').forEach(b => {
    b.addEventListener('click', async () => {
      const grossist = b.dataset.grossist!
      const felt = rot!.querySelector<HTMLInputElement>('.antall input')
      const antall = Math.max(1, Math.round(Number(felt?.value ?? 1)))
      b.disabled = true
      const svar = await spor({ type: 'legg', elnummer: v.elnummer, grossist, antall, navn: v.navn, enhet: v.enhet, produktId: v.produktId })
      if (svar.ok) visVare(v, `${antall} ${v.enhet} lagt i ${grossist}-kurven (${svar.linjer ?? '?'} ${svar.linjer === 1 ? 'vare' : 'varer'}).`)
      else visVare(v, svar.feil, true)
    })
  })
}

async function oppdater() {
  const elnummer = elnummerFraEfobasen(location.href)
  if (elnummer === gjeldende && vert?.isConnected) return
  gjeldende = elnummer
  if (!elnummer || lukket.has(elnummer)) { fjern(); return }

  tegn(`${topp(elnummer)}<div class="melding">Henter prisene …</div>`)
  let svar: Svar
  try {
    svar = await spor({ type: 'vare', elnummer })
  } catch {
    // Utvidelsen er oppdatert mens siden var åpen: bakgrunnen er ny, siden gammel.
    tegn(`${topp(elnummer)}<div class="melding">Last siden på nytt for å se prisene.</div>`)
    return
  }
  if (gjeldende !== elnummer) return // han bladde videre mens vi ventet
  if (!svar.ok) { tegn(`${topp(elnummer)}<div class="melding feil">${esc(svar.feil)}</div>`); return }
  if (!svar.epost) { tegn(`${topp(elnummer)}<div class="melding">Logg inn: trykk på Ampex-ikonet øverst i nettleseren.</div>`); return }
  if (svar.vare) visVare(svar.vare)
}

// Navigasjon i en ensidesapp. Navigation API finnes i Chrome; observatøren tar resten.
const nav = (globalThis as { navigation?: EventTarget }).navigation
nav?.addEventListener('navigatesuccess', () => { void oppdater() })
let sist = location.href
new MutationObserver(() => {
  if (location.href !== sist) { sist = location.href; void oppdater() }
}).observe(document, { subtree: true, childList: true })
void oppdater()

// Innlogging i popupen: vis prisene med en gang, uten å laste siden på nytt.
chrome.storage.onChanged.addListener(() => { gjeldende = null; void oppdater() })

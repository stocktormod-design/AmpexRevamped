/** Popupen bak Ampex-ikonet: logg inn og ut. Selve jobben gjør boksen på EFObasen. */
import { spor, type Svar } from './meldinger'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function vis(svar: Svar) {
  const inne = svar.ok && !!svar.epost
  $('inn').hidden = inne
  $('ute').hidden = !inne
  if (svar.ok && svar.epost) $('hvem').textContent = svar.epost
  $('feil').textContent = svar.ok ? '' : svar.feil
}

$<HTMLFormElement>('inn').addEventListener('submit', async e => {
  e.preventDefault()
  const knapp = $<HTMLFormElement>('inn').querySelector('button')!
  knapp.disabled = true
  vis(await spor({
    type: 'logginn',
    epost: $<HTMLInputElement>('epost').value.trim(),
    passord: $<HTMLInputElement>('passord').value,
  }))
  knapp.disabled = false
})
$('loggut').addEventListener('click', async () => vis(await spor({ type: 'loggut' })))
$('efo').addEventListener('click', () => { void chrome.tabs.create({ url: 'https://efobasen.efo.no/' }) })

void spor({ type: 'status' }).then(vis)

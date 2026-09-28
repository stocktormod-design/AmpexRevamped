/**
 * Selvtest av Fiken-adapteren UTEN token, mot en falsk `fetch`.
 *
 *   npm run verify:fiken-offline
 *
 * `verify:fiken` krever et testforetak og en nøkkel, og kjøres derfor sjelden.
 * Den overså i tillegg at `POST /timeUsers` ikke finnes, fordi den synker den
 * innloggede brukeren — som alltid ligger i lista fra før. Denne dekker de
 * veiene ingen kjører for hånd: personen mangler, navnet treffer bare delvis,
 * POST-en svarer 405, og farten mot Fikens grense på fire kall i sekundet.
 *
 * Harde påstander, ingen testrunner.
 */
import { FikenAdapter } from '../lib/accounting/fiken'

type Svar = { status: number; body?: unknown; location?: string }
function lag(ruter: (m: string, u: string) => Svar) {
  const logg: string[] = []
  const f = async (input: any, init?: any) => {
    const url = String(input); const m = init?.method ?? 'GET'
    logg.push(`${m} ${url.replace('https://api.fiken.no/api/v2/companies/test', '')}`)
    const s = ruter(m, url)
    return new Response(s.body === undefined ? '' : JSON.stringify(s.body), {
      status: s.status,
      headers: s.location ? { Location: s.location, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    })
  }
  return { f: f as unknown as typeof fetch, logg }
}
const nytt = (f: typeof fetch) => new FikenAdapter({ companySlug: 'test', token: 't', fetchImpl: f })
let feil = 0
const paastand = (ok: boolean, hva: string) => { console.log(`${ok ? '  ok  ' : ' FEIL '} ${hva}`); if (!ok) feil++ }

async function main() {
  // 1. Finnes på e-post → ingen POST.
  {
    const { f, logg } = lag((m, u) => u.includes('email=') ? { status: 200, body: [{ timeUserId: 11, name: 'Ola Nordmann', email: 'ola@x.no' }] } : { status: 200, body: [] })
    const r = await nytt(f).synkTimebruker('Ola Nordmann', 'ola@x.no')
    paastand(r.ok && r.verdi === '11', 'finnes på e-post → id 11')
    paastand(!logg.some(l => l.startsWith('POST')), 'ingen POST når personen finnes')
  }
  // 2. Delvis navnetreff skal IKKE godtas som treff.
  {
    const { f } = lag((m, u) => {
      if (m === 'GET' && u.includes('name=')) return { status: 200, body: [{ timeUserId: 22, name: 'Ola Nordmannsen' }] }
      if (m === 'POST') return { status: 405 }
      return { status: 200, body: [{ timeUserId: 22, name: 'Ola Nordmannsen' }] }
    })
    const r = await nytt(f).synkTimebruker('Ola')
    paastand(!r.ok, 'delvis navnetreff «Ola Nordmannsen» godtas ikke for «Ola»')
    paastand(!r.ok && !r.kanProvesIgjen, 'feilen er endelig, ikke «prøv igjen»')
    paastand(!r.ok && r.feil.includes('Ola Nordmannsen'), 'feilen lister personene Fiken har')
  }
  // 3. 405 på POST → handlingsrettet melding, ikke «Fiken 405:».
  {
    const { f } = lag((m) => m === 'POST' ? { status: 405 } : { status: 200, body: [{ timeUserId: 9, name: 'Kari' }] })
    const r = await nytt(f).synkTimebruker('Per Hansen', 'per@x.no')
    paastand(!r.ok && !r.feil.startsWith('Fiken 405'), 'ikke rå statuskode til bruker')
    paastand(!r.ok && r.feil.includes('Timeføring') && r.feil.includes('Per Hansen'), 'sier hva som må gjøres, med navnet')
    if (!r.ok) console.log(`        «${r.feil}»`)
  }
  // 4. Finnes POST-en likevel (201 + Location) → vi bruker den.
  {
    const { f } = lag((m) => m === 'POST' ? { status: 201, location: 'https://api.fiken.no/api/v2/companies/test/timeUsers/77' } : { status: 200, body: [] })
    const r = await nytt(f).synkTimebruker('Ny Person', 'ny@x.no')
    paastand(r.ok && r.verdi === '77', 'udokumentert POST virker → id 77')
  }
  // 5. 201 uten Location → nytt oppslag i stedet for feil.
  {
    let laget = false
    const { f } = lag((m) => { if (m === 'POST') { laget = true; return { status: 201 } } return { status: 200, body: laget ? [{ timeUserId: 88, name: 'Ny Person', email: 'ny@x.no' }] : [] } })
    const r = await nytt(f).synkTimebruker('Ny Person', 'ny@x.no')
    paastand(r.ok && r.verdi === '88', '201 uten Location → slår opp på nytt → id 88')
  }
  // 6. Farten: fire kall skal ta minst 3 × 250 ms.
  {
    const { f } = lag(() => ({ status: 200, body: [] }))
    const a = nytt(f); const t0 = Date.now()
    await a.hvemErJeg(); await a.hvemErJeg(); await a.hvemErJeg(); await a.hvemErJeg()
    const brukt = Date.now() - t0
    paastand(brukt >= 740, `fire kall tok ${brukt} ms (≥ 750 ms = under 4/s)`)
  }
  console.log(feil === 0 ? '\nAlt grønt.' : `\n${feil} påstander feilet.`)
  process.exit(feil === 0 ? 0 : 1)
}
main()

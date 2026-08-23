/**
 * Selvtest for Tripletex-adapteren. Samme mønster som verify-invoicing: et
 * kjørbart skript med harde påstander, ingen testrunner.
 *
 *   npm run verify:tripletex
 *
 * `fetch` er stubbet, så alt bortsett fra selve nettkallet er bevist her:
 * autentiseringskjeden, beløpsomregningen, MVA-kodene, idempotensen på kunder
 * og hvilke feil som er verdt å prøve igjen.
 *
 * Den ene feilen som koster mest er beløpsenheten. Fiken vil ha ØRE som
 * heltall, Tripletex vil ha KRONER med desimaler — speilvendt. Sender vi øre
 * til Tripletex blir fakturaen hundre ganger for høy, og det er ikke en feil
 * man oppdager i en logg. Den har derfor flere påstander enn noe annet her.
 */
import { TripletexAdapter } from '../lib/accounting/tripletex'
import type { Fakturagrunnlag } from '../lib/invoicing'

let feil = 0

function sjekk(navn: string, faktisk: unknown, forventet: unknown) {
  const ok = JSON.stringify(faktisk) === JSON.stringify(forventet)
  if (!ok) {
    feil++
    console.error(`✗ ${navn}\n    forventet: ${JSON.stringify(forventet)}\n    faktisk:   ${JSON.stringify(faktisk)}`)
  } else {
    console.log(`✓ ${navn}`)
  }
}

type Kall = { url: string; init?: RequestInit }

/** Bygger en stubbet fetch som svarer etter et oppslag på URL-fragment. */
function stub(svar: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
  const kall: Kall[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    kall.push({ url, init })
    const s = svar(url, init)
    const status = s.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: new Map() as unknown as Headers,
      json: async () => s.body,
      text: async () => JSON.stringify(s.body ?? ''),
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetch: f, kall }
}

async function main() {
  const SESJON = { value: { token: 'sesj-123', expirationDate: '2026-09-01' } }

  function lagAdapter(svar: (url: string, init?: RequestInit) => { status?: number; body?: unknown }) {
    const s = stub((url, init) => (url.includes('/token/session/') ? { body: SESJON } : svar(url, init)))
    return {
      adapter: new TripletexAdapter({
        consumerToken: 'forbruker-abc',
        employeeToken: 'ansatt-def',
        fetchImpl: s.fetch,
      }),
      kall: s.kall,
    }
  }

  // ── Autentisering ──────────────────────────────────────────────────────────

  {
    const { adapter, kall } = lagAdapter(() => ({ body: { values: [{ id: 9, name: 'Testkunde AS' }] } }))
    await adapter.synkKunde({ navn: 'Testkunde AS', erBedrift: true, lokalId: 'a' })

    const sesjonskall = kall.find(k => k.url.includes('/token/session/'))
    sjekk('sesjonstoken opprettes med PUT', sesjonskall?.init?.method, 'PUT')
    sjekk('begge tokenene sendes med', [
      sesjonskall!.url.includes('consumerToken=forbruker-abc'),
      sesjonskall!.url.includes('employeeToken=ansatt-def'),
    ], [true, true])

    // companyId 0 = «firmaet tokenet tilhører». Basic-strengen er base64 av
    // «0:sesjonstoken», ikke av de langlivede tokenene — de skal aldri på nettet
    // i en header.
    const apiKall = kall.find(k => k.url.includes('/customer'))
    const auth = (apiKall!.init!.headers as Record<string, string>).Authorization
    sjekk('Basic auth bruker companyId:sesjonstoken', auth, `Basic ${Buffer.from('0:sesj-123').toString('base64')}`)
    sjekk('langtidstokenet står ALDRI i en header', auth.includes('ansatt-def'), false)
  }

  {
    // Tokenet caches. Uten dette koster hver eneste operasjon et ekstra rundtur-kall.
    const { adapter, kall } = lagAdapter(() => ({ body: { values: [{ id: 9, name: 'X' }] } }))
    await adapter.synkKunde({ navn: 'X', erBedrift: false, lokalId: 'a' })
    await adapter.synkKunde({ navn: 'X', erBedrift: false, lokalId: 'b' })
    sjekk('sesjonstokenet hentes bare én gang', kall.filter(k => k.url.includes('/token/session/')).length, 1)
  }

  // ── Kunder: finn før du oppretter ──────────────────────────────────────────

  {
    const { adapter, kall } = lagAdapter(url =>
      url.includes('organizationNumber=999888777')
        ? { body: { values: [{ id: 42, organizationNumber: '999888777' }] } }
        : { body: {} })

    const r = await adapter.synkKunde({
      navn: 'Arntsen Elservice', erBedrift: true, orgNr: '999888777', lokalId: 'lokal-1',
    })
    sjekk('eksisterende firmakunde gjenbrukes på org.nr', r, { ok: true, verdi: '42' })
    sjekk('og ingen ny kunde opprettes', kall.some(k => k.init?.method === 'POST' && k.url.endsWith('/customer')), false)
  }

  {
    const { adapter, kall } = lagAdapter(url =>
      url.includes('POST') ? { body: {} } : { body: { values: [] } })
    const s = stub(() => ({ body: {} }))
    void s
    const r = await adapter.synkKunde({ navn: 'Ny Kunde AS', erBedrift: true, orgNr: '123456785', lokalId: 'l2' })
    void r
    const post = kall.find(k => k.init?.method === 'POST')
    sjekk('ukjent kunde opprettes', post !== undefined, true)
    const body = JSON.parse(String(post!.init!.body)) as Record<string, unknown>
    sjekk('som kunde, ikke leverandør', [body.isCustomer, body.isSupplier], [true, false])
    sjekk('org.nr følger med på firmakunder', body.organizationNumber, '123456785')
    sjekk('og firmaet er ikke privatperson', body.isPrivateIndividual, false)
  }

  {
    // Privatkunde har ikke org.nr, og skal ikke få et tomt et sendt med.
    const { adapter, kall } = lagAdapter(() => ({ body: { values: [] } }))
    await adapter.synkKunde({ navn: 'Ola Nordmann', erBedrift: false, lokalId: 'l3' })
    const post = kall.find(k => k.init?.method === 'POST')
    const body = JSON.parse(String(post!.init!.body)) as Record<string, unknown>
    sjekk('privatkunde merkes som privatperson', body.isPrivateIndividual, true)
    sjekk('og har ingen org.nr-nøkkel', 'organizationNumber' in body && body.organizationNumber !== undefined, false)
  }

  // ── Fakturautkast: ØRE → KRONER ────────────────────────────────────────────

  const grunnlag = (linjer: Fakturagrunnlag['linjer']): Fakturagrunnlag => ({
    linjer,
    utelatt: [],
    nettoOre: linjer.reduce((n, l) => n + l.nettoOre, 0),
    mvaOre: linjer.reduce((n, l) => n + l.mvaOre, 0),
    bruttoOre: linjer.reduce((n, l) => n + l.bruttoOre, 0),
    kostOre: 0,
    dbOre: null,
    dbProsent: null,
    mvaFordeling: [],
  })

  {
    const { adapter, kall } = lagAdapter(url =>
      url.endsWith('/order') ? { body: { value: { id: 555 } } } : { body: { values: [] } })

    const r = await adapter.opprettFakturautkast({
      lokalOrdreId: 'o1',
      ordrenummer: 9,
      tittel: 'Ny kurs på kjøkken',
      kundeEksternId: '42',
      dato: new Date('2026-08-23T12:00:00Z'),
      forfallsdager: 14,
      ordreTekst: 'Testveien 5',
      grunnlag: grunnlag([
        // 250,00 kr netto. Sendt som øre ville dette blitt 25 000 kr.
        { kilde: 'timer', kildeIder: ['t1'], beskrivelse: '2,5 t montør', antall: 1, enhet: 'stk', enhetsprisOre: 25000, rabattProsent: 0, mva: 'hoy', nettoOre: 25000, mvaOre: 6250, bruttoOre: 31250 },
        // 12,34 kr — sjekker at ørene ikke forsvinner i avrundingen.
        { kilde: 'materiell', kildeIder: ['m1'], beskrivelse: 'Koblingsklemme', antall: 1, enhet: 'stk', enhetsprisOre: 1234, rabattProsent: 0, mva: 'fritatt', nettoOre: 1234, mvaOre: 0, bruttoOre: 1234 },
      ]),
    })

    sjekk('utkastet får ordre-ID-en tilbake', r, { ok: true, verdi: '555' })

    const ordre = JSON.parse(String(kall.find(k => k.url.endsWith('/order'))!.init!.body)) as Record<string, unknown>
    sjekk('kunden kobles som tall, ikke streng', ordre.customer, { id: 42 })
    sjekk('forfall sendes som dager', [ordre.invoicesDueIn, ordre.invoicesDueInType], [14, 'DAYS'])
    sjekk('ordrenummeret vårt blir referansen', ordre.reference, 'Ordre 9')
    sjekk('ordreteksten blir kommentar', ordre.comment, 'Testveien 5')

    const linjer = JSON.parse(String(kall.find(k => k.url.includes('/orderline'))!.init!.body)) as Record<string, unknown>[]
    sjekk('begge linjene sendes', linjer.length, 2)
    sjekk('250,00 kr sendes som 250, ikke 25000', linjer[0].unitPriceExcludingVatCurrency, 250)
    sjekk('12,34 kr beholder ørene', linjer[1].unitPriceExcludingVatCurrency, 12.34)
    sjekk('antall er alltid 1 — beløpet er hele linja', [linjer[0].count, linjer[1].count], [1, 1])
    sjekk('25 % mva blir vatType 3', linjer[0].vatType, { id: 3 })
    sjekk('fritatt blir vatType 5', linjer[1].vatType, { id: 5 })
    sjekk('linjene henger på ordren', linjer[0].order, { id: 555 })

    // Det viktigste enkeltbeviset: summen Tripletex vil regne seg fram til er
    // den samme summen vi viser i appen.
    const sumKroner = linjer.reduce((n, l) => n + (l.unitPriceExcludingVatCurrency as number), 0)
    sjekk('sum netto stemmer med grunnlaget', sumKroner, 262.34)
  }

  {
    // Ampex utsteder ALDRI en faktura. `:invoice` er menneskets knapp i Tripletex.
    const { adapter, kall } = lagAdapter(url =>
      url.endsWith('/order') ? { body: { value: { id: 7 } } } : { body: {} })
    await adapter.opprettFakturautkast({
      lokalOrdreId: 'o', ordrenummer: 1, tittel: 't', kundeEksternId: '1',
      dato: new Date('2026-08-23T12:00:00Z'), forfallsdager: 14,
      grunnlag: grunnlag([{ kilde: 'timer', kildeIder: ['a'], beskrivelse: 'x', antall: 1, enhet: 'stk', enhetsprisOre: 100, rabattProsent: 0, mva: 'hoy', nettoOre: 100, mvaOre: 25, bruttoOre: 125 }]),
    })
    sjekk('ingenting faktureres fra Ampex', kall.some(k => k.url.includes(':invoice')), false)
  }

  {
    const { adapter } = lagAdapter(() => ({ body: {} }))
    const r = await adapter.opprettFakturautkast({
      lokalOrdreId: 'o', ordrenummer: 1, tittel: 't', kundeEksternId: '1',
      dato: new Date(), forfallsdager: 14, grunnlag: grunnlag([]),
    })
    sjekk('tom ordre avvises uten nettkall', r, { ok: false, feil: 'Ingen fakturerbare linjer på ordren', kanProvesIgjen: false })
  }

  // ── Feil som er verdt å prøve igjen ────────────────────────────────────────

  {
    const { adapter } = lagAdapter(() => ({ status: 429, body: 'rate limited' }))
    const r = await adapter.synkKunde({ navn: 'X', erBedrift: false, lokalId: 'a' })
    sjekk('429 kan prøves igjen', (r as { kanProvesIgjen: boolean }).kanProvesIgjen, true)
  }
  {
    const { adapter } = lagAdapter(() => ({ status: 503, body: 'nede' }))
    const r = await adapter.synkKunde({ navn: 'X', erBedrift: false, lokalId: 'a' })
    sjekk('5xx kan prøves igjen', (r as { kanProvesIgjen: boolean }).kanProvesIgjen, true)
  }
  {
    // 400 er vår feil. Å prøve igjen gir samme svar og skjuler bare årsaken.
    const { adapter } = lagAdapter(() => ({ status: 400, body: 'ugyldig org.nr' }))
    const r = await adapter.synkKunde({ navn: 'X', erBedrift: false, lokalId: 'a' })
    sjekk('400 prøves IKKE igjen', (r as { kanProvesIgjen: boolean }).kanProvesIgjen, false)
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  {
    const { adapter } = lagAdapter(() => ({ body: { value: { id: 555 } } })) // ingen invoice
    sjekk('ufakturert ordre er et utkast', await adapter.hentFakturastatus('555'), { ok: true, verdi: 'utkast' })
  }
  {
    const { adapter } = lagAdapter(url =>
      url.includes('/invoice/')
        ? { body: { value: { amountOutstanding: 0, invoiceDueDate: '2026-09-01' } } }
        : { body: { value: { id: 555, invoice: { id: 900 } } } })
    sjekk('utestående 0 er betalt', await adapter.hentFakturastatus('555'), { ok: true, verdi: 'betalt' })
  }
  {
    const { adapter } = lagAdapter(url =>
      url.includes('/invoice/')
        ? { body: { value: { amountOutstanding: 1000, invoiceDueDate: '2020-01-01' } } }
        : { body: { value: { id: 555, invoice: { id: 900 } } } })
    sjekk('forfalt dato med utestående er forfalt', await adapter.hentFakturastatus('555'), { ok: true, verdi: 'forfalt' })
  }
  {
    const { adapter } = lagAdapter(url =>
      url.includes('/invoice/')
        ? { body: { value: { amountOutstanding: 500, isCreditNote: true } } }
        : { body: { value: { id: 555, invoice: { id: 900 } } } })
    sjekk('kreditnota slår gjennom alt annet', await adapter.hentFakturastatus('555'), { ok: true, verdi: 'kreditert' })
  }
}

main().then(() => {
  console.log('')
  if (feil > 0) {
    console.error(`${feil} påstand(er) feilet.`)
    process.exit(1)
  }
  console.log('Alle påstander holder.')
}).catch(e => {
  console.error('Selvtesten kastet:', e)
  process.exit(1)
})

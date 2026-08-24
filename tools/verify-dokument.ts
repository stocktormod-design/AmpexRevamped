/**
 * Selvtest for dokumentutskriften. Samme mønster som de andre: et kjørbart
 * skript med harde påstander, ingen testrunner.
 *
 *   npm run verify:dokument
 *
 * Dette arket er det kunden faktisk får, og det kan ende hos en advokat i en
 * tvist. De tre feilene som koster mest er testet her:
 *
 *   1. Ubesvarte punkter som forsvinner — arket ville sett mer komplett ut enn
 *      jobben var.
 *   2. HTML-injeksjon fra brukertekst — et kundenavn med `<` som spiser resten
 *      av dokumentet.
 *   3. Et utkast som ikke er merket som utkast.
 */
import { byggUtskriftHtml, esc, formatterSvar, type Utskrift } from '../lib/dokument/utskrift'

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

const BASIS: Utskrift = {
  firma: { navn: 'Arntsen Elservice', orgnr: '999888777', telefon: '90000000' },
  dokument: {
    tittel: 'Sluttkontroll',
    malversjon: 3,
    status: 'ferdig',
    fullfortAv: 'Tormod H. Arntsen',
    fullfortTid: new Date('2026-08-20T10:00:00Z'),
  },
  ordre: { nummer: 42, tittel: 'Ny kurs på kjøkken', adresse: 'Testveien 5' },
  kunde: { navn: 'Ola Nordmann', adresse: 'Testveien 5' },
  seksjoner: [
    {
      tittel: 'Kontrollpunkter',
      punkter: [
        { sporsmal: 'Visuell kontroll utført', type: 'choice', svar: 'Ja', alternativer: ['Ja', 'Nei', 'Ikke aktuelt'] },
        { sporsmal: 'Isolasjonsresistans målt', type: 'number', svar: 250, enhet: 'MΩ' },
        { sporsmal: 'Kortslutningsstrøm', type: 'number', svar: null },
      ],
    },
  ],
  signaturer: [],
  skrevetUt: new Date('2026-08-24T09:00:00Z'),
}

// ── Ubesvarte punkter skal STÅ ─────────────────────────────────────────────
//
// Den viktigste påstanden i fila. Skjuler vi tomme punkter, ser arket mer
// komplett ut enn jobben var — og det er nøyaktig den løgnen et tilsyn ser
// etter.
{
  const html = byggUtskriftHtml(BASIS)
  sjekk('ubesvart punkt vises', html.includes('Ikke besvart'), true)
  sjekk('og spørsmålet står der selv om svaret mangler', html.includes('Kortslutningsstrøm'), true)
  sjekk('besvarte punkter kommer med', html.includes('Visuell kontroll utført'), true)
  sjekk('enhet henger på tallet', html.includes('250 MΩ'), true)
}

// ── HTML-injeksjon ─────────────────────────────────────────────────────────

sjekk('ampersand escapes', esc('Ola & Kari'), 'Ola &amp; Kari')
sjekk('vinkelparenteser escapes', esc('<script>'), '&lt;script&gt;')
sjekk('anførselstegn escapes', esc('han sa "hei"'), 'han sa &quot;hei&quot;')
sjekk('null blir tom streng', esc(null), '')

{
  const stygg: Utskrift = {
    ...BASIS,
    kunde: { navn: '<script>alert(1)</script>', adresse: null },
    ordre: { ...BASIS.ordre, tittel: 'Kurs & stikk <b>' },
    seksjoner: [{
      tittel: 'Test',
      punkter: [{ sporsmal: 'Merknad <img src=x>', type: 'multiline', svar: '</td></tr><script>' }],
    }],
  }
  const html = byggUtskriftHtml(stygg)
  sjekk('ingen rå script-tagg slipper gjennom', html.includes('<script>'), false)
  sjekk('kundenavnet står escapet', html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true)
  sjekk('ampersand i ordretittel escapes', html.includes('Kurs &amp; stikk'), true)
  sjekk('svartekst kan ikke bryte ut av tabellcella', html.includes('&lt;/td&gt;&lt;/tr&gt;'), true)
}

// ── Utkast skal se ut som utkast ───────────────────────────────────────────

{
  const utkast = byggUtskriftHtml({ ...BASIS, dokument: { ...BASIS.dokument, status: 'utkast' } })
  sjekk('uferdig dokument merkes', utkast.includes('Utkast — dokumentet er ikke ferdigstilt'), true)

  const ferdig = byggUtskriftHtml(BASIS)
  sjekk('ferdig dokument merkes ikke', ferdig.includes('ikke ferdigstilt'), false)
}

// ── Svarformatering ────────────────────────────────────────────────────────

sjekk('tom streng blir tankestrek', formatterSvar({ sporsmal: 'x', type: 'text', svar: '' }), '—')
sjekk('null blir tankestrek', formatterSvar({ sporsmal: 'x', type: 'text', svar: null }), '—')
sjekk('tom tabell blir tankestrek', formatterSvar({ sporsmal: 'x', type: 'table', svar: [] }), '—')
sjekk(
  'tabellrader skrives som lesbare linjer',
  formatterSvar({
    sporsmal: 'Kursfortegnelse',
    type: 'table',
    svar: [{ kurs: '1', vern: 'B16', kabel: '2,5' }, { kurs: '2', vern: 'C10', kabel: '1,5' }],
  }),
  '1 · B16 · 2,5\n2 · C10 · 1,5',
)
// Et nullsvar er IKKE et manglende svar. 0 A er en måling.
sjekk('null som tall er et ekte svar', formatterSvar({ sporsmal: 'x', type: 'number', svar: 0 }), '0')

// ── Signatur ───────────────────────────────────────────────────────────────

{
  const medSig = byggUtskriftHtml({
    ...BASIS,
    signaturer: [{
      formaal: 'Arbeidet er utført',
      signertAv: 'Ola Nordmann',
      signertTid: new Date('2026-08-20T11:30:00Z'),
      strok: [{ points: [[0, 0.5], [0.5, 0.2], [1, 0.6]] }],
      aspect: 3,
    }],
  })
  // 0–1-koordinater ganges opp i viewBox-rommet: aspect 3 → 300×100, så
  // [0, 0.5] blir «M0.0 50.0» og [1, 0.6] blir «L300.0 60.0».
  sjekk('signaturen tegnes som SVG-path', medSig.includes('<path d="M0.0 50.0 L150.0 20.0 L300.0 60.0"'), true)
  sjekk('viewBox følger aspect-forholdet', medSig.includes('viewBox="0 0 300 100"'), true)
  sjekk('signatørens navn står under streken', medSig.includes('Ola Nordmann'), true)
  sjekk('ingen ekstern bilderessurs', /<img\s/.test(medSig), false)

  const tomSig = byggUtskriftHtml({
    ...BASIS,
    signaturer: [{
      formaal: 'Annet', signertAv: 'Tom Strek',
      signertTid: new Date('2026-08-20T11:30:00Z'), strok: [],
    }],
  })
  sjekk('signatur uten strøk sier fra i stedet for å tegne ingenting', tomSig.includes('Ingen strøk registrert'), true)
}

// ── Determinisme ───────────────────────────────────────────────────────────
//
// Samme inndata må gi samme ark. Leste funksjonen klokken selv, ville to
// utskrifter av samme dokument vært ulike filer — og da kan de ikke
// sammenlignes.
sjekk('samme inndata gir samme HTML', byggUtskriftHtml(BASIS) === byggUtskriftHtml(BASIS), true)

// ── Det som ALDRI skal stå på arket ────────────────────────────────────────
//
// Modulen tar ikke imot kostpris, dekningsbidrag eller interne notater i det
// hele tatt. Denne påstanden vokter at ingen legger dem til senere «bare for å
// ha dem tilgjengelig».
{
  const html = byggUtskriftHtml(BASIS)
  const forbudt = ['kostpris', 'dekningsbidrag', 'internal_note', 'internt notat']
  sjekk('ingen interne tall på kundens ark', forbudt.filter(o => html.toLowerCase().includes(o)), [])
}

console.log('')
if (feil > 0) {
  console.error(`${feil} påstand(er) feilet.`)
  process.exit(1)
}
console.log('Alle påstander holder.')

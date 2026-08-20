/**
 * Selvtest for skjemamotoren. Samme mønster som verify-pricefile og
 * verify-invoicing: et kjørbart skript med harde påstander, ingen testrunner.
 *
 *   npm run verify:forms
 *
 * Hva som testes er ikke tilfeldig. Et skjema er DOKUMENTASJON — det er beviset
 * når noen bestrider en jobb, og det leses av DSB. De tre måtene motoren kan
 * lyve på er:
 *
 *   1. En gammel revisjon leses feil, så et signert dokument viser andre punkt
 *      enn det som faktisk ble fylt ut.
 *   2. Et betinget punkt beholder svaret sitt etter at betingelsen ble falsk,
 *      så «ingen avvik» leveres sammen med en avviksbeskrivelse.
 *   3. En klikkliste mister alternativene sine i konverteringen, så «OK/Avvik/
 *      Utbedret» blir til Ja/Nei uten at noen ser det.
 */
import {
  parseSchema, toSections,
  type FormField as FirmField, type FormSection as FirmSection, type FormSchema,
} from '../lib/forms/schema'
import { convertFirmField, convertFirmSections, validateFirmSections } from '../lib/forms/firm-schema'
import { isFieldVisible, pruneHidden, visibleFields, visibleSections } from '../lib/forms/visibility'
import type { FormTemplate, FormValues } from '../lib/forms/types'

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

// ── 1. Gamle revisjoner må fortsatt kunne leses ──────────────────────────────
// En revisjon er uforanderlig og skrives ALDRI om. v1-rader (flat `items`)
// finnes derfor for alltid, også etter at editoren bare lager v2.

const v1: FormSchema = {
  items: [
    { id: 'f1', type: 'check', label: 'Jording kontrollert' },
    { id: 'f2', type: 'text', label: 'Målt av' },
  ],
}
sjekk('v1 flat liste blir én navnløs seksjon', toSections(v1).map(s => [s.title, s.fields.length]), [['', 2]])
sjekk('v1 beholder feltrekkefølgen', toSections(v1)[0].fields.map(f => f.id), ['f1', 'f2'])

const v2: FormSchema = {
  sections: [
    { id: 's1', title: 'Anlegg', fields: [{ id: 'a', type: 'text', label: 'Adresse' }] },
    { id: 's2', title: 'Kontroll', fields: [{ id: 'b', type: 'check', label: 'Jording' }] },
  ],
}
sjekk('v2 beholder seksjonene', toSections(v2).map(s => s.title), ['Anlegg', 'Kontroll'])
sjekk('v2 vinner over items hvis begge finnes',
  toSections({ items: [{ id: 'x', type: 'text', label: 'x' }], sections: v2.sections }).length, 2)
sjekk('tom schema gir ingen seksjoner', toSections({}), [])
sjekk('null gir ingen seksjoner', toSections(null), [])
sjekk('ødelagt JSON gir ingen seksjoner, ikke kast', parseSchema('{ ikke json'), [])
sjekk('parseSchema leser v1', parseSchema(JSON.stringify(v1))[0].fields.length, 2)
sjekk('parseSchema på tom streng', parseSchema(''), [])
// Seksjon uten fields-array skal ikke velte lesingen av et helt dokument.
sjekk('seksjon uten felt-array blir tom seksjon',
  toSections({ sections: [{ id: 's', title: 'T' } as unknown as FirmSection] })[0].fields, [])

// ── 2. Konvertering til rendermodellen ───────────────────────────────────────
// Det som gikk tapt i v1: klikklistas EGNE alternativer.

const klikkliste: FirmField = {
  id: 'k', type: 'choice', label: 'Tilstand',
  choices: ['OK', 'Avvik', 'Utbedret', 'Ikke aktuelt'],
}
sjekk('klikkliste beholder alle alternativene ordrett',
  convertFirmField(klikkliste).choices, ['OK', 'Avvik', 'Utbedret', 'Ikke aktuelt'])
sjekk('avkryss blir Ja/Nei/Ikke aktuelt',
  convertFirmField({ id: 'c', type: 'check', label: 'Jording' }).choices, ['Ja', 'Nei', 'Ikke aktuelt'])
sjekk('tall beholder enhet',
  convertFirmField({ id: 'n', type: 'number', label: 'Isolasjonsmotstand', unit: 'MΩ' }).unit, 'MΩ')
sjekk('tabell beholder kolonnene',
  convertFirmField({ id: 't', type: 'table', label: 'Kurs', columns: [{ key: 'c1', label: 'Kursnr' }] }).columns,
  [{ key: 'c1', label: 'Kursnr' }])
sjekk('fritekst blir multiline', convertFirmField({ id: 'm', type: 'multiline', label: 'Merknad' }).type, 'multiline')
sjekk('foto blir info med markør', convertFirmField({ id: 'p', type: 'photo', label: 'Tavle' }).type, 'info')
sjekk('hjelpetekst følger med',
  convertFirmField({ id: 'h', type: 'text', label: 'L', help: 'Se pkt. 6.3' }).help, 'Se pkt. 6.3')
sjekk('betingelsen følger med',
  convertFirmField({ id: 'b', type: 'text', label: 'L', showIf: { field: 'k', equals: ['Avvik'] } }).showIf,
  { field: 'k', equals: ['Avvik'] })
sjekk('feltnøkkelen er feltets id — svarene er lagret under den',
  convertFirmField(klikkliste).key, 'k')
sjekk('énslig navnløs seksjon arver maltittelen',
  convertFirmSections([{ id: 's', title: '', fields: [] }], 'Sluttkontroll')[0].title, 'Sluttkontroll')
sjekk('flere navnløse seksjoner nummereres',
  convertFirmSections([{ id: 'a', title: '', fields: [] }, { id: 'b', title: '', fields: [] }], 'X').map(s => s.title),
  ['Del 1', 'Del 2'])

// ── 3. Betinget visning ──────────────────────────────────────────────────────

const mal: FormTemplate = {
  id: 'test', version: 1, name: 'Sluttkontroll', source: 'test',
  sections: [
    {
      title: 'Kontroll',
      fields: [
        { key: 'tilstand', label: 'Tilstand', type: 'choice', choices: ['OK', 'Avvik'] },
        { key: 'avvik_tekst', label: 'Beskriv avviket', type: 'multiline', required: true, showIf: { field: 'tilstand', equals: ['Avvik'] } },
      ],
    },
    {
      title: 'Kun ved avvik',
      fields: [
        { key: 'frist', label: 'Frist for utbedring', type: 'text', showIf: { field: 'tilstand', equals: ['Avvik'] } },
      ],
    },
  ],
}
const avvikFelt = mal.sections[0].fields[1]

sjekk('uten betingelse er feltet alltid synlig', isFieldVisible(mal.sections[0].fields[0], {}), true)
sjekk('betinget felt er skjult når kilden er tom', isFieldVisible(avvikFelt, {}), false)
sjekk('betinget felt er skjult ved feil svar', isFieldVisible(avvikFelt, { tilstand: 'OK' }), false)
sjekk('betinget felt vises ved riktig svar', isFieldVisible(avvikFelt, { tilstand: 'Avvik' }), true)
// Et tabellsvar er et array; en betingelse mot det skal ikke krasje eller slå til.
sjekk('betingelse mot et ikke-tekstsvar slår ikke til',
  isFieldVisible(avvikFelt, { tilstand: [{ a: 'Avvik' }] }), false)

sjekk('seksjon uten synlige felt faller bort',
  visibleSections(mal, { tilstand: 'OK' }).map(s => s.title), ['Kontroll'])
sjekk('seksjonene kommer tilbake ved avvik',
  visibleSections(mal, { tilstand: 'Avvik' }).map(s => s.title), ['Kontroll', 'Kun ved avvik'])
sjekk('synlige felt ved OK', visibleFields(mal, { tilstand: 'OK' }).map(f => f.key), ['tilstand'])
sjekk('synlige felt ved avvik',
  visibleFields(mal, { tilstand: 'Avvik' }).map(f => f.key), ['tilstand', 'avvik_tekst', 'frist'])

// Den farligste: svaret som blir liggende igjen.
const medAvvik: FormValues = { tilstand: 'Avvik', avvik_tekst: 'Kabel skadet', frist: '1. sept' }
sjekk('avviksbeskrivelsen forsvinner når avviket gjør det',
  pruneHidden(mal, { ...medAvvik, tilstand: 'OK' }), { tilstand: 'OK' })
sjekk('den overlever så lenge avviket står', pruneHidden(mal, medAvvik), medAvvik)
sjekk('ubetingede svar røres aldri',
  pruneHidden(mal, { tilstand: 'OK', ukjent_felt: 'beholdes' }), { tilstand: 'OK', ukjent_felt: 'beholdes' })

// ── 4. Validering av en mal før den lagres eller importeres ──────────────────

const gyldig: FirmSection[] = [{
  id: 's', title: 'Kontroll', fields: [
    { id: 'a', type: 'choice', label: 'Tilstand', choices: ['OK', 'Avvik'] },
    { id: 'b', type: 'multiline', label: 'Beskriv', showIf: { field: 'a', equals: ['Avvik'] } },
  ],
}]
sjekk('en gyldig mal gir ingen problemer', validateFirmSections(gyldig), [])
sjekk('klikkliste uten alternativer fanges',
  validateFirmSections([{ id: 's', title: '', fields: [{ id: 'a', type: 'choice', label: 'Tilstand', choices: [] }] }]).length, 1)
sjekk('tabell uten kolonner fanges',
  validateFirmSections([{ id: 's', title: '', fields: [{ id: 'a', type: 'table', label: 'Kurs', columns: [] }] }]).length, 1)
sjekk('punkt uten tekst fanges',
  validateFirmSections([{ id: 's', title: '', fields: [{ id: 'a', type: 'text', label: '  ' }] }]).length, 1)
sjekk('duplikat-id fanges — svarene ville overskrevet hverandre',
  validateFirmSections([{ id: 's', title: '', fields: [
    { id: 'a', type: 'text', label: 'En' }, { id: 'a', type: 'text', label: 'To' },
  ] }]).length, 1)
sjekk('betingelse mot ukjent punkt fanges',
  validateFirmSections([{ id: 's', title: '', fields: [
    { id: 'b', type: 'text', label: 'B', showIf: { field: 'finnes_ikke', equals: ['Ja'] } },
  ] }]).length, 1)
sjekk('betingelse mot et svar som ikke finnes fanges',
  validateFirmSections([{ id: 's', title: '', fields: [
    { id: 'a', type: 'choice', label: 'A', choices: ['OK'] },
    { id: 'b', type: 'text', label: 'B', showIf: { field: 'a', equals: ['Avvik'] } },
  ] }]).length, 1)
sjekk('betingelse som peker NEDOVER fanges',
  validateFirmSections([{ id: 's', title: '', fields: [
    { id: 'b', type: 'text', label: 'B', showIf: { field: 'a', equals: ['Ja'] } },
    { id: 'a', type: 'check', label: 'A' },
  ] }]).length, 1)
sjekk('betingelse uten svar fanges — punktet ville aldri vist seg',
  validateFirmSections([{ id: 's', title: '', fields: [
    { id: 'a', type: 'check', label: 'A' },
    { id: 'b', type: 'text', label: 'B', showIf: { field: 'a', equals: [] } },
  ] }]).length, 1)

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

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
import { aiKanFylle, avvisningsgrunn } from '../lib/forms/ai-fill-rules'
import { foreslatteTemaer, isFieldVisible, pruneHidden, temaVerdier, visibleFields, visibleSections } from '../lib/forms/visibility'
import { risikovurdering, AMPEX_TEMPLATES } from '../lib/forms/templates'
import { findUnfilledRequired } from '../lib/forms/visibility'
import { ANSWER_TYPES } from '../lib/forms/answer-types'
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

/* ── Begge AI-veier inn i et skjema må oppføre seg likt ──────────────────── */

// gap-check (ett opptak → felter) og Live-assistenten (felt fylles underveis)
// hadde hver sin regel for hva AI-en fikk skrive, og de var ikke like. Da
// avhenger innholdet i et dokument av hvilken knapp som ble trykt — en
// forskjell ingen kan se i ettertid. Regelen ligger nå ett sted.

sjekk('tabell kan ikke fylles av AI', aiKanFylle('table'), false)
sjekk('info kan ikke fylles av AI', aiKanFylle('info'), false)
for (const t of ['text', 'multiline', 'number', 'choice']) {
  sjekk(`${t} kan fylles av AI`, aiKanFylle(t), true)
}
// Hvorfor tabell er den viktige: en tabell lagres som RADER. En tekststreng der
// rendres som en TOM tabell (components/form-field-view.tsx faller tilbake til
// [] når verdien ikke er en liste) — skjemaet ser komplett ut, montøren
// signerer, og svaret finnes ingen steder.
sjekk('avvisningen sier hvor punktet fylles i stedet',
  avvisningsgrunn('table'), 'Tabellfelt fylles i appen, ikke via tale.')
sjekk('et felt AI-en KAN fylle har ingen avvisningsgrunn', avvisningsgrunn('number'), null)

console.log('')
// ── Risikovurdering med temavalg (v2, 30.10) ──────────────────────────────
// «Hvis det ikke er elbillader skal man jo ikke ha spørsmål om det.»
const rv = risikovurdering
const seksjoner = (v: FormValues) => visibleSections(rv, v).map(s => s.title)
sjekk('v1-dokument (uten temavalg) ser ut som før', seksjoner({ spenningslost: 'Ja' }),
  ['Anlegg og arbeid', 'Jobben inneholder', 'Farevurdering', 'Tiltak og konklusjon'])
sjekk('ingen elbillader → ingen elbil-spørsmål', seksjoner(temaVerdier(rv, ['tema_bad'])).includes('Elbillading'), false)
sjekk('bad valgt → badseksjonen og bare den', seksjoner(temaVerdier(rv, ['tema_bad'])),
  ['Anlegg og arbeid', 'Jobben inneholder', 'Farevurdering', 'Bad og våtrom', 'Tiltak og konklusjon'])
sjekk('temavalget skriver Ja/Nei på alle temaer', Object.values(temaVerdier(rv, ['tema_elbil'])).filter(v => v === 'Ja').length, 1)
sjekk('ordreteksten krysser av på forhånd', foreslatteTemaer(rv, 'Montere Easee ladeboks i garasjen, ny kurs fra sikringsskapet').sort(),
  ['tema_elbil', 'tema_tavle'])
sjekk('uten treff krysses ingenting av', foreslatteTemaer(rv, 'Befaring'), [])
sjekk('fjernes et tema, forsvinner svarene på det',
  pruneHidden(rv, { ...temaVerdier(rv, []), elbil_rcd: 'Ja' }).elbil_rcd, undefined)
sjekk('alle temaseksjoner peker på et valg som finnes',
  rv.sections.flatMap(s => s.fields).filter(f => f.showIf).every(f => rv.sections.some(s => s.fields.some(x => x.key === f.showIf!.field))), true)
sjekk('feltnøklene er unike', new Set(rv.sections.flatMap(s => s.fields.map(f => f.key))).size, rv.sections.flatMap(s => s.fields).length)
sjekk('hvert tema har ord som krysser av', rv.sections.find(s => s.velger)!.fields.every(f => rv.sections.find(s => s.velger)!.velger!.match[f.key] instanceof RegExp), true)

// ── Dynamiske skjema: inntak først, resten tilpasses ──────────────────────
// «Hvis det ikke er elbillader får du ingen spørsmål om laderen.» Regelen er
// rekkefølge + showIf, ikke et eget flagg — testen holder begge deler fast.
const sja = AMPEX_TEMPLATES.find(t => t.id === 'ampex.sja-elbil-tavle')
sjekk('SJA-malen er med blant de bundlede malene', !!sja, true)
if (sja) {
  sjekk('inntaket er første del', sja.sections[0].title, 'Innledende spørsmål')

  const rekkefolge = sja.sections.flatMap(s => s.fields.map(f => f.key))
  sjekk('alle betingelser peker oppover',
    sja.sections.flatMap(s => s.fields).filter(f => f.showIf).every(f =>
      rekkefolge.indexOf(f.showIf!.field) >= 0 &&
      rekkefolge.indexOf(f.showIf!.field) < rekkefolge.indexOf(f.key)), true)
  sjekk('hvert inntaksspørsmål har et Ja-svar å betinge på',
    sja.sections[0].fields.every(f => (f.choices ?? []).includes('Ja')), true)

  // Alt Nei: ingen oppfølging. Ingenting er stilt, ingenting er påkrevd.
  const altNei = { sja_elbil: 'Nei', sja_spenning: 'Nei', sja_hoyde: 'Nei', sja_bad: 'Nei' }
  sjekk('skjult felt er ikke synlig',
    isFieldVisible(sja.sections.find(s => s.title === 'Elbillader')!.fields[0], altNei), false)
  sjekk('skjult påkrevd felt meldes ikke som manglende',
    findUnfilledRequired(sja, altNei).some(f => f.key === 'sja_elbil_vern'), false)
  sjekk('skjult felt telles ikke i framdriften',
    visibleFields(sja, altNei).some(f => f.key === 'sja_elbil_vern'), false)
  const oppfolging = sja.sections.slice(1, -1).flatMap(s => s.fields).map(f => f.key)
  sjekk('ingen oppfølgingsspørsmål vises når alt er Nei',
    visibleFields(sja, altNei).some(f => oppfolging.includes(f.key)), false)

  // Svar som blir skjult skal forsvinne ut av dokumentet, ikke bli liggende.
  const medElbil = { ...altNei, sja_elbil: 'Ja', sja_elbil_vern: 'Ja' }
  sjekk('svaret finnes mens feltet vises', pruneHidden(sja, medElbil).sja_elbil_vern, 'Ja')
  sjekk('endret svar fjerner det skjulte svaret',
    'sja_elbil_vern' in pruneHidden(sja, { ...medElbil, sja_elbil: 'Nei' }), false)
  sjekk('PDF-grunnlaget viser bare stillede spørsmål',
    visibleSections(sja, { ...medElbil, sja_elbil: 'Nei' }).some(s => s.title === 'Elbillader'), false)
}

// ── Én ordliste for svartypene ────────────────────────────────────────────
// Telefonen og kontoret tegner hver sin bygger, men må ikke finne på hvert
// sitt språk. Uten denne lista ville «Tekst» hett «Kort tekst» på den ene
// flaten, og et skjema laget på kontoret sett annerledes ut i felt. Testen
// holder ordene, rekkefølgen og ikonnøklene på plass.
const svartyper = ANSWER_TYPES.map(t => t.id)
sjekk('alle åtte svartypene har en oppføring', ANSWER_TYPES.length, 8)
sjekk('ingen svartype er med to ganger', new Set(svartyper).size, 8)
sjekk('rekkefølgen er vanligst først', svartyper.slice(0, 3), ['check', 'text', 'multiline'])
sjekk('hver type har navn, forklaring og eksempel',
  ANSWER_TYPES.every(t => t.label.trim() && t.description.trim() && t.example.trim()), true)
sjekk('hver type har en ikonnøkkel', ANSWER_TYPES.every(t => t.icon.trim().length > 0), true)

if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

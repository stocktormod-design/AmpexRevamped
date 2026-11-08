/**
 * Selvtest for prosjekteringen (rom, areal, risikomatrise, hva som mangler).
 *
 *   npm run verify:prosjektering
 *
 * Dokumentet går til kunden og er grunnlaget for risikovurderingen etter FEL § 16. Et feil
 * areal, et risikotall som havner i feil rute eller et «ferdig» som ikke er ferdig, er feil
 * kunden og et tilsyn ser.
 */
import {
  foringLengde, hoydeFor, kursfortegnelse, nesteKursNr, standardHoyde,
  areal, forslagForRom, lesProsjektering, mangler, matrise, meterPerEnhet, niva, punkterPerRom,
  risikotall, romFor, tomProsjektering, type Fare, type Rom,
} from '../lib/prosjektering'
import { forslag, KATALOG_IDER, somFare } from '../lib/risiko-katalog'
import { erTilleggssymbol, punkttypeFraEtikett } from '../lib/el-symboler'
import { getSymbol } from '../lib/symbols'
import { dimensjonFor, gruppeFor, lagKursfortegnelse, spenningsfall } from '../lib/kursforslag'
import { dupliserUtvalg, flyttUtvalg, iBoks, kursAvUtvalg, lengdeLangs, roterUtvalg, slettUtvalg, sokKommandoer } from '../lib/tegning-redigering'

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
const nær = (a: number | null | undefined, b: number, eps = 1e-6) => a != null && Math.abs(a - b) < eps

// ── Målestokk ─────────────────────────────────────────────────────────────
// Verona: planen er 1360 × 1020 px, ytterveggen 13,61 m går over 80 % av bredden.
const aspekt = 1360 / 1020
const m = meterPerEnhet({ a: { x: 0.1, y: 0.9 }, b: { x: 0.9, y: 0.9 }, meter: 13.61 }, aspekt)
sjekk('vannrett mål: hele bredden = 13,61 / 0,8 m', nær(m?.x, 13.61 / 0.8), true)
sjekk('høyden skaleres med sidens forhold', nær(m?.y, 13.61 / 0.8 / aspekt), true)
// Samme lengde målt loddrett: 10,20 m over 75 % av høyden → samme skala som over hvis planen er tro.
const loddrett = meterPerEnhet({ a: { x: 0.95, y: 0.1 }, b: { x: 0.95, y: 0.85 }, meter: 10.2 }, aspekt)
sjekk('loddrett mål gir meter per høyde direkte', nær(loddrett?.y, 10.2 / 0.75), true)
sjekk('null meter gir ingen målestokk', meterPerEnhet({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meter: 0 }, 1), null)
sjekk('to like punkter gir ingen målestokk', meterPerEnhet({ a: { x: 0.5, y: 0.5 }, b: { x: 0.5, y: 0.5 }, meter: 3 }, 1), null)
sjekk('areal 0,25 × 0,2 av en 10 × 8 m plan = 4 m²', nær(areal({ x: 0, y: 0, w: 0.25, h: 0.2 }, { x: 10, y: 8 }), 4), true)
sjekk('areal uten målestokk er ukjent', areal({ x: 0, y: 0, w: 1, h: 1 }, null), null)

// ── Forslag per rom ───────────────────────────────────────────────────────
sjekk('bad får skvett og del 701', [forslagForRom('Bath').pavirkninger.includes('AD4'), forslagForRom('Bad 1').nek[0].includes('701')], [true, true])
sjekk('garasje får støt, brannfare og elbil', [forslagForRom('Garage').pavirkninger.includes('AG2'), forslagForRom('Garasje').pavirkninger.includes('BE2'), forslagForRom('garasje').nek.some(n => n.includes('722'))], [true, true, true])
sjekk('ukjent rom får bare normale forhold', forslagForRom('Gang').pavirkninger, ['AA5', 'AD1', 'BA1'])
sjekk('«Kitchen / Living room» treffer kjøkken først', forslagForRom('Kitchen / Living room').bruk, 'Matlaging, mange faste apparater')

// ── Risikomatrise ─────────────────────────────────────────────────────────
sjekk('risikotall er S × K', risikotall(3, 4), 12)
sjekk('utenfor 1–5 klemmes', [risikotall(0, 9), risikotall(7, 7)], [5, 25])
sjekk('grensene: 4 lav, 5 middels, 10 middels, 12 høy', [niva(2, 2), niva(1, 5), niva(2, 5), niva(3, 4)], ['lav', 'middels', 'middels', 'hoy'])
const fare = (over: Partial<Fare>): Fare => ({ id: 'f', tittel: 'Fare', gjelder: 'anlegg', s: 3, k: 4, tiltak: 'Tiltak', restS: 1, restK: 4, ...over })
const mat = matrise([fare({ id: 'a' }), fare({ id: 'b', s: 3, k: 4, restS: 2, restK: 2 })], false)
sjekk('to farer i samme rute før tiltak', mat.get('3,4')?.map(f => f.id), ['a', 'b'])
const etter = matrise([fare({ id: 'a' }), fare({ id: 'b', restS: 2, restK: 2 })], true)
sjekk('etter tiltak skilles de', [etter.get('1,4')?.map(f => f.id), etter.get('2,2')?.map(f => f.id)], [['a'], ['b']])

// ── Rom og punkter ────────────────────────────────────────────────────────
const rom = (id: string, form: Rom['form']): Rom => ({ id, navn: id, form, bruk: 'x', brukere: 'y', pavirkninger: [], notat: '' })
const garasje = rom('garasje', { x: 0.6, y: 0, w: 0.4, h: 0.6 })
const bod = rom('bod', { x: 0.8, y: 0.4, w: 0.2, h: 0.2 })
sjekk('punkt i bod inne i garasjen hører til boden', romFor({ x: 0.9, y: 0.5 }, [garasje, bod])?.id, 'bod')
sjekk('punkt utenfor alle rom hører ikke til noe rom', romFor({ x: 0.1, y: 0.9 }, [garasje, bod]), null)
const p = tomProsjektering()
p.rom = [garasje, bod]
p.punkter = [
  { id: '1', type: 'stikk', x: 0.7, y: 0.1 }, { id: '2', type: 'stikk', x: 0.7, y: 0.2 },
  { id: '3', type: 'lyspunkt', x: 0.9, y: 0.5 }, { id: '4', type: 'stikk', x: 0.1, y: 0.9 },
]
const ppr = punkterPerRom(p)
sjekk('punkter telles per rom og type', [ppr.get('garasje')?.get('stikk'), ppr.get('bod')?.get('lyspunkt'), ppr.get('')?.get('stikk')], [2, 1, 1])

// ── Hva som mangler ───────────────────────────────────────────────────────
const tom = mangler(tomProsjektering())
sjekk('et tomt dokument mangler plan, kunde, rom, farer, pekere, SJA og kompetanse', tom.length, 8)
const ferdig = tomProsjektering()
ferdig.plan.key = 'drawings/x.png'
ferdig.kunde = 'Familie med to små barn, elbil'
ferdig.rom = [garasje]
ferdig.farer = [
  fare({ id: '1', x: 0.5, y: 0.5 }), fare({ id: '2', gjelder: 'montor', x: 0.2, y: 0.2 }),
  fare({ id: '3' }), fare({ id: '4' }), fare({ id: '5' }),
]
ferdig.sja = { arbeidsmoment: 'Tilkobling i tavle', deltakere: 'Tormod', steg: [{ id: 's', steg: 'Frakoble', fare: 'Spenning', tiltak: 'Lås og merk', ansvarlig: 'Tormod' }], konklusjon: '' }
ferdig.kompetanse = [{ id: 'k', hva: 'Elsikkerhetskurs FSE', hvorfor: 'FSE § 7' }]
sjekk('et utfylt dokument mangler ingenting', mangler(ferdig), [])
ferdig.farer[2] = fare({ id: '3', tittel: 'Verre', restS: 5, restK: 5 })
sjekk('restrisiko over startrisiko meldes', mangler(ferdig), ['«Verre»: restrisikoen er høyere enn før tiltak'])

// ── Lesing av lagrede dokumenter ──────────────────────────────────────────
sjekk('tomt eller søppel gir et tomt dokument', [lesProsjektering(null), lesProsjektering('x')], [tomProsjektering(), tomProsjektering()])
const gammel = lesProsjektering({ rom: [{ id: 'r', navn: 'Bad', form: { x: 0, y: 0, w: 1, h: 1 } }], sja: { arbeidsmoment: 'A' } })
sjekk('manglende felt i et rom fylles inn', [gammel.rom[0].pavirkninger, gammel.rom[0].bruk], [[], ''])
sjekk('SJA uten steg får tom liste', gammel.sja.steg, [])

sjekk('eldre dokument uten «avvist» får tom liste', gammel.avvist, [])

// ── Dynamisk risikovurdering: jobben bestemmer spørsmålene ────────────────
const ider = (tekst: string, t = tomProsjektering()) => forslag({ tekst, tegning: t }).map(f => f.id)
sjekk('katalogen har unike id-er', new Set(KATALOG_IDER).size, KATALOG_IDER.length)
sjekk('en tom jobb gir ingen forslag', ider(''), [])
sjekk('ingen elbillader → ingen spørsmål om DC-feilstrøm', ider('Bytte stikkontakter i stua').includes('anlegg.elbil-dc'), false)
sjekk('elbillader i ordreteksten → DC-feilstrøm og last', ['anlegg.elbil-dc', 'anlegg.elbil-last'].every(i => ider('Montere Easee ladeboks i garasjen').includes(i)), true)
const verona = tomProsjektering()
verona.rom = [
  { id: 'bad', navn: 'Bad', form: { x: 0, y: 0, w: 0.2, h: 0.2 }, bruk: '', brukere: '', pavirkninger: ['AD4', 'BA2'], notat: '' },
  { id: 'sov', navn: 'Soverom 1', form: { x: 0.3, y: 0, w: 0.2, h: 0.2 }, bruk: '', brukere: '', pavirkninger: [], notat: '' },
]
verona.punkter = [{ id: 'p1', type: 'stikk-jord', x: 0.1, y: 0.1 }, { id: 'p2', type: 'lyspunkt', x: 0.4, y: 0.1 }]
const fv = forslag({ tekst: '', tegning: verona })
const bad = fv.find(f => f.id === 'anlegg.bad-sjokk')
sjekk('badet på tegningen gir våtromsfaren, festet til badet', [bad?.romId, bad?.fordi], ['bad', 'rommet «Bad»'])
sjekk('soverom uten røykvarsler på tegningen sies rett ut', fv.find(f => f.id === 'anlegg.royk')?.fordi, 'soverommet «Soverom 1» har ingen røykvarsler på tegningen')
sjekk('barn + stikkontakter gir barnesikring', fv.some(f => f.id === 'anlegg.barn'), true)
sjekk('lyspunkt i tak gir arbeid i høyden', fv.some(f => f.id === 'montor.hoyde'), true)
sjekk('ingen garasje, ingen varmepumpe, ingen elbil → ingen av dem', fv.filter(f => /garasje|varmepumpe|elbil/.test(f.id)).length, 0)
const lagtTil = { ...verona, farer: [somFare(bad!, 'f1')], avvist: ['anlegg.royk'] }
const igjen = forslag({ tekst: '', tegning: lagtTil }).map(f => f.id)
sjekk('lagt til og avvist kommer ikke tilbake', [igjen.includes('anlegg.bad-sjokk'), igjen.includes('anlegg.royk')], [false, false])
sjekk('et forslag blir en fare med kilde og NEK i tiltaket', [lagtTil.farer[0].kilde, lagtTil.farer[0].tiltak.includes('NEK 400-7-701')], ['anlegg.bad-sjokk', true])
sjekk('alle forslag har lavere eller lik restrisiko', forslag({ tekst: 'elbil varmepumpe tavle inntak dimmer gammel komfyr utendørs varmekabel', tegning: verona })
  .filter(f => risikotall(f.restS, f.restK) > risikotall(f.s, f.k)).map(f => f.id), [])

// ── Installasjonstegningen ────────────────────────────────────────────────
sjekk('bryter står på 110 cm uten egen høyde', hoydeFor({ id: 'b', type: 'bryter', x: 0, y: 0 }), 110)
sjekk('egen høyde vinner over standarden', hoydeFor({ id: 'b', type: 'bryter', x: 0, y: 0, hoyde: 90 }), 90)
sjekk('lyspunkt i tak har ingen standardhøyde', standardHoyde('lyspunkt'), null)
// En 10 × 10 m plan (kvadratisk): en L-formet føring 0,2 bort og 0,1 ned = 2 m + 1 m.
const mpe10 = { x: 10, y: 10 }
sjekk('føringen måles langs alle leddene', nær(foringLengde({ id: 'f', skjult: true, pts: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.1 }] }, mpe10), 3), true)
sjekk('uten målestokk er lengden ukjent', foringLengde({ id: 'f', skjult: true, pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, null), null)
sjekk('neste kursnummer etter 1, 2, 7 og «Ute» er 8', nesteKursNr([{ nr: '1' }, { nr: '2' }, { nr: '7' }, { nr: 'Ute' }] as never), '8')
sjekk('første kurs er 1', nesteKursNr([]), '1')
const anlegg = tomProsjektering()
anlegg.plan.malestokk = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, meter: 10 }
anlegg.rom = [{ id: 'stue', navn: 'Stue', form: { x: 0, y: 0, w: 0.5, h: 1 }, bruk: '', brukere: '', pavirkninger: [], notat: '' },
  { id: 'kj', navn: 'Kjøkken', form: { x: 0.5, y: 0, w: 0.5, h: 1 }, bruk: '', brukere: '', pavirkninger: [], notat: '' }]
const kurs = (id: string, nr: string) => ({ id, nr, navn: '', vern: 'C10', rcd: '', kabel: '', forlegning: '', merknad: '' })
anlegg.kurser = [kurs('k10', '10'), kurs('k2', '2'), kurs('ku', 'Ute')]
anlegg.punkter = [
  { id: '1', type: 'stikk-jord', x: 0.1, y: 0.5, kursId: 'k2' }, { id: '2', type: 'stikk-jord', x: 0.6, y: 0.5, kursId: 'k2' },
  { id: '3', type: 'lyspunkt', x: 0.2, y: 0.2, kursId: 'k2' }, { id: '4', type: 'komfyr', x: 0.8, y: 0.2, kursId: 'k10' },
  { id: '5', type: 'stikk', x: 0.3, y: 0.3 },
]
anlegg.foringer = [{ id: 'f1', skjult: true, kursId: 'k2', pts: [{ x: 0.1, y: 0.5 }, { x: 0.6, y: 0.5 }] }]
const kf = kursfortegnelse(anlegg, 1)
sjekk('kursene sorteres på nummer, tekst sist', kf.map(r => r.kurs.nr), ['2', '10', 'Ute'])
sjekk('kurs 2: to stikk og ett lys, flest først', kf[0].punkter, [['stikk-jord', 2], ['lyspunkt', 1]])
sjekk('kurs 2 går gjennom stue og kjøkken', kf[0].rom, ['Stue', 'Kjøkken'])
sjekk('kurs 2 er 5 m målt langs føringen', nær(kf[0].lengde, 5), true)
sjekk('kurs uten føring har ukjent lengde', kf[1].lengde, null)
sjekk('punkt uten kurs havner ikke i fortegnelsen', kf.flatMap(r => r.punkter).reduce((s, [, n]) => s + n, 0), 4)
sjekk('eldre dokument får tomme kurser og føringer', [gammel.kurser, gammel.foringer], [[], []])
sjekk('føring med under to punkter leses ikke inn', lesProsjektering({ foringer: [{ id: 'x', pts: [{ x: 0, y: 0 }], skjult: true }] }).foringer, [])

// ── Elkraft-forklaringen → punkttyper ─────────────────────────────────────
// Etikettene ordrett fra en ekte norsk symbolforklaring (NEK 144-stil, 30.10).
const forklaring: Array<[string, string | null]> = [
  ['Fordeling', 'fordeling'], ['Stikkontakt', 'stikk'], ['Stikkontakt, 2-veis m/jord', 'stikk-jord'],
  ['Stikkontakt, 3-polt Industri/rundstift', 'stikk-3fas'], ['Tilkoblingspunkt for utstyr levert av andre', 'tilkobling'],
  ['Ovn', 'ovn'], ['Bryter', 'bryter'], ['Bryter, 1-polt', 'bryter'], ['Bryter, 2-polt', 'bryter-2pol'],
  ['Bryter, serievender', 'serievender'], ['Dimmer', 'dimmer'], ['Bevegelsesføler', 'sensor'],
  ['Bevegelsesføler, i/tak', 'sensor'], ['Lysføler (lux)', 'lysfoler'], ['Termostat', 'termostat'],
  ['Koblingsboks, påvegg', 'koblingsboks'], ['Koblingsboks, innfelt', 'koblingsboks-innfelt'], ['Varmekabel', 'varmekabel'],
  ['Brannsentral', null],
]
for (const [etikett, type] of forklaring) sjekk(`«${etikett}» → ${type}`, punkttypeFraEtikett(etikett), type)
sjekk('hver type forklaringen gir har et symbol', forklaring.filter(([, t]) => t && !getSymbol(t)).map(([e]) => e), [])
sjekk('tilleggssymboler er ikke punkter', ['Tilleggssymbol for uttak montert i kanal', 'Sammenkobling av en eller flere kabler', 'Stikkontakt'].map(erTilleggssymbol), [true, true, false])

// ── Tegnemodusen: utvalg ──────────────────────────────────────────────────
const tm = tomProsjektering()
tm.punkter = [{ id: 'a', type: 'stikk', x: 0.2, y: 0.2 }, { id: 'b', type: 'lyspunkt', x: 0.5, y: 0.5 }, { id: 'c', type: 'bryter', x: 0.9, y: 0.9 }]
tm.foringer = [{ id: 'f', pts: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.1 }], skjult: true }]
tm.rom = [{ id: 'r', navn: 'Stue', form: { x: 0, y: 0, w: 0.7, h: 0.7 }, bruk: '', brukere: '', pavirkninger: [], notat: '' }]
sjekk('vindu (mot høyre) tar bare det som ligger helt inni', iBoks(tm, { x: 0.05, y: 0.05 }, { x: 0.65, y: 0.6 }).sort(), ['a', 'b', 'f'])
sjekk('kryssing (mot venstre) tar det som berøres', iBoks(tm, { x: 0.65, y: 0.6 }, { x: 0.15, y: 0.05 }).sort(), ['a', 'b', 'f', 'r'])
sjekk('skjulte lag kan ikke velges', iBoks(tm, { x: 0.05, y: 0.05 }, { x: 0.65, y: 0.6 }, id => id === 'f').sort(), ['a', 'b'])
const flyttet = flyttUtvalg(tm, ['a', 'f'], 0.1, 0)
sjekk('flytt tar punkt og føring like langt', [nær(flyttet.punkter[0].x, 0.3), nær(flyttet.foringer[0].pts[1].x, 0.7), flyttet.punkter[1].x], [true, true, 0.5])
const kopi = dupliserUtvalg(tm, ['a', 'r'], 0.05, 0.05)
sjekk('kopi: punktet får ny id, rommet kopieres ikke', [kopi.nye.length, kopi.p.punkter.length, kopi.p.rom.length, kopi.nye[0] !== 'a'], [1, 4, 1, true])
const rot = roterUtvalg(roterUtvalg(tm, ['a'], 90), ['a'], -180)
sjekk('rotasjon går rundt: 90 − 180 = 270', rot.punkter[0].vinkel, 270)
sjekk('rotasjon tilbake til 0 lagres som tom', roterUtvalg(roterUtvalg(tm, ['a'], 90), ['a'], 270).punkter[0].vinkel, undefined)
const ka = kursAvUtvalg(tm, ['a', 'b', 'f'], 'Stue')
sjekk('ny kurs av valgte: nr 1, tre ting på den', [ka.p.kurser[0].nr, ka.p.punkter.filter(x => x.kursId === ka.kursId).length + ka.p.foringer.filter(x => x.kursId === ka.kursId).length], ['1', 3])
const sl = slettUtvalg(ka.p, [ka.kursId, 'c'])
sjekk('slett kurs tar den av punktene; slett punkt fjerner det', [sl.kurser.length, sl.punkter.length, sl.punkter.every(x => !x.kursId)], [0, 2, true])
sjekk('lengde langs: 3-4-5 i meter', nær(lengdeLangs([{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.4 }], { x: 10, y: 10 }), 7), true)
const kom = [{ navn: 'Stikkontakt m/jord', ord: 'uttak' }, { navn: 'Ny kurs', ord: 'krets' }, { navn: 'Tilpass visning' }]
sjekk('kommandosøk: alle ordene må finnes', sokKommandoer(kom, 'ny kurs').map(k => k.navn), ['Ny kurs'])
sjekk('kommandosøk: nøkkelord teller', sokKommandoer(kom, 'uttak').map(k => k.navn), ['Stikkontakt m/jord'])

// ── Kursfortegnelse av tegningen ─────────────────────────────────────────
{
  const d = tomProsjektering()
  d.rom = [rom('Stue', { x: 0, y: 0, w: 0.5, h: 0.5 }), rom('Kjøkken', { x: 0.5, y: 0, w: 0.5, h: 0.5 }), rom('Bad', { x: 0, y: 0.5, w: 0.3, h: 0.3 })]
  const pt = (id: string, type: string, x: number, y: number, kursId?: string) => ({ id, type, x, y, kursId })
  d.punkter = [
    ...Array.from({ length: 10 }, (_, i) => pt(`s${i}`, 'stikk-jord', 0.05 + i * 0.04, 0.2)),   // 10 stikk i stua → to kurser
    pt('l1', 'downlight', 0.1, 0.1), pt('l2', 'downlight', 0.2, 0.1), pt('b1', 'bryter', 0.05, 0.05),
    pt('l3', 'lyspunkt', 0.7, 0.1), pt('k1', 'komfyr', 0.8, 0.3), pt('k2', 'stikk', 0.6, 0.3),
    pt('v1', 'varmekabel', 0.1, 0.6), pt('t1', 'termostat', 0.05, 0.55),
    pt('r1', 'royk', 0.2, 0.2), pt('x1', 'stikk', 0.9, 0.9, 'gammel'),
  ]
  d.kurser = [{ id: 'gammel', nr: '7', navn: 'Garasje', vern: 'C10', kabel: '', rcd: '', forlegning: '', merknad: '' }]
  const r = lagKursfortegnelse(d)
  const k = (id: string) => r.p.kurser.find(x => x.id === r.p.punkter.find(y => y.id === id)!.kursId)
  sjekk('røykvarsler legges ikke på kurs', r.p.punkter.find(x => x.id === 'r1')!.kursId, undefined)
  sjekk('stue og kjøkken lys på samme kurs (3 lyspunkter < 12)', k('l1')?.id === k('l3')?.id, true)
  sjekk('bryteren følger lyset i rommet', k('b1')?.id, k('l1')?.id)
  sjekk('lyskursen heter etter rommene', k('l1')?.navn, 'Lys Stue, Kjøkken')
  sjekk('lys: B10 3G1,5', [k('l1')?.vern, k('l1')?.kabel], ['B10', 'IFXI 3G1,5'])
  sjekk('10 stikk i stua deles: 8 + 2', k('s0')?.id !== k('s9')?.id && k('s7')?.id === k('s0')?.id, true)
  sjekk('rest-stikk i stua og kjøkkenstikket deler kurs', k('s9')?.id, k('k2')?.id)
  sjekk('komfyren får egen kurs uten tall', [k('k1')?.navn, k('k1')?.vern], ['Komfyr, Kjøkken', ''])
  sjekk('varmekabel og termostat i badet på én kurs', k('v1')?.id === k('t1')?.id && k('v1')?.navn === 'Varme Bad', true)
  sjekk('nye kurser nummereres etter den høyeste', r.p.kurser.filter(x => r.nye.includes(x.id)).map(x => x.nr), ['8', '9', '10', '11', '12'])
  const g = r.p.kurser.find(x => x.id === 'gammel')!
  sjekk('eksisterende kurs: skrevet vern beholdes, tomt fylles', [g.vern, g.kabel, g.rcd], ['C10', 'IFXI 3G2,5', '30 mA type A'])
  sjekk('punkt på eksisterende kurs flyttes ikke', r.p.punkter.find(x => x.id === 'x1')!.kursId, 'gammel')
  sjekk('ingenting å gjøre andre gang', lagKursfortegnelse(r.p).nye.length, 0)
  sjekk('data og fordeling har ingen gruppe', [gruppeFor('data'), gruppeFor('fordeling')], [null, null])
  sjekk('lader: type B', dimensjonFor('fast', 'elbillader').rcd.includes('type B'), true)
  sjekk('spenningsfall 25 m 3G1,5 B10 = 2,9 %', nær(spenningsfall(25, 'IFXI 3G1,5', 'B10'), 2 * 25 * 10 * 0.0225 / (1.5 * 230) * 100), true)
  sjekk('spenningsfall uten kabel = null', spenningsfall(25, '', 'B10'), null)
}

// ── Svakstrømsforklaringen (30.10): data, adgang, brann ───────────────────
{
  const forventet: Array<[string, string]> = [
    ['Rack, for data', 'rack'], ['Adresseledd', 'adresseledd'], ['Brannklokke', 'klokke'], ['Alarmsender', 'alarmsender'],
    ['Alarmsirene', 'sirene'], ['Alarmsummer', 'summer'], ['Dørholder', 'dorholder'], ['IR-detektor', 'ir-detektor'],
    ['Kamera', 'kamera'], ['Kamera, dome', 'kamera-dome'], ['Kortleser', 'kortleser'], ['Kortleser m/tastatur', 'kortleser-tastatur'],
    ['Uttak, data dobbel', 'data-dobbel'], ['Uttak, fiber dobbel', 'fiber-dobbel'], ['Uttak, tele dobbel', 'tele-dobbel'],
    ['Inngangsenhet', 'inngangsenhet'], ['Nøkkelsafe', 'nokkelsafe'], ['Roterende blinklampe', 'blinklampe'], ['Utgangsenhet', 'utgangsenhet'],
    ['Magnetkontakt', 'magnetkontakt'], ['Nødåpner, KAC', 'nodapner'], ['Ranskontakt', 'ranskontakt'], ['Utpasseringsknapp', 'utpasseringsknapp'],
  ]
  for (const [etikett, type] of forventet) {
    sjekk(`svakstrøm: «${etikett}» → ${type}`, punkttypeFraEtikett(etikett), type)
    sjekk(`svakstrøm: ${type} har symbol`, !!getSymbol(type), true)
  }
  sjekk('vanlig datauttak er fortsatt data', punkttypeFraEtikett('Datauttak'), 'data')
  sjekk('svakstrøm legges ikke på sterkstrømskurser', ['kortleser', 'kamera', 'rack', 'sirene'].map(gruppeFor), [null, null, null, null])
}

if (feil) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nalt grønt')

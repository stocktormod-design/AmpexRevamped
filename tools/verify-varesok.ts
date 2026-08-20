/**
 * Selvtest for varesøk og varekort — de to rene modulene bak «EFObasen-følelsen».
 *
 *   npm run verify:varesok
 *
 * Hva som testes er valgt etter hvordan en montør faktisk søker: han har en
 * etikett i hånda der halve el-nummeret er slitt bort, eller han husker
 * produsenten og ikke varenavnet.
 */
import {
  avstand, deleSok, erTall, foreslaaRetting, likeMonster, rangerVare, sorterTreff,
  type SokbarVare,
} from '../lib/product-search'
import { utledKategori, utledKategorier, kategoriNavn, kandidater } from '../lib/product-category'
import { byggSokeTekst, tilVarekort, visbareEkstra } from '../lib/pricefile/varekort'
import { byggPrisbilde, erListepris, kostprisFra, type Prisrad } from '../lib/pricing'
import { parseEfoNelfo, type Vare } from '../lib/pricefile/efo-nelfo'
import { DEMO_BILDER, demoFiler, demovarer } from '../lib/pricefile/demo-katalog'

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

/* ── Varekort: det prisfila allerede inneholder ───────────────────────────── */

const raaVare = (over: Partial<Vare> = {}): Vare => ({
  merke: 'elnummer', vareNr: '1234567',
  betegnelse: 'PFSP 3G2,5', betegnelse2: 'Installasjonskabel',
  beskrivelse: 'PFSP 3G2,5 Installasjonskabel',
  maaleEnhet: 'm', prisEnhet: 'MTR', prisEnhetTekst: 'meter',
  pris: 24.9, mengde: 1, prisDato: null, status: 'uendret',
  blokkNummer: null, rabattGruppe: '4260', fabrikat: 'Nexans', type: 'PFSP',
  lagerfoert: true, salgspakning: 100, rabatt: null, prisType: 'netto',
  nettoPris: 24.9, tillegg: [], alternativer: [],
  ...over,
})

const kort = tilVarekort(raaVare({
  tillegg: [
    { feltId: 'BILDE', verdi: 'https://x.no/b.jpg' },
    { feltId: 'FDV', verdi: 'https://x.no/fdv.pdf' },
    { feltId: 'HMS', verdi: 'https://x.no/hms.pdf' },
    { feltId: 'EFOBASE', verdi: 'EFO-99' },
    { feltId: 'VEKT', verdi: '0,12' },
    { feltId: 'DIMENSJON', verdi: '12x8 mm' },
  ],
  alternativer: [
    { merke: 'ean', vareNr: '7012345678901', type: 'identifikasjon', salgspakning: null },
    { merke: 'nrf', vareNr: '4455667', type: 'identifikasjon', salgspakning: null },
    { merke: 'elnummer', vareNr: '7654321', type: 'erstatning', salgspakning: null },
  ],
}))!

sjekk('fabrikat hentes ut — det folk faktisk sier', kort.fabrikat, 'Nexans')
sjekk('typebetegnelse hentes ut', kort.typeBetegnelse, 'PFSP')
sjekk('rabattgruppe blir varegruppe', kort.rabattGruppe, '4260')
sjekk('EAN fra alternativpost', kort.ean, '7012345678901')
sjekk('NRF fra alternativpost', kort.nrf, '4455667')
sjekk('erstatningsvare fanges', kort.erstattesAv, '7654321')
sjekk('bilde-URL', kort.bildeUrl, 'https://x.no/b.jpg')
sjekk('FDV-URL', kort.fdvUrl, 'https://x.no/fdv.pdf')
sjekk('HMS-URL', kort.hmsUrl, 'https://x.no/hms.pdf')
sjekk('EFObase-id er ikke en URL og skal ikke kreves å være det', kort.efobaseId, 'EFO-99')
sjekk('salgspakning', kort.salgspakning, 100)
sjekk('ingenting kastes — alle VX-felt beholdes', Object.keys(kort.ekstra).sort(),
  ['BILDE', 'DIMENSJON', 'EFOBASE', 'FDV', 'HMS', 'VEKT'])
sjekk('lenkefeltene vises ikke som tekstrader',
  visbareEkstra(kort.ekstra).map(x => x.etikett), ['Dimensjon', 'Vekt'])

// En verdi som ikke er en URL skal ikke bli en død lenke i UI-et.
sjekk('BILDE som ikke er en URL blir null',
  tilVarekort(raaVare({ tillegg: [{ feltId: 'BILDE', verdi: 'se katalog' }] }))!.bildeUrl, null)
sjekk('tom VX-verdi lagres ikke',
  Object.keys(tilVarekort(raaVare({ tillegg: [{ feltId: 'FDV', verdi: '  ' }] }))!.ekstra), [])
// El-nummer er foretrukket, men EAN er like universell på tvers av grossister.
// Å hoppe over EAN-merkede linjeposter var å kaste varer vi hadde full
// informasjon om.
sjekk('EAN-merket linjepost bruker EAN som nøkkel',
  tilVarekort(raaVare({ merke: 'ean', vareNr: '7012345678901' }))!.elnummer, '7012345678901')
sjekk('EAN-merket linjepost får også EAN i eget felt',
  tilVarekort(raaVare({ merke: 'ean', vareNr: '7012345678901' }))!.ean, '7012345678901')
sjekk('el-nummer vinner over EAN når begge finnes', kort.elnummer, '1234567')
sjekk('vare uten både el-nummer og EAN gir null',
  tilVarekort(raaVare({ merke: 'produsent', vareNr: 'ABC', alternativer: [] })), null)
sjekk('pakning kan komme fra alternativpost når linjeposten mangler den',
  tilVarekort(raaVare({
    salgspakning: null,
    alternativer: [{ merke: 'elnummer', vareNr: '1', type: 'pakning', salgspakning: 25 }],
  }))!.salgspakning, 25)

sjekk('søketeksten inneholder alt som skal kunne søkes',
  kort.sokeTekst, 'pfsp 3g2,5 installasjonskabel 1234567 nexans pfsp 7012345678901 4455667 4260')
sjekk('byggSokeTekst hopper over tomme deler', byggSokeTekst(['A', null, '', ' B ']), 'a b')

/* ── Søk ─────────────────────────────────────────────────────────────────── */

sjekk('deler på mellomrom', deleSok('nexans pfsp'), ['nexans', 'pfsp'])
sjekk('deler også på skråstrek', deleSok('1,5/2,5'), ['1,5', '2,5'])
sjekk('komma beholdes inne i ord — «3G2,5» er ett ord i faget', deleSok('3g2,5'), ['3g2,5'])
sjekk('tomt søk gir ingen ord', deleSok('   '), [])
sjekk('erTall', [erTall('1234567'), erTall('3g2'), erTall('')], [true, false, false])

const vare = (over: Partial<SokbarVare> = {}): SokbarVare => {
  const v: SokbarVare = {
    id: 'p1', elnummer: '1234567', navn: 'PFSP 3G2,5 Installasjonskabel',
    fabrikat: 'Nexans', typeBetegnelse: 'PFSP', ean: '7012345678901', nrf: '4455667',
    sokeTekst: '', ...over,
  }
  v.sokeTekst = v.sokeTekst || byggSokeTekst([v.navn, v.elnummer, v.fabrikat, v.typeBetegnelse, v.ean, v.nrf])
  return v
}
const r = (sok: string, v = vare()) => rangerVare(v, sok, deleSok(sok))

sjekk('el-nummer eksakt er beste treff', r('1234567'), 0)
sjekk('el-nummer med mellomrom teller likt', r('123 45 67'), 0)
sjekk('EAN eksakt — det du får av en strekkodeskanner', r('7012345678901'), 1)
sjekk('NRF eksakt', r('4455667'), 1)
sjekk('el-nummer fra starten', r('1234'), 2)
// Det var dette som IKKE virket før: de siste sifrene på en slitt etikett.
sjekk('de fire siste sifrene i el-nummeret treffer', r('4567'), 3)
sjekk('to sifre er for lite til å søke midt i et nummer', r('45'), null)
sjekk('to sifre drar også ned et flerordssøk', r('nexans 45'), null)
sjekk('to BOKSTAVER er derimot greit — «ka» sier noe', r('ka'), 9)
sjekk('navn eksakt', r('pfsp 3g2,5 installasjonskabel'), 4)
sjekk('typebetegnelse eksakt', r('pfsp', vare({ navn: 'Kabel' })), 5)
sjekk('navn fra starten', r('pfsp 3g2'), 6)
sjekk('produsentnavn', r('nexans'), 7)

// Det andre som ikke virket før: flere ord i vilkårlig rekkefølge.
sjekk('«nexans pfsp» treffer', r('nexans pfsp'), 9)
sjekk('«pfsp nexans» treffer like godt — rekkefølgen skal ikke telle', r('pfsp nexans'), 9)
sjekk('«kabel 3g2,5» treffer på tvers av felt', r('kabel 3g2,5'), 9)
sjekk('ett ord som ikke finnes gjør hele søket til bom', r('nexans abb'), null)
sjekk('tomt søk treffer alt', r(''), 100)

// En vare som er opprettet for hånd har verken fabrikat eller EAN.
const enkel = vare({ elnummer: null, fabrikat: null, typeBetegnelse: null, ean: null, nrf: null, navn: 'Koblingsboks' })
sjekk('vare uten el-nummer er fortsatt søkbar på navn', r('koblings', enkel), 6)
sjekk('tallsøk krasjer ikke på vare uten el-nummer', r('1234', enkel), null)

const treff = sorterTreff([
  { vare: vare({ id: 'b', navn: 'Zetta kabel', elnummer: '9999999' }) },
  { vare: vare({ id: 'a', navn: 'Alfa kabel', elnummer: '8888888' }) },
  { vare: vare({ id: 'c', navn: 'Kabel PFSP', elnummer: '1234567' }) },
], 'kabel')
// «Kabel PFSP» begynner med søket (rang 6) og skal slå de to som bare
// inneholder det (rang 9) — de to sorteres alfabetisk seg imellom.
sjekk('prefiks slår «inneholder», så alfabetisk innenfor rangen',
  treff.map(x => x.vare.id), ['c', 'a', 'b'])
sjekk('bedre rang slår alfabetisk',
  sorterTreff([
    { vare: vare({ id: 'navn', navn: 'Zebra 1234567', elnummer: '9999999' }) },
    { vare: vare({ id: 'el', navn: 'Alfa', elnummer: '1234567' }) },
  ], '1234567').map(x => x.vare.id), ['el', 'navn'])
sjekk('maks-grensen respekteres',
  sorterTreff(Array.from({ length: 100 }, (_, i) => ({ vare: vare({ id: `p${i}` }) })), 'kabel', 5).length, 5)

sjekk('LIKE-mønsteret bruker det lengste ordet', likeMonster('3g2,5 installasjonskabel'), '%installasjonskabel%')
sjekk('korte søk gir ingen LIKE — da er full skanning raskere', likeMonster('ab'), null)
sjekk('tomt søk gir ingen LIKE', likeMonster('  '), null)
sjekk('tre tegn er nok', likeMonster('abc'), '%abc%')

/* ── Varegruppe utledet av navnet ─────────────────────────────────────────── */
// Grunnlaget for å BLA. Ordet som går igjen på flest varer vinner; ved likt
// antall vinner det som står først.

// Katalogen som brukes under. «installasjonskabel» står i tre, «Skjermet» i én.
const KAT = [
  'PFXP 3G1,5 500V Installasjonskabel, halogenfri',
  'PFXP 3G2,5 500V Installasjonskabel, halogenfri',
  'PFSP 3G1,5 500V Skjermet installasjonskabel',
  'TFXP 4G6 Jordkabel',
  'RK 1,5 gul/grønn Jordledning',
  'Stikkontakt 2-pol jord IP20 infelt Hvit',
  'Stikkontakt 2-pol jord IP44 utenpå Hvit',
  'Downlight LED 8W 3000K IP44 Dimbar, hvit',
  'Downlight LED 8W 2700K IP44 Dimbar, børstet stål',
  'Ladeboks 22kW type 2 m/RFID Lastbalansering',
  'Koblingsboks 100x100 IP54 Grå, med klemmer',
  'LED-armatur 1200mm 30W IP65 Industri',
]
const ut = utledKategorier(KAT)
const kat = (navn: string) => ut[KAT.indexOf(navn)]

// Selve poenget med frekvens: adjektivet står i ÉN vare, substantivet i tre.
sjekk('«Skjermet installasjonskabel» blir Installasjonskabel, ikke Skjermet',
  kat('PFSP 3G1,5 500V Skjermet installasjonskabel'), 'Installasjonskabel')
sjekk('kabel: PFXP/3G2,5/500V er koder og hoppes over',
  kat('PFXP 3G2,5 500V Installasjonskabel, halogenfri'), 'Installasjonskabel')
sjekk('TFXP/4G6 hoppes over', kat('TFXP 4G6 Jordkabel'), 'Jordkabel')
sjekk('RK/1,5 hoppes over, farge er svartelistet', kat('RK 1,5 gul/grønn Jordledning'), 'Jordledning')
sjekk('substantivet står først i de fleste navn',
  kat('Stikkontakt 2-pol jord IP20 infelt Hvit'), 'Stikkontakt')
sjekk('downlight', kat('Downlight LED 8W 3000K IP44 Dimbar, hvit'), 'Downlight')
sjekk('LED-armatur beholder sin egen skrivemåte', kat('LED-armatur 1200mm 30W IP65 Industri'), 'LED-armatur')
sjekk('komma strippes', kat('Koblingsboks 100x100 IP54 Grå, med klemmer'), 'Koblingsboks')
// Begge står i én vare hver — da vinner den som står først.
sjekk('ved likt antall vinner ordet som står først',
  kat('Ladeboks 22kW type 2 m/RFID Lastbalansering'), 'Ladeboks')
// Posisjonsvekten: «trykk» er vanligere enn «Bryter», men står bakerst.
sjekk('et vanlig variantord bakerst slår ikke substantivet foran',
  utledKategorier([
    'Bryter 1-pol trykk Hvit', 'Bryter 2-pol trykk Hvit', 'Dimmer 250W trykk',
    'Dimmer 400W trykk', 'Stikkontakt trykk', 'Koblingsboks trykk',
  ])[0], 'Bryter')

sjekk('kandidater hopper over koder og produsentnavn',
  kandidater('PFXP 3G2,5 500V Installasjonskabel, halogenfri'), ['Installasjonskabel'])
sjekk('rene koder gir ingen kandidater', kandidater('PFXP 3G2,5 500V'), [])
sjekk('uten kandidater gir null kategori', utledKategorier(['PFXP 3G2,5 500V']), [null])
sjekk('tomt navn gir null', utledKategorier(['']), [null])
sjekk('enkeltvare uten katalog tar første kandidat',
  utledKategori('Ladeboks 22kW type 2 m/RFID Lastbalansering'), 'Ladeboks')
sjekk('uten gruppe vises som «Annet»',
  [kategoriNavn(null), kategoriNavn('  '), kategoriNavn('Bryter')], ['Annet', 'Annet', 'Bryter'])

/* ── Synonymer: ordene montøren faktisk bruker ────────────────────────────── */

const downlight = vare({
  navn: 'Downlight LED 8W 3000K IP44 Dimbar, hvit', elnummer: '1841010',
  fabrikat: 'SG', typeBetegnelse: 'JUNISTAR', ean: null, nrf: null,
})
sjekk('«spot» treffer downlight — ordet står ingen steder i navnet', r('spot', downlight), 10)
sjekk('«downlight» ordrett rangeres BEDRE enn synonymtreffet', r('downlight', downlight), 6)
sjekk('«lys» treffer også', r('lys', downlight), 10)
const boks = vare({ navn: 'Koblingsboks 100x100 IP54', elnummer: '1955010', fabrikat: 'SCHNEIDER', typeBetegnelse: 'MURETTA', ean: null, nrf: null })
sjekk('«kobo» treffer koblingsboks', r('kobo', boks), 10)
sjekk('synonym som ikke passer treffer ikke', r('elbil', boks), null)

/* ── «Mente du …» ─────────────────────────────────────────────────────────── */

sjekk('avstand: identisk', avstand('kabel', 'kabel'), 0)
sjekk('avstand: én bokstav feil', avstand('kabek', 'kabel'), 1)
sjekk('avstand: avbryter over taket', avstand('kabel', 'downlight', 2) > 2, true)
const ordbok = ['Downlight', 'Stikkontakt', 'Koblingsboks', 'NEXANS', 'Onninen', 'ABB']
sjekk('«Onninnen» → Onninen', foreslaaRetting('Onninnen', ordbok), 'Onninen')
sjekk('«downligt» → Downlight', foreslaaRetting('downligt', ordbok), 'Downlight')
sjekk('«stikontakt» → Stikkontakt', foreslaaRetting('stikontakt', ordbok), 'Stikkontakt')
sjekk('for kort til å gjette på', foreslaaRetting('abb', ordbok), null)
sjekk('flerordssøk gjettes ikke på', foreslaaRetting('nexans kabl', ordbok), null)
sjekk('for langt unna gir ingen gjetning', foreslaaRetting('traktor', ordbok), null)

/* ── Listepris kontra nettopris ───────────────────────────────────────────── */
// Skillet som avgjør om prissammenligningen er sann eller selvsikkert gal.

const netto = (g: string, kr: number): Prisrad => ({ grossist: g, nettoPris: kr, priceType: 'netto', rabattProsent: null })
const beregnet = (g: string, kr: number, rab: number): Prisrad => ({ grossist: g, nettoPris: kr, priceType: 'brutto', rabattProsent: rab })
const liste = (g: string, kr: number): Prisrad => ({ grossist: g, nettoPris: kr, priceType: 'brutto', rabattProsent: null })

sjekk('brutto uten rabatt ER listepris', erListepris(liste('A', 100)), true)
sjekk('brutto MED rabatt er firmaets pris', erListepris(beregnet('A', 62, 38)), false)
sjekk('netto er firmaets pris', erListepris(netto('A', 62)), false)
sjekk('rabatt 0 teller som ingen rabatt', erListepris({ grossist: 'A', nettoPris: 100, priceType: 'brutto', rabattProsent: 0 }), true)

const toNetto = byggPrisbilde([beregnet('Onninen', 13.89, 38), beregnet('Solar', 12.99, 42)])
sjekk('to nettopriser: billigste peker på den laveste', toNetto.billigste!.grossist, 'Solar')
sjekk('to nettopriser: besparelsen regnes ut', toNetto.besparelse, 0.9)
sjekk('to nettopriser: ikke bare listepriser', toNetto.kunListepriser, false)

// Kjernen: en billig LISTEPRIS skal aldri slå en dyrere ekte pris. Gjorde den
// det, ville systemet anbefalt en grossist på et tall ingen har avtalt.
const blandet = byggPrisbilde([liste('Onninen', 10.00), beregnet('Solar', 12.99, 42)])
sjekk('listepris vinner ALDRI over en ekte pris, uansett hvor lav', blandet.billigste!.grossist, 'Solar')
sjekk('blandet: ingen besparelse påstås', blandet.besparelse, null)
sjekk('blandet flagges', blandet.blandet, true)

const bareListe = byggPrisbilde([liste('Onninen', 22.40), liste('Solar', 22.40)])
sjekk('bare listepriser flagges', bareListe.kunListepriser, true)
sjekk('bare listepriser: laveste vises likevel', bareListe.billigste!.nettoPris, 22.40)
// Listeprisene er nesten like uansett — en «besparelse» der ville vært støy
// presentert som innsikt.
sjekk('bare listepriser: ingen besparelse påstås', bareListe.besparelse, null)

sjekk('én pris gir ingen sammenligning', byggPrisbilde([netto('A', 50)]).besparelse, null)
sjekk('ingen priser gir ingen billigste', byggPrisbilde([]).billigste, null)
sjekk('ingen priser er ikke «bare listepriser»', byggPrisbilde([]).kunListepriser, false)

// cost_price: et dekningsbidrag regnet på listepris er for lavt, og får en
// lønnsom jobb til å se ulønnsom ut.
sjekk('kostpris velger ekte pris framfor billigere listepris',
  kostprisFra([liste('Onninen', 10.00), beregnet('Solar', 12.99, 42)]),
  { pris: 12.99, grossist: 'Solar', erListepris: false })
sjekk('kostpris merker når den bare har listepris',
  kostprisFra([liste('Onninen', 22.40)])!.erListepris, true)
sjekk('kostpris uten priser er null', kostprisFra([]), null)

/* ── Demokatalogen ────────────────────────────────────────────────────────── */
// Den går gjennom den EKTE parseren og den ekte importen. Brekker den, er det
// enten parseren eller katalogen som er endret — begge deler er verdt et varsel.

const FILER = demoFiler()
const demo = FILER.map(f => ({ grossist: f.grossist, r: parseEfoNelfo(f.innhold) }))
sjekk('tre demofiler', demo.length, 3)
sjekk('sortimentet er stort nok til å bla i', demovarer().length > 300, true)
for (const d of demo) {
  sjekk(`${d.grossist}: parser uten avvik`, d.r.avvik.length, 0)
  sjekk(`${d.grossist}: er et pristilbud (P4), ikke en varefil`, d.r.hode.filtype, 'pristilbud')
  sjekk(`${d.grossist}: alle varer har el-nummer`, d.r.varer.every(v => v.merke === 'elnummer'), true)
  sjekk(`${d.grossist}: alle varer har varekort`, d.r.varer.every(v => tilVarekort(v) !== null), true)
  sjekk(`${d.grossist}: rabatt er regnet inn i nettoprisen`,
    d.r.varer.every(v => v.prisType === 'brutto' && v.rabatt !== null && v.nettoPris < v.pris), true)
}

// Uten overlapp finnes det ingenting å sammenligne, og demoen viser aldri
// «BILLIGST» — som er den ene tingen den er der for å vise.
const [enA, enB] = demo.map(d => new Map(d.r.varer.map(v => [v.vareNr, v.nettoPris])))
const felles = [...enA.keys()].filter(k => enB.has(k))
sjekk('de aller fleste varene finnes hos flere', felles.length > 250, true)
sjekk('begge grossister er billigst på noe — ellers er sammenligningen meningsløs',
  [felles.some(k => enA.get(k)! < enB.get(k)!), felles.some(k => enB.get(k)! < enA.get(k)!)], [true, true])
sjekk('noen varer finnes bare hos den ene, som i virkeligheten',
  enA.size > felles.length && enB.size > felles.length, true)
// Feltet er semikolonseparert. Et felt som INNEHOLDER semikolon blir splittet
// og stille avkortet — det var nøyaktig slik bildene forsvant første gang.
for (const d of demo) {
  const linjer = FILER.find(f => f.grossist === d.grossist)!.innhold.split('\n')
  sjekk(`${d.grossist}: ingen PX-verdi inneholder semikolon`,
    linjer.filter(l => l.startsWith('PX;')).every(l => l.split(';').length === 3), true)
}
sjekk('bilder ligger utenfor filene',
  Object.values(DEMO_BILDER).every(b => b.startsWith('data:image/png;base64,')), true)
sjekk('hver vare i katalogen har et piktogram',
  demovarer().every(v => !!DEMO_BILDER[v.bilde]), true)
sjekk('el-numrene er unike — ellers slår varer sammen ved import',
  new Set(demovarer().map(v => v.elnummer)).size, demovarer().length)
sjekk('alle tre grossister er billigst på noe',
  ['Onninen', 'Solar', 'Ahlsell'].every(g => {
    const min = new Map<string, { g: string; p: number }>()
    for (const d of demo) for (const v of d.r.varer) {
      const b = min.get(v.vareNr)
      if (!b || v.nettoPris < b.p) min.set(v.vareNr, { g: d.grossist, p: v.nettoPris })
    }
    return [...min.values()].some(x => x.g === g)
  }), true)

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

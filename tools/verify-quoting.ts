/**
 * Selvtest for tilbudsregningen. Samme mønster som verify-invoicing.
 *
 *   npm run verify:quoting
 *
 * Et tilbud er et bindende pristilbud. Feil her koster penger på to måter:
 * for lavt tall gir en jobb uten fortjeneste, og et tall som ikke stemmer med
 * linjene på arket gir en diskusjon med kunden man alltid taper.
 */
import {
  anvendPaslag, byggTilbudssum, effektivStatus, foreslaaPris, grupperTilbud, kanRedigeres, linjeNettoOre,
  paslagProsent, prisFraPaslagOre, somRabatt, somTilbudStatus, utvidPakke,
  type Omrade, type Pakkelinje, type TilbudslinjeInn,
} from '../lib/quoting'
import { formatKr, tilOre } from '../lib/invoicing'

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

// ── Rabatt ───────────────────────────────────────────────────────────────────

sjekk('rabatt: null blir 0', somRabatt(null), 0)
sjekk('rabatt: negativ blir 0', somRabatt(-10), 0)
sjekk('rabatt: over 100 klippes — 150 % er alltid en tastefeil', somRabatt(150), 100)
sjekk('rabatt: NaN blir 0', somRabatt(Number.NaN), 0)
sjekk('rabatt: 12,5 beholdes', somRabatt(12.5), 12.5)

// Avrunding ÉN gang, etter rabatten. 3 × 33,33 kr − 10 % = 89,991 kr → 8999 øre.
sjekk('linjenetto rundes én gang, etter rabatt', linjeNettoOre(3, tilOre(33.33), 10), 8999)
sjekk('linjenetto uten rabatt', linjeNettoOre(12.5, tilOre(24.9), 0), 31125)
sjekk('100 % rabatt gir null', linjeNettoOre(5, tilOre(100), 100), 0)

// ── Summering ────────────────────────────────────────────────────────────────

const linjer: TilbudslinjeInn[] = [
  { id: 'a', art: 'tekst', beskrivelse: 'Kjøkken' },
  { id: 'b', art: 'materiell', beskrivelse: 'Downlight', antall: 10, enhet: 'stk', enhetsprisKr: 249, kostprisKr: 130 },
  { id: 'c', art: 'materiell', beskrivelse: 'Kabel PFSP 3G1,5', antall: 40, enhet: 'm', enhetsprisKr: 24.9, kostprisKr: 12, rabattProsent: 10 },
  { id: 'd', art: 'arbeid', beskrivelse: 'Montasje', antall: 8, enhet: 't', enhetsprisKr: 895 },
]
const sum = byggTilbudssum(linjer)

sjekk('tekstlinja teller null', sum.linjer[0].nettoOre, 0)
sjekk('tekstlinja beholder plassen sin i rekkefølgen', sum.linjer.map(l => l.id), ['a', 'b', 'c', 'd'])
sjekk('downlight 10 × 249', sum.linjer[1].nettoOre, 249000)
sjekk('kabel 40 × 24,90 − 10 %', sum.linjer[2].nettoOre, 89640)
sjekk('rabatten står igjen på linja', sum.linjer[2].rabattOre, 9960)
sjekk('bruttolinja er før rabatt', sum.linjer[2].bruttoLinjeOre, 99600)
sjekk('montasje 8 × 895', sum.linjer[3].nettoOre, 716000)
sjekk('netto = summen av linjene', sum.nettoOre, 249000 + 89640 + 716000)
sjekk('mva 25 %', sum.mvaOre, Math.round(1054640 * 0.25))
sjekk('brutto = netto + mva', sum.bruttoOre, sum.nettoOre + sum.mvaOre)
sjekk('samlet rabatt', sum.rabattOre, 9960)

// Linjene MÅ legge sammen til totalen. Det er dette kunden regner etter.
sjekk('linjene summerer til netto', sum.linjer.reduce((n, l) => n + l.nettoOre, 0), sum.nettoOre)
sjekk('linjene summerer til mva', sum.linjer.reduce((n, l) => n + l.mvaOre, 0), sum.mvaOre)

// ── Dekningsbidrag ───────────────────────────────────────────────────────────
// Kost: 10 × 130 + 40 × 12 = 1300 + 480 = 1780 kr. Arbeid har ingen kost oppgitt.
sjekk('kost summeres kun der den er kjent', sum.kostOre, 178000)
sjekk('dekningsbidrag i øre', sum.dbOre, 1054640 - 178000)
sjekk('DB i prosent av salgspris, ikke påslag på kost', sum.dbProsent, 83.1)

const utenKost = byggTilbudssum([{ id: 'x', art: 'arbeid', beskrivelse: 'Timer', antall: 2, enhetsprisKr: 900 }])
sjekk('uten kost er DB null, ikke 100 %', utenKost.dbOre, null)
sjekk('uten kost er DB-prosent null', utenKost.dbProsent, null)

const tomt = byggTilbudssum([])
sjekk('tomt tilbud gir null netto', tomt.nettoOre, 0)
sjekk('tomt tilbud gir ingen mva-fordeling', tomt.mvaFordeling, [])
sjekk('tomt tilbud gir ikke DB-prosent på null netto', tomt.dbProsent, null)

// ── MVA-fordeling ────────────────────────────────────────────────────────────

const blandet = byggTilbudssum([
  { id: '1', art: 'materiell', beskrivelse: 'Vare', antall: 1, enhetsprisKr: 1000 },
  { id: '2', art: 'arbeid', beskrivelse: 'Utlegg uten mva', antall: 1, enhetsprisKr: 500, mvaType: 'fritatt' },
  { id: '3', art: 'tekst', beskrivelse: 'Forbehold: stillas ikke inkludert' },
])
sjekk('to satser gir to grupper', blandet.mvaFordeling.length, 2)
sjekk('største gruppe først', blandet.mvaFordeling[0].mva, 'hoy')
sjekk('fritatt gir null mva', blandet.mvaFordeling[1].mvaOre, 0)
sjekk('tekstlinja havner ikke i mva-fordelingen',
  blandet.mvaFordeling.reduce((n, g) => n + g.nettoOre, 0), blandet.nettoOre)
sjekk('ukjent mva-streng faller til høy sats — å utelate mva er den dyre feilen',
  byggTilbudssum([{ id: 'z', art: 'materiell', beskrivelse: 'V', antall: 1, enhetsprisKr: 100, mvaType: 'tullball' }]).mvaOre, 2500)

// ── Manglende tall skal ikke bli NaN på et bindende dokument ─────────────────

const halvtomt = byggTilbudssum([
  { id: 'm', art: 'materiell', beskrivelse: 'Uten pris', antall: 3 },
  { id: 'n', art: 'materiell', beskrivelse: 'Uten antall', enhetsprisKr: 100 },
])
sjekk('linje uten pris gir 0, ikke NaN', halvtomt.linjer[0].nettoOre, 0)
sjekk('linje uten antall gir 0, ikke NaN', halvtomt.linjer[1].nettoOre, 0)
sjekk('summen er et tall', Number.isFinite(halvtomt.bruttoOre), true)
sjekk('enhet defaulter etter art', [halvtomt.linjer[0].enhet, byggTilbudssum([{ id: 'a', art: 'arbeid', beskrivelse: 'T' }]).linjer[0].enhet], ['stk', 't'])

// ── Status ───────────────────────────────────────────────────────────────────

sjekk('ukjent status faller til utkast', somTilbudStatus('tull'), 'utkast')
sjekk('null status faller til utkast', somTilbudStatus(null), 'utkast')
sjekk('bare utkast kan redigeres', ['utkast', 'sendt', 'akseptert', 'avslatt', 'utlopt'].map(s => kanRedigeres(s as never)),
  [true, false, false, false, false])

const naa = 1_755_000_000_000
sjekk('sendt tilbud uten frist utløper ikke', effektivStatus('sendt', null, naa), 'sendt')
sjekk('sendt tilbud innenfor frist er sendt', effektivStatus('sendt', naa + 1000, naa), 'sendt')
sjekk('sendt tilbud etter frist er utløpt', effektivStatus('sendt', naa - 1000, naa), 'utlopt')
sjekk('akseptert tilbud utløper ALDRI — avgjørelsen er tatt', effektivStatus('akseptert', naa - 1000, naa), 'akseptert')
sjekk('avslått tilbud utløper heller ikke', effektivStatus('avslatt', naa - 1000, naa), 'avslatt')
sjekk('utkast utløper ikke', effektivStatus('utkast', naa - 1000, naa), 'utkast')

// ── Påslag ───────────────────────────────────────────────────────────────────
// Påslag er av KOST, dekningsbidrag er av SALGSPRIS. Blandes de to, tror man at
// 50 % påslag er 50 % fortjeneste — og priser jobben for lavt hele året.

sjekk('påslag: 100 kjøpt, 150 solgt = 50 %', paslagProsent(10000, 15000), 50)
sjekk('samme linje er 33,3 % dekningsbidrag, ikke 50',
  byggTilbudssum([{ id: 'p', art: 'materiell', beskrivelse: 'V', antall: 1, enhetsprisKr: 150, kostprisKr: 100 }]).dbProsent, 33.3)
sjekk('påslag uten kost er null, ikke uendelig', paslagProsent(null, 15000), null)
sjekk('påslag på null kost er null', paslagProsent(0, 15000), null)
sjekk('salg under kost gir negativt påslag — det skal SES, ikke skjules', paslagProsent(10000, 8000), -20)
sjekk('pris fra kost + påslag', prisFraPaslagOre(10000, 50), 15000)
sjekk('pris fra kost + påslag rundes til hele øre', prisFraPaslagOre(3333, 12.5), 3750)
sjekk('påslag og pris er hverandres omvendte', paslagProsent(10000, prisFraPaslagOre(10000, 35)), 35)

// ── Områder ──────────────────────────────────────────────────────────────────
// Et område er en overskrift MED SUM. Den ene regelen alt annet henger på:
// områdene på øverste nivå pluss linjene uten område er HELE tilbudet. En linje
// som telles to ganger gir et for høyt tilbud; en som faller ut gir en jobb
// gjort gratis. Begge deler oppdages her, ikke av kunden.

const omrader: Omrade[] = [
  { id: 'etg1', forelderId: null, navn: '1. etasje', sortOrder: 0 },
  { id: 'stue', forelderId: 'etg1', navn: 'Stue', sortOrder: 0 },
  { id: 'kjokken', forelderId: 'etg1', navn: 'Kjøkken', sortOrder: 1 },
  { id: 'ute', forelderId: null, navn: 'Utvendig', sortOrder: 1 },
]
const medOmrade = byggTilbudssum([
  { id: 'l1', art: 'tekst', beskrivelse: 'Forbehold', omradeId: null },
  { id: 'l2', art: 'materiell', beskrivelse: 'Downlight', antall: 10, enhetsprisKr: 249, kostprisKr: 130, omradeId: 'stue' },
  { id: 'l3', art: 'arbeid', beskrivelse: 'Montasje stue', antall: 4, enhetsprisKr: 895, omradeId: 'stue' },
  { id: 'l4', art: 'materiell', beskrivelse: 'Stikk', antall: 6, enhetsprisKr: 199, kostprisKr: 90, omradeId: 'kjokken' },
  { id: 'l5', art: 'materiell', beskrivelse: 'Utelampe', antall: 2, enhetsprisKr: 1490, omradeId: 'ute' },
  { id: 'l6', art: 'materiell', beskrivelse: 'Sikringsskap', antall: 1, enhetsprisKr: 12000, omradeId: 'slettet' },
])
const innhold = grupperTilbud(medOmrade.linjer, omrader)
const finn = (id: string) => innhold.omrader.find(o => o.id === id)!

sjekk('områdene kommer i visningsrekkefølge, barn rett under forelder',
  innhold.omrader.map(o => o.id), ['etg1', 'stue', 'kjokken', 'ute'])
sjekk('nivået sier hvor langt inn raden skal rykkes',
  innhold.omrader.map(o => o.niva), [0, 1, 1, 0])
sjekk('linjer uten område ligger utenfor', innhold.utenOmrade.map(l => l.id), ['l1', 'l6'])
sjekk('stua summerer sine egne to linjer', finn('stue').nettoOre, 249000 + 358000)
sjekk('forelderen ruller sammen barna, ikke bare sine egne',
  finn('etg1').nettoOre, finn('stue').nettoOre + finn('kjokken').nettoOre)
sjekk('forelderen har ingen egne linjer', finn('etg1').linjer.length, 0)
sjekk('antall linjer teller hele grenen', finn('etg1').antallLinjer, 3)
sjekk('DB per område regnes av områdets egne tall', finn('kjokken').dbOre, 119400 - 54000)
sjekk('område uten kjent kost gir DB null, ikke 100 %', finn('ute').dbOre, null)

// DETTE er regelen hele oppdelingen står og faller på.
const rot = innhold.omrader.filter(o => o.niva === 0).reduce((n, o) => n + o.nettoOre, 0)
const løse = innhold.utenOmrade.reduce((n, l) => n + l.nettoOre, 0)
sjekk('rotområdene + løse linjer = hele tilbudet', rot + løse, medOmrade.nettoOre)
sjekk('ingen linje er borte',
  innhold.omrader.reduce((n, o) => n + o.linjer.length, 0) + innhold.utenOmrade.length,
  medOmrade.linjer.length)

// Et slettet område skal aldri kunne ta penger med seg ut av summen.
sjekk('linje som peker på et slettet område faller tilbake til tilbudet',
  innhold.utenOmrade.some(l => l.id === 'l6'), true)

// Ring i forelderpekerne: A under B under A. Uten vern henger visningen — den
// viser ikke bare feil tall. Samme felle som tegningsmappene.
const ringInnhold = grupperTilbud(
  byggTilbudssum([{ id: 'r1', art: 'materiell', beskrivelse: 'Vare', antall: 1, enhetsprisKr: 100, omradeId: 'a' }]).linjer,
  [
    { id: 'a', forelderId: 'b', navn: 'A', sortOrder: 0 },
    { id: 'b', forelderId: 'a', navn: 'B', sortOrder: 1 },
  ],
)
sjekk('ring i forelderpekerne henger ikke, begge blir rotområder',
  ringInnhold.omrader.map(o => [o.id, o.niva]), [['a', 0], ['b', 0]])
sjekk('ringen mister ingen penger',
  ringInnhold.omrader.filter(o => o.niva === 0).reduce((n, o) => n + o.nettoOre, 0), 10000)

sjekk('forelder som ikke finnes gjør området til et rotområde',
  grupperTilbud([], [{ id: 'x', forelderId: 'finnes-ikke', navn: 'X', sortOrder: 0 }]).omrader.map(o => o.niva), [0])
sjekk('tilbud uten områder ser ut som før',
  grupperTilbud(medOmrade.linjer, []).utenOmrade.length, medOmrade.linjer.length)
sjekk('samme sortOrder gir stabil rekkefølge, ikke tilfeldig',
  grupperTilbud([], [
    { id: 'b', forelderId: null, navn: 'B', sortOrder: 0 },
    { id: 'a', forelderId: null, navn: 'A', sortOrder: 0 },
  ]).omrader.map(o => o.id), ['a', 'b'])

// ── Tilvalg ──────────────────────────────────────────────────────────────────
// Kunden velger om linja skal med (Jobber). Et fravalgt tilvalg er UTENFOR
// summen — netto, mva, rabatt, kost og områdesum — men beholder prisen sin,
// for det er den kunden skal se før hun sier ja. Regelen som ikke kan brytes:
// en vanlig linje er alltid med, uansett hva `valgt` sier.

const medTilvalg = byggTilbudssum([
  { id: 'g', art: 'materiell', beskrivelse: 'Grunnpakke', antall: 1, enhetsprisKr: 10000, kostprisKr: 6000 },
  { id: 'v1', art: 'materiell', beskrivelse: 'Varmekabel bad', antall: 1, enhetsprisKr: 4000, kostprisKr: 2500, rabattProsent: 10, valgfri: true, valgt: false },
  { id: 'v2', art: 'arbeid', beskrivelse: 'Montasje varmekabel', antall: 2, enhetsprisKr: 900, valgfri: true, valgt: true },
  { id: 'n', art: 'materiell', beskrivelse: 'Vanlig linje med valgt=false', antall: 1, enhetsprisKr: 500, valgt: false },
])
sjekk('fravalgt tilvalg beholder prisen sin på linja', medTilvalg.linjer[1].nettoOre, 360000)
sjekk('fravalgt tilvalg teller ikke i netto', medTilvalg.nettoOre, 1000000 + 180000 + 50000)
sjekk('fravalgt tilvalg teller ikke i rabatten', medTilvalg.rabattOre, 0)
sjekk('fravalgt tilvalg teller ikke i kost', medTilvalg.kostOre, 600000)
sjekk('fravalgt tilvalg teller ikke i mva', medTilvalg.mvaOre, Math.round(1230000 * 0.25))
sjekk('valgt tilvalg teller som en vanlig linje', medTilvalg.linjer[2].tellerMed, true)
sjekk('vanlig linje er ALLTID med, uansett valgt-feltet', medTilvalg.linjer[3].tellerMed, true)
sjekk('tilvalg uten valgt-felt er AV — å merke som tilvalg skal synes på summen',
  byggTilbudssum([{ id: 'x', art: 'materiell', beskrivelse: 'V', antall: 1, enhetsprisKr: 100, valgfri: true }]).nettoOre, 0)
sjekk('antall tilvalg teller både valgte og fravalgte', medTilvalg.antallTilvalg, 2)
sjekk('det kunden kan legge til er summen av de fravalgte', medTilvalg.tilvalgUtenforOre, 360000)
sjekk('linjene som teller med summerer til netto',
  medTilvalg.linjer.filter(l => l.tellerMed).reduce((n, l) => n + l.nettoOre, 0), medTilvalg.nettoOre)

const tilvalgIOmrade = grupperTilbud(
  byggTilbudssum([
    { id: 'a', art: 'materiell', beskrivelse: 'Stikk', antall: 4, enhetsprisKr: 200, omradeId: 'bad' },
    { id: 'b', art: 'materiell', beskrivelse: 'Varmekabel', antall: 1, enhetsprisKr: 5000, omradeId: 'bad', valgfri: true, valgt: false },
  ]).linjer,
  [{ id: 'bad', forelderId: null, navn: 'Bad', sortOrder: 0 }],
)
sjekk('området summerer uten det fravalgte tilvalget', tilvalgIOmrade.omrader[0].nettoOre, 80000)
sjekk('men tilvalget står fortsatt i området', tilvalgIOmrade.omrader[0].linjer.map(l => l.id), ['a', 'b'])

// ── Påslag på hele tilbudet ─────────────────────────────────────────────────
// «Oppdater påslag» (Cordel) setter pris = kost + påslag der det går an. Låste
// linjer, tekst og linjer uten kost røres ALDRI — låsen er der for at en
// avtalt pris ikke skal kunne skrives over av ett tall for hele tilbudet.

const forPaslag: TilbudslinjeInn[] = [
  { id: 'p1', art: 'materiell', beskrivelse: 'Vare', antall: 1, enhetsprisKr: 100, kostprisKr: 100 },
  { id: 'p2', art: 'materiell', beskrivelse: 'Låst', antall: 1, enhetsprisKr: 100, kostprisKr: 100, prisLaast: true },
  { id: 'p3', art: 'arbeid', beskrivelse: 'Uten kost', antall: 1, enhetsprisKr: 900 },
  { id: 'p4', art: 'tekst', beskrivelse: 'Forbehold' },
  { id: 'p5', art: 'materiell', beskrivelse: 'Alt riktig fra før', antall: 1, enhetsprisKr: 150, kostprisKr: 100 },
]
sjekk('påslag treffer bare linjer med kost som ikke er låst, og hopper over uendrede',
  anvendPaslag(forPaslag, 50), [{ id: 'p1', enhetsprisKr: 150 }])
sjekk('påslag på et utvalg (Blokk) rører ikke resten',
  anvendPaslag(forPaslag, 80, new Set(['p5'])), [{ id: 'p5', enhetsprisKr: 180 }])
sjekk('låst linje i utvalget forblir låst', anvendPaslag(forPaslag, 80, new Set(['p2'])), [])
sjekk('ugyldig påslag gjør ingenting', anvendPaslag(forPaslag, Number.NaN), [])
sjekk('negativt påslag er lov — det er et varsel, ikke en feil',
  anvendPaslag([{ id: 'q', art: 'materiell', beskrivelse: 'V', antall: 1, enhetsprisKr: 100, kostprisKr: 100 }], -10),
  [{ id: 'q', enhetsprisKr: 90 }])

sjekk('foreslått pris: egen salgspris vinner', foreslaaPris(100, 180, 50), 180)
sjekk('foreslått pris: ellers kost + påslag', foreslaaPris(100, null, 50), 150)
sjekk('foreslått pris: uten påslag og uten salgspris er den TOM, ikke null kroner', foreslaaPris(100, null, null), null)
sjekk('foreslått pris: uten kost er den tom', foreslaaPris(null, null, 50), null)

// ── Pakker ───────────────────────────────────────────────────────────────────
// En pakke er malen for én liten oppgave. Antallet ganges inn på hver linje;
// tekst følger med én gang.

const dobbelStikk: Pakkelinje[] = [
  { art: 'materiell', beskrivelse: 'Stikkontakt dobbel', antall: 1, enhet: 'stk', enhetsprisKr: null, kostprisKr: 60, mvaType: null, elnummer: '1400123', produktId: 'prod-1' },
  { art: 'materiell', beskrivelse: 'PN 2,5', antall: 6, enhet: 'm', enhetsprisKr: 15, kostprisKr: 8, mvaType: null, elnummer: null, produktId: null },
  { art: 'arbeid', beskrivelse: 'Montasje', antall: 0.5, enhet: 't', enhetsprisKr: 895, kostprisKr: null, mvaType: null, elnummer: null, produktId: null },
  { art: 'tekst', beskrivelse: 'Inkl. innfelt boks', antall: null, enhet: null, enhetsprisKr: null, kostprisKr: null, mvaType: null, elnummer: null, produktId: null },
]
const treStikk = utvidPakke(dobbelStikk, 3, 40)
sjekk('mengden ganges med antall pakker', treStikk.map(l => l.antall), [3, 18, 1.5, null])
sjekk('linje uten egen pris får kost + tilbudets påslag', treStikk[0].enhetsprisKr, 84)
sjekk('linje med egen pris beholder den', treStikk[1].enhetsprisKr, 15)
sjekk('arbeid uten kost beholder timeprisen', treStikk[2].enhetsprisKr, 895)
sjekk('tekstlinja følger med én gang, uten tall', [treStikk[3].art, treStikk[3].antall], ['tekst', null])
sjekk('el-nummer og produkt følger med', [treStikk[0].elnummer, treStikk[0].produktId], ['1400123', 'prod-1'])
sjekk('null eller negativt antall blir én pakke', utvidPakke(dobbelStikk, 0, 40)[1].antall, 6)
sjekk('pakke uten påslag gir tom pris der pakken ikke har egen',
  utvidPakke(dobbelStikk, 1, null)[0].enhetsprisKr, null)

// ── Formatering deles med fakturaen ──────────────────────────────────────────
sjekk('beløp formateres med hardt mellomrom, som på fakturaen', formatKr(sum.bruttoOre), '13 183,00')

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

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
  byggTilbudssum, effektivStatus, kanRedigeres, linjeNettoOre, somRabatt, somTilbudStatus,
  type TilbudslinjeInn,
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

// ── Formatering deles med fakturaen ──────────────────────────────────────────
sjekk('beløp formateres med hardt mellomrom, som på fakturaen', formatKr(sum.bruttoOre), '13 183,00')

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

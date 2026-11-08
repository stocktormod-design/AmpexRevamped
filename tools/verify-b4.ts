/**
 * Selvtest for B4-skriveren (EFO/NELFO Bestilling 4.0).
 *
 *   npm run verify:b4
 *
 * Feltposisjonene sjekkes mot spec E-NBestilling 4.0 (rev. 2004-06-18): BH har 49
 * felt, BL 14, BT 2, BA 3. Ingen grossist har ennå fått en fil fra oss — første
 * ekte test er en prøvebestilling til Solar, og svaret (C4) er fasiten.
 */
import { skrivB4, validerB4, kodAnsi, antallFelt, type B4Bestilling } from '../lib/pricefile/b4'

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

const grunn: B4Bestilling = {
  bestNr: 'A1042',
  kundeNr: '10042',
  kjoper: { orgnr: '987 654 321', firmanavn: 'Holand Elektro AS', adresse1: 'Fjordvegen 2', postnr: '6100', poststed: 'VOLDA' },
  kontakt: { navn: 'Tormod Holand', mobil: '41234567', epost: 'tormod@ampex.no' },
  selger: { orgnr: '123456789', firmanavn: 'Solar Norge AS' },
  ordreNr: 'O-2207',
  kjopersRef: 'Hansen; bad og gang',
  merket: 'Ordre O-2207 Hansen',
  leveringsdato: '2026-11-10',
  levering: { type: 'adresse', navn: 'Kari Hansen', adresse1: 'Bøgata 7', postnr: '6100', poststed: 'VOLDA' },
  fritekst: 'Ring montør ved ankomst, porten er låst etter kl 15',
  linjer: [
    { vareMerke: 'elnummer', vareNr: '1234567', tekst: 'PFXP 3G2,5 500V', antall: 12.5, prisEnhet: 'MTR' },
    {
      vareMerke: 'elnummer', vareNr: '7654321', tekst: 'Nelko stikk infelt 1,5 – hvit', antall: 4, prisEnhet: 'PCE',
      delLevering: false, alternativer: [{ vareMerke: 'ean', vareNr: '7071234567890' }], fritekst: 'Må være hvit',
    },
  ],
}

const res = skrivB4(grunn, new Date('2026-11-07T18:30:00Z'))
if (!res.ok) { console.error('✗ gyldig bestilling ble avvist:', res.feil); process.exit(1) }

const poster = res.tekst.split('\r\n')
sjekk('fila slutter med CR+LF', res.tekst.endsWith('\r\n'), true)
sjekk('ingen nakne LF', /[^\r]\n/.test(res.tekst), false)
const felt = poster.filter(Boolean).map(p => p.split(';'))
const bh = felt[0]
sjekk('filnavn begynner med B4', res.filnavn, 'B4_A1042_20261107183000.txt')
sjekk('BH har 49 felt (spec)', bh.length, 49)
sjekk('BH format og versjon', [bh[0], bh[1], bh[2]], ['BH', 'EFONELFO', '4.0'])
sjekk('selger og kjøper som foretaks-id', [bh[3], bh[4]], ['NO123456789MVA', 'NO987654321MVA'])
sjekk('BestNr / KundeNr / KOrdNr', [bh[5], bh[6], bh[9]], ['A1042', '10042', 'O-2207'])
sjekk('semikolon i referansen blir komma', bh[17], 'Hansen, bad og gang')
sjekk('ObkrType = 4 (C4-fil) som standard', bh[19], '4')
sjekk('LevDato ÅÅÅÅMMDD', bh[22], '20261110')
sjekk('BestOpp = 3 (håndholdt enhet)', bh[23], '3')
sjekk('leveringsadresse i felt 26–31', bh.slice(25, 31), ['Kari Hansen', 'Bøgata 7', '', '6100', 'VOLDA', 'NO'])
sjekk('kjøper i felt 32–37', bh.slice(31, 37), ['Holand Elektro AS', 'Fjordvegen 2', '', '6100', 'VOLDA', 'NO'])
sjekk('kontakt i felt 38–43', bh.slice(37, 43), ['Tormod Holand', '', '41234567', '', 'tormod@ampex.no', ''])
sjekk('selger i felt 44–49', bh.slice(43, 49), ['Solar Norge AS', '', '', '', '', 'NO'])

const hodeTekst = felt.slice(1).filter(f => f[0] === 'BT' && felt.indexOf(f) < felt.findIndex(x => x[0] === 'BL'))
sjekk('hodefritekst delt i BT à maks 30', hodeTekst.map(f => f[1]), ['Ring montør ved ankomst,', 'porten er låst etter kl 15'])
sjekk('BT har 2 felt', hodeTekst.every(f => f.length === 2), true)

const bl = felt.filter(f => f[0] === 'BL')
sjekk('BL har 14 felt (spec)', bl.map(f => f.length), [14, 14])
sjekk('linjenr fra 1 og BestNr gjentatt', bl.map(f => [f[1], f[2]]), [['1', 'A1042'], ['2', 'A1042']])
sjekk('VareMrk 1 = el-nummer', bl.map(f => f[3]), ['1', '1'])
sjekk('12,5 m skrives 1250 (2 implisitte desimaler)', bl[0][7], '1250')
sjekk('4 stk skrives 400', bl[1][7], '400')
sjekk('prisenhet', bl.map(f => f[8]), ['MTR', 'PCE'])
sjekk('DelLev N når deling ikke er lov', [bl[0][12], bl[1][12]], ['', 'N'])

const etterLinje2 = felt.slice(felt.indexOf(bl[1]) + 1)
sjekk('linjefritekst rett etter linja, så BA', etterLinje2.map(f => f[0]), ['BT', 'BA'])
sjekk('BA har 3 felt: EAN-alternativ', etterLinje2[1], ['BA', '2', '7071234567890'])

// Tegnsett
const bytes = res.bytes
sjekk('ø blir 0xF8 (CP1252), ikke UTF-8', Array.from(kodAnsi('ø')), [0xf8])
sjekk('æøåÆØÅ', Array.from(kodAnsi('æøåÆØÅ')), [0xe6, 0xf8, 0xe5, 0xc6, 0xd8, 0xc5])
sjekk('tankestrek – blir 0x96', Array.from(kodAnsi('–')), [0x96])
sjekk('emoji blir ?', Array.from(kodAnsi('👍')), [0x3f])
sjekk('fila har like mange bytes som tegn', bytes.length, [...res.tekst].length)
sjekk('antallFelt avrunder flyttall', antallFelt(0.1 + 0.2), '30')

// Avvisninger
const avvis = (navn: string, endring: Partial<B4Bestilling>, inneholder: string) => {
  const f = validerB4({ ...grunn, ...endring })
  sjekk(`avviser: ${navn}`, f.some(x => x.includes(inneholder)), true)
}
avvis('manglende kundenummer', { kundeNr: '' }, 'Kundenummer')
avvis('kundenummer over 10 tegn', { kundeNr: '12345678901' }, 'lengre enn 10')
avvis('bestillingsnummer over 10 tegn', { bestNr: '0123456789X' }, 'lengre enn 10')
avvis('orgnr med 8 siffer', { kjoper: { ...grunn.kjoper, orgnr: '12345678' } }, '9 siffer')
avvis('tom bestilling', { linjer: [] }, 'ingen linjer')
avvis('el-nummer med 6 siffer', { linjer: [{ ...grunn.linjer[0], vareNr: '123456' }] }, 'el-nummer')
avvis('antall 0', { linjer: [{ ...grunn.linjer[0], antall: 0 }] }, 'over 0')
avvis('3 desimaler', { linjer: [{ ...grunn.linjer[0], antall: 1.255 }] }, '2 desimaler')
avvis('prisenhet «stk»', { linjer: [{ ...grunn.linjer[0], prisEnhet: 'stk' }] }, 'CommonCode')
avvis('e-postbekreftelse uten e-post', { bekreftelse: 'epost', kontakt: {} }, 'e-post')
avvis('adresse uten postnr', { levering: { type: 'adresse', navn: 'X', adresse1: 'Y', postnr: '', poststed: 'Z' } }, 'Leveringsadressen')

const avvist = skrivB4({ ...grunn, kundeNr: '' })
sjekk('skrivB4 gir feil, ikke fil, når den er ugyldig', avvist.ok, false)

// Henting i butikk
const hent = skrivB4({ ...grunn, levering: { type: 'hent', lager: 'VOLDA' }, melding: undefined })
if (hent.ok) {
  const h = hent.tekst.split('\r\n')[0].split(';')
  sjekk('hent: SLager satt, Melding «Hentes», ingen leveringsadresse', [h[15], h[21], h[25]], ['VOLDA', 'Hentes', ''])
} else { feil++; console.error('✗ hent ble avvist', hent.feil) }

if (feil > 0) { console.error(`\n${feil} feil`); process.exit(1) }
console.log('\nB4-skriveren er i samsvar med E-NBestilling 4.0.')

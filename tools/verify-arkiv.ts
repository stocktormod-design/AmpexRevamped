/**
 * Selvtest for arkivet.
 *
 *   npm run verify:arkiv
 *
 * To ting må holde, ellers er «uforanderlig arkiv» bare et ord:
 *
 *   1. **Hashen må være en ekte SHA-256.** Den er håndskrevet fordi appen ikke
 *      har noen krypto-primitiv, og en håndskrevet hash uten testvektorer er
 *      ikke verdt tilliten. Vektorene under er FIPS 180-4 sine egne.
 *   2. **Pakken må være deterministisk.** Samme jobb skal gi samme bytes
 *      uansett hvem som fryser den, når, og i hvilken tidssone.
 */
import { sha256Hex, utf8Bytes } from '../lib/archive/sha256'
import { byggPakke, arkivNokkel, type Arkivinnhold } from '../lib/archive/bundle'

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

/* ── SHA-256 mot de offisielle testvektorene ──────────────────────────────── */

sjekk('tom streng', sha256Hex(''),
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
sjekk('«abc»', sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
sjekk('56 tegn — krysser blokkgrensen', sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
  '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
// 448 bits — nøyaktig grensetilfellet der paddingen krever en ekstra blokk.
sjekk('112 tegn — to blokker med padding',
  sha256Hex('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
  'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
sjekk('en million a-er', sha256Hex('a'.repeat(1000000)),
  'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')

// Norsk tekst og emoji må gi samme UTF-8 som alle andre implementasjoner —
// ellers stemmer ikke hashen på tvers av plattformer.
sjekk('æøå kodes som UTF-8', Array.from(utf8Bytes('æøå')), [195, 166, 195, 184, 195, 165])
sjekk('surrogatpar blir ett kodepunkt', Array.from(utf8Bytes('⚡')), [226, 154, 161])
sjekk('emoji utenfor BMP', Array.from(utf8Bytes('😀')), [240, 159, 152, 128])

/* ── Determinisme ────────────────────────────────────────────────────────── */

const innhold = (): Arkivinnhold => ({
  ordre: {
    ordrenummer: 42, tittel: 'El-kontroll bolig', beskrivelse: null, status: 'fakturert',
    adresse: 'Havnegata 7, 3040 Drammen',
    opprettet: new Date(Date.UTC(2026, 6, 1, 9, 0)),
    fakturert: new Date(Date.UTC(2026, 7, 20, 14, 30)),
  },
  kunde: { navn: 'DNB Eiendom', orgnr: '911223344', epost: null, telefon: null, adresse: null },
  materiell: [{ beskrivelse: 'PFXP 3G2,5', antall: 40, enhet: 'm', elnummer: '1451025', enhetspris: 24.9 }],
  timer: [{ dato: new Date(Date.UTC(2026, 7, 19)), timer: 7.5, person: 'Tormod', aktivitet: 'Montasje' }],
  tillegg: [],
  dokumenter: [{ mal: 'ampex.samsvar', malversjon: 1, status: 'fullfort', verdier: { norm: 'NEK 400:2022' } }],
  signaturer: [{ formaal: 'ferdig', signertAv: 'Kari Nordmann', signertTid: new Date(Date.UTC(2026, 7, 20)), strok: [] }],
  godkjenninger: [{ beslutning: 'godkjent', godkjenner: 'Far', besluttetTid: new Date(Date.UTC(2026, 7, 20, 15)) }],
  vedlegg: ['scans/abc.glb'],
})

const a = byggPakke(innhold())
const b = byggPakke(innhold())
sjekk('samme jobb gir samme hash', a.sha256, b.sha256)
sjekk('hashen er 64 hex-tegn', /^[0-9a-f]{64}$/.test(a.sha256), true)

// Nøkkelrekkefølge skal ikke telle: JSON.stringify følger innsettingsrekkefølge,
// og den varierer med hvordan raden ble bygget.
const snudd = innhold()
const k = snudd.kunde!
snudd.kunde = { telefon: k.telefon, adresse: k.adresse, navn: k.navn, epost: k.epost, orgnr: k.orgnr }
sjekk('nøkkelrekkefølge endrer ikke hashen', byggPakke(snudd).sha256, a.sha256)

// Men ekte endringer MÅ endre den — ellers beviser hashen ingenting.
const endret = innhold()
endret.timer[0].timer = 8
sjekk('en endret time gir ny hash', byggPakke(endret).sha256 !== a.sha256, true)
const endret2 = innhold()
endret2.materiell[0].enhetspris = 25
sjekk('en endret pris gir ny hash', byggPakke(endret2).sha256 !== a.sha256, true)

sjekk('datoer skrives som ISO i UTC', a.json.includes('"fakturert":"2026-08-20T14:30:00.000Z"'), true)
sjekk('formatversjonen er med i pakken', a.json.includes('"format":1'), true)
sjekk('telleverket stemmer', a.innhold,
  { materiell: 1, timer: 1, tillegg: 0, dokumenter: 1, signaturer: 1, vedlegg: 1 })
sjekk('bytes er UTF-8-lengden, ikke antall tegn', a.bytes >= a.json.length, true)

/* ── Nøkkelen ────────────────────────────────────────────────────────────── */

const firma = '0e906e0c-7f8c-4c66-8b48-99ad2f2cf706'
sjekk('nøkkelen er lesbar for et menneske',
  arkivNokkel(firma, 2026, 42, a.sha256), `arkiv/${firma}/2026/ordre-42-${a.sha256.slice(0, 12)}.json`)
// Omfrysing skal ALDRI overskrive forrige pakke — begge må kunne ligge side om side.
sjekk('ny hash gir ny nøkkel',
  arkivNokkel(firma, 2026, 42, a.sha256) !== arkivNokkel(firma, 2026, 42, byggPakke(endret).sha256), true)
sjekk('ordre uten nummer får en nøkkel likevel',
  arkivNokkel(firma, 2026, null, a.sha256).includes('ordre-uten-nummer-'), true)

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

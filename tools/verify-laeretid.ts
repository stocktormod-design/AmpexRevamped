/**
 * Selvtest for læretid — læreplanen og avkryssingsregelen.
 *
 *   npm run verify:laeretid
 *
 * Testene er hentet fra en ekte opprydding: 28 dokumentasjoner ble gjennomgått
 * 06.09.2026, og kryssene rettet mot loggteksten. De groveste feilene der er
 * regresjonstestene her. Klarer koden dem ikke, gjenskaper den nøyaktig de
 * tallene produktet finnes for å erstatte.
 */
import {
  LAEREPLANER, delNokkel, finnMaal, laereplan,
} from '../lib/laeretid/laereplan'
import {
  dekningForMaal, raadForMaal, varselForLogg, vurderBelegg,
  type Belegg,
} from '../lib/laeretid/dekning'
import {
  kanSe, mineLaerlinger, hvemSerHva,
  aksepter, kanInvitere, kanKobleFra,
  type Innsyn, type Invitasjon, type Tilknytning,
} from '../lib/laeretid/tilgang'
import {
  AI_ENDRINGER_PER_LOGG, RAPPORTERINGSGRENSE_ORE, anbefalteQuizer, avslagForMaaned,
  belonning, harRettighet, kanBeOmEndring, kanStarteNyLogg, kvote, rapporteringsvarsler,
  type Etterslepspakke, type Tilgangsrad, type Verving,
} from '../lib/laeretid/abonnement'
import {
  DAGER_TIL_REPETISJON, DAGER_TIL_RUNDE_2,
  anbefaltDytt, forTidlig, forfaltTilRepetisjon, svakeTemaer,
  etterprovLinje, utspurtForDel, repetisjonerAaLage, vaskForslag, isoDag,
  type Fasit, type Sporsmaal,
} from '../lib/laeretid/quiz'
import {
  HOVEDDELER, KART, UTGAVE, erUtgaatt, finnOppslag, oppslagIDel,
} from '../lib/laeretid/nek-kart'
import {
  SPORSMAAL, erFerdig, finnForbudte, gjenstaaende, type Tilstand,
} from '../lib/laeretid/utsporing'
import {
  MALER, NEK_NOKKEL, STANDARD_MAL_ID, finnMal, fyllResten, jaNei, lesUtfylling, mangler, nekFelter, tilTekst, tomUtfylling, vaskUtfylling,
} from '../lib/laeretid/mal'
import { loggPdfHtml } from '../lib/pdf/logg'
import { arbeidsdatoFraBilder, lesExifTid, tidFraExif } from '../lib/laeretid/bildetid'
import { byggProfil, fokus, fordeling, nesteTema, nivaaFor, temaProfil } from '../lib/laeretid/profil'
import { ENHETER, TEMAER, finnTema } from '../lib/laeretid/teori'
import { finnOppslag as nekOppslag } from '../lib/laeretid/nek-kart'
import {
  MAKS_FORSOK, gjennomgang, nekHenvisning, paastaarNek, rensNek, trygtNekSvar, vaskBelegg,
  type Grunnlag, type Melding,
} from '../lib/laeretid/samtale'

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

// ── Læreplanen ──────────────────────────────────────────────────────────────

sjekk('begge læreplanene har tjue mål',
  LAEREPLANER.map(p => p.maal.length), [20, 20])
sjekk('ELE03-04 gjelder fra 01.01.2026',
  laereplan('ELE03-04').gyldigFra, '2026-01-01')
sjekk('nøkkelen er læreplan + nummer + del, ikke etiketten',
  delNokkel('ELE03-03', 5, 'ekomutstyr'), 'ELE03-03/5/ekomutstyr')

// Teksten er forskrift. Endres den, skal testen falle.
sjekk('1.1 står ordrett som hos Udir',
  finnMaal('ELE03-03', 1).tekst,
  'planlegge, gjennomføre og dokumentere arbeidsoppdragene individuelt og i samarbeid med andre i henhold til gjeldende regelverk og bedriftens internkontrollsystem, og begrunne valgene som er gjort')

// De fire delene som manglet i den håndskrevne mållista. To av dem ligger på
// de tynneste målene, så de er verdt mest.
const oversett = LAEREPLANER[0].maal.flatMap(m =>
  m.deler.filter(d => d.oversettI2026).map(d => `${m.etikett}/${d.id}`))
sjekk('de fire oversette delene er med',
  oversett, ['1.5/ekomutstyr', '1.7/kablet', '1.9/energiokonomi', '1.20/endringer'])

// ── Avkryssingsregelen ──────────────────────────────────────────────────────

const maal12 = finnMaal('ELE03-03', 12)
const foringsvei = maal12.deler.find(d => d.id === 'foringsvei')!
const iz = maal12.deler.find(d => d.id === 'iz')!

const grunn = (over: Partial<Belegg> = {}): Belegg => ({
  loggId: 'logg-1', maalNr: 12, delId: 'foringsvei',
  kilde: 'brodtekst', generert: false, utfortSelv: true, ...over,
})

sjekk('brødtekst + utført selv holder',
  vurderBelegg(foringsvei, grunn()).holder, true)

// 1.3 og 1.4 sto på nesten alt fordi risikotabellen fylles ut hver gang.
sjekk('risikotabellen bærer ikke et kryss alene',
  vurderBelegg(foringsvei, grunn({ kilde: 'risikotabell' })),
  { holder: false, grunn: 'Står bare i risikovurderingstabellen, som fylles ut i hver logg' })

// Men 1.2 ER risikovurderingen, og tabellen er der den gjøres (27.09.2026).
const sjokk = finnMaal('ELE03-03', 2).deler[0]
sjekk('risikotabellen bærer 1.2',
  vurderBelegg(sjokk, grunn({ maalNr: 2, delId: sjokk.id, kilde: 'risikotabell' })).holder, true)

// 1.16 sto på fjorten logger på grunnlag av raden «Hva gjorde du bra?».
sjekk('egenvurderingstabellen bærer ikke et kryss alene',
  vurderBelegg(foringsvei, grunn({ kilde: 'egenvurdering' })).holder, false)

// 1.19 sto på nitten logger. Bare én skilte faktisk fraksjoner.
sjekk('«søppelet ble sortert» er en bisetning, ikke dekning',
  vurderBelegg(foringsvei, grunn({ kilde: 'bisetning' })).holder, false)

// 1.8 sto på KNX-loggene. Han trakk kabel fram til spjeld, programmerte ingenting.
sjekk('nærhet til utstyr han ikke rørte gir ikke kryss',
  vurderBelegg(foringsvei, grunn({ kilde: 'naerhet' })).holder, false)

// Å legge kabel på ferdig montert bro dekker forlegning, ikke føringsvei.
sjekk('redegjort for, men ikke utført, gir ikke kryss på en utførelsesdel',
  vurderBelegg(foringsvei, grunn({ utfortSelv: false })),
  { holder: false, grunn: 'Du har redegjort for det, ikke utført det' })

// Men det motsatte gjelder også: «gjøre rede for»-deler ER redegjørelse.
sjekk('redegjørelsesdel holder uten at han utførte noe',
  vurderBelegg(iz, grunn({ delId: 'iz', utfortSelv: false })).holder, true)

// Når tekst er gratis er tekst ikke lenger bevis.
sjekk('generert avsnitt bærer ikke kryss alene',
  vurderBelegg(foringsvei, grunn({ generert: true })).holder, false)
sjekk('generert avsnitt holder når han forklarte det etterpå',
  vurderBelegg(foringsvei, grunn({ generert: true, utspurt: 'bestatt' })).holder, true)
sjekk('strøket utspørring velter krysset',
  vurderBelegg(foringsvei, grunn({ utspurt: 'stroket' })),
  { holder: false, grunn: 'Du klarte ikke å forklare det da du ble spurt' })

// ── Dekning per mål ─────────────────────────────────────────────────────────

const maal9 = finnMaal('ELE03-03', 9)
sjekk('1.9 uten belegg er tomt',
  dekningForMaal(maal9, []).status, 'tomt')

// Fem mål hvilte på én logg hver. Formelt dekket, i praksis sårbart.
const enLogg: Belegg[] = maal9.deler.map(d => ({
  loggId: 'solceller', maalNr: 9, delId: d.id,
  kilde: 'brodtekst', generert: false, utfortSelv: true,
}))
sjekk('alle deler fra ÉN logg er kritisk, ikke holder',
  dekningForMaal(maal9, enLogg).status, 'kritisk')

const toLogger: Belegg[] = [
  ...enLogg.slice(0, 3),
  ...maal9.deler.slice(3).map(d => ({
    loggId: 'batteri', maalNr: 9, delId: d.id,
    kilde: 'brodtekst' as const, generert: false, utfortSelv: true,
  })),
]
sjekk('alle deler fra to logger holder',
  dekningForMaal(maal9, toLogger).status, 'holder')
sjekk('dekningen teller deler, ikke logger',
  dekningForMaal(maal9, toLogger).dekkede + '/' + dekningForMaal(maal9, toLogger).totalt, '5/5')

// Det fagbrev.io faktisk gjør: telle merkede logger. Nitten logger merket
// 1.19 uten dekning i teksten skal gi null, ikke nitten.
const nittenMerket: Belegg[] = Array.from({ length: 19 }, (_, i) => ({
  loggId: `logg-${i}`, maalNr: 19, delId: 'avfall',
  kilde: 'risikotabell' as const, generert: false, utfortSelv: true,
}))
sjekk('nitten logger merket via tabellrad gir fortsatt tomt',
  dekningForMaal(finnMaal('ELE03-03', 19), nittenMerket).status, 'tomt')

// ── Varsel og råd ───────────────────────────────────────────────────────────

sjekk('åtte mål på en logg er greit', varselForLogg(8), null)
sjekk('tolv mål på en logg gir varsel', varselForLogg(12) !== null, true)

sjekk('tomt mål med utførelsesdeler ber om en jobb',
  raadForMaal(maal9, dekningForMaal(maal9, []), []).slag, 'skaff-jobb')

// Energiøkonomi er ren redegjørelse — den koster et avsnitt, ikke en jobb.
const altUtenomOkonomi: Belegg[] = maal9.deler
  .filter(d => d.id !== 'energiokonomi')
  .map(d => ({
    loggId: d.id === 'energiproduksjon' ? 'a' : 'b', maalNr: 9, delId: d.id,
    kilde: 'brodtekst' as const, generert: false, utfortSelv: true,
  }))
sjekk('siste del som er ren redegjørelse ber om et avsnitt, ikke en jobb',
  raadForMaal(maal9, dekningForMaal(maal9, altUtenomOkonomi), altUtenomOkonomi).slag, 'skriv-avsnitt')

const stroketBelegg: Belegg[] = [{
  loggId: 'moskenes', maalNr: 9, delId: 'energiproduksjon',
  kilde: 'brodtekst', generert: false, utfortSelv: true, utspurt: 'stroket',
}]
sjekk('strøket utspørring gir råd om å lese, ikke om å skaffe jobb',
  raadForMaal(maal9, dekningForMaal(maal9, stroketBelegg), stroketBelegg).slag, 'les-og-ov')

// ── Tilgang ─────────────────────────────────────────────────────────────────

const I_DAG = '2026-09-16'
const tilknytninger: Tilknytning[] = [
  // Faglig leder og instruktør i Aqila.
  { laerlingId: 'tormod', personId: 'tom-ole', rolle: 'faglig_leder', gyldigFra: '2024-08-01', gyldigTil: null },
  { laerlingId: 'tormod', personId: 'vetle', rolle: 'instruktor', gyldigFra: '2024-08-01', gyldigTil: null },
  // Koordinator fra TENK Lofoten — satt på lærlinger i FLERE bedrifter.
  { laerlingId: 'tormod', personId: 'jens-arne', rolle: 'koordinator', gyldigFra: '2024-08-01', gyldigTil: null },
  { laerlingId: 'siri-lofoten-elektro', personId: 'jens-arne', rolle: 'koordinator', gyldigFra: '2025-01-01', gyldigTil: null },
  // Kollega uten innsyn.
  { laerlingId: 'tormod', personId: 'joakim', rolle: 'ansatt', gyldigFra: '2024-08-01', gyldigTil: null },
  // Tidligere faglig leder som sluttet.
  { laerlingId: 'tormod', personId: 'gammel-sjef', rolle: 'faglig_leder', gyldigFra: '2024-08-01', gyldigTil: '2025-06-30' },
]
const se = (personId: string, hva: Innsyn, laerlingId = 'tormod') =>
  kanSe({ personId, laerlingId, hva, paaDato: I_DAG, tilknytninger })

sjekk('lærlingen ser sin egen kladd', se('tormod', 'kladd'), true)
sjekk('faglig leder ser loggen', se('tom-ole', 'logg'), true)
sjekk('koordinator ser loggen', se('jens-arne', 'logg'), true)
sjekk('koordinator ser dekningen', se('jens-arne', 'dekning'), true)

// Grensen produktet står og faller på.
sjekk('INGEN ser kladden hans', ['tom-ole', 'vetle', 'jens-arne', 'joakim'].map(p => se(p, 'kladd')),
  [false, false, false, false])
sjekk('INGEN ser profilen hans', ['tom-ole', 'vetle', 'jens-arne'].map(p => se(p, 'profil')),
  [false, false, false])
sjekk('ingen andre ser abonnementet', se('tom-ole', 'abonnement'), false)

sjekk('kollega i bedriften ser ingenting', [se('joakim', 'dekning'), se('joakim', 'logg')], [false, false])
sjekk('en fremmed ser ingenting', se('ukjent', 'dekning'), false)

// En faglig leder som slutter mister innsynet.
sjekk('utløpt tilknytning gir ingenting', se('gammel-sjef', 'logg'), false)

// Det company_id ikke kan uttrykke: samme person, to bedrifter.
sjekk('koordinator følger lærlinger på tvers av firmaer',
  mineLaerlinger('jens-arne', I_DAG, tilknytninger).map(x => x.laerlingId),
  ['tormod', 'siri-lofoten-elektro'])
sjekk('faglig leder i Aqila ser ikke lærlingen i Lofoten Elektro',
  se('tom-ole', 'logg', 'siri-lofoten-elektro'), false)
sjekk('ansatt havner ikke i «mine lærlinger»',
  mineLaerlinger('joakim', I_DAG, tilknytninger), [])

// Løftet på skjermen genereres fra samme matrise som håndhever det.
sjekk('hvem-ser-hva viser kollegaen som «ingenting»',
  hvemSerHva('tormod', I_DAG, tilknytninger).find(x => x.personId === 'joakim')?.ser, 'ingenting')
sjekk('hvem-ser-hva utelater den som sluttet',
  hvemSerHva('tormod', I_DAG, tilknytninger).some(x => x.personId === 'gammel-sjef'), false)

// ── Invitasjon ──────────────────────────────────────────────────────────────

const inv = (over: Partial<Invitasjon> = {}): Invitasjon => ({
  id: 'inv-1', laerlingId: 'tormod', epost: 'tom-ole@aqila.no', rolle: 'faglig_leder',
  fraPersonId: 'tormod', sendtDato: '2026-09-10', utloperDato: '2026-10-10',
  status: 'sendt', ...over,
})

sjekk('lærlingen kan invitere hvem som helst til sin egen læretid',
  (['faglig_leder', 'instruktor', 'koordinator'] as const).map(r =>
    kanInvitere({ fraPersonId: 'tormod', laerlingId: 'tormod', rolle: r, paaDato: I_DAG, tilknytninger })),
  [true, true, true])
sjekk('en fremmed kan ikke invitere seg selv inn',
  kanInvitere({ fraPersonId: 'ukjent', laerlingId: 'tormod', rolle: 'koordinator', paaDato: I_DAG, tilknytninger }), false)
sjekk('koordinator kan hente inn en faglig leder, men ikke en ny koordinator',
  [
    kanInvitere({ fraPersonId: 'jens-arne', laerlingId: 'tormod', rolle: 'faglig_leder', paaDato: I_DAG, tilknytninger }),
    kanInvitere({ fraPersonId: 'jens-arne', laerlingId: 'tormod', rolle: 'koordinator', paaDato: I_DAG, tilknytninger }),
  ], [true, false])
sjekk('en kollega uten innsyn kan ikke invitere noen',
  kanInvitere({ fraPersonId: 'joakim', laerlingId: 'tormod', rolle: 'instruktor', paaDato: I_DAG, tilknytninger }), false)

// Lærlingen inviterte → mottakeren aksepterer og får tilgangen.
sjekk('faglig leder som aksepterer blir knyttet til lærlingen',
  aksepter(inv(), { personId: 'tom-ole', epost: 'tom-ole@aqila.no' }, I_DAG),
  { laerlingId: 'tormod', personId: 'tom-ole', rolle: 'faglig_leder', gyldigFra: I_DAG, gyldigTil: null })

// Kontoret inviterte → lærlingen aksepterer, og AVSENDEREN får tilgangen.
const fraKontoret = inv({
  epost: 'tormod@aqila.no', rolle: 'koordinator', fraPersonId: 'jens-arne',
})
sjekk('når kontoret inviterer, er det avsenderen som får tilgang',
  aksepter(fraKontoret, { personId: 'tormod', epost: 'tormod@aqila.no' }, I_DAG)?.personId, 'jens-arne')
sjekk('en annen enn lærlingen kan ikke løse inn kontorets invitasjon',
  aksepter(fraKontoret, { personId: 'joakim', epost: 'tormod@aqila.no' }, I_DAG), null)

sjekk('feil adresse løser ikke inn invitasjonen',
  aksepter(inv(), { personId: 'joakim', epost: 'joakim@aqila.no' }, I_DAG), null)
sjekk('adressen er ikke versalfølsom',
  aksepter(inv(), { personId: 'tom-ole', epost: ' Tom-Ole@Aqila.no ' }, I_DAG)?.personId, 'tom-ole')
sjekk('utløpt invitasjon gir ingenting',
  aksepter(inv(), { personId: 'tom-ole', epost: 'tom-ole@aqila.no' }, '2026-11-01'), null)
sjekk('en invitasjon kan ikke aksepteres to ganger',
  aksepter(inv({ status: 'akseptert' }), { personId: 'tom-ole', epost: 'tom-ole@aqila.no' }, I_DAG), null)

// Han skal vite FØR han aksepterer hva han kan ta tilbake.
sjekk('betaler han selv, kan han koble fra koordinatoren',
  kanKobleFra('koordinator', 'selv').kan, true)
sjekk('betaler kontoret plassen, følger koordinatoren med den',
  kanKobleFra('koordinator', 'kontor').kan, false)
sjekk('faglig leder kan alltid fjernes når han betaler selv',
  kanKobleFra('faglig_leder', 'selv').kan, true)

// ── Abonnement og tilgang ───────────────────────────────────────────────────

const abo = (over: Partial<Tilgangsrad> = {}): Tilgangsrad => ({
  laerlingId: 'tormod', finansiering: 'selv', referanse: 'sub_x',
  gyldigFra: '2026-01-01', gyldigTil: null, loggerPerMaaned: 4, ...over,
})
const utlopt = abo({ gyldigTil: '2026-08-31' })

// Den viktigste regelen i hele modulen.
sjekk('utløpt abonnement låser ALDRI dokumentasjonen',
  (['lese', 'eksport', 'slette'] as const).map(r => harRettighet(r, [utlopt], I_DAG)),
  [true, true, true])
sjekk('uten abonnement i det hele tatt beholder han lesing og eksport',
  (['lese', 'eksport'] as const).map(r => harRettighet(r, [], I_DAG)), [true, true])
sjekk('utløpt abonnement stopper ny logg og utspørring',
  (['ny-logg', 'utsporing'] as const).map(r => harRettighet(r, [utlopt], I_DAG)),
  [false, false])
sjekk('aktivt abonnement gir ny logg', harRettighet('ny-logg', [abo()], I_DAG), true)

// Kontoret betaler ikke med kort. Samme rad, annen finansiering.
sjekk('kontorbetalt plass gir samme tilgang som selvbetalt',
  harRettighet('ny-logg', [abo({ finansiering: 'kontor', referanse: null })], I_DAG), true)

const tomKvote = kvote({
  rader: [abo()], pakker: [], brukteLoggerDenneMaaneden: 4,
  brukteEkstraTotalt: 0, paaDato: I_DAG,
})
sjekk('fire av fire brukt gir null igjen', tomKvote.igjen, 0)
sjekk('tom kvote tilbyr etterslep, ikke abonnement',
  (kanStarteNyLogg([abo()], tomKvote, I_DAG) as { tilbud?: string }).tilbud, 'etterslep')
sjekk('uten abonnement tilbys abonnement, ikke etterslep',
  (kanStarteNyLogg([utlopt], tomKvote, I_DAG) as { tilbud?: string }).tilbud, 'abonnement')

// Han som ligger tre måneder bak er kunden som trenger oss mest.
const pakker: Etterslepspakke[] = [{ laerlingId: 'tormod', kjoptDato: '2026-09-10', ekstraLogger: 10 }]
const medEtterslep = kvote({
  rader: [abo()], pakker, brukteLoggerDenneMaaneden: 4,
  brukteEkstraTotalt: 2, paaDato: I_DAG,
})
sjekk('etterslepspakka gir logger utover månedskvoten', medEtterslep.igjen, 8)
sjekk('etterslepspakka nullstilles ikke ved månedsskifte',
  kvote({ rader: [abo()], pakker, brukteLoggerDenneMaaneden: 0, brukteEkstraTotalt: 2, paaDato: I_DAG }).ekstra, 8)
sjekk('med etterslep kan han fortsette',
  kanStarteNyLogg([abo()], medEtterslep, I_DAG).kanFortsette, true)

sjekk('fire logger gir åtte anbefalte quizer', anbefalteQuizer(4), 8)

// To omskrivinger, og grunnen er ikke kostnad: uendelig «skriv om» gjør at
// ingen leser teksten, og da eier ingen den.
sjekk('to omskrivinger er inkludert', AI_ENDRINGER_PER_LOGG, 2)
sjekk('foerste omskriving er lov', kanBeOmEndring(0), { kan: true, igjen: 2 })
sjekk('andre omskriving er lov', kanBeOmEndring(1), { kan: true, igjen: 1 })
sjekk('tredje omskriving avvises', kanBeOmEndring(2).kan, false)
sjekk('avslaget peker paa hans egen redigering, ikke paa en betalingsmur',
  (kanBeOmEndring(2) as { grunn: string }).grunn.includes('selv'), true)

// ── Utspørring ──────────────────────────────────────────────────────────────

const sp = (over: Partial<Sporsmaal> = {}): Sporsmaal => ({
  id: 's1', loggId: 'moskenes', maalNr: 12, delId: 'iz', runde: 1,
  tekst: 'Hvorfor jordes skjermen bare i én ende?',
  svar: null, vurdering: null, laget: '2026-09-12', besvart: null, ...over,
})

sjekk('ubesvart runde 1 dyttes med en gang',
  anbefaltDytt([sp()], '2026-09-12')?.grunn, 'fersk')
sjekk('ingenting aa dytte paa naar alt er besvart',
  anbefaltDytt([sp({ besvart: '2026-09-12', vurdering: 'bestatt' })], '2026-09-20'), null)

// Fire logger paa én kveld skal ikke gi fire paaminnelser.
sjekk('aldri mer enn ett dytt om dagen',
  anbefaltDytt([
    sp({ id: 'a', besvart: '2026-09-16', vurdering: 'bestatt' }),
    sp({ id: 'b', loggId: 'kleppstad' }),
  ], '2026-09-16'), null)

const runde1 = sp({ id: 'r1', besvart: '2026-09-12', vurdering: 'bestatt' })
const runde2 = sp({ id: 'r2', runde: 2, tekst: 'Sitter det fortsatt?' })

sjekk('runde 2 dyttes ikke dagen etter',
  anbefaltDytt([runde1, runde2], '2026-09-13'), null)
sjekk('runde 2 dyttes etter tre dager',
  anbefaltDytt([runde1, runde2], '2026-09-15')?.grunn, 'repetisjon')
sjekk('runde 2 teller fra da han SVARTE, ikke fra da spoersmaalet ble laget',
  anbefaltDytt([sp({ id: 'r1', besvart: '2026-09-20', vurdering: 'bestatt' }), runde2], '2026-09-21'), null)
sjekk('runde 2 dyttes aldri foer runde 1 er besvart',
  anbefaltDytt([sp({ id: 'r1' }), runde2], '2026-10-01')?.sporsmaal.runde ?? null, 1)

// ── Fra svar til kryss ──────────────────────────────────────────────────────

sjekk('ingen spoersmaal paa delen gir ingen dom',
  utspurtForDel([sp()], 'moskenes', 12, 'annen'), null)
sjekk('halvferdig avhoer er ikke en dom',
  utspurtForDel([sp({ id: 'a', besvart: '2026-09-12', vurdering: 'bestatt' }), sp({ id: 'b' })], 'moskenes', 12, 'iz'), null)
sjekk('alle bestaatt i runde 1 gir bestaatt',
  utspurtForDel([sp({ besvart: '2026-09-12', vurdering: 'bestatt' })], 'moskenes', 12, 'iz'), 'bestatt')
sjekk('ett stryk i runde 1 stryker delen',
  utspurtForDel([
    sp({ id: 'a', besvart: '2026-09-12', vurdering: 'bestatt' }),
    sp({ id: 'b', besvart: '2026-09-12', vurdering: 'stroket' }),
  ], 'moskenes', 12, 'iz'), 'stroket')
sjekk('stryk i runde 2 tar ALDRI krysset',
  utspurtForDel([
    sp({ id: 'a', besvart: '2026-09-12', vurdering: 'bestatt' }),
    sp({ id: 'b', runde: 2, besvart: '2026-09-16', vurdering: 'stroket' }),
  ], 'moskenes', 12, 'iz'), 'bestatt')
sjekk('en annen logg paa samme del teller ikke her',
  utspurtForDel([sp({ loggId: 'kleppstad', besvart: '2026-09-12', vurdering: 'stroket' })], 'moskenes', 12, 'iz'), null)

// Repetisjon: tre uker etter bom, én gang, og ferdig naar han klarer det.
const bom = sp({ id: 'bom', runde: 2, besvart: '2026-09-01', vurdering: 'stroket' })
sjekk('bom kommer ikke tilbake foer tre uker',
  repetisjonerAaLage([bom], '2026-09-10').length, 0)
sjekk('bom kommer tilbake etter tre uker',
  repetisjonerAaLage([bom], '2026-09-22').map(x => x.delId), ['iz'])
sjekk('ikke nytt spoersmaal naar ett alt venter paa samme del',
  repetisjonerAaLage([bom, sp({ id: 'ny', runde: 2 })], '2026-09-22').length, 0)
sjekk('klart etter bommet — repetisjonen er gjort',
  repetisjonerAaLage([bom, sp({ id: 'ok', runde: 2, besvart: '2026-09-23', vurdering: 'bestatt' })], '2026-10-30').length, 0)
sjekk('bestaatt FOER bommet redder ikke temaet',
  repetisjonerAaLage([sp({ id: 'foer', besvart: '2026-08-20', vurdering: 'bestatt' }), bom], '2026-09-22').length, 1)

// Modellen velger del, men faar ikke finne paa en.
const finnes = (m: number, d: string) => m === 12 && (d === 'iz' || d === 'forlegning')
sjekk('ukjent del kastes',
  vaskForslag([{ maalNr: 12, delId: 'tull', tekst: 'Hvorfor?' }], finnes, 1), [])
sjekk('paastand uten spoersmaalstegn kastes',
  vaskForslag([{ maalNr: 12, delId: 'iz', tekst: 'Skjermen jordes i én ende.' }], finnes, 1), [])
sjekk('to paa samme del blir ett',
  vaskForslag([
    { maalNr: 12, delId: 'iz', tekst: 'Hvorfor én ende?' },
    { maalNr: 12, delId: 'iz', tekst: 'Hvilken ende?' },
    { maalNr: 12, delId: 'forlegning', tekst: 'Hvordan la du den?' },
  ], finnes, 1).length, 2)
sjekk('runde 2 er ett spoersmaal',
  vaskForslag([
    { maalNr: 12, delId: 'iz', tekst: 'Hvorfor én ende?' },
    { maalNr: 12, delId: 'forlegning', tekst: 'Hvordan la du den?' },
  ], finnes, 2).length, 1)
sjekk('isoDag er lokal kalenderdag', isoDag(new Date(2026, 8, 5, 23, 30)), '2026-09-05')

// ── Samtalen som skriver loggen ─────────────────────────────────────────────

const grunnlag = (over: Partial<Grunnlag> = {}): Grunnlag => ({
  instruks: 'La ny kabel fra tavla til varmepumpa.', notater: [], bilderUtenNotat: 0, ...over,
})
const bot = (tekst = 'spørsmål'): Melding => ({ rolle: 'bot', tekst, dekker: [] })
const han = (tekst: string, ...dekker: Melding['dekker']): Melding => ({ rolle: 'laerling', tekst, dekker })

sjekk('foerste spoersmaal er alltid hva han gjorde selv',
  gjennomgang(grunnlag(), []).neste, 'utfort-selv')
sjekk('ett svar om hva han gjorde, og loggen kan skrives',
  gjennomgang(grunnlag(), [bot(), han('Jeg trakk kabelen, montøren koblet.', 'utfort-selv')]).ferdig, true)
sjekk('bilder uten notat spoerres om etterpaa',
  gjennomgang(grunnlag({ bilderUtenNotat: 2 }), [bot(), han('a', 'utfort-selv')]).neste, 'bilde-uten-notat')
// Ingen evig loekke: spurt to ganger uten svar er «husker ikke».
sjekk(`etter ${MAKS_FORSOK} forsoek gaar samtalen videre`,
  gjennomgang(grunnlag(), [bot(), han('hæ'), bot(), han('vet ikke helt')]).ferdig, true)
sjekk('ett forsoek er ikke nok til aa gi opp',
  gjennomgang(grunnlag(), [bot(), han('hæ')]).forsok, 1)

// NEK: hvor, aldri hva.
sjekk('kjent punkt gir side', nekHenvisning('512')?.side, 171)
sjekk('«NEK 400 512» renses', nekHenvisning('NEK 400 512')?.punkt, '512')
sjekk('ukjent punkt sendes aldri videre', nekHenvisning('999'), null)
sjekk('gammel 61x-henvisning sendes aldri videre', nekHenvisning('6-61'), null)
sjekk('«NEK 522 krever …» er innhold',
  paastaarNek('Bra. NEK 522 krever at kabelen festes hver 40 cm.').length, 1)
sjekk('«ifølge NEK skal …» er innhold',
  paastaarNek('Ifølge NEK skal jordfeilbryteren være type A.').length, 1)
sjekk('en ren henvisning er IKKE innhold',
  paastaarNek(trygtNekSvar(nekHenvisning('512'))), [])
sjekk('et vanlig spoersmaal uten NEK slipper gjennom',
  paastaarNek('Hva måtte du tenke på når du festet kabelen?'), [])

// Glipper boten, forsvinner setningen — ikke spoersmaalet.
sjekk('rensNek beholder spoersmaalet',
  rensNek('NEK 400 krever mer enn spenningsmåling. Hvilke andre målinger gjorde dere?', null),
  'Hvilke andre målinger gjorde dere?')
sjekk('rensNek legger henvisningen foran naar den finnes',
  rensNek('Ifølge NEK skal du måle isolasjon. Hva målte dere?', nekHenvisning('512'))?.startsWith('Slå opp 512 på side 171'), true)
sjekk('rensNek lar en ren melding staa urort',
  rensNek('Hvilken kabeltype var det?', null), 'Hvilken kabeltype var det?')
sjekk('bare innhold gir ren henvisning',
  rensNek('NEK 522 krever strips hver 40 cm.', nekHenvisning('522'))?.startsWith('Slå opp 522'), true)

// Belegg: modellen velger, reglene vasker.
const finnesB = (m: number, d: string) => m >= 1 && m <= 20 && d === 'x'
sjekk('ukjent del gir ikke belegg', vaskBelegg([{ maalNr: 12, delId: 'tull', utfortSelv: true }], finnesB), [])
sjekk('samme del to ganger blir én',
  vaskBelegg([{ maalNr: 12, delId: 'x', utfortSelv: true }, { maalNr: 12, delId: 'x', utfortSelv: false }], finnesB).length, 1)
sjekk('aldri mer enn aatte maal paa én logg',
  new Set(vaskBelegg(Array.from({ length: 12 }, (_, i) => ({ maalNr: i + 1, delId: 'x', utfortSelv: true })), finnesB).map(b => b.maalNr)).size, 8)

// ── Malen ───────────────────────────────────────────────────────────────────

const std = finnMal(STANDARD_MAL_ID)
sjekk('ukjent mal gir standardmalen', finnMal('finnes-ikke').id, STANDARD_MAL_ID)
sjekk('standardmalen er loggmalen fra fagbrev.io, i dens rekkefølge',
  std.seksjoner.map(s => s.id),
  ['oppdrag', 'risiko', 'materiell', 'verktoy', 'utforelse', 'sluttkontroll', 'bilder', 'vurdering', 'vedlegg'])
sjekk('risikovurderingen har tolv faste punkter',
  (std.seksjoner.find(s => s.id === 'risiko') as { faste: string[] }).faste.length, 12)
sjekk('vurderingen har tolv spørsmål og fire kolonner som i Word-malen',
  [(std.seksjoner.find(s => s.id === 'vurdering') as { faste: string[] }).faste.length,
   (std.seksjoner.find(s => s.id === 'vurdering') as { kolonner: string[] }).kolonner.length], [12, 4])
sjekk('refleksjonsmalen har fem deler', finnMal('tenk-refleksjon').seksjoner.length, 5)
sjekk('gamle mal-id-er faller tilbake til standardmalen', finnMal('fagbrev-2026').id, STANDARD_MAL_ID)
sjekk('overskriftene står ordrett fra malen',
  std.seksjoner.find(s => s.id === 'utforelse')?.tittel, 'Utførelse med begrunnelser for valg og henvisning til forskrifter')

sjekk('ja/nei godtar bare ja og nei', [jaNei('JA.'), jaNei('nei'), jaNei('kanskje')], ['Ja', 'Nei', ''])

// Modellen kan ikke fjerne et punkt ved å la være å svare på det.
const vasket = vaskUtfylling(std, { risiko: [['ja', 'Fall', 'Stige']], materiell: [['Wago', '4'], ['', '']] })
sjekk('faste rader står alltid, også ubesvarte', (vasket.risiko as string[][]).length, 12)
sjekk('første risikorad er fylt og ja er normalisert', (vasket.risiko as string[][])[0], ['Ja', 'Fall', 'Stige'])
sjekk('tomme rader i frie tabeller forsvinner', vasket.materiell, [['Wago', '4']])
sjekk('ødelagt json gir tom utfylling, ikke krasj', lesUtfylling(std, '{ikke json').oppdrag, '')

sjekk('tom mal mangler alt som skal fylles',
  mangler(std, tomUtfylling(std)).map(m => m.seksjon),
  ['oppdrag', 'risiko', 'materiell', 'verktoy', 'utforelse', 'sluttkontroll', 'vurdering', 'vedlegg'])
sjekk('ubesvarte punkter telles',
  mangler(std, vasket).find(m => m.seksjon === 'risiko')?.tekst, '11 punkter i risikovurdering er ikke besvart')
sjekk('teksten følger malens overskrifter',
  tilTekst(std, vasket).split('\n\n').map(d => d.split('\n')[0]).slice(0, 3), ['Oppdrag', 'Risikovurdering', 'Materielliste'])

// Ingenting står tomt til lærlingen.
const fylt = fyllResten(std, vasket)
sjekk('glemte rader blir nei og ikke relevant', (fylt.risiko as string[][])[5], ['Nei', 'Ikke relevant.', 'Ikke relevant.'])
sjekk('rader modellen fylte røres ikke', (fylt.risiko as string[][])[0], ['Ja', 'Fall', 'Stige'])
sjekk('etter sikkerhetsnettet mangler ingen tabellrad',
  mangler(std, fylt).filter(m => ['risiko', 'vurdering', 'vedlegg'].includes(m.seksjon)), [])

// NEK: boten peker, lærlingen begrunner.
const medNek = vaskUtfylling(std, { [NEK_NOKKEL]: [['522', 'Hvorfor kabelen ligger i rør i bakken'], ['999', 'finnes ikke'], ['522', 'dobbelt']] })
sjekk('bare NEK-punkter fra kartet, ett per punkt', nekFelter(medNek).map(f => f.punkt), ['522'])
sjekk('NEK-feltet får sidetall fra kartet', nekFelter(medNek)[0].side, 193)
sjekk('manglende NEK-forklaring stopper IKKE innsending (frivillig)',
  mangler(std, medNek).some(m => m.seksjon === NEK_NOKKEL), false)
sjekk('uten forklaring står henvisningen alene',
  tilTekst(std, medNek).includes('Henvisning til forskrifter:\nNEK 400:2026, punkt 522, side 193'), true)
sjekk('begrunnelsen havner under utførelsen med punkt og side',
  tilTekst(std, vaskUtfylling(std, { utforelse: 'La kabelen.', [NEK_NOKKEL]: [['522', 'Rør', 'Kabelen er beskyttet mot mekanisk skade.']] }))
    .includes('NEK 400:2026, punkt 522, side 193: Kabelen er beskyttet mot mekanisk skade.'), true)

// PDF-en er leveransen til fagbrev.io, i malens form.
const pdf = loggPdfHtml({
  tittel: 'Byggestrøm <Kleppstad>', arbeidsdato: '2026-09-24', mal: std, bilder: [],
  utfylling: vaskUtfylling(std, { oppdrag: 'Satte opp byggestrøm.', [NEK_NOKKEL]: [['522', 'Hvorfor kabelen ligger i rør']] }),
})
sjekk('pdf-en har malens overskrifter i malens rekkefølge',
  [...pdf.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m => m[1]).slice(0, 3), ['Oppdrag', 'Risikovurdering', 'Materielliste'])
sjekk('pdf-en har alle tolv risikopunkter, også ubesvarte',
  (pdf.match(/<td class="sp">/g) ?? []).length, 12 + 12 + 7)
sjekk('pdf-en viser henvisningen uten krav om forklaring',
  pdf.includes('NEK 400:2026, punkt 522, side 193') && !pdf.includes('Skriv begrunnelsen'), true)
sjekk('tittelen escapes', pdf.includes('Byggestrøm &lt;Kleppstad&gt;'), true)

// Bildetid: bare tiden leses fra EXIF, aldri posisjonen.
sjekk('exif-tid med offset', lesExifTid('2026:09:24 10:14:03', '+02:00')?.toISOString(), '2026-09-24T08:14:03.000Z')
sjekk('exif-tid uten offset er lokaltid', lesExifTid('2026:09:24 10:14:03')?.getHours(), 10)
sjekk('kamera uten klokke gir ingen tid', lesExifTid('0000:00:00 00:00:00'), null)
sjekk('søppel gir ingen tid', lesExifTid('i går'), null)
sjekk('iOS legger tiden under {Exif}',
  tidFraExif({ '{Exif}': { DateTimeOriginal: '2026:09:24 10:14:03', OffsetTimeOriginal: '+02:00' }, '{GPS}': { Latitude: 67.9 } })?.toISOString(),
  '2026-09-24T08:14:03.000Z')
sjekk('Android er flat', tidFraExif({ DateTimeOriginal: '2026:09:24 10:14:03', OffsetTimeOriginal: '+02:00' })?.toISOString(),
  '2026-09-24T08:14:03.000Z')
sjekk('tatt slår digitalisert', tidFraExif({ DateTimeDigitized: '2026:09:25 09:00:00', DateTimeOriginal: '2026:09:24 10:14:03' })?.getDate(), 24)
sjekk('bilde fra Messenger uten exif gir null', tidFraExif({}), null)
sjekk('arbeidsdato er dagen de fleste bildene er fra',
  arbeidsdatoFraBilder([new Date(2026, 8, 24, 10), new Date(2026, 8, 24, 14), new Date(2026, 8, 26, 20), null]), '2026-09-24')
sjekk('ingen tider gir ingen arbeidsdato', arbeidsdatoFraBilder([null, null]), null)

// Læringsprofilen: regnes ut, lagres aldri.
const q = (over: Partial<Sporsmaal>): Sporsmaal => ({
  id: Math.random().toString(), loggId: 'l1', maalNr: 12, delId: 'forlegning', runde: 1,
  tekst: '?', svar: 'x', vurdering: 'bestatt', laget: '2026-09-01', besvart: '2026-09-01', ...over,
})
const blg = (maalNr: number, delId: string, loggId = 'l1') => ({ loggId, maalNr, delId, utfortSelv: true })
const iDag = '2026-09-27'
sjekk('aldri spurt, aldri i logg: ny', nivaaFor(byggProfil([], [], iDag), 12, 'forlegning'), 0)
sjekk('i en logg men aldri spurt: grunnleggende', nivaaFor(byggProfil([], [blg(12, 'forlegning')], iDag), 12, 'forlegning'), 1)
sjekk('ett bestått: trygg', nivaaFor(byggProfil([q({})], [blg(12, 'forlegning')], iDag), 12, 'forlegning'), 2)
sjekk('tre bestått nylig: sterk',
  nivaaFor(byggProfil([q({ besvart: '2026-09-20' }), q({ besvart: '2026-09-22' }), q({ besvart: '2026-09-25' })], [], iDag), 12, 'forlegning'), 3)
sjekk('nylig bom holder på grunnleggende selv med gamle bestått',
  nivaaFor(byggProfil([q({ besvart: '2026-06-01' }), q({ besvart: '2026-06-10' }), q({ besvart: '2026-06-20' }),
    q({ vurdering: 'stroket', besvart: '2026-09-20' })], [], iDag), 12, 'forlegning'), 1)
sjekk('bestått etter bommet løfter igjen',
  nivaaFor(byggProfil([q({ vurdering: 'stroket', besvart: '2026-09-15' }), q({ besvart: '2026-09-20' }), q({ besvart: '2026-09-24' })], [], iDag), 12, 'forlegning'), 2)
sjekk('gamle svar teller mindre enn nye (halveringstid)',
  byggProfil([q({ besvart: '2025-09-27' })], [], iDag)[0].poeng < byggProfil([q({ besvart: '2026-09-27' })], [], iDag)[0].poeng, true)
const pf = byggProfil([
  q({ maalNr: 8, delId: 'vern', vurdering: 'stroket', besvart: '2026-09-25' }),
  q({ maalNr: 13, delId: 'miljo' }),
], [blg(8, 'vern'), blg(13, 'miljo'), blg(12, 'forlegning'), blg(2, 'sjokk')], iDag)
sjekk('fokus: bom først, så aldri spurt, så resten',
  fokus(pf, 4).map(t => `${t.maalNr}/${t.delId}`), ['8/vern', '2/sjokk', '12/forlegning', '13/miljo'])
sjekk('fokus tar ikke med deler han aldri har vært borti i en logg',
  fokus(byggProfil([], [], iDag)).length, 0)
sjekk('fordelingen teller deler per nivå', fordeling(pf), { 0: 0, 1: 3, 2: 1, 3: 0 })

// Teoristien.
sjekk('hvert teoritema hører til en enhet', TEMAER.every(t => (ENHETER as readonly string[]).includes(t.enhet)), true)
sjekk('hvert teoritema peker på en del som finnes i læreplanen',
  TEMAER.filter(t => !finnMaal('ELE03-03', t.maalNr).deler.some(d => d.id === t.delId)).map(t => t.id), [])
sjekk('hvert NEK-punkt i teorien står i kartet',
  TEMAER.filter(t => t.nek && !nekOppslag(t.nek)).map(t => t.id), [])
sjekk('tema-id-ene er unike', new Set(TEMAER.map(t => t.id)).size, TEMAER.length)
sjekk('Ohms lov står først på stien', TEMAER[0].id, 'ohm')
sjekk('ukjent tema gir null', finnTema('finnes-ikke'), null)
const tq = (tema: string, vurdering: 'bestatt' | 'stroket', besvart: string) =>
  q({ loggId: null, tema, vurdering, besvart })
const tp = temaProfil([tq('ohm', 'bestatt', '2026-09-20'), tq('karakteristikk', 'stroket', '2026-09-25')], iDag)
sjekk('teori: ett bestått er trygg', tp.get('ohm')?.nivaa, 2)
sjekk('teori: nylig bom er grunnleggende', tp.get('karakteristikk')?.nivaa, 1)
const sti = TEMAER.map(t => t.id)
sjekk('stien sender deg til det du bommet på først', nesteTema(sti, tp), 'karakteristikk')
sjekk('uten bom: første tema du ikke har prøvd', nesteTema(sti, temaProfil([tq('ohm', 'bestatt', '2026-09-20')], iDag)), 'effekt')
sjekk('teorispørsmål dyttes med en gang (ingen jobb som må sette seg)',
  anbefaltDytt([q({ loggId: null, tema: 'ohm', runde: 2, besvart: null, vurdering: null, svar: null })], iDag)?.grunn, 'repetisjon')

// Malen styrer hva samtalen MÅ innom.
sjekk('loggmalen spør bare om hva han gjorde selv',
  gjennomgang({ instruks: 'Jobb i stua.', notater: [], bilderUtenNotat: 0, malKrav: std.sporOm }, []).igjen.map(g => g.punkt),
  ['utfort-selv'])

// Takten er en anbefaling, ikke en sperre.
sjekk('for tidlig sier hva som gaar tapt, men sperrer ikke',
  forTidlig(runde2, [runde1, runde2], '2026-09-13')?.includes('hvis du vil'), true)
sjekk('ingen advarsel naar den er moden',
  forTidlig(runde2, [runde1, runde2], '2026-09-16'), null)
sjekk('runde 1 er aldri for tidlig', forTidlig(runde1, [runde1], '2026-09-12'), null)

// Den andre slags svakhet: jobben er gjort, forstaaelsen mangler.
const bommet: Sporsmaal[] = [
  sp({ id: 'x1', maalNr: 13, delId: 'materiale', vurdering: 'stroket', besvart: '2026-08-01' }),
  sp({ id: 'x2', maalNr: 13, delId: 'materiale', vurdering: 'stroket', besvart: '2026-09-01' }),
  sp({ id: 'x3', maalNr: 12, delId: 'iz', vurdering: 'stroket', besvart: '2026-09-10' }),
  sp({ id: 'x4', maalNr: 12, delId: 'foringsvei', vurdering: 'bestatt', besvart: '2026-09-10' }),
]
sjekk('bestaatte svar er ikke svake temaer', svakeTemaer(bommet).length, 2)
sjekk('flest bom foerst',
  svakeTemaer(bommet)[0], { maalNr: 13, delId: 'materiale', bommet: 2, sistBommet: '2026-09-01' })
sjekk('repetisjon forfaller ikke med en gang',
  forfaltTilRepetisjon(svakeTemaer(bommet)[0], '2026-09-05'), false)
sjekk('repetisjon forfaller etter tre uker',
  forfaltTilRepetisjon(svakeTemaer(bommet)[0], '2026-09-25'), true)
sjekk('avstandene er tre dager og tre uker', [DAGER_TIL_RUNDE_2, DAGER_TIL_REPETISJON], [3, 21])

// ── Fasiten ─────────────────────────────────────────────────────────────────

const fasit = (over: Partial<Fasit> = {}): Fasit => ({
  tekst: 'PE foerst og fremst fordi kontinuiteten ikke skal avhenge av utstyr som kan fjernes.',
  nek: '543', ...over,
})

// «Kan inneholde feil» er pynt. Et sidetall er en handling.
sjekk('fasiten sier at den er laget av AI',
  etterprovLinje(fasit()).includes('laget av AI'), true)
sjekk('fasiten gir punkt OG sidetall naar den kan',
  etterprovLinje(fasit()), 'Dette er laget av AI og kan inneholde feil. Dobbeltsjekk i NEK 543, side 312.')
sjekk('ukjent punkt gir fortsatt punktet, bare uten side',
  etterprovLinje(fasit({ nek: '999' })), 'Dette er laget av AI og kan inneholde feil. Dobbeltsjekk i NEK 999.')
sjekk('uten NEK-punkt henvises det til et menneske',
  etterprovLinje(fasit({ nek: null })).includes('faglig leder'), true)

// ── NEK-kartet ──────────────────────────────────────────────────────────────

sjekk('kartet er festet til en utgave', UTGAVE, 'NEK 400:2026')
sjekk('ingen punkter gaar igjen', KART.length, new Set(KART.map(o => o.punkt)).size)
sjekk('alle punkter hoerer til en kjent hoveddel',
  KART.filter(o => !(o.del in HOVEDDELER)).map(o => o.punkt), [])
sjekk('alle punkter har sidetall', KART.filter(o => !o.side || o.side < 1).map(o => o.punkt), [])

// Sidetallene skal stige med nummereringen innenfor en del. Gjoer de ikke det,
// har jeg lest feil i innholdsfortegnelsen.
const femdelen = oppslagIDel('400-5')
sjekk('400-5 er sortert paa side', femdelen.map(o => o.side),
  [...femdelen.map(o => o.side)].sort((a, b) => a - b))
sjekk('boker aapner ikke paa side null', Math.min(...KART.map(o => o.side)) > 0, true)

sjekk('oppslag paa beskyttelsesledere peker paa side 312', finnOppslag('543')?.side, 312)
sjekk('byggestroem ligger i 400-7-704', finnOppslag('7-704')?.del, '400-7')
sjekk('ukjent punkt gir null', finnOppslag('999'), null)

// Utloeseren, ikke tittelen. Et kart som gjentar normtittelen hjelper ingen.
sjekk('hvert oppslag sier NAAR du slaar opp',
  KART.filter(o => o.naar.length < 25).map(o => o.punkt), [])

// 2026 omnummererte verifikasjonsdelen.
sjekk('gammel 61x-referanse fanges', erUtgaatt('NEK 400-6-61')?.ny, '400-6, avsnitt 6.4')
sjekk('gjeldende referanse er ikke utgaatt', erUtgaatt('NEK 400-5-52'), null)
sjekk('6.4 finnes i kartet, og er merket med omnummereringen',
  finnOppslag('6.4')?.naar.includes('61x'), true)

// ── Verving ─────────────────────────────────────────────────────────────────

const verv = (over: Partial<Verving> = {}): Verving => ({
  ververId: 'tormod', vervetId: 'kompis', valuta: 'utbetaling',
  forstBetalt: '2026-10-01', betalteMaaneder: 1, ...over,
})

// Uten en bekreftet foerste betaling lager noen fem kontoer paa en kveld.
sjekk('ingen beloenning foer foerste betaling er inne',
  belonning(verv({ forstBetalt: null, betalteMaaneder: 0 })).ore, 0)
sjekk('foerste maaned gir 50 kr', belonning(verv()).ore, 5000)
sjekk('tolv maaneder gir 50 + elleve x 25',
  belonning(verv({ betalteMaaneder: 12 })).ore, 5000 + 11 * 2500)

// Hans eget regnestykke: ti stykker over et aar.
const tiStykker = Array.from({ length: 10 }, (_, i) =>
  verv({ vervetId: `k${i}`, betalteMaaneder: 12 }))
sjekk('ti verv over et aar gir 3 250 kr',
  tiStykker.reduce((s, v) => s + belonning(v).ore, 0), 325000)

sjekk('logger er en egen valuta og gir ingen kroner',
  belonning(verv({ valuta: 'logger', betalteMaaneder: 12 })), { valuta: 'logger', ore: 0, logger: 13 })

// Avslag kan aldri gi penger tilbake.
sjekk('ti verv gir 250 i avslag paa 399', avslagForMaaned(25000, 39900), 25000)
sjekk('avslaget stopper paa abonnementsprisen', avslagForMaaned(60000, 39900), 39900)

// Varselet som skal komme foer januar, ikke i januar.
sjekk('grensa er tusen kroner', RAPPORTERINGSGRENSE_ORE, 100000)
sjekk('ti utbetalinger over et aar passerer grensa',
  rapporteringsvarsler(tiStykker)[0].overGrensen, true)
sjekk('én verving i én maaned gjoer det ikke',
  rapporteringsvarsler([verv()])[0].overGrensen, false)
sjekk('avslag og logger utloeser ingen rapportering',
  rapporteringsvarsler([
    verv({ valuta: 'avslag', betalteMaaneder: 12 }),
    verv({ valuta: 'logger', betalteMaaneder: 12 }),
  ]), [])

// ── Avhoerslista ────────────────────────────────────────────────────────────

const tilstand = (over: Partial<Tilstand> = {}): Tilstand => ({
  instruks: 'Trakk LiHCH til automasjonsfeltet sammen med Vetle.',
  innhold: null, bilderUtenNotat: 0, besvart: [],
  nevnerMaaling: false, nevnerKabel: false, ...over,
})

// Det viktigste spoersmaalet i hele produktet: hva gjorde du SELV?
sjekk('«hva gjorde du selv» spoerres alltid',
  gjenstaaende(tilstand()).includes('utfort-selv'), true)
sjekk('spoerres ikke to ganger',
  gjenstaaende(tilstand({ besvart: ['utfort-selv'] })).includes('utfort-selv'), false)

// Faa spoersmaal: ingen lærling vil bruke tid paa en logg (Tormod 27.09.2026).
sjekk('maaling, kabeltype og mestring spoerres IKKE foer loggen',
  gjenstaaende(tilstand({ nevnerMaaling: true, nevnerKabel: true })).filter(p => p !== 'utfort-selv'), [])
sjekk('bilder uten notat plukkes opp',
  gjenstaaende(tilstand({ bilderUtenNotat: 2 })).includes('bilde-uten-notat'), true)
sjekk('en mal kan kreve et punkt uttrykkelig',
  gjenstaaende(tilstand({ malKrav: ['risiko'] })).includes('risiko'), true)
sjekk('ferdig naar han har sagt hva han gjorde selv',
  erFerdig(tilstand({ besvart: ['utfort-selv'] })), true)
sjekk('bildespoersmaalet spoer hva han ville faa med, ikke hva det viser',
  SPORSMAAL['bilde-uten-notat'].includes('få med på bildet'), true)
sjekk('spoersmaalet om maaling sier hvorfor',
  SPORSMAAL['hva-ble-maalt'].includes('ikke sluttkontroll'), true)

// Formuleringer som skjuler hvem som gjorde hva, eller paastaar mer enn han kan staa for.
sjekk('passiv «det ble kontrollert at» fanges',
  finnForbudte('Det ble kontrollert at leddene satt godt sammen.').length, 1)
sjekk('«ble ikke maalt» fanges — usikkerhet er ikke et nei',
  finnForbudte('Isolasjonen ble ikke målt.')[0].hvorfor.includes('husker ikke'), true)
sjekk('ordet sluttkontroll flagges for ettersyn',
  finnForbudte('Vi tok en sluttkontroll etterpå.').length, 1)
sjekk('en ryddig setning gaar gjennom',
  finnForbudte('Selve stigen monterte jeg ikke, men jeg la kabelen på den.'), [])

console.log('')
if (feil > 0) {
  console.error(`${feil} sjekk(er) feilet.`)
  process.exit(1)
}
console.log('Alle sjekker passerte.')

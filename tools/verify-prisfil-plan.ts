/**
 * Selvtest for prisfilplanen — det kontoret skriver til Supabase når en
 * grossistfil importeres.
 *
 *   npm run verify:prisfil-plan
 *
 * Dette er pengelogikk: kostprisen som settes her er den dekningsbidraget
 * regnes fra, og utsalgsprisen er den kunden faktisk faktureres for. Feil her
 * er ikke en visuell feil, den er en faktura.
 *
 * Selve skrivingen (`desktop/src/lib/prisfil-lager.ts`) har ingen test — den
 * er upsert og nettverk, og har ingen regning i seg. Det er derfor delingen
 * går akkurat der den går.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseEfoNelfo, type ParseResultat } from '../lib/pricefile/efo-nelfo'
import {
  elnumreIFil,
  planleggImport,
  type EksisterendePris,
  type EksisterendeVare,
  type ImportValg,
  type PlanKontekst,
} from '../lib/pricefile/plan'

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

const FIRMA = '00000000-0000-0000-0000-0000000000c0'
const BRUKER = '00000000-0000-0000-0000-0000000000b0'
const NAA = new Date('2026-08-21T10:00:00.000Z')

/** Teller i stedet for uuid, så planen er sammenlignbar mellom kjøringer. */
function ktx(): PlanKontekst {
  let n = 0
  return { companyId: FIRMA, brukerId: BRUKER, nyId: () => `ny-${++n}`, naa: NAA }
}

function valg(over: Partial<ImportValg> = {}): ImportValg {
  return { grossist: 'Onninen', ...over }
}

const tekst = readFileSync(join(process.cwd(), 'lib', 'pricefile', 'fixture', 'V4_eksempel.txt'), 'latin1')
const fil = parseEfoNelfo(tekst)

const PFXP = '1234567'
const STIKK = '7654321'
const BOKS = '1112223'

function vare(plan: ReturnType<typeof planleggImport>, elnr: string) {
  const v = plan.varer.find(x => x.elnummer === elnr)
  if (!v) throw new Error(`fant ikke vare ${elnr} i planen`)
  return v
}

function pris(plan: ReturnType<typeof planleggImport>, elnr: string) {
  const p = plan.priser.find(x => x.elnummer === elnr)
  if (!p) throw new Error(`fant ikke prisrad ${elnr} i planen`)
  return p
}

// ── Tomt kartotek ───────────────────────────────────────────────────────────

const tom = planleggImport(fil, valg(), [], [], ktx())

// EAN-varen i fixturen (varemerke 2) er IKKE med: `elnummer()` slipper bare
// varemerke 1 gjennom, og den grensen deles med montørappens import.
sjekk('varene med el-nummer blir med', tom.varer.length, 3)
sjekk('like mange prisrader som varer — én per (vare, grossist)', tom.priser.length, tom.varer.length)
sjekk('alt er nytt i et tomt kartotek', tom.resultat.nye, 3)
sjekk('ingenting oppdateres i et tomt kartotek', tom.resultat.oppdaterte, 0)
sjekk('EAN-varen telles som uten el-nummer', tom.resultat.utenElnummer, 1)

// V4 er grossistens fulle sortiment til LISTEPRIS. Hver eneste linje skal
// flagges, ellers regnes dekningsbidraget på en pris firmaet aldri betaler.
sjekk('hele V4-fila er listepris', tom.resultat.listepriser, 3)

sjekk('nettopris 20,50 blir kostpris når ingen andre priser finnes', vare(tom, PFXP).cost_price, 20.5)
sjekk('uten påslag settes utsalg lik kostpris på en NY vare', vare(tom, PFXP).unit_price, 20.5)
sjekk('bruttopris tas vare på for seg', pris(tom, PFXP).gross_price, 20.5)
sjekk('mva settes til høy på nye varer', vare(tom, PFXP).vat_type, 'hoy')
sjekk('inntektskonto settes på nye varer', vare(tom, PFXP).income_account, '3000')
sjekk('fabrikat leses fra VL-posten', vare(tom, PFXP).fabrikat, 'NEXANS')
sjekk('bilde leses fra VX-posten', vare(tom, PFXP).image_url, 'https://eksempel.no/bilder/1234567.jpg')
sjekk('salgspakning følger med på prisraden', pris(tom, PFXP).sales_pack, 100)
sjekk('lagerført J blir true', pris(tom, PFXP).stocked, true)
sjekk('ikke lagerført N blir false', pris(tom, BOKS).stocked, false)
sjekk('gyldighet fra hodeposten havner på prisraden', pris(tom, STIKK).valid_from, '2026-08-01T00:00:00.000Z')

// ── Kostpris er den BILLIGSTE kjente, ikke prisen i denne fila ───────────────

const solarNetto: EksisterendePris = {
  id: 'pris-solar', product_id: 'vare-pfxp', elnummer: PFXP, supplier: 'Solar',
  net_price: 25, price_type: 'netto', discount_percent: 30,
}
const pfxpFinnes: EksisterendeVare = { id: 'vare-pfxp', elnummer: PFXP, unit_price: 99, fabrikat: 'ABB' }

const medNetto = planleggImport(fil, valg(), [pfxpFinnes], [solarNetto], ktx())

// Det viktigste enkeltkravet i hele grossistsporet: en LISTEPRIS på 20,50 skal
// aldri slå en EKTE nettopris på 25,00. Et dekningsbidrag regnet på listepris
// er for lavt, og får en lønnsom jobb til å se ulønnsom ut.
sjekk('ekte nettopris slår listepris selv når listeprisen er lavere', vare(medNetto, PFXP).cost_price, 25)
sjekk('og grossisten på varen blir den vi faktisk kan kjøpe billigst hos', vare(medNetto, PFXP).supplier, 'Solar')
sjekk('vi er da ikke billigst på denne', medNetto.resultat.billigstHer, 2)
sjekk('varen telles som oppdatert, ikke ny', medNetto.resultat.oppdaterte, 1)
sjekk('varen beholder id-en sin', vare(medNetto, PFXP).id, 'vare-pfxp')
sjekk('prisraden vår er ny — Solars rad røres ikke', pris(medNetto, PFXP).supplier, 'Onninen')
sjekk('vår prisrad har fortsatt vår pris', pris(medNetto, PFXP).net_price, 20.5)

const solarListe: EksisterendePris = { ...solarNetto, id: 'pris-solar-liste', net_price: 18, price_type: 'brutto', discount_percent: null }
const kunListe = planleggImport(fil, valg(), [pfxpFinnes], [solarListe], ktx())
sjekk('mellom to listepriser vinner den laveste', vare(kunListe, PFXP).cost_price, 18)
sjekk('og da er ikke vi billigst', kunListe.resultat.billigstHer, 2)

// ── Utsalgsprisen røres ikke uten at noen har bedt om det ───────────────────

sjekk('en pris satt for hånd overskrives ikke uten påslagsregel', vare(medNetto, PFXP).unit_price, 99)

const medPaslag = planleggImport(fil, valg({ paslagProsent: 35 }), [pfxpFinnes], [], ktx())
sjekk('påslag 35 % på 20,50 blir 27,68', vare(medPaslag, PFXP).unit_price, 27.68)
sjekk('påslag overstyrer også en pris satt for hånd', vare(medPaslag, PFXP).unit_price !== 99, true)

// ── Varekortfelt tømmes aldri av en fil som mangler dem ─────────────────────

const boksFinnes: EksisterendeVare = {
  id: 'vare-boks', elnummer: BOKS, fabrikat: 'ABB', image_url: 'https://gammel/bilde.jpg',
  extra: JSON.stringify({ VEKT: '0.10', EGEN: 'x' }),
}
const beriket = planleggImport(fil, valg(), [boksFinnes], [], ktx())
sjekk('fila har ingen fabrikat på boksen — den vi hadde står', vare(beriket, BOKS).fabrikat, 'ABB')
sjekk('og bildet en annen grossist ga oss står også', vare(beriket, BOKS).image_url, 'https://gammel/bilde.jpg')
sjekk('boksen telles ikke som beriket', beriket.resultat.berikede, 2)

const pfxpMedEkstra: EksisterendeVare = { id: 'vare-pfxp', elnummer: PFXP, extra: JSON.stringify({ VEKT: '0.10', EGEN: 'x' }) }
const slaattSammen = planleggImport(fil, valg(), [pfxpMedEkstra], [], ktx())
sjekk(
  'ekstrafelt slås sammen — fila vinner på kollisjon, resten står',
  JSON.parse(vare(slaattSammen, PFXP).extra ?? '{}'),
  { VEKT: '0.145', EGEN: 'x', BILDE: 'https://eksempel.no/bilder/1234567.jpg' },
)

const ugyldig: EksisterendeVare = { id: 'vare-pfxp', elnummer: PFXP, extra: '{ ikke json' }
sjekk(
  'ugyldig JSON i basen stopper ikke en import av femti tusen varer',
  JSON.parse(planleggImport(fil, valg(), [ugyldig], [], ktx()).varer.find(v => v.elnummer === PFXP)?.extra ?? '{}'),
  { BILDE: 'https://eksempel.no/bilder/1234567.jpg', VEKT: '0.145' },
)

// ── Samme fil to ganger duplisererer ingenting ──────────────────────────────

const eksisterendeVarer: EksisterendeVare[] = tom.varer.map(v => ({ ...v }))
const eksisterendePriser: EksisterendePris[] = tom.priser.map(p => ({
  id: p.id, product_id: p.product_id, elnummer: p.elnummer, supplier: p.supplier,
  net_price: p.net_price, price_type: p.price_type, discount_percent: p.discount_percent,
}))
const igjen = planleggImport(fil, valg(), eksisterendeVarer, eksisterendePriser, ktx())

sjekk('andre kjøring lager ingen nye varer', igjen.resultat.nye, 0)
sjekk('andre kjøring oppdaterer alle', igjen.resultat.oppdaterte, 3)
sjekk('vare-id-ene er de samme', igjen.varer.map(v => v.id), tom.varer.map(v => v.id))
sjekk('prisrad-id-ene er de samme — upsert, ikke insert', igjen.priser.map(p => p.id), tom.priser.map(p => p.id))

// ── Utgåtte varer ───────────────────────────────────────────────────────────

const medUtgaatt: ParseResultat = {
  ...fil,
  varer: fil.varer.map(v => (v.vareNr === BOKS ? { ...v, status: 'utgaar' as const } : v)),
}
const uten = planleggImport(medUtgaatt, valg(), [], [], ktx())
sjekk('utgåtte varer hoppes over som standard', uten.resultat.utgaatte, 1)
sjekk('og de er ikke med i planen', uten.varer.some(v => v.elnummer === BOKS), false)

const med = planleggImport(medUtgaatt, valg({ inkluderUtgaatte: true }), [], [], ktx())
sjekk('med flagget settes de inn', med.varer.some(v => v.elnummer === BOKS), true)
sjekk('men prisraden merkes utgått, så ingen bestiller dem', pris(med, BOKS).discontinued, true)

// ── Oppslagslista importen henter på ────────────────────────────────────────

sjekk('el-numrene som skal slås opp er de samme som planen rører', elnumreIFil(fil, valg()).sort(), tom.varer.map(v => v.elnummer).sort())
sjekk('utgåtte er ikke med i oppslaget når de hoppes over', elnumreIFil(medUtgaatt, valg()).includes(BOKS), false)

// ── Kilde ───────────────────────────────────────────────────────────────────

const demo = planleggImport(fil, valg({ kilde: 'demo' }), [], [], ktx())
sjekk('kilde merkes på varen, så oppdiktede priser kan fjernes igjen', vare(demo, PFXP).source_system, 'demo')

console.log(feil === 0 ? '\nAlle påstander holder.' : `\n${feil} påstander feilet.`)
process.exit(feil === 0 ? 0 : 1)

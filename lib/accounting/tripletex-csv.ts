import type { Fakturagrunnlag } from '../invoicing'
import { MVA_TRIPLETEX } from './adapter'

/**
 * Fakturaeksport som FIL, ikke som API-kall.
 *
 * ── Hvorfor ────────────────────────────────────────────────────────────────
 *
 * Tripletex' utviklervilkår gjelder API-tilgang. En fil regnskapsføreren
 * importerer rører aldri API-et, og da finnes hverken §2.2.13 (skriftlig
 * AI-samtykke før produksjonstilgang), §2.2.9 (de kan pålegge priser og sperre
 * endepunkter etter eget skjønn), eller den løpende innsikten en KONKURRENT
 * ellers får i kundetallet vårt — Tripletex Elektro/VVS er konkurrenten, ikke
 * bare leverandøren (`docs/REGNSKAPSINTEGRASJON.md`).
 *
 * Fila virker dessuten overalt: Fiken, PowerOffice, eller en regnskapsfører som
 * bytter system neste år. CSV er CSV. `Regnskapsadapter` (API-veien) står
 * uendret ved siden av — dette er en vei TIL, ikke en erstatning.
 *
 * ── Hvorfor CSV og ikke Excel ──────────────────────────────────────────────
 *
 * Tripletex tar imot begge, men advarer selv om Excel:
 *
 *   «Excel importerer noen ganger datoer som tall som Tripletex ikke kan tolke
 *   riktig.»
 *
 * En dato som blir 45678 er en faktura med feil forfallsdato, og det oppdages
 * når kunden ikke betaler. CSV har ikke det problemet — teksten er teksten.
 *
 * ── Formatet ───────────────────────────────────────────────────────────────
 *
 * Kolonnene og navnene er Tripletex' egne, fra «Fakturaimport – beskrivelse av
 * kolonner». Én rad per ORDRELINJE; fakturafeltene gjentas på hver rad i samme
 * faktura, som i deres eksempelfil.
 *
 * Rene funksjoner, ingen I/O. Selvtestet i `npm run verify:tripletex-csv`.
 */

/** Kolonnene vi skriver, i Tripletex' egen rekkefølge. Obligatoriske først. */
export const KOLONNER = [
  'INVOICE NO',
  'INVOICE DATE',
  'DUE DATE',
  'ORDER NO',
  'ORDER DATE',
  'CUSTOMER NO',
  'CUSTOMER NAME',
  'ORGANIZATION NO',
  'CUSTOMER EMAIL',
  'CUSTOMER PHONE',
  'POSTAL ADDR - LINE 1',
  'POSTAL ADDR - POSTAL NO',
  'POSTAL ADDR - CITY',
  'DELIVERY ADDR - LINE 1',
  'PROJECT NO',
  'PROJECT NAME',
  'COMMENTS',
  'ORDER LINE - DESCRIPTION',
  'ORDER LINE - UNIT PRICE',
  'ORDER LINE - COUNT',
  'ORDER LINE - DISCOUNT',
  'ORDER LINE - VAT CODE',
] as const

export type Fakturakunde = {
  /** Kundenummer i regnskapssystemet, om det finnes. Ellers matches på navn/org.nr. */
  nummer?: string | null
  navn: string
  orgnr?: string | null
  epost?: string | null
  telefon?: string | null
  adresse?: string | null
  postnummer?: string | null
  poststed?: string | null
}

export type Fakturarad = {
  /** Fra `nummerserier`-serien 'faktura'. Aldri gjenbrukt, aldri under startpunktet. */
  fakturanummer: number
  fakturadato: Date
  forfallsdato: Date
  ordrenummer: number | null
  ordredato: Date
  kunde: Fakturakunde
  /** Adressen jobben ble utført på — ofte en annen enn kundens fakturaadresse. */
  leveringsadresse?: string | null
  prosjektnavn?: string | null
  kommentar?: string | null
  grunnlag: Fakturagrunnlag
}

/** ISO-dato, som Tripletex krever: `YYYY-MM-DD`. */
export function isoDato(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Øre (heltall) → beløp med to desimaler.
 *
 * Punktum som desimalskilletegn, ikke komma. Med semikolon som feltskille ville
 * komma vært trygt — men punktum er trygt i BEGGE varianter, og en fil som
 * tåler at noen bytter skilletegn er en fil færre som kommer i retur.
 *
 * Egen funksjon og ikke `/100` på kallstedet: en manglende divisjon ett sted er
 * en faktura hundre ganger for høy.
 */
export function belop(ore: number): string {
  return (Math.round(ore) / 100).toFixed(2)
}

/**
 * Ett felt, klart for CSV.
 *
 * ── Formelinjeksjon ────────────────────────────────────────────────────────
 *
 * Et felt som begynner med `=`, `+`, `-` eller `@` tolkes som en FORMEL når
 * fila åpnes i Excel eller Sheets. En kunde som heter «=cmd|…» er en angrepsvei
 * mot regnskapsføreren som åpner fila for å se over den før import. Feltet
 * prefikses derfor med apostrof, som er den etablerte nøytraliseringen.
 *
 * Dette er ikke teoretisk paranoia: kundenavn og linjebeskrivelser kommer fra
 * fritekst en montør har skrevet i felt.
 */
export function felt(v: unknown, skille = ';'): string {
  let s = String(v ?? '')

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`

  const maaSiteres = s.includes(skille) || s.includes('"') || s.includes('\n') || s.includes('\r')
  return maaSiteres ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Bygger CSV-en for én eller flere fakturaer.
 *
 * Én rad per ordrelinje. Fakturafeltene gjentas på hver rad i samme faktura —
 * det er slik Tripletex' egen eksempelfil er bygget, og det er derfor
 * `INVOICE NO` er nøkkelen som binder radene sammen.
 *
 * `skille` er semikolon som standard, som er norsk konvensjon og det Excel på
 * norsk oppsett forventer. **Verifiser mot Tripletex' egen eksempelfil før
 * første ekte import** — den lastes ned fra «Faktura > Import/eksport >
 * Fakturaimport», og er fasiten på skilletegnet.
 */
export function byggFakturaCsv(fakturaer: Fakturarad[], skille = ';'): string {
  const linjer: string[] = [KOLONNER.join(skille)]

  for (const f of fakturaer) {
    for (const l of f.grunnlag.linjer) {
      const rad: Record<(typeof KOLONNER)[number], unknown> = {
        'INVOICE NO': f.fakturanummer,
        'INVOICE DATE': isoDato(f.fakturadato),
        'DUE DATE': isoDato(f.forfallsdato),
        'ORDER NO': f.ordrenummer ?? '',
        'ORDER DATE': isoDato(f.ordredato),
        'CUSTOMER NO': f.kunde.nummer ?? '',
        'CUSTOMER NAME': f.kunde.navn,
        'ORGANIZATION NO': f.kunde.orgnr ?? '',
        'CUSTOMER EMAIL': f.kunde.epost ?? '',
        'CUSTOMER PHONE': f.kunde.telefon ?? '',
        'POSTAL ADDR - LINE 1': f.kunde.adresse ?? '',
        'POSTAL ADDR - POSTAL NO': f.kunde.postnummer ?? '',
        'POSTAL ADDR - CITY': f.kunde.poststed ?? '',
        'DELIVERY ADDR - LINE 1': f.leveringsadresse ?? '',
        // Prosjektet opprettes av Tripletex hvis det ikke finnes. Vi sender
        // navnet, ikke et nummer: nummeret er deres, ikke vårt.
        'PROJECT NO': '',
        'PROJECT NAME': f.prosjektnavn ?? '',
        'COMMENTS': f.kommentar ?? '',
        'ORDER LINE - DESCRIPTION': l.beskrivelse,
        // Enhetspris er HELE linjebeløpet og antall er 1. Antallet står
        // allerede i beskrivelsen fra `lib/invoicing.ts`, og å sende det som
        // count ville betydd at Tripletex ganger opp på nytt — samme tall to
        // steder er ett sted for mye når det gjelder penger.
        'ORDER LINE - UNIT PRICE': belop(l.nettoOre),
        'ORDER LINE - COUNT': 1,
        // Rabatten er ALLEREDE trukket fra i nettoOre (lib/invoicing.ts).
        // Sendes den også her, trekkes den to ganger.
        'ORDER LINE - DISCOUNT': 0,
        'ORDER LINE - VAT CODE': MVA_TRIPLETEX[l.mva],
      }
      linjer.push(KOLONNER.map(k => felt(rad[k], skille)).join(skille))
    }
  }

  // CRLF: Excel på Windows er den vanligste leseren, og LF alene gir én lang
  // linje der. Tripletex tåler begge.
  return linjer.join('\r\n') + '\r\n'
}

/**
 * Filnavnet regnskapsføreren ser i nedlastingsmappa.
 *
 * Firmanavn og periode, ikke en uuid: hun får denne på e-post ved siden av tre
 * andre filer, og skal kunne se hvilken som er hvilken uten å åpne dem.
 */
export function filnavn(firma: string, fra: Date, til: Date): string {
  const rent = firma.replace(/[^\wæøåÆØÅ -]/g, '').trim().replace(/\s+/g, '-')
  return `${rent}-faktura-${isoDato(fra)}-til-${isoDato(til)}.csv`
}

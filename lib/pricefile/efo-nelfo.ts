/**
 * EFO/NELFO Vareformat / Pristilbud versjon 4.0 — parser.
 *
 * Dette er kanalen grossistene allerede bruker for å sende vare- og prisdata til
 * kundenes innkjøpssystemer (Elektroskandia, Solar, Onninen). Filen kommer som del
 * av kundeforholdet, så bedriften betaler ikke noe ekstra for den — og den
 * inneholder KUNDENS egne fremforhandlede priser, som EFObasen ikke har.
 *
 * Format (spec E-NVare4.0r4, rev. 2010-11-25):
 *   - semikolonseparert tekst, variabel postlengde
 *   - tegnsett Windows ANSI (CP1252) eller ISO 8859-1 — IKKE UTF-8
 *   - poster skilles med CR+LF
 *   - semikolon er forbudt inne i felt, så naiv splitting er trygt
 *   - filnavn: V4* = varefil, P4* = pristilbud
 *
 * Posttyper:
 *   VH/PH  hodepost (én, første linje) — selger, kjøper, gyldighet, valuta
 *   VL/PL  linjepost — én per vare
 *   VX/PX  tilleggsinformasjon til forrige linjepost (bilde, FDV, HMS, vekt …)
 *   VA/PA  alternativer til forrige linjepost (erstatningsvare, pakningsstørrelse)
 *
 * FALLGRUVEN: flere tallfelt har IMPLISITTE desimaler — desimaltegn skrives ikke.
 * `Pris` har 2 (2050 = kr 20,50), `Mengde` og `SalgsPakning` har 4 (25500 = 2,55).
 * Leses de som heltall blir prisen 100× for høy. Se `implisitteDesimaler`.
 */

/** Hva `VareNr` faktisk er. El-nummer er nøkkelen som gjør varer sammenlignbare på tvers av grossister. */
export type VareMerke = 'ukjent' | 'elnummer' | 'ean' | 'produsent' | 'nrf' | 'tilleggsvare'

/** Enhet installasjonen måles i — ikke nødvendigvis samme som prisenheten. */
export type MaaleEnhet = 'stk' | 'm' | 'l' | 'kg' | 'ukjent'

/** Om prisen skal rabatteres videre etter avtale, eller allerede er netto. */
export type PrisType = 'brutto' | 'netto' | 'ukjent'

/** Endringsflagg fra grossisten. `utgaar` betyr at varen skal ut av sortimentet. */
export type VareStatus = 'uendret' | 'ny' | 'endret' | 'utgaar'

/** Rollen en alternativ-post har til linjeposten over seg. */
export type AlternativType = 'alternativ' | 'erstatning' | 'identifikasjon' | 'pakning' | 'ukjent'

export type Hodepost = {
  /** 'vare' = komplett sortiment (V4), 'pristilbud' = utvalg med kundepriser (P4) */
  filtype: 'vare' | 'pristilbud'
  selgerOrgnr: string
  kjoperOrgnr: string | null
  /** Kundenummeret hos grossisten — trengs i bestillingen senere. */
  kundeNr: string | null
  gyldigFra: Date | null
  gyldigTil: Date | null
  valuta: string
  avtaleId: string | null
  selgerNavn: string
}

export type Tilleggsinfo = {
  /** DIMENSJON, VEKT, FDV, HMS, BILDE, VOLUM, UNSPSC, EFOBASE, IE-* */
  feltId: string
  verdi: string
}

export type Alternativ = {
  merke: VareMerke
  vareNr: string
  type: AlternativType
  /** Antall prisenheter i denne pakningen. Null når posten ikke gjelder pakning. */
  salgspakning: number | null
}

export type Vare = {
  merke: VareMerke
  /** El-nummer når `merke === 'elnummer'`. Join-nøkkelen på tvers av grossister. */
  vareNr: string
  betegnelse: string
  /** Utfyllende varetekst. Slås sammen med `betegnelse` i `beskrivelse`. */
  betegnelse2: string | null
  /** Ferdig sammenslått tekst — det montøren skal høre i lesetilbakemeldingen. */
  beskrivelse: string
  maaleEnhet: MaaleEnhet
  /** UN CommonCode for enheten prisen gjelder per. */
  prisEnhet: string
  prisEnhetTekst: string | null
  /** Pris per `prisEnhet`, i kroner med desimaler oppløst. */
  pris: number
  /** Antall `maaleEnhet` som inngår i én `prisEnhet`. */
  mengde: number
  prisDato: Date | null
  status: VareStatus
  blokkNummer: string | null
  rabattGruppe: string | null
  fabrikat: string | null
  type: string | null
  /** true/false når grossisten oppgir det, null når koden ikke er i bruk. */
  lagerfoert: boolean | null
  /**
   * Antall prisenheter i minste normale bestillingsmengde.
   * Å bestille 100 av noe som kommer i pakker à 10 er den dyre klassikeren —
   * dette feltet er grunnen til at bestillingen kan avrundes riktig.
   */
  salgspakning: number | null
  /** Rabattprosent. Kun i pristilbud (PL). */
  rabatt: number | null
  prisType: PrisType
  /** Nettopris etter `rabatt`. Lik `pris` når prisen allerede er netto. */
  nettoPris: number
  tillegg: Tilleggsinfo[]
  alternativer: Alternativ[]
}

export type ParseResultat = {
  hode: Hodepost
  varer: Vare[]
  /** Linjer som ikke lot seg tolke. Tom liste = ren fil. */
  avvik: ParseAvvik[]
}

export type ParseAvvik = {
  /** 1-indeksert linjenummer i filen, så feilen kan slås opp manuelt. */
  linje: number
  grunn: string
  innhold: string
}

const VARE_MERKE: Record<string, VareMerke> = {
  '0': 'ukjent', '1': 'elnummer', '2': 'ean', '3': 'produsent', '4': 'nrf', '9': 'tilleggsvare',
}

const MAALE_ENHET: Record<string, MaaleEnhet> = {
  '1': 'stk', '2': 'm', '3': 'l', '4': 'kg',
}

const VARE_STATUS: Record<string, VareStatus> = {
  '0': 'uendret', '1': 'ny', '2': 'endret', '3': 'utgaar',
}

const ALTERNATIV_TYPE: Record<string, AlternativType> = {
  A: 'alternativ', E: 'erstatning', V: 'identifikasjon', P: 'pakning',
}

/**
 * Tall med implisitte desimaler: feltet inneholder sifrene uten desimaltegn, og
 * antall desimaler er gitt av formatet. `2050` med 2 desimaler er 20,50.
 *
 * Noen grossister skriver likevel et desimaltegn i praksis (komma eller punktum).
 * Er tegnet der, respekterer vi det heller enn å gange opp — å tolke «20.50» som
 * 2050 kroner ville vært verre enn å avvike fra spec.
 */
function implisitteDesimaler(raa: string, desimaler: number): number | null {
  const s = raa.trim()
  if (!s) return null
  if (s.includes(',') || s.includes('.')) {
    const n = Number(s.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  const negativ = s.startsWith('-')
  const sifre = negativ ? s.slice(1) : s
  if (!/^\d+$/.test(sifre)) return null
  const n = Number(sifre) / 10 ** desimaler
  return negativ ? -n : n
}

/**
 * ÅÅÅÅMMDD → Date. Ugyldig eller tom verdi gir null i stedet for Invalid Date.
 *
 * Bygges i UTC med vilje: dette er en kalenderdato (avtalen gjelder fra 1. august),
 * ikke et tidspunkt. Med lokal midnatt ville «20260801» blitt 31. juli så snart
 * enheten står øst for Greenwich — og gyldighetsvinduet ville forskjøvet seg med
 * telefonens tidssone.
 */
function parseDato(raa: string): Date | null {
  const s = raa.trim()
  if (!/^\d{8}$/.test(s)) return null
  const aar = Number(s.slice(0, 4))
  const maaned = Number(s.slice(4, 6))
  const dag = Number(s.slice(6, 8))
  if (maaned < 1 || maaned > 12 || dag < 1 || dag > 31) return null
  const d = new Date(Date.UTC(aar, maaned - 1, dag))
  // Rullerte datoen over (31. februar), var den ikke gyldig likevel.
  return d.getUTCMonth() === maaned - 1 && d.getUTCDate() === dag ? d : null
}

function tekst(felt: string[], i: number): string {
  return (felt[i] ?? '').trim()
}

function tekstEllerNull(felt: string[], i: number): string | null {
  const v = tekst(felt, i)
  return v.length > 0 ? v : null
}

/**
 * Dekoder bytes som CP1252/ISO-8859-1. Filene er ANSI, ikke UTF-8 — leses de som
 * UTF-8 blir «Ø» og «å» til erstatningstegn midt i varetekstene.
 *
 * CP1252 og ISO 8859-1 er like fra 0xA0 og opp, som dekker norske tegn. Forskjellen
 * ligger i 0x80–0x9F, der CP1252 har typografiske tegn — dem tar `windows-1252` når
 * plattformen støtter den, ellers faller vi tilbake på latin1.
 */
export function dekodAnsi(bytes: Uint8Array): string {
  try {
    return new TextDecoder('windows-1252').decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

/**
 * Parser en hel varefil eller pristilbudsfil.
 *
 * Er kildeteksten lest fra bytes, bruk `dekodAnsi` først — ikke `toString('utf8')`.
 */
/**
 * Base64 → bytes, uten Buffer og uten å stole på at `atob` finnes i runtime.
 *
 * Telefonen leser fila som base64 (expo-file-system). Fila er CP1252, ikke
 * UTF-8, så den MÅ igjennom `dekodAnsi` som bytes. Leses den som tekst blir
 * æ, ø og å ødelagt i hvert eneste varenavn — og det oppdages først når noen
 * leter etter «Vernebryter».
 */
export function base64TilBytes(b64: string): Uint8Array {
  const tegn = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const rent = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const ut = new Uint8Array(Math.floor((rent.length * 3) / 4))
  let p = 0
  for (let i = 0; i < rent.length; i += 4) {
    const n = (tegn.indexOf(rent[i]) << 18)
      | (tegn.indexOf(rent[i + 1]) << 12)
      | ((tegn.indexOf(rent[i + 2]) & 63) << 6)
      | (tegn.indexOf(rent[i + 3]) & 63)
    ut[p++] = (n >> 16) & 255
    if (i + 2 < rent.length) ut[p++] = (n >> 8) & 255
    if (i + 3 < rent.length) ut[p++] = n & 255
  }
  return ut.subarray(0, p)
}

export function parseEfoNelfo(innhold: string): ParseResultat {
  // Godtar både CRLF (spec) og LF, siden filer ofte har vært innom et Unix-ledd.
  const linjer = innhold.split(/\r\n|\n|\r/)
  const avvik: ParseAvvik[] = []
  const varer: Vare[] = []
  let hode: Hodepost | null = null

  for (let i = 0; i < linjer.length; i++) {
    const raa = linjer[i]
    if (!raa || raa.trim().length === 0) continue

    const felt = raa.split(';')
    const type = tekst(felt, 0).toUpperCase()

    switch (type) {
      case 'VH':
      case 'PH': {
        if (hode) {
          avvik.push({ linje: i + 1, grunn: 'flere hodeposter — kun den første brukes', innhold: raa })
          break
        }
        const format = tekst(felt, 1).toUpperCase()
        if (format && format !== 'EFONELFO') {
          avvik.push({ linje: i + 1, grunn: `ukjent format «${format}»`, innhold: raa })
        }
        hode = {
          filtype: type === 'VH' ? 'vare' : 'pristilbud',
          selgerOrgnr: tekst(felt, 3),
          kjoperOrgnr: tekstEllerNull(felt, 4),
          kundeNr: tekstEllerNull(felt, 5),
          gyldigFra: parseDato(tekst(felt, 6)),
          gyldigTil: parseDato(tekst(felt, 7)),
          valuta: tekst(felt, 8) || 'NOK',
          avtaleId: tekstEllerNull(felt, 9),
          selgerNavn: tekst(felt, 10),
        }
        break
      }

      case 'VL':
      case 'PL': {
        const vareNr = tekst(felt, 2)
        const pris = implisitteDesimaler(tekst(felt, 8), 2)
        if (!vareNr) {
          avvik.push({ linje: i + 1, grunn: 'linjepost uten varenummer', innhold: raa })
          break
        }
        if (pris === null) {
          avvik.push({ linje: i + 1, grunn: 'linjepost uten tolkbar pris', innhold: raa })
          break
        }
        const betegnelse = tekst(felt, 3)
        const betegnelse2 = tekstEllerNull(felt, 4)
        const lagerRaa = tekst(felt, 16).toUpperCase()
        const rabatt = implisitteDesimaler(tekst(felt, 18), 2)
        const prisTypeRaa = tekst(felt, 19).toUpperCase()
        const prisType: PrisType =
          prisTypeRaa === 'B' ? 'brutto' : prisTypeRaa === 'N' ? 'netto' : 'ukjent'

        varer.push({
          merke: VARE_MERKE[tekst(felt, 1)] ?? 'ukjent',
          vareNr,
          betegnelse,
          betegnelse2,
          beskrivelse: [betegnelse, betegnelse2].filter(Boolean).join(' '),
          maaleEnhet: MAALE_ENHET[tekst(felt, 5)] ?? 'ukjent',
          prisEnhet: tekst(felt, 6),
          prisEnhetTekst: tekstEllerNull(felt, 7),
          pris,
          mengde: implisitteDesimaler(tekst(felt, 9), 4) ?? 1,
          prisDato: parseDato(tekst(felt, 10)),
          status: VARE_STATUS[tekst(felt, 11)] ?? 'uendret',
          blokkNummer: tekstEllerNull(felt, 12),
          rabattGruppe: tekstEllerNull(felt, 13),
          fabrikat: tekstEllerNull(felt, 14),
          type: tekstEllerNull(felt, 15),
          lagerfoert: lagerRaa === 'J' ? true : lagerRaa === 'N' ? false : null,
          salgspakning: implisitteDesimaler(tekst(felt, 17), 4),
          rabatt,
          prisType,
          // Rabatt gjelder kun pristilbud. Er prisen allerede netto, skal den stå.
          nettoPris: prisType === 'brutto' && rabatt ? rund2(pris * (1 - rabatt / 100)) : pris,
          tillegg: [],
          alternativer: [],
        })
        break
      }

      case 'VX':
      case 'PX': {
        const forrige = varer[varer.length - 1]
        if (!forrige) {
          avvik.push({ linje: i + 1, grunn: 'tilleggsinfo uten linjepost over', innhold: raa })
          break
        }
        const feltId = tekst(felt, 1)
        if (!feltId) {
          avvik.push({ linje: i + 1, grunn: 'tilleggsinfo uten FELTID', innhold: raa })
          break
        }
        forrige.tillegg.push({ feltId: feltId.toUpperCase(), verdi: tekst(felt, 2) })
        break
      }

      case 'VA':
      case 'PA': {
        const forrige = varer[varer.length - 1]
        if (!forrige) {
          avvik.push({ linje: i + 1, grunn: 'alternativ uten linjepost over', innhold: raa })
          break
        }
        forrige.alternativer.push({
          merke: VARE_MERKE[tekst(felt, 1)] ?? 'ukjent',
          vareNr: tekst(felt, 2),
          type: ALTERNATIV_TYPE[tekst(felt, 3).toUpperCase()] ?? 'ukjent',
          salgspakning: implisitteDesimaler(tekst(felt, 4), 4),
        })
        break
      }

      default:
        avvik.push({ linje: i + 1, grunn: `ukjent posttype «${type}»`, innhold: raa })
    }
  }

  if (!hode) {
    throw new Error('Ingen hodepost (VH/PH) funnet — filen er ikke EFO/NELFO 4.0.')
  }

  return { hode, varer, avvik }
}

function rund2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Minste bestillbare antall som dekker `oensket`, avrundet opp til hel salgspakning.
 *
 * Uten dette bestiller man 100 stk av noe som leveres i pakker à 10 og får enten
 * avvist ordre eller 10 pakker man ikke ba om. Returnerer også pakningen som ble
 * brukt, så lesetilbakemeldingen kan si «5 pakker à 10 = 50 stk».
 */
export function rundTilPakning(oensket: number, vare: Pick<Vare, 'salgspakning'>): {
  antall: number
  pakninger: number | null
  pakningsstoerrelse: number | null
} {
  const p = vare.salgspakning
  if (!p || p <= 0) return { antall: oensket, pakninger: null, pakningsstoerrelse: null }
  const pakninger = Math.ceil(oensket / p)
  return { antall: rund2(pakninger * p), pakninger, pakningsstoerrelse: p }
}

/** El-nummer er join-nøkkelen mellom grossister. Varer uten det kan ikke sammenlignes. */
export function elnummer(vare: Vare): string | null {
  return vare.merke === 'elnummer' ? vare.vareNr : null
}

import { sha256Hex } from './sha256'

/**
 * Arkivpakken — den frosne kopien av en ferdig jobb.
 *
 * **Determinisme er hele poenget.** Samme jobb må gi nøyaktig samme bytes, og
 * dermed samme hash, uansett hvem som fryser den og når. Derfor:
 *
 *   - Nøklene sorteres alfabetisk før serialisering. `JSON.stringify` følger
 *     innsettingsrekkefølgen, og den varierer med hvordan raden ble bygget.
 *   - INGEN «generert klokken»-felt inne i pakken. Et tidsstempel i innholdet
 *     ville gitt ny hash hver gang, og da beviser hashen ingenting.
 *     `frosset_at` ligger i databaseraden, utenfor det som hashes.
 *   - Datoer skrives som ISO-8601 i UTC. Lokal tid ville gitt to forskjellige
 *     pakker for samme jobb avhengig av telefonens tidssone.
 *
 * Rene funksjoner, ingen database — selvtestet i `npm run verify:arkiv`.
 */

export type ArkivOrdre = {
  ordrenummer: number | null
  tittel: string
  beskrivelse: string | null
  status: string
  adresse: string | null
  opprettet: Date
  fakturert: Date | null
}

export type ArkivKunde = {
  navn: string | null
  orgnr: string | null
  epost: string | null
  telefon: string | null
  adresse: string | null
}

export type ArkivLinje = {
  beskrivelse: string
  antall: number
  enhet: string
  elnummer?: string | null
  enhetspris?: number | null
  /**
   * Avtalt rabatt. Uten den ganger ikke antall × enhetspris opp til det kunden
   * faktisk betalte, og en pakke som skal avgjøre en tvist om nettopp beløpet
   * ville pekt på feil tall.
   */
  rabattProsent?: number | null
}

export type ArkivTime = {
  dato: Date
  timer: number
  person: string
  aktivitet?: string | null
  notat?: string | null
}

/**
 * Ett utfylt punkt: SPØRSMÅLET og svaret, sammen.
 *
 * Grunnen til at spørsmålet må ligge i pakken og ikke bare nøkkelen: et
 * firmaskjema er importert eller skrevet av kunden selv, og ordlyden finnes
 * KUN i `form_template_revisions`. Om syv år skal denne pakken kunne bevise hva
 * som ble kontrollert, uten appen, uten databasen, uten oss. «12» er ikke et
 * bevis. «Målt isolasjonsresistans: 12 MΩ» er det.
 */
export type ArkivDokumentpunkt = {
  nokkel: string
  sporsmal: string
  type: string
  enhet?: string | null
  /** For klikklister: hva man KUNNE svart. Uten den er «Nei» uten kontekst. */
  alternativer?: string[] | null
  svar: unknown
}

export type ArkivDokument = {
  mal: string
  /** Malens navn slik det sto da dokumentet ble frosset. */
  malnavn: string
  /** Versjonen dokumentet ble FYLT mot. */
  malversjon: number
  /**
   * Versjonen vi faktisk fant ordlyden i. Er den ulik `malversjon`, eller null,
   * står det HER i stedet for å skjules — en pakke som later som den er
   * fullstendig er verre enn en som sier hva den mangler.
   */
  malversjonLest: number | null
  status: string
  fullfortAv?: string | null
  fullfortTid?: Date | null
  punkter: ArkivDokumentpunkt[]
  /**
   * Svar vi ikke fant et spørsmål til — feltet er fjernet i en senere revisjon,
   * eller malen er borte. Ingen svar skal noensinne falle ut av arkivet, heller
   * ikke et vi ikke lenger vet spørsmålet til.
   */
  uplasserteSvar: Record<string, unknown>
}

/** Feltet slik arkivet trenger det — samme form for Ampex-maler og firmamaler. */
export type ArkivFeltbeskrivelse = {
  key: string
  label: string
  type: string
  unit?: string | null
  choices?: string[] | null
}

/**
 * Svar + malbeskrivelse → punkter i skjemaets rekkefølge, pluss det som ikke
 * lot seg plassere. Ren funksjon: hele grunnen til at den kan selvtestes.
 *
 * Punkt uten svar tas MED. At noe ikke ble besvart er også dokumentasjon — og
 * en pakke som bare viser de utfylte punktene ser mer komplett ut enn jobben var.
 * Unntaket er `info`, som aldri lagres og ikke er et spørsmål.
 */
export function byggDokumentpunkter(
  felter: ArkivFeltbeskrivelse[],
  verdier: Record<string, unknown>,
): { punkter: ArkivDokumentpunkt[]; uplasserteSvar: Record<string, unknown> } {
  const punkter: ArkivDokumentpunkt[] = []
  const plassert = new Set<string>()

  for (const f of felter) {
    if (f.type === 'info') continue
    plassert.add(f.key)
    const p: ArkivDokumentpunkt = {
      nokkel: f.key,
      sporsmal: f.label,
      type: f.type,
      svar: f.key in verdier ? verdier[f.key] : null,
    }
    if (f.unit) p.enhet = f.unit
    if (f.choices && f.choices.length > 0) p.alternativer = f.choices
    punkter.push(p)
  }

  const uplasserteSvar: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(verdier)) {
    if (!plassert.has(k)) uplasserteSvar[k] = v
  }
  return { punkter, uplasserteSvar }
}

export type ArkivSignatur = {
  formaal: string
  signertAv: string
  tittel?: string | null
  signertTid: Date
  strok: unknown
  merknad?: string | null
}

export type ArkivGodkjenning = {
  beslutning: string
  godkjenner: string
  besluttetTid: Date
  begrunnelse?: string | null
}

export type Arkivinnhold = {
  ordre: ArkivOrdre
  kunde: ArkivKunde | null
  materiell: ArkivLinje[]
  timer: ArkivTime[]
  tillegg: { tittel: string; prising: string; status: string; godkjentAv?: string | null }[]
  dokumenter: ArkivDokument[]
  signaturer: ArkivSignatur[]
  godkjenninger: ArkivGodkjenning[]
  /** R2-nøkler til skann og tegninger — filene ligger der fra før. */
  vedlegg: string[]
}

/**
 * Versjonsnummer på selve formatet. Endres det, må gamle pakker kunne leses.
 *
 * 2 (21.08.2026): dokumenter bærer nå SPØRSMÅLET, ikke bare nøkkelen og svaret.
 * Endret mens det ennå var gratis — det fantes null frosne pakker. Etter den
 * første er formatet i praksis uforanderlig, for en gammel pakke kan aldri
 * skrives om uten at hashen ryker.
 */
export const ARKIVFORMAT = 2

/**
 * Rekursiv, deterministisk serialisering.
 *
 * Datoer → ISO i UTC. Objektnøkler sorteres. `undefined` faller bort, som i
 * vanlig JSON — men `null` beholdes, fordi «feltet finnes og er tomt» er en
 * annen opplysning enn «feltet finnes ikke».
 */
function normaliser(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(normaliser)
  if (v && typeof v === 'object') {
    const ut: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x === undefined) continue
      ut[k] = normaliser(x)
    }
    return ut
  }
  return v
}

export type Pakke = { json: string; sha256: string; bytes: number; innhold: Record<string, number> }

/** Bygger pakken og hasher den. Samme inndata gir alltid samme resultat. */
export function byggPakke(innhold: Arkivinnhold): Pakke {
  const json = JSON.stringify(normaliser({ format: ARKIVFORMAT, ...innhold }))
  return {
    json,
    sha256: sha256Hex(json),
    // Byte-lengden av UTF-8, ikke antall tegn — det er det R2 lagrer.
    bytes: new Blob([json]).size,
    // Telleverk så en tom eller halv pakke synes i registeret uten nedlasting.
    innhold: {
      materiell: innhold.materiell.length,
      timer: innhold.timer.length,
      tillegg: innhold.tillegg.length,
      dokumenter: innhold.dokumenter.length,
      signaturer: innhold.signaturer.length,
      vedlegg: innhold.vedlegg.length,
    },
  }
}

/**
 * R2-nøkkelen.
 *
 * Firma / år / ordrenummer — lesbart for et menneske som må lete manuelt en
 * gang om syv år. Hashen er med i filnavnet, så en omfrysing aldri overskriver
 * den forrige pakken: to versjoner kan eksistere side om side, og registeret
 * peker på den gjeldende.
 */
export function arkivNokkel(companyId: string, aar: number, ordrenummer: number | null, sha: string): string {
  const ordre = ordrenummer != null ? String(ordrenummer) : 'uten-nummer'
  return `arkiv/${companyId}/${aar}/ordre-${ordre}-${sha.slice(0, 12)}.json`
}

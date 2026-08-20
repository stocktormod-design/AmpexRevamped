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
}

export type ArkivTime = {
  dato: Date
  timer: number
  person: string
  aktivitet?: string | null
  notat?: string | null
}

export type ArkivDokument = {
  mal: string
  malversjon: number
  status: string
  fullfortAv?: string | null
  fullfortTid?: Date | null
  verdier: Record<string, unknown>
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

/** Versjonsnummer på selve formatet. Endres det, må gamle pakker kunne leses. */
export const ARKIVFORMAT = 1

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

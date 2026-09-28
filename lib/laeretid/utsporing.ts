/**
 * Avhørslista — hva boten MÅ ha svar på før en logg er ferdig.
 * Selvtestes i `npm run verify:laeretid`.
 *
 * **Dette er ikke en samtale, det er et avhør med fast liste.**
 *
 * En åpen chat gir en hyggelig logg som ikke holder. Spørsmålene under er de
 * som faktisk avgjør om dokumentasjonen er sann, og de kommer fra feil som er
 * gjort — ikke fra en idé om hva som er lurt å spørre om.
 *
 * Ingen modell er involvert her. Hvilke spørsmål som gjenstår er ren logikk på
 * loggens tilstand, og det skal det være: en modell som «glemmer» å spørre hva
 * han faktisk gjorde selv, produserer et kryss som ryker på fagprøven.
 * Modellen formulerer spørsmålet og vurderer svaret — den bestemmer ikke
 * hvilke spørsmål som må stilles.
 */

export type Paakrevd =
  /**
   * Hva gjorde han SELV, og hva så han andre gjøre?
   *
   * En del han bare har redegjort for kan ikke krysses av. Å legge kabel på
   * ferdig montert bro dekker forlegning, ikke føringsvei — og forskjellen
   * synes ikke i en logg som sier «det ble montert».
   */
  | 'utfort-selv'
  /**
   * Hva ble FAKTISK målt?
   *
   * Spenningsmåling er funksjonskontroll: den bekrefter at spenningen er der
   * og ligger riktig. Den sier ingenting om isolasjonstilstand eller om PE
   * henger sammen. Skriv aldri «sluttkontroll» når det bare ble målt spenning.
   */
  | 'hva-ble-maalt'
  /** Hvilken kabeltype? Gjett ALDRI når den ikke er oppgitt. */
  | 'kabeltype'
  /** Hva følte han mestring over? 1.16 dekkes ikke av en tabellrad. */
  | 'mestring'
  /** Bilder uten notat. «Du tok dette 14:20 — hva var det?» */
  | 'bilde-uten-notat'
  /** Materiell og verktøy — malens materielliste og verktøyseksjon. */
  | 'materiell'
  /** Var noe farlig, eller kunne noe gått galt? Malens risikovurdering. */
  | 'risiko'
  /** Gikk det som planlagt, endringer, tid, hendelser, kunden. Malens vurderingstabell. */
  | 'vurdering'

export type Tilstand = {
  /** Lærlingens egen instruks. Primærkilde. */
  instruks: string | null
  innhold: string | null
  /** Antall bilder uten notat. */
  bilderUtenNotat: number
  /** Spørsmål han allerede har besvart i denne loggen. */
  besvart: Paakrevd[]
  /** Nevner loggen måling i det hele tatt? */
  nevnerMaaling: boolean
  /** Nevner loggen kabel i det hele tatt? */
  nevnerKabel: boolean
  /**
   * Det malen alltid krever, uansett hva loggen nevner. Malen har en
   * materielliste, en risikovurdering og en sluttkontroll — de kan ikke fylles
   * uten at han er spurt. Se `sporOm` i mal.ts.
   */
  malKrav?: Paakrevd[]
}

export const SPORSMAAL: Record<Paakrevd, string> = {
  'utfort-selv':
    'Hva gjorde du selv på denne jobben, og hva så du andre gjøre? Det skal stå tydelig i loggen, for en del du bare redegjør for kan ikke krysses av.',
  'hva-ble-maalt':
    'Hva ble faktisk målt? Spenningsmåling er ikke sluttkontroll — den sier ingenting om isolasjon eller om PE henger sammen.',
  'kabeltype':
    'Hvilken kabeltype var det? Jeg gjetter ikke på det.',
  'mestring':
    'Hva var du fornøyd med i dag? Én konkret ting.',
  'bilde-uten-notat':
    'Noen bilder mangler notat. Hva ville du få med på bildet? Én setning.',
  'materiell':
    'Hvilket materiell og hvilket verktøy brukte du? Det skal stå i materiellista.',
  'risiko':
    'Var noe farlig på jobben, eller kunne noe gått galt? Tenk på spenning, høyde, verneutstyr og andre fag. Det skal stå i risikovurderingen.',
  'vurdering':
    'Gikk jobben som planlagt? Ble det endringer, uventet tidsbruk eller noe farlig underveis, og ble kunden fornøyd? Det skal stå i vurderingen av arbeidet.',
}

/**
 * Hvilke spørsmål gjenstår før loggen kan skrives?
 *
 * Så få som mulig (Tormod 27.09.2026: «det er for mange spørsmål rundt loggen …
 * det er ingen lærlinger som vil bruke tid på en logg»). Samtalen før loggen
 * spør bare om det som gjør loggen USANN hvis det er feil, og som ikke kan
 * gjettes av bildene og notatene:
 *
 *   1. Hva gjorde du selv, og hva gjorde andre? En del han bare så på kan ikke
 *      krysses av, og forskjellen synes ikke i en logg som sier «det ble montert».
 *   2. Bilder uten notat: hva ville du få med på bildet?
 *
 * Alt annet — materiell, risiko, målinger, kabeltype, vurdering, mestring —
 * fyller modellen ut fra det han alt har sagt, og resten står som ja/nei i
 * malen. Forståelsen sjekkes i quizen ETTER jobben, der den hører hjemme.
 * Et punkt til spørres bare om en mal krever det uttrykkelig (`malKrav`).
 */
export function gjenstaaende(t: Tilstand): Paakrevd[] {
  const ut: Paakrevd[] = []
  const krav = t.malKrav ?? []
  const valgfrie: Paakrevd[] = ['materiell', 'risiko', 'hva-ble-maalt', 'kabeltype', 'vurdering', 'mestring']

  if (!t.besvart.includes('utfort-selv')) ut.push('utfort-selv')
  if (t.bilderUtenNotat > 0 && !t.besvart.includes('bilde-uten-notat')) ut.push('bilde-uten-notat')
  for (const p of valgfrie) {
    if (krav.includes(p) && !t.besvart.includes(p)) ut.push(p)
  }
  return ut
}

export function erFerdig(t: Tilstand): boolean {
  return gjenstaaende(t).length === 0
}

/**
 * Formuleringer boten ALDRI skal bruke om lærlingen.
 *
 * Er han usikker, skal det stå at han ikke husker — ikke at noe IKKE ble gjort.
 * Å påstå at noe ikke ble utført er en påstand han ikke kan stå for, og den er
 * like gal som å påstå at det ble gjort.
 */
export const FORBUDTE_FORMULERINGER: { monster: RegExp; hvorfor: string }[] = [
  {
    monster: /det ble (ikke )?kontrollert at/i,
    hvorfor: 'Passiv form skjuler hvem som gjorde det. Skriv hva HAN gjorde.',
  },
  {
    monster: /ble ikke (målt|utført|gjort|kontrollert)/i,
    hvorfor: 'Er han usikker, skriv «jeg husker ikke» — ikke at noe ikke ble gjort.',
  },
  {
    monster: /sluttkontroll/i,
    hvorfor: 'Bruk bare ordet når isolasjon og kontinuitet faktisk ble målt. Spenningsmåling er funksjonskontroll.',
  },
]

export function finnForbudte(tekst: string): { treff: string; hvorfor: string }[] {
  return FORBUDTE_FORMULERINGER
    .map(f => {
      const m = tekst.match(f.monster)
      return m ? { treff: m[0], hvorfor: f.hvorfor } : null
    })
    .filter(Boolean) as { treff: string; hvorfor: string }[]
}

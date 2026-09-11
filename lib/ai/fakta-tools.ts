/**
 * Verktøy som samler RÅFAKTA. Modellen observerer; koden regner.
 * Selvtestes i `npm run verify:fakta-tools`.
 *
 * ── Prinsippet ──────────────────────────────────────────────────────────────
 *
 * Mønsteret er allerede etablert i `prosjekt_status`: «Tallene er fasit — ikke
 * regn selv.» Her føres det videre til de to områdene der en feil koster mest:
 * lønnsgrunnlag og elektrisk sikkerhet.
 *
 * Testen på om en parameter hører hjemme her: **kunne modellen tatt feil av
 * den uten at noen merket det?** «Han begynte halv sju» er en observasjon —
 * hører hjemme. «Det blir tre og en halv time overtid» er en konklusjon —
 * hører ikke hjemme, uansett hvor lett regnestykket ser ut.
 *
 * Konsekvensen for skjemaet: det finnes ingen felter for resultater. Ikke
 * `overtid_timer`, ikke `matpenger`, ikke `innenfor_grensen`. Finnes feltet,
 * blir det fylt.
 *
 * ── Om null ─────────────────────────────────────────────────────────────────
 *
 * `null` er et gyldig og ønsket svar. En modell som ikke kan si «vet ikke»
 * gjetter i stedet, og et gjettet klokkeslett ser nøyaktig ut som et observert
 * ett når det først står i en timeliste.
 */

/** Gemini-formet funksjonsdeklarasjon. */
export type Funksjonsdeklarasjon = {
  name: string
  description: string
  parameters: {
    type: 'OBJECT'
    properties: Record<string, unknown>
    required: string[]
  }
}

/**
 * Tidsføring.
 *
 * Ingen parameter heter noe som ligner et resultat. Modellen kan ikke oppgi
 * antall timer i det hele tatt — bare start, slutt og pause. Differansen er
 * kodens jobb, og det er også der helligdager, skiftordning og firmaets egen
 * normalarbeidsdag hører hjemme.
 */
export const BEREGN_ARBEIDSTID: Funksjonsdeklarasjon = {
  name: 'beregn_arbeidstid',
  description:
    'Klassifiserer en arbeidsdag etter gjeldende overenskomst og firmaets innstillinger. ' +
    'Du oppgir KUN det brukeren faktisk sa: dato, klokkeslett, pause, ordre. ' +
    'Du regner ingenting selv — verken timer, overtid, matpenger eller diett. ' +
    'Svaret er fasit, også når det avviker fra det du selv ville gjettet.',
  parameters: {
    type: 'OBJECT',
    properties: {
      dato: {
        type: 'STRING',
        description:
          'ISO-dato (ÅÅÅÅ-MM-DD). Sa brukeren «i går» eller «på tirsdag», regn om til dato — ' +
          'det er kalender, ikke arbeidstid. Er du usikker på hvilken dag han mente, spør.',
      },
      start: { type: 'STRING', description: 'Klokkeslett HH:MM slik brukeren oppga det.' },
      slutt: { type: 'STRING', description: 'Klokkeslett HH:MM slik brukeren oppga det.' },
      pause_minutter: {
        type: 'INTEGER',
        description:
          'Ubetalt pause i minutter, hvis brukeren oppga det. Utelat feltet hvis han ikke sa noe — ' +
          'sett det ALDRI til 0 for å slippe å spørre. Null pause og uoppgitt pause er ikke det samme.',
      },
      ordre_id: {
        type: 'STRING',
        description: 'Id fra finn_ordre. Finn aldri på et ordrenummer og gjett aldri på id.',
      },
      aktivitet: {
        type: 'STRING',
        description: 'Aktivitetsnavn hvis brukeren nevnte ett, f.eks. «montasje», «kjøring».',
      },
      merknad_fra_bruker: {
        type: 'STRING',
        description:
          'Ordrett det brukeren sa som kan påvirke klassifiseringen, f.eks. «jeg ble kalt ut på natta» ' +
          'eller «det var dagen før helligdagen». Tolk det ikke — gjengi det.',
      },
    },
    required: ['dato', 'start', 'slutt', 'ordre_id'],
  },
}

/**
 * Måleverdier.
 *
 * Modellen registrerer tallet og hva som ble målt. Den avgjør ikke om det er
 * innenfor — den kan ikke engang uttrykke en slik vurdering i dette skjemaet.
 *
 * `enhet` er med fordi «to komma to» kan være ohm eller megaohm, og forskjellen
 * er seks nuller. Sier brukeren ikke enheten, skal den spørres om, ikke antas.
 */
export const REGISTRER_MAALING: Funksjonsdeklarasjon = {
  name: 'registrer_maaling',
  description:
    'Registrerer én måleverdi på en kurs. Du vurderer IKKE om verdien er innenfor — ' +
    'appen slår opp grensen firmaet har lagt inn og svarer. Les opp svaret du får. ' +
    'Si aldri selv at noe er godkjent eller kan tas i bruk.',
  parameters: {
    type: 'OBJECT',
    properties: {
      ordre_id: { type: 'STRING', description: 'Id fra finn_ordre.' },
      kurs: {
        type: 'STRING',
        description: 'Kursbetegnelsen slik brukeren sa den, f.eks. «kurs 12» eller «stikk kjøkken».',
      },
      storrelse: {
        type: 'STRING',
        enum: ['Rpe', 'Riso', 'Ik_min', 'Ik_maks', 'Zs', 'annet'],
        description:
          'Hva som ble målt. Ik_min og Ik_maks er IKKE det samme og skal aldri slås sammen: ' +
          'Ik_maks handler om at vern og utstyr tåler det som kan komme, Ik_min om at vernet ' +
          'løser ut i tide ved feil lengst ute i kursen. Er du i tvil om hvilken brukeren mener, spør.',
      },
      verdi: { type: 'NUMBER', description: 'Tallet slik brukeren sa det. Regn det ikke om.' },
      enhet: {
        type: 'STRING',
        enum: ['ohm', 'kiloohm', 'megaohm', 'ampere', 'kiloampere', 'volt'],
        description:
          'Enheten brukeren oppga. Sa han den ikke, SPØR — «2,2» kan være ohm eller megaohm, ' +
          'og forskjellen er seks nuller. Anta aldri.',
      },
      testspenning_V: {
        type: 'NUMBER',
        description: 'For Riso: testspenningen, hvis brukeren oppga den. Utelat hvis ikke.',
      },
      merknad_fra_bruker: {
        type: 'STRING',
        description: 'Ordrett noe brukeren sa om målingen. Tolk det ikke.',
      },
    },
    required: ['ordre_id', 'kurs', 'storrelse', 'verdi', 'enhet'],
  },
}

/**
 * Materiell.
 *
 * Modellen oppgir hva brukeren sa, ikke hva det koster. Pris hentes fra
 * varekartoteket ved oppslag — en modell som kan oppgi pris, kan oppgi feil
 * pris, og den havner rett i et fakturagrunnlag.
 */
export const FOR_MATERIELL: Funksjonsdeklarasjon = {
  name: 'for_materiell',
  description:
    'Fører materiell på en ordre. Du oppgir hva og hvor mye brukeren sa. ' +
    'Du oppgir ALDRI pris, påslag eller sum — de hentes fra varekartoteket.',
  parameters: {
    type: 'OBJECT',
    properties: {
      ordre_id: { type: 'STRING' },
      vare_id: {
        type: 'STRING',
        description: 'Id fra sok_vare. Uten treff: la feltet stå tomt og fyll beskrivelse i stedet.',
      },
      beskrivelse: {
        type: 'STRING',
        description: 'Brukerens egne ord, når varen ikke ble funnet i kartoteket.',
      },
      antall: { type: 'NUMBER' },
      enhet: { type: 'STRING', description: 'stk, meter, pakke — slik brukeren sa det.' },
    },
    required: ['ordre_id', 'antall'],
  },
}

export const FAKTA_VERKTOY: Funksjonsdeklarasjon[] = [
  BEREGN_ARBEIDSTID,
  REGISTRER_MAALING,
  FOR_MATERIELL,
]

/**
 * Ord som avslører at et skjema ber modellen konkludere framfor å observere.
 * Brukes av selvtesten, og er ment å fange en fremtidig parameter som sniker
 * seg inn med navn som `overtid_timer` eller `innenfor`.
 */
export const KONKLUSJONSORD = [
  'overtid',
  'matpenger',
  'diett',
  'tillegg',
  'sum',
  'total',
  'pris',
  'belop',
  'sats',
  'innenfor',
  'godkjent',
  'bestatt',
  'avvik',
  'lovlig',
  'grense',
]

/**
 * Hvem får se hva på kontorflaten. Ren logikk, ingen database.
 * Selvtestes i `npm run verify:kontor-tilgang`.
 *
 * **Dette er ikke sikkerhetsmodellen.** RLS per `company_id` isolerer firmaene,
 * `krev_faglig_godkjenning` blokkerer fakturering uten godkjenning, og
 * `kan_godkjenne_faglig()` avgjør hvem som får skrive en godkjenningsrad.
 * Matrisen under styrer hva som VISES — den fjerner rot, ikke risiko.
 *
 * Grunnen til at den likevel er skrevet ut og testet, er at Handyman og Cordel
 * begge lar firmaet definere rettigheter per brukergruppe, og at et kontor uten
 * et slikt skille ender med at alle ser dekningsbidraget. Det er en samtale
 * ingen daglig leder vil ha på grunn av en skjerm.
 */

export type Rolle =
  | 'owner'
  | 'admin'
  | 'bas'
  | 'installator'
  | 'montor'
  | 'laerling'
  | 'regnskapsforer'

export type Rettighet =
  /** Slippes inn på kontorflaten i det hele tatt. */
  | 'kontor'
  /** Se ordrelista. */
  | 'ordre.les'
  /** Se ALLE firmaets ordrer, ikke bare dem du er med på. */
  | 'ordre.alle'
  /** Rette opp det som ble ført i felt — timer, materiell, beskrivelse. */
  | 'ordre.endre'
  /** Se prosjektene: rom, tegninger, oppgaver, deltakere. */
  | 'prosjekt.les'
  /** Se tilbud og hva de summerer til. */
  | 'tilbud.les'
  /**
   * Se HELE firmaets timeliste, ikke bare timene på egne ordrer.
   *
   * Dette er lønnsgrunnlag. En bas har ikke denne, og det er med vilje: timene
   * han faktisk trenger står på ordrene hans, og en samlet oversikt over hva
   * kollegaene har ført er noe annet enn å lede en jobb.
   */
  | 'timer.les'
  /** Se kunderegisteret. */
  | 'kunder.les'
  /** Se fakturagrunnlaget: linjer, netto, mva, brutto. */
  | 'faktura.les'
  /** Marker som fakturert. */
  | 'faktura.marker'
  /** Se dekningsbidrag i kroner og prosent. */
  | 'db.les'
  /** Se varekartoteket. */
  | 'varer.les'
  /** Importere prisfil og skrive til varekartoteket. */
  | 'priser.importer'
  /**
   * Lese internkontrollsystemet.
   *
   * Alle med kontortilgang har denne, og basen har den også. En rutine ingen
   * får lese er en rutine ingen kan følge — det er selve poenget med at
   * systemet er skriftlig.
   */
  | 'ik.les'
  /**
   * Skrive internkontrollen: opprette punkter, endre rutiner, vedta.
   *
   * Installatøren har denne fordi han er faglig ansvarlig. Det er hans navn som
   * står på samsvarserklæringen, og da er det hans rutiner.
   */
  | 'ik.skriv'
  /** Se firmaets skjemamaler og revisjonene deres. */
  | 'skjema.les'
  /** Endre skjemamaler og knytte dem til et internkontrollpunkt. */
  | 'skjema.skriv'
  /**
   * Se AUDIT-sporet i historikken: hvem som endret hvilket felt, ført av
   * databasetriggeren.
   *
   * Det finnes ingen egen logg-flate. Historikken står på rutinen og på malen,
   * der spørsmålet faktisk stilles. Revisjonene — de med endringsnotat — er en
   * del av dokumentet og leses av alle som får lese objektet. Auditsporet er
   * tilsyn, og det er denne rettigheten som styrer om det vises.
   */
  | 'logg.les'
  /** Se firmaoppsettet: innstillinger, ansatte, bake-noder. */
  | 'firma.les'
  /** Se skannekoeen: hva ligger paa telefonene, hva bakes, hva ble ferdig. */
  | 'skann.les'
  /**
   * Styre bakepoolen: melde inn PC-er, trekke noder, og bryteren for
   * Ampex-poolen.
   *
   * Kun eier og administrator, og det er den siste som avgjoer: aa slaa paa
   * `company_settings.ampex_pool` er aa tillate at LiDAR av kundens bolig
   * pakkes ut paa en maskin firmaet ikke eier. Det binder firmaet overfor
   * kundene sine, og hoerer derfor samme sted som andre beslutninger som gjoer
   * det — ikke hos den som tilfeldigvis setter opp PC-en.
   */
  | 'pool.styr'
  /**
   * Invitere en ny ansatt inn i firmaet, og sette rollen hennes.
   *
   * Kun eier og administrator. Regnskapsføreren har `firma.les` og ser altså
   * ansattlista, men det er noe annet enn å bestemme hvem som slipper inn i
   * den — og rollen hun ville satt er den samme rollen som avgjør hvem som ser
   * lønnsgrunnlaget hennes.
   *
   * Rettigheten er kun for GRENSESNITTET. Den ekte sperren står i
   * `supabase/functions/inviter-ansatt`, som slår opp kallerens egen rolle i
   * basen og aldri stoler på klienten. Se kommentaren over `MATRISE`.
   */
  | 'bruker.inviter'

/**
 * Rollene og hva de får se.
 *
 * `montor` og `laerling` står med vilje som tomme lister og ikke som
 * utelatelser: en rolle som mangler i tabellen er en rolle noen har glemt, og
 * da skal det være tydelig at svaret er «ingenting», ikke «ukjent».
 */
const ALT: Rettighet[] = [
  'kontor',
  'ordre.les', 'ordre.alle', 'ordre.endre',
  'prosjekt.les', 'tilbud.les', 'timer.les', 'kunder.les',
  'faktura.les', 'faktura.marker', 'db.les',
  'varer.les', 'priser.importer',
  'ik.les', 'ik.skriv', 'skjema.les', 'skjema.skriv', 'logg.les',
  'firma.les', 'bruker.inviter',
  'skann.les', 'pool.styr',
]

const MATRISE: Record<Rolle, Rettighet[]> = {
  owner: ALT,
  admin: ALT,

  // Regnskapsføreren skal fakturere, ikke redigere faget. Hun ser summen,
  // dekningsbidraget, timelista og kunderegisteret — alt fakturaen bygger på —
  // men retter ikke en montørs timeføring og rører ikke varekartoteket.
  // Internkontrollen og loggen leser hun, fordi det er hun som ofte er den som
  // finner fram dokumentasjonen når noen spør etter den.
  regnskapsforer: [
    'kontor', 'ordre.les', 'ordre.alle',
    'prosjekt.les', 'tilbud.les', 'timer.les', 'kunder.les',
    'faktura.les', 'faktura.marker', 'db.les',
    'varer.les', 'ik.les', 'skjema.les', 'logg.les', 'firma.les',
  ],

  // Installatøren er den faglig ansvarlige. Han ser hele firmaet og retter det
  // som ble ført feil, og han ser summen han faktisk godkjenner. Han
  // fakturerer ikke, og dekningsbidraget er ikke hans bord.
  //
  // **Internkontrollen er hans.** Det er hans navn som står på
  // samsvarserklæringen, og da er det hans rutiner — han er den eneste utenfor
  // eier og administrator som kan skrive dem.
  installator: [
    'kontor', 'ordre.les', 'ordre.alle', 'ordre.endre',
    'prosjekt.les', 'tilbud.les', 'timer.les', 'kunder.les',
    'faktura.les', 'varer.les',
    'ik.les', 'ik.skriv', 'skjema.les', 'skjema.skriv', 'logg.les',
    'skann.les',
  ],

  // Basen leder sine egne jobber. Han ser ordrene han er med på, ikke firmaets
  // portefølje, og ingen priser ut mot kunde. Kunderegisteret har han fordi
  // han trenger telefonnummeret på vei til jobben, og internkontrollen fordi
  // en rutine ingen får lese er en rutine ingen kan følge.
  bas: [
    'kontor', 'ordre.les', 'ordre.endre', 'prosjekt.les', 'kunder.les', 'varer.les',
    'ik.les', 'skjema.les', 'skann.les',
  ],

  // Alt en montør og en lærling trenger ligger i appen på telefonen.
  montor: [],
  laerling: [],
}

const ALLE_ROLLER = Object.keys(MATRISE) as Rolle[]

export function somRolle(v: string | null | undefined): Rolle | null {
  return ALLE_ROLLER.includes(v as Rolle) ? (v as Rolle) : null
}

export function kan(rolle: Rolle | string | null | undefined, rett: Rettighet): boolean {
  const r = somRolle(typeof rolle === 'string' ? rolle : rolle ?? null)
  return r ? MATRISE[r].includes(rett) : false
}

/** Alle rettigheter en rolle har. Til feilsøking og til «hva ser jeg?»-visningen. */
export function rettigheter(rolle: Rolle | string | null | undefined): Rettighet[] {
  const r = somRolle(typeof rolle === 'string' ? rolle : rolle ?? null)
  return r ? [...MATRISE[r]] : []
}

/** Menneskelig navn på rollen. Kontoret skriver ikke `regnskapsforer` på skjermen. */
export const ROLLENAVN: Record<Rolle, string> = {
  owner: 'Eier',
  admin: 'Administrator',
  bas: 'Bas',
  installator: 'Installatør',
  montor: 'Montør',
  laerling: 'Lærling',
  regnskapsforer: 'Regnskapsfører',
}

export function rollenavn(v: string | null | undefined): string {
  const r = somRolle(v)
  return r ? ROLLENAVN[r] : 'Ukjent rolle'
}

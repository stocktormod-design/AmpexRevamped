/**
 * Hva har skjedd med dette punktet, eller dette skjemaet?
 *
 * Ren logikk, ingen database. Selvtestes i `npm run verify:ik-hendelser`.
 *
 * To kilder forteller om det samme, og de må slås sammen uten å telle dobbelt:
 *
 * - **Revisjonene** (`ik_revisjoner`, `form_template_revisions`) er dokumentets
 *   egen historikk. De har et endringsnotat — en setning et menneske skrev om
 *   hvorfor. Det er den verdifulle delen.
 * - **Audit-loggen** (`audit_events`) er databasens spor. Den fanger alt, også
 *   det som ikke er en revisjon: at punktet ble vedtatt, at noen kvitterte for
 *   gjennomgang, at det ble opprettet.
 *
 * Problemet er at en lagring lager BEGGE: en revisjonsrad og en audit-rad. Vises
 * begge, står hver endring to ganger, og en historikk som teller dobbelt er en
 * historikk ingen stoler på. Regelen under er derfor: en audit-rad som endrer
 * `gjeldende_versjon` er en lagring, og den er allerede fortalt av revisjonen.
 */

export type Auditrad = {
  id: string
  actor_name: string | null
  operasjon: string
  endringer: Record<string, unknown> | null
  skjedde_at: string
}

export type Revisjonsrad = {
  id: string
  versjon: number
  endringsnotat: string
  endret_av_navn: string | null
  created_at: string
}

export type Hendelseslag = 'opprettet' | 'revisjon' | 'vedtatt' | 'utgatt' | 'gjennomgang' | 'endret'

export type Hendelse = {
  id: string
  tid: string
  hvem: string | null
  slag: Hendelseslag
  tekst: string
  versjon?: number
}

/** Feltnavn i basen til noe et menneske kjenner igjen. */
const FELT: Record<string, string> = {
  innhold: 'rutinen',
  tittel: 'tittelen',
  hjemmel: 'hjemmelen',
  formal: 'formålet',
  status: 'status',
  sist_gjennomgatt: 'gjennomgangsdato',
  vedtatt_at: 'vedtaksdato',
  vedtatt_av: 'hvem som vedtok',
  gjeldende_versjon: 'versjon',
  gjennomgang_intervall_mnd: 'intervallet',
  ansvarlig: 'ansvarlig',
  sort_order: 'rekkefølgen',
  nummer: 'nummeret',
  deleted_at: 'sletting',
  key: 'nøkkelen',
  title: 'tittelen',
  category: 'kategorien',
  current_version: 'versjon',
}

function tilStreng(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** Verdien et felt ble endret TIL, når audit-raden har formen {fra, til}. */
function til(endringer: Record<string, unknown> | null, felt: string): string | null {
  const e = endringer?.[felt]
  if (!e || typeof e !== 'object') return null
  return tilStreng((e as { til?: unknown }).til)
}

/**
 * Tolker én audit-rad. Returnerer null for rader som allerede er fortalt av en
 * revisjon, eller som ikke har noe å si et menneske.
 */
export function tolkAudit(rad: Auditrad): Hendelse | null {
  const felter = rad.endringer ? Object.keys(rad.endringer) : []

  if (rad.operasjon === 'insert') {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'opprettet', tekst: 'Opprettet' }
  }

  if (rad.operasjon === 'delete') {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'endret', tekst: 'Slettet' }
  }

  // En soft delete er en sletting, uansett hva den heter i basen.
  if (felter.includes('deleted_at') && til(rad.endringer, 'deleted_at')) {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'endret', tekst: 'Slettet' }
  }

  // Vedtaket først: den samme oppdateringen setter både status, vedtaksdato og
  // gjennomgangsdato, og det er vedtaket som er hendelsen.
  const nyStatus = til(rad.endringer, 'status')
  if (nyStatus === 'vedtatt') {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'vedtatt', tekst: 'Vedtatt' }
  }
  if (nyStatus === 'utgatt') {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'utgatt', tekst: 'Satt som utgått' }
  }

  // Kvittering for gjennomgang: gjennomgangsdatoen endret, og INGENTING annet.
  // Er andre felt med, er det en større endring som skal beskrives som det.
  if (felter.length === 1 && felter[0] === 'sist_gjennomgatt') {
    return { id: rad.id, tid: rad.skjedde_at, hvem: rad.actor_name, slag: 'gjennomgang', tekst: 'Gjennomgått, ingen endring' }
  }

  // En lagring bumper versjonen, og den er allerede fortalt av revisjonen.
  // Uten denne linja står hver eneste endring to ganger.
  if (felter.includes('gjeldende_versjon') || felter.includes('current_version')) return null

  if (felter.length === 0) return null

  return {
    id: rad.id,
    tid: rad.skjedde_at,
    hvem: rad.actor_name,
    slag: 'endret',
    tekst: `Endret ${felter.map(f => FELT[f] ?? f).join(', ')}`,
  }
}

/**
 * Slår sammen revisjoner og audit-rader til én historikk, nyeste først.
 *
 * Revisjonene har alltid forrang: de bærer endringsnotatet, altså grunnen.
 */
export function byggHistorikk(revisjoner: Revisjonsrad[], audit: Auditrad[]): Hendelse[] {
  const fraRevisjoner: Hendelse[] = revisjoner.map(r => ({
    id: `rev-${r.id}`,
    tid: r.created_at,
    hvem: r.endret_av_navn,
    slag: 'revisjon',
    tekst: r.endringsnotat,
    versjon: r.versjon,
  }))

  const fraAudit = audit.map(tolkAudit).filter((h): h is Hendelse => h !== null)

  return [...fraRevisjoner, ...fraAudit].sort((a, b) => (a.tid < b.tid ? 1 : a.tid > b.tid ? -1 : 0))
}

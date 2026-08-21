import type { Auditrad, Revisjonsrad } from '@delt/ik/hendelser'
import { IK_SKJELETT, maaVaereSkriftlig } from '@delt/ik/skjelett'
import { supabase } from '@/supabase'

/**
 * Internkontrollsystemet: lesing og skriving.
 *
 * Tre regler som ligger her og ikke i grensesnittet, fordi de er systemet og
 * ikke skjermen:
 *
 * 1. **Hver endring blir en revisjon.** `lagreEndring()` skriver ALLTID en rad
 *    i `ik_revisjoner` med hele teksten slik den ble, ikke en diff. Skal man
 *    dokumentere hva rutinen sa den dagen noe skjedde, må teksten stå der hel.
 * 2. **Endringsnotatet er påkrevd.** Databasen krever det (`not null`), og det
 *    er med vilje: en revisjon ingen kan vurdere i ettertid er ingen revisjon.
 * 3. **Å vedta er ikke det samme som å lagre.** Et punkt får `vedtatt` først
 *    når noen sier at det gjelder, og da settes `sist_gjennomgatt` samtidig —
 *    fristen begynner å løpe fra vedtaket, ikke fra første utkast.
 */

export type IkStatus = 'utkast' | 'vedtatt' | 'utgatt'

export type IkPunkt = {
  id: string
  nummer: string
  tittel: string
  hjemmel: string | null
  formal: string | null
  innhold: string | null
  ansvarlig: string | null
  status: IkStatus
  gjennomgang_intervall_mnd: number
  sist_gjennomgatt: string | null
  vedtatt_at: string | null
  gjeldende_versjon: number
  sort_order: number
  updated_at: string
  /** Utledet fra skjelettet, ikke lagret: krever forskriften dette skriftlig? */
  maaVaereSkriftlig: boolean
}

export type IkRevisjon = {
  id: string
  versjon: number
  tittel: string
  hjemmel: string | null
  formal: string | null
  innhold: string | null
  endringsnotat: string
  endret_av_navn: string | null
  created_at: string
}

const KOLONNER =
  'id,nummer,tittel,hjemmel,formal,innhold,ansvarlig,status,' +
  'gjennomgang_intervall_mnd,sist_gjennomgatt,vedtatt_at,gjeldende_versjon,sort_order,updated_at'

export async function hentPunkter(): Promise<IkPunkt[]> {
  const { data, error } = await supabase
    .from('ik_punkter')
    .select(KOLONNER)
    .is('deleted_at', null)
    .order('sort_order')
  if (error) throw new Error(`Kunne ikke lese internkontrollen: ${error.message}`)
  return ((data ?? []) as unknown as Omit<IkPunkt, 'maaVaereSkriftlig'>[]).map(p => ({
    ...p,
    maaVaereSkriftlig: maaVaereSkriftlig(p.nummer),
  }))
}

export async function hentRevisjoner(punktId: string): Promise<IkRevisjon[]> {
  const { data, error } = await supabase
    .from('ik_revisjoner')
    .select('id,versjon,tittel,hjemmel,formal,innhold,endringsnotat,endret_av_navn,created_at')
    .eq('punkt_id', punktId)
    .is('deleted_at', null)
    .order('versjon', { ascending: false })
  if (error) throw new Error(`Kunne ikke lese revisjonene: ${error.message}`)
  return (data ?? []) as unknown as IkRevisjon[]
}

/**
 * Oppretter skjelettet.
 *
 * Kjøres én gang, og bare når systemet er tomt. Punktene lages som UTKAST med
 * formål og hjemmel fylt ut, men uten innhold — innholdet er firmaets, og et
 * IK-system skrevet av leverandøren er nettopp den døde permen forskriften
 * skal hindre.
 */
export async function opprettSkjelett(brukerId: string): Promise<number> {
  const finnes = await hentPunkter()
  if (finnes.length > 0) throw new Error('Internkontrollen er allerede opprettet.')

  const rader = IK_SKJELETT.map((p, i) => ({
    nummer: p.nummer,
    tittel: p.tittel,
    hjemmel: p.hjemmel || null,
    formal: p.formal,
    innhold: null,
    status: 'utkast',
    gjennomgang_intervall_mnd: p.intervallMnd,
    sort_order: i,
    created_by: brukerId,
  }))

  const { error } = await supabase.from('ik_punkter').insert(rader)
  if (error) throw new Error(`Kunne ikke opprette internkontrollen: ${error.message}`)
  return rader.length
}

export type Endring = {
  tittel: string
  hjemmel: string | null
  formal: string | null
  innhold: string | null
  gjennomgang_intervall_mnd: number
  ansvarlig: string | null
}

/**
 * Lagrer en endring på et punkt, og arkiverer den som revisjon.
 *
 * Revisjonen skrives FØRST. Ryker nettet mellom de to skrivingene, sitter man
 * igjen med en revisjon uten tilsvarende endring — en dobbeltføring i
 * historikken. Motsatt rekkefølge ville gitt en endring uten spor, og det er
 * den feilen som ikke kan rettes opp i ettertid.
 */
export async function lagreEndring(
  punkt: IkPunkt,
  endring: Endring,
  endringsnotat: string,
  bruker: { id: string; navn: string },
): Promise<number> {
  const notat = endringsnotat.trim()
  if (!notat) throw new Error('Endringsnotat er påkrevd. Skriv én linje om hva som ble endret og hvorfor.')

  const nyVersjon = punkt.gjeldende_versjon + 1

  const rev = await supabase.from('ik_revisjoner').insert({
    punkt_id: punkt.id,
    versjon: nyVersjon,
    tittel: endring.tittel,
    hjemmel: endring.hjemmel,
    formal: endring.formal,
    innhold: endring.innhold,
    endringsnotat: notat,
    endret_av: bruker.id,
    endret_av_navn: bruker.navn,
  })
  if (rev.error) throw new Error(`Kunne ikke arkivere revisjonen: ${rev.error.message}`)

  const { error } = await supabase
    .from('ik_punkter')
    .update({ ...endring, gjeldende_versjon: nyVersjon })
    .eq('id', punkt.id)
  if (error) throw new Error(`Revisjonen ble arkivert, men punktet ble ikke oppdatert: ${error.message}`)

  return nyVersjon
}

/**
 * Vedtar punktet. Setter samtidig gjennomgangsdatoen til i dag: fristen begynner
 * å løpe fra vedtaket, ikke fra første utkast.
 */
export async function vedta(punktId: string, brukerId: string): Promise<void> {
  const { error } = await supabase
    .from('ik_punkter')
    .update({
      status: 'vedtatt',
      vedtatt_at: new Date().toISOString(),
      vedtatt_av: brukerId,
      sist_gjennomgatt: new Date().toISOString().slice(0, 10),
    })
    .eq('id', punktId)
  if (error) throw new Error(`Kunne ikke vedta punktet: ${error.message}`)
}

/**
 * Kvitterer for gjennomgang uten å endre teksten.
 *
 * Dette er den levende delen i praksis: faglig ansvarlig leser gjennom punktet,
 * finner det fortsatt riktig, og flytter fristen. Det skal IKKE lage en
 * revisjon — ingenting ble endret — men det havner i audit-loggen via
 * `audit_row`, så gjennomgangen kan dokumenteres.
 */
export async function kvitterGjennomgang(punktId: string): Promise<void> {
  const { error } = await supabase
    .from('ik_punkter')
    .update({ sist_gjennomgatt: new Date().toISOString().slice(0, 10) })
    .eq('id', punktId)
  if (error) throw new Error(`Kunne ikke registrere gjennomgangen: ${error.message}`)
}

// ── Skjemaer knyttet til et punkt ──────────────────────────────────────────

export type Skjemakobling = { id: string; template_id: string; tittel: string; versjon: number; status: string }

export async function hentSkjemakoblinger(): Promise<Map<string, Skjemakobling[]>> {
  const [k, m] = await Promise.all([
    supabase.from('ik_punkt_skjema').select('id,punkt_id,template_id').is('deleted_at', null),
    supabase.from('form_templates').select('id,title,current_version,status').is('deleted_at', null),
  ])
  if (k.error) throw new Error(k.error.message)
  if (m.error) throw new Error(m.error.message)

  const maler = new Map(
    ((m.data ?? []) as { id: string; title: string; current_version: number; status: string }[])
      .map(x => [x.id, x]),
  )
  const ut = new Map<string, Skjemakobling[]>()
  for (const r of (k.data ?? []) as { id: string; punkt_id: string; template_id: string }[]) {
    const mal = maler.get(r.template_id)
    if (!mal) continue
    const liste = ut.get(r.punkt_id) ?? []
    liste.push({ id: r.id, template_id: r.template_id, tittel: mal.title, versjon: mal.current_version, status: mal.status })
    ut.set(r.punkt_id, liste)
  }
  return ut
}

export type Skjemamal = {
  id: string
  key: string | null
  title: string
  category: string
  current_version: number
  status: string
  updated_at: string
}

export async function hentSkjemamaler(): Promise<Skjemamal[]> {
  const { data, error } = await supabase
    .from('form_templates')
    .select('id,key,title,category,current_version,status,updated_at')
    .is('deleted_at', null)
    .order('category')
    .order('title')
  if (error) throw new Error(`Kunne ikke lese skjemamalene: ${error.message}`)
  return (data ?? []) as unknown as Skjemamal[]
}

export async function knyttSkjema(punktId: string, templateId: string): Promise<void> {
  const { error } = await supabase.from('ik_punkt_skjema').insert({ punkt_id: punktId, template_id: templateId })
  if (error) throw new Error(`Kunne ikke knytte skjemaet: ${error.message}`)
}

export async function loesnaSkjema(koblingId: string): Promise<void> {
  // Soft delete, regel 5. En kobling som ble fjernet er også en endring i
  // internkontrollen, og den skal kunne spores.
  const { error } = await supabase
    .from('ik_punkt_skjema')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', koblingId)
  if (error) throw new Error(`Kunne ikke fjerne koblingen: ${error.message}`)
}

/**
 * Audit-sporet for ÉN rad.
 *
 * Det finnes ingen samlet endringslogg-flate, og det er med vilje: en tabell
 * med alle firmaets hendelser er utviklerens utsyn på databasen, ikke noe
 * kontoret åpner. Spørsmålet folk faktisk har er «hva har skjedd med DENNE
 * rutinen», og da hører sporet til på rutinen.
 *
 * `audit_events` fylles av en trigger i databasen, ikke av appen. Det er hele
 * poenget: en logg klienten skriver selv er en logg klienten kan la være å
 * skrive. Tabellen har ingen insert-policy for klienten.
 */
export async function hentAuditFor(tabell: string, radId: string): Promise<Auditrad[]> {
  const { data, error } = await supabase
    .from('audit_events')
    .select('id,actor_name,operasjon,endringer,skjedde_at')
    .eq('tabell', tabell)
    .eq('rad_id', radId)
    .order('skjedde_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`Kunne ikke lese endringssporet: ${error.message}`)
  return (data ?? []) as unknown as Auditrad[]
}

/** Revisjonene på en skjemamal. Samme form som IK-revisjonene, andre kolonner. */
export async function hentMalrevisjoner(templateId: string): Promise<Revisjonsrad[]> {
  const { data, error } = await supabase
    .from('form_template_revisions')
    .select('id,version,change_note,created_at')
    .eq('template_id', templateId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
  if (error) throw new Error(`Kunne ikke lese malrevisjonene: ${error.message}`)
  return ((data ?? []) as { id: string; version: number; change_note: string | null; created_at: string }[]).map(r => ({
    id: r.id,
    versjon: r.version,
    // `form_template_revisions` har ingen kolonne for hvem som endret. Navnet
    // står i auditsporet, og der hentes det fra.
    endret_av_navn: null,
    endringsnotat: r.change_note ?? 'Ingen merknad',
    created_at: r.created_at,
  }))
}
// ── Lesebekreftelse ────────────────────────────────────────────────────────

export type Lesing = {
  user_id: string
  user_navn: string | null
  versjon: number
  lest_at: string
}

/**
 * Hvem har lest hvilket punkt, og hvilken versjon.
 *
 * Versjonen er med fordi bekreftelsen gjelder ÉN versjon. Endres rutinen, står
 * alle som bare bekreftet den forrige som uleste igjen — automatisk. Det er
 * mekanismen forskriften ber om når den sier «herunder informasjon om
 * endringer»: en ny revisjon ber om ny bekreftelse fordi den ER en ny versjon.
 */
export async function hentLesinger(): Promise<Map<string, Lesing[]>> {
  const { data, error } = await supabase
    .from('ik_lest')
    .select('punkt_id,user_id,user_navn,versjon,lest_at')
    .order('lest_at', { ascending: false })
  if (error) throw new Error(`Kunne ikke lese bekreftelsene: ${error.message}`)

  const ut = new Map<string, Lesing[]>()
  for (const r of (data ?? []) as (Lesing & { punkt_id: string })[]) {
    const liste = ut.get(r.punkt_id) ?? []
    liste.push({ user_id: r.user_id, user_navn: r.user_navn, versjon: r.versjon, lest_at: r.lest_at })
    ut.set(r.punkt_id, liste)
  }
  return ut
}

/**
 * Bekrefter at DU har lest punktet, i den versjonen som gjelder nå.
 *
 * `user_id` settes ikke herfra — databasen setter den til `auth.uid()`, og
 * insert-policyen krever at de er like. En bekreftelse noen andre kan sette på
 * dine vegne er ikke et bevis på at du har lest noe.
 */
export async function bekreftLest(punktId: string, versjon: number, navn: string): Promise<void> {
  const { error } = await supabase
    .from('ik_lest')
    .insert({ punkt_id: punktId, versjon, user_navn: navn })
  if (error) {
    // Unik-indeksen sier at du alt har bekreftet denne versjonen. Det er ikke
    // en feil brukeren skal se som en feil.
    if (error.code === '23505') return
    throw new Error(`Kunne ikke bekrefte: ${error.message}`)
  }
}

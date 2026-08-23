// Fakturautkast ut til firmaets regnskapssystem.
//
// ── Hvorfor dette må være en Edge Function ──────────────────────────────────
//
// Et `employeeToken` i Tripletex gir tilgang til HELE regnskapet — bilag, lønn,
// kunder, historikk. Det skal aldri ligge i en nettleser og aldri på en
// montørtelefon. Tokenene bor i Supabase Vault og hentes med `service_role`,
// som bare finnes her inne (migrasjonen 20260823160000).
//
// ── Hvorfor serveren regner selv ────────────────────────────────────────────
//
// Kontoret viser allerede fakturagrunnlaget, og kunne sendt det hit ferdig
// regnet. Da ville klienten bestemt hva kunden faktureres. Utkastet godkjennes
// riktignok av et menneske inne i regnskapssystemet, så skaden er begrenset —
// men «noen ser det nok» er et håp, ikke en kontroll.
//
// Derfor leses radene fra basen her, og `byggFakturagrunnlag` fra
// `delt/invoicing.ts` gjør regningen. Det er SAMME fil som appen og kontoret
// bruker, speilet inn av `npm run bygg:regnskap` — ikke en kopi noen
// vedlikeholder ved siden av. To regnestykker på samme faktura er ett for mye.
//
// ── Vi utsteder aldri en faktura ────────────────────────────────────────────
//
// Adapterne lager UTKAST. I Tripletex er det en ordre som ikke er fakturert; i
// Fiken et fakturautkast. Knappen som gjør det til en ekte faktura med nummer
// trykkes av et menneske inne i regnskapssystemet, aldri herfra. Se prinsippet
// øverst i `delt/accounting/adapter.ts`.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   npm run bygg:regnskap          # speil delt kode inn i delt/
//   supabase functions deploy regnskap
//
// Og én gang per firma, i SQL-editoren:
//
//   update public.company_settings set regnskapssystem = 'tripletex'
//    where company_id = '<firma>';
//   select public.set_company_regnskap_token('<firma>', 'tripletex_consumer', '<token>');
//   select public.set_company_regnskap_token('<firma>', 'tripletex_employee', '<token>');
//
// Testmiljøet er standard. Sett `TRIPLETEX_BASE=https://tripletex.no/v2` som
// secret når firmaet har fått produksjonstilgang — tokens fra test virker ikke
// i produksjon, og omvendt.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'
import { byggFakturagrunnlag } from './delt/invoicing.ts'
import type { MateriellInn, TilleggInn, TimeInn } from './delt/invoicing.ts'
import type { Regnskapsadapter } from './delt/accounting/adapter.ts'
import { FikenAdapter } from './delt/accounting/fiken.ts'
import { TripletexAdapter } from './delt/accounting/tripletex.ts'

const TRIPLETEX_BASE = Deno.env.get('TRIPLETEX_BASE') ?? 'https://api-test.tripletex.tech/v2'

/** Standard betalingsfrist. Firmaspesifikk frist er ikke modellert ennå. */
const FORFALLSDAGER = 14

type Foresporsel =
  | { handling: 'send-utkast'; ordre_id?: string }
  | { handling: 'status'; ordre_id?: string }

type Svar =
  | { ok: true; sendt: { system: string; utkastId: string; kundeId: string; bruttoOre: number } }
  | { ok: true; status: string }
  | { ok: false; error: string; kanProvesIgjen?: boolean }

const svar = (s: Svar) => Response.json(s)

/**
 * Hvem får sende et utkast til regnskapet.
 *
 * Samme liste som `faktura.marker` i `lib/kontor-tilgang.ts`. Rettigheten der
 * er for GRENSESNITTET; dette er sperren. En montør med et gyldig token og en
 * `fetch` utenom appen skal ikke kunne pushe fakturagrunnlag.
 */
const KAN_FAKTURERE: readonly string[] = ['owner', 'admin', 'regnskapsforer']

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: Foresporsel
    try {
      body = await req.json()
    } catch {
      return svar({ ok: false, error: 'Ugyldig forespørsel.' })
    }

    const { data: { user }, error: brukerFeil } = await ctx.supabase.auth.getUser()
    if (brukerFeil || !user) return svar({ ok: false, error: 'Ikke logget inn.' })

    const { data: meg, error: megFeil } = await ctx.supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .maybeSingle()
    if (megFeil) return svar({ ok: false, error: megFeil.message })
    if (!meg?.company_id) return svar({ ok: false, error: 'Du hører ikke til et firma.' })
    if (!KAN_FAKTURERE.includes(meg.role)) {
      return svar({ ok: false, error: 'Bare eier, administrator og regnskapsfører kan sende til regnskap.' })
    }
    const firma = meg.company_id as string

    const ordreId = (body.ordre_id ?? '').trim()
    if (!ordreId) return svar({ ok: false, error: 'Mangler ordre.' })

    // ── Hvilket system, og med hvilke nøkler? ──────────────────────────────
    const { data: oppsett, error: oppsettFeil } = await ctx.supabaseAdmin
      .from('company_settings')
      .select('regnskapssystem')
      .eq('company_id', firma)
      .maybeSingle()
    if (oppsettFeil) return svar({ ok: false, error: oppsettFeil.message })

    const system = (oppsett?.regnskapssystem ?? 'ingen') as string
    if (system === 'ingen') {
      return svar({ ok: false, error: 'Firmaet har ikke koblet et regnskapssystem ennå.' })
    }

    const token = async (navn: string): Promise<string | null> => {
      const { data } = await ctx.supabaseAdmin
        .rpc('get_company_regnskap_token', { p_company_id: firma, p_navn: navn })
      return (data as string | null) ?? null
    }

    let adapter: Regnskapsadapter
    if (system === 'tripletex') {
      const [forbruker, ansatt] = await Promise.all([
        token('tripletex_consumer'),
        token('tripletex_employee'),
      ])
      if (!forbruker || !ansatt) {
        return svar({ ok: false, error: 'Tripletex-tokenene mangler. Sett dem med set_company_regnskap_token().' })
      }
      adapter = new TripletexAdapter({
        consumerToken: forbruker,
        employeeToken: ansatt,
        baseUrl: TRIPLETEX_BASE,
      })
    } else {
      const [fikenToken, slug] = await Promise.all([token('fiken_token'), token('fiken_slug')])
      if (!fikenToken || !slug) {
        return svar({ ok: false, error: 'Fiken-nøklene mangler. Sett dem med set_company_regnskap_token().' })
      }
      adapter = new FikenAdapter({ companySlug: slug, token: fikenToken })
    }

    // ── Ordren, og alt fakturaen bygger på ────────────────────────────────
    //
    // `supabaseAdmin` og eksplisitt `company_id`-filter på hver spørring: RLS
    // er omgått her, så isolasjonen må gjenskapes for hånd. Uten `.eq` på
    // firma ville en gjettet ordre-ID fra et annet firma svart med data.
    const [o, m, t, e, ak] = await Promise.all([
      ctx.supabaseAdmin.from('orders')
        .select('id,order_number,title,address,customer_id,customer_name,invoice_external_id,created_at')
        .eq('id', ordreId).eq('company_id', firma).is('deleted_at', null).maybeSingle(),
      ctx.supabaseAdmin.from('order_materials')
        .select('id,description,quantity,unit,elnummer,unit_price,cost_price,vat_type,billable,invoiced_at,discount_percent')
        .eq('order_id', ordreId).is('deleted_at', null),
      ctx.supabaseAdmin.from('time_entries')
        .select('id,user_id,user_name,date,hours,note,activity_id,billable,invoiced_at')
        .eq('order_id', ordreId).is('deleted_at', null),
      ctx.supabaseAdmin.from('order_extras')
        .select('id,title,description,pricing,price,vat_type,status,approved_by,invoiced_at')
        .eq('order_id', ordreId).is('deleted_at', null),
      ctx.supabaseAdmin.from('activities')
        .select('id,name,hourly_rate,billable,vat_type')
        .eq('company_id', firma).is('deleted_at', null),
    ])

    const forste = [o, m, t, e, ak].find(r => r.error)
    if (forste?.error) return svar({ ok: false, error: forste.error.message })
    if (!o.data) return svar({ ok: false, error: 'Fant ikke ordren.' })
    const ordre = o.data as Record<string, unknown>

    if (body.handling === 'status') {
      const eksternId = ordre.invoice_external_id as string | null
      if (!eksternId) return svar({ ok: true, status: 'ikke_sendt' })
      const r = await adapter.hentFakturastatus(eksternId)
      if (!r.ok) return svar({ ok: false, error: r.feil, kanProvesIgjen: r.kanProvesIgjen })
      return svar({ ok: true, status: r.verdi })
    }

    if (body.handling !== 'send-utkast') return svar({ ok: false, error: 'Ukjent handling.' })

    // ── Regningen. Samme fil som appen og kontoret bruker. ────────────────
    const aktiviteter = new Map(
      ((ak.data ?? []) as Record<string, unknown>[]).map(a => [a.id as string, a]),
    )

    const materiell: MateriellInn[] = ((m.data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string,
      beskrivelse: r.description as string,
      antall: r.quantity as number,
      enhet: r.unit as string,
      elnummer: r.elnummer as string | null,
      enhetsprisKr: r.unit_price as number | null,
      kostprisKr: r.cost_price as number | null,
      mvaType: r.vat_type as string | null,
      fakturerbar: r.billable as boolean | null,
      fakturertTid: r.invoiced_at ? new Date(r.invoiced_at as string).getTime() : null,
      rabattProsent: r.discount_percent as number | null,
    }))

    const timer: TimeInn[] = ((t.data ?? []) as Record<string, unknown>[]).map(r => {
      const a = r.activity_id ? aktiviteter.get(r.activity_id as string) : undefined
      return {
        id: r.id as string,
        aktivitetId: r.activity_id as string | null,
        aktivitetNavn: (a?.name as string) ?? null,
        aktivitetTimepris: (a?.hourly_rate as number) ?? null,
        aktivitetFakturerbar: (a?.billable as boolean) ?? null,
        aktivitetMva: (a?.vat_type as string) ?? null,
        personId: r.user_id as string,
        personNavn: (r.user_name as string) ?? '',
        dato: new Date(r.date as string).getTime(),
        timer: r.hours as number,
        // `internal_note` hentes bevisst ikke: den skal aldri på en faktura.
        notat: r.note as string | null,
        fakturerbar: r.billable as boolean | null,
        fakturertTid: r.invoiced_at ? new Date(r.invoiced_at as string).getTime() : null,
      }
    })

    const tillegg: TilleggInn[] = ((e.data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string,
      tittel: r.title as string,
      beskrivelse: r.description as string | null,
      prising: r.pricing === 'fastpris' ? 'fastpris' : 'medgatt',
      prisKr: r.price as number | null,
      mvaType: r.vat_type as string | null,
      status: r.status === 'godkjent' || r.status === 'avvist' ? r.status : 'foreslatt',
      godkjentAv: r.approved_by as string | null,
      fakturertTid: r.invoiced_at ? new Date(r.invoiced_at as string).getTime() : null,
    }))

    const grunnlag = byggFakturagrunnlag(materiell, timer, {}, tillegg)
    if (grunnlag.linjer.length === 0) {
      return svar({ ok: false, error: 'Ordren har ingen fakturerbare linjer.' })
    }

    // ── Kunden må finnes i regnskapet FØRST ───────────────────────────────
    //
    // Regnskapet eier kunderegisteret (se `delt/accounting/adapter.ts`). Uten
    // en ekstern ID kan ikke utkastet peke på noen, og en ordre uten kunde er
    // en faktura ingen kan sende.
    const kundeId = ordre.customer_id as string | null
    if (!kundeId) {
      return svar({ ok: false, error: 'Ordren har ingen kunde fra kunderegisteret. Velg en kunde først.' })
    }

    const { data: kunde, error: kundeFeil } = await ctx.supabaseAdmin
      .from('customers')
      .select('id,name,is_company,org_nr,email,phone,address,postal_code,city,external_id,source_system')
      .eq('id', kundeId).eq('company_id', firma).is('deleted_at', null).maybeSingle()
    if (kundeFeil) return svar({ ok: false, error: kundeFeil.message })
    if (!kunde) return svar({ ok: false, error: 'Fant ikke kunden.' })

    // En ekstern ID fra ET ANNET system er ikke gyldig her. Uten denne sjekken
    // ville en Fiken-ID blitt sendt til Tripletex som om den var deres.
    let eksternKunde = (kunde.source_system === system ? kunde.external_id : null) as string | null

    if (!eksternKunde) {
      const r = await adapter.synkKunde({
        navn: kunde.name as string,
        erBedrift: Boolean(kunde.is_company),
        orgNr: kunde.org_nr as string | null,
        epost: kunde.email as string | null,
        telefon: kunde.phone as string | null,
        adresse: kunde.address as string | null,
        postnummer: kunde.postal_code as string | null,
        poststed: kunde.city as string | null,
        lokalId: kunde.id as string,
      })
      if (!r.ok) return svar({ ok: false, error: r.feil, kanProvesIgjen: r.kanProvesIgjen })
      eksternKunde = r.verdi

      const { error: skrivFeil } = await ctx.supabaseAdmin
        .from('customers')
        .update({ external_id: eksternKunde, source_system: system })
        .eq('id', kundeId)
      // Kunden finnes nå der ute. Klarer vi ikke skrive ID-en tilbake, ville et
      // nytt forsøk laget en DUPLIKAT kunde — og da går fakturaen til feil
      // rad. Derfor stopper vi her i stedet for å fortsette.
      if (skrivFeil) {
        return svar({
          ok: false,
          error: `Kunden ble opprettet i ${adapter.navn}, men koblingen ble ikke lagret: ${skrivFeil.message}`,
          kanProvesIgjen: false,
        })
      }
    }

    // ── Utkastet ──────────────────────────────────────────────────────────
    const utkast = await adapter.opprettFakturautkast({
      lokalOrdreId: ordreId,
      ordrenummer: (ordre.order_number as number) ?? null,
      tittel: ordre.title as string,
      kundeEksternId: eksternKunde,
      dato: new Date(),
      forfallsdager: FORFALLSDAGER,
      grunnlag,
      ordreTekst: (ordre.address as string | null) ?? null,
    })
    if (!utkast.ok) return svar({ ok: false, error: utkast.feil, kanProvesIgjen: utkast.kanProvesIgjen })

    const { error: merkFeil } = await ctx.supabaseAdmin
      .from('orders')
      .update({
        invoice_external_id: utkast.verdi,
        source_system: system,
        regnskap_sendt_at: new Date().toISOString(),
      })
      .eq('id', ordreId)
    if (merkFeil) {
      return svar({
        ok: false,
        error: `Utkastet ble laget i ${adapter.navn} (${utkast.verdi}), men ordren ble ikke merket: ${merkFeil.message}`,
        kanProvesIgjen: false,
      })
    }

    // Revisjonslinja skrives med `service_role` rett inn, samme grunn som i
    // ampex-admin: `log_audit_event` henter firmaet fra `current_company_id()`.
    await ctx.supabaseAdmin.from('audit_events').insert({
      company_id: firma,
      actor_id: user.id,
      actor_name: user.email ?? 'Ampex',
      operasjon: 'hendelse',
      hendelse: 'faktura.utkast_sendt',
      tabell: 'orders',
      rad_id: ordreId,
      detaljer: {
        system,
        utkast_id: utkast.verdi,
        brutto_ore: grunnlag.bruttoOre,
        linjer: grunnlag.linjer.length,
      },
    })

    return svar({
      ok: true,
      sendt: {
        system,
        utkastId: utkast.verdi,
        kundeId: eksternKunde,
        bruttoOre: grunnlag.bruttoOre,
      },
    })
  }),
}

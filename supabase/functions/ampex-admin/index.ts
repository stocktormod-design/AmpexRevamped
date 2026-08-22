// Ampex-flata: opprett et firma, og se hvilke som finnes.
//
// ── Hvorfor dette ikke er selvbetjening ─────────────────────────────────────
//
// Et firma i Ampex er en tenancy. Alt i basen er isolert per `company_id`, og
// den som oppretter et firma blir eier av det med én gang. En registrerings-
// side på ampex.no ville betydd at hvem som helst kan lage seg en tenancy hos
// oss, og at «hvem er kunde» blir et spørsmål ingen kan svare på uten å telle
// rader. Firmaer opprettes derfor av Ampex, og lista over hvem som får gjøre
// det er tabellen `ampex_admins`.
//
// ── Hvorfor service_role, ikke en RLS-policy ────────────────────────────────
//
// Alternativet var en policy på `companies` som sier «ampex-admin får skrive
// alt». Da ville tilgang over ALLE firmaer ligget i RLS-laget, i samme
// mekanisme som holder firmaene fra hverandre — og en feil der er en feil i
// isolasjonen. Her ligger den i stedet i én funksjon som gjør én ting, og
// RLS fortsetter å si det den har sagt hele tiden: du ser ditt eget firma.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase functions deploy ampex-admin
//   supabase secrets set AMPEX_NETTSTED=https://www.ampex.no/
//
// Og én gang, i SQL-editoren (se migrasjonen 20260822120000):
//
//   insert into public.ampex_admins (user_id, notat)
//   select id, 'Tormod' from auth.users where email = 'din@adresse.no';
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

const NETTSTED = Deno.env.get('AMPEX_NETTSTED') ?? 'https://www.ampex.no/'

type Foresporsel =
  | { handling: 'firmaer' }
  | { handling: 'bytt-firma'; firma_id?: string }
  | { handling: 'opprett'; navn?: string; org_nummer?: string; eier_epost?: string; eier_navn?: string }

type Firmarad = {
  id: string
  name: string
  org_number: string | null
  created_at: string
  deleted_at: string | null
  ansatte: number
  aktive: number
}

type Svar =
  | { ok: true; firmaer: Firmarad[] }
  | { ok: true; opprettet: { id: string; navn: string; eier_epost: string } }
  | { ok: true; byttet: { id: string; navn: string } }
  | { ok: false; error: string }

const svar = (s: Svar) => Response.json(s)

function gyldigEpost(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

/**
 * Norsk organisasjonsnummer er ni siffer, og siste er en MOD11-kontrollsiffer.
 *
 * Sjekken er verdt de ti linjene: `companies.org_number` er unik, og et
 * feiltastet nummer blir stående som firmaets identitet mot Brønnøysund,
 * fakturaer og samsvarserklæringer. Det oppdages typisk året etter.
 */
function gyldigOrgnummer(n: string): boolean {
  if (!/^\d{9}$/.test(n)) return false
  const vekt = [3, 2, 7, 6, 5, 4, 3, 2]
  const sum = vekt.reduce((s, v, i) => s + v * Number(n[i]), 0)
  const rest = sum % 11
  const kontroll = rest === 0 ? 0 : 11 - rest
  return kontroll < 10 && kontroll === Number(n[8])
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: Foresporsel
    try {
      body = await req.json()
    } catch {
      return svar({ ok: false, error: 'Ugyldig forespørsel.' })
    }

    // ── Er den som spør Ampex-administrator? ───────────────────────────────
    const { data: { user }, error: brukerFeil } = await ctx.supabase.auth.getUser()
    if (brukerFeil || !user) return svar({ ok: false, error: 'Ikke logget inn.' })

    const { data: admin, error: adminFeil } = await ctx.supabaseAdmin
      .from('ampex_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (adminFeil) return svar({ ok: false, error: adminFeil.message })
    if (!admin) {
      // Samme svar som en ukjent handling ville gitt. Den som ikke er
      // Ampex-admin skal ikke få vite at det finnes en flate her.
      console.warn('[ampex-admin] avvist:', user.id)
      return svar({ ok: false, error: 'Ukjent handling.' })
    }

    if (body.handling === 'firmaer') {
      const { data: firmaer, error } = await ctx.supabaseAdmin
        .from('companies')
        .select('id,name,org_number,created_at,deleted_at')
        .order('created_at', { ascending: false })
      if (error) return svar({ ok: false, error: error.message })

      const { data: profiler, error: pFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .select('company_id,deleted_at')
      if (pFeil) return svar({ ok: false, error: pFeil.message })

      const tell = new Map<string, { ansatte: number; aktive: number }>()
      for (const p of profiler ?? []) {
        if (!p.company_id) continue
        const t = tell.get(p.company_id) ?? { ansatte: 0, aktive: 0 }
        t.ansatte++
        if (!p.deleted_at) t.aktive++
        tell.set(p.company_id, t)
      }

      return svar({
        ok: true,
        firmaer: (firmaer ?? []).map(f => ({
          ...f,
          ansatte: tell.get(f.id)?.ansatte ?? 0,
          aktive: tell.get(f.id)?.aktive ?? 0,
        })) as Firmarad[],
      })
    }

    // ── Bytt hvilket firma Ampex-administratoren selv står i ──────────────
    //
    // Dette ER en tenancy-endring, altså nøyaktig det `profiles_vern` finnes
    // for å hindre. At den likevel er lov her hviler på tre ting, og alle tre
    // må stemme:
    //
    //   1. Den skjer med `service_role`, som er unntaket triggeren har
    //      (`auth.uid() is null`). Ingen klient kan gjøre dette selv.
    //   2. Kalleren er slått opp i `ampex_admins` lenger oppe i denne
    //      funksjonen — ikke i et flagg klienten kunne satt på seg selv.
    //   3. Det gir ingen NY tilgang. En Ampex-admin leser og skriver allerede
    //      alle firmaer gjennom denne funksjonen; dette bestemmer bare hvilket
    //      firma skjermbildene hans viser.
    //
    // Prisen står i revisjonssporet: rader han lager etter byttet føres på det
    // nye firmaet. Derfor logges byttet i BEGGE firmaene, så et hopp i
    // historikken har en forklaring ved siden av seg.
    if (body.handling === 'bytt-firma') {
      const firmaId = (body.firma_id ?? '').trim()
      if (!firmaId) return svar({ ok: false, error: 'Mangler firma.' })

      const { data: firma, error } = await ctx.supabaseAdmin
        .from('companies')
        .select('id,name,deleted_at')
        .eq('id', firmaId)
        .maybeSingle()
      if (error) return svar({ ok: false, error: error.message })
      if (!firma) return svar({ ok: false, error: 'Fant ikke firmaet.' })
      if (firma.deleted_at) return svar({ ok: false, error: 'Firmaet er slettet.' })

      const { data: for_, error: forFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle()
      if (forFeil) return svar({ ok: false, error: forFeil.message })
      if (for_?.company_id === firma.id) {
        return svar({ ok: true, byttet: { id: firma.id, navn: firma.name } })
      }

      const { error: byttFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .update({ company_id: firma.id })
        .eq('id', user.id)
      if (byttFeil) return svar({ ok: false, error: byttFeil.message })

      const linje = (companyId: string, hendelse: string, detaljer: Record<string, unknown>) =>
        ctx.supabaseAdmin.from('audit_events').insert({
          company_id: companyId,
          actor_id: user.id,
          actor_name: user.email ?? 'Ampex',
          operasjon: 'hendelse',
          hendelse,
          detaljer,
        })

      if (for_?.company_id) {
        await linje(for_.company_id, 'ampex.forlot', { til: firma.id, av: 'ampex-admin' })
      }
      await linje(firma.id, 'ampex.byttet_inn', { fra: for_?.company_id ?? null, av: 'ampex-admin' })

      return svar({ ok: true, byttet: { id: firma.id, navn: firma.name } })
    }

    if (body.handling !== 'opprett') return svar({ ok: false, error: 'Ukjent handling.' })

    const navn = (body.navn ?? '').trim()
    const orgNummer = (body.org_nummer ?? '').replace(/\s/g, '')
    const eierEpost = (body.eier_epost ?? '').trim().toLowerCase()
    const eierNavn = (body.eier_navn ?? '').trim()

    if (!navn) return svar({ ok: false, error: 'Firmaet må ha et navn.' })
    if (orgNummer && !gyldigOrgnummer(orgNummer)) {
      return svar({ ok: false, error: 'Organisasjonsnummeret har feil kontrollsiffer.' })
    }
    if (!gyldigEpost(eierEpost)) return svar({ ok: false, error: 'Skriv en gyldig e-post til eieren.' })
    if (!eierNavn) return svar({ ok: false, error: 'Skriv navnet til eieren.' })

    // ── Er eierens adresse ledig? ──────────────────────────────────────────
    //
    // Sjekkes FØR firmaet opprettes. Rekkefølgen er hele poenget: feiler den
    // etterpå, står det igjen et firma uten eier som ingen leter etter.
    const { data: funn, error: funnFeil } = await ctx.supabaseAdmin
      .rpc('finn_bruker_paa_epost', { p_epost: eierEpost })
    if (funnFeil) return svar({ ok: false, error: funnFeil.message })

    const fra_for = Array.isArray(funn) ? funn[0] : funn
    if (fra_for?.company_id) {
      return svar({ ok: false, error: 'Adressen er allerede eier eller ansatt i et annet firma.' })
    }

    const { data: firma, error: firmaFeil } = await ctx.supabaseAdmin
      .from('companies')
      .insert({ name: navn, org_number: orgNummer || null })
      .select('id')
      .single()

    if (firmaFeil || !firma) {
      const duplikat = /duplicate key|unique/i.test(firmaFeil?.message ?? '')
      return svar({
        ok: false,
        error: duplikat ? 'Det finnes allerede et firma med dette organisasjonsnummeret.' : (firmaFeil?.message ?? 'Fikk ikke opprettet firmaet.'),
      })
    }

    // `company_settings` har ingen trigger som lager raden, og alle kolonnene
    // utenom company_id har default. Uten den svarer firmaoppsettet tomt.
    const { error: oppsettFeil } = await ctx.supabaseAdmin
      .from('company_settings')
      .insert({ company_id: firma.id })

    if (oppsettFeil) {
      await ctx.supabaseAdmin.from('companies').update({ deleted_at: new Date().toISOString() }).eq('id', firma.id)
      return svar({ ok: false, error: `Firmaet ble ikke satt opp: ${oppsettFeil.message}` })
    }

    // ── Eieren ─────────────────────────────────────────────────────────────
    const nyBruker = fra_for?.id
      ? { id: fra_for.id as string }
      : (await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(eierEpost, {
          data: { full_name: eierNavn },
          redirectTo: NETTSTED,
        })).data?.user ?? null

    if (!nyBruker) {
      // Firmaet ble opprettet, men eieren kom aldri fram. Soft delete, som
      // regel 5 sier — men det er ingen bevaring for bevaringens skyld:
      // et firma uten eier er et firma ingen kan komme inn i.
      await ctx.supabaseAdmin.from('companies').update({ deleted_at: new Date().toISOString() }).eq('id', firma.id)
      return svar({ ok: false, error: 'Fikk ikke sendt invitasjonen til eieren. Firmaet ble ikke opprettet.' })
    }

    const { error: profilFeil } = await ctx.supabaseAdmin
      .from('profiles')
      .update({ company_id: firma.id, role: 'owner', full_name: eierNavn })
      .eq('id', nyBruker.id)

    if (profilFeil) {
      await ctx.supabaseAdmin.from('companies').update({ deleted_at: new Date().toISOString() }).eq('id', firma.id)
      return svar({ ok: false, error: `Eieren ble ikke koblet til firmaet: ${profilFeil.message}` })
    }

    // Ikke `log_audit_event`: den henter firmaet fra `current_company_id()` og
    // kaster «ingen firmatilhørighet» hvis kalleren ikke har et. En Ampex-admin
    // har som regel ikke det, og skal ikke ha det.
    //
    // Raden skrives derfor rett inn, på det NYE firmaet. Det er også der den
    // hører hjemme: firmaets historikk begynner med at det ble opprettet, og
    // av hvem.
    await ctx.supabaseAdmin.from('audit_events').insert({
      company_id: firma.id,
      actor_id: user.id,
      actor_name: user.email ?? 'Ampex',
      operasjon: 'hendelse',
      hendelse: 'firma.opprettet',
      detaljer: { navn, org_nummer: orgNummer || null, eier_epost: eierEpost, av: 'ampex-admin' },
    })

    return svar({ ok: true, opprettet: { id: firma.id, navn, eier_epost: eierEpost } })
  }),
}

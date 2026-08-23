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
  | { handling: 'folk'; firma_id?: string }
  | { handling: 'send-paa-nytt'; bruker_id?: string }
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

/**
 * En person i et firma, sett fra Ampex-flata.
 *
 * `bekreftet_at` er `auth.users.email_confirmed_at`, og det er ikke en
 * vilkårlig av tre datoer: det er nøyaktig feltet GoTrue selv ser på når
 * `/invite` bestemmer seg for å avvise en ny invitasjon. Skjermen skal vise
 * det samme skillet som serveren kommer til å handle etter.
 */
type Folkerad = {
  id: string
  epost: string
  full_name: string | null
  role: string
  invitert_at: string | null
  bekreftet_at: string | null
  sist_innlogget_at: string | null
  deleted_at: string | null
}

/** Hva som faktisk gikk ut. Se `sendPaaNytt` under. */
type Slag = 'invitasjon' | 'passord'

type Svar =
  | { ok: true; firmaer: Firmarad[] }
  | { ok: true; folk: Folkerad[] }
  | { ok: true; sendt: { epost: string; slag: Slag } }
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

    // ── Folkene i ETT firma ───────────────────────────────────────────────
    //
    // `firmaets_ansatte()` kan ikke brukes her: den filtrerer på
    // `current_company_id()` inne i seg selv, og en Ampex-admin står som regel
    // ikke i firmaet han ser på. Derfor `ampex_firmaets_folk(firma)` fra
    // migrasjonen 20260823120000 — som til gjengjeld er trukket fra både anon
    // og authenticated, så bare `service_role` når den.
    if (body.handling === 'folk') {
      const firmaId = (body.firma_id ?? '').trim()
      if (!firmaId) return svar({ ok: false, error: 'Mangler firma.' })

      const { data, error } = await ctx.supabaseAdmin
        .rpc('ampex_firmaets_folk', { p_firma: firmaId })
      if (error) return svar({ ok: false, error: error.message })

      return svar({ ok: true, folk: (data ?? []) as Folkerad[] })
    }

    // ── Send lenken en gang til ───────────────────────────────────────────
    //
    // Én knapp, to utfall, og hvilket av dem det blir er ikke noe skjermen
    // skal gjette. GoTrue avgjør det: `/invite` avviser en bruker som har
    // bekreftet e-posten sin («A user with this email address has already been
    // registered»), fordi en invitasjon er måten en konto BLIR til. Har hun
    // allerede laget seg en, er det ikke en invitasjon hun mangler — det er
    // veien inn i den kontoen hun har.
    //
    // Derfor leses `email_confirmed_at` her, som er nøyaktig det feltet
    // `/invite` selv ser på, og ikke `last_sign_in_at`. En som har trykket på
    // invitasjonen og valgt passord, men aldri logget inn igjen etterpå, HAR
    // en konto — hun skal ha en passordlenke, ikke en invitasjon som vil
    // feile.
    //
    // Klienten oppgir aldri hvilken av de to den vil ha. Da ville skjermen og
    // GoTrue kunnet være uenige, og den uenigheten ville blitt en feilmelding
    // hos den som skulle purre.
    if (body.handling === 'send-paa-nytt') {
      const brukerId = (body.bruker_id ?? '').trim()
      if (!brukerId) return svar({ ok: false, error: 'Mangler bruker.' })

      const { data: hentet, error: hentFeil } = await ctx.supabaseAdmin.auth.admin
        .getUserById(brukerId)
      const konto = hentet?.user
      if (hentFeil || !konto?.email) {
        return svar({ ok: false, error: 'Fant ikke brukeren.' })
      }
      const epost = konto.email

      // Profilen leses for to ting: at personen ikke er trukket, og hvilket
      // firma revisjonslinja hører hjemme i.
      const { data: profil, error: profilFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .select('company_id,full_name,deleted_at')
        .eq('id', brukerId)
        .maybeSingle()
      if (profilFeil) return svar({ ok: false, error: profilFeil.message })
      if (!profil) return svar({ ok: false, error: 'Brukeren har ingen profil.' })
      if (profil.deleted_at) {
        return svar({ ok: false, error: 'Personen er trukket ut av firmaet. Inviter på nytt i stedet.' })
      }

      const harKonto = Boolean(konto.email_confirmed_at)
      const slag: Slag = harKonto ? 'passord' : 'invitasjon'

      if (harKonto) {
        // Ingen admin-vei sender denne e-posten: `generateLink` lager bare
        // lenken, og en gjenopprettingslenke på skjermen til en Ampex-admin er
        // en vei inn i kundens konto. Derfor det vanlige, offentlige
        // endepunktet — lenken går dit den skal, til adressen selv.
        const { error } = await ctx.supabase.auth.resetPasswordForEmail(epost, {
          redirectTo: NETTSTED,
        })
        if (error) {
          console.error('[ampex-admin] passordlenke feilet:', error)
          return svar({ ok: false, error: error.message })
        }
      } else {
        // Navnet sendes med igjen. `data` overskriver user_metadata, og en
        // invitasjon som tømmer navnet ville gjort en purring til et tap.
        const { error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(epost, {
          data: { full_name: profil.full_name ?? undefined },
          redirectTo: NETTSTED,
        })
        if (error) {
          console.error('[ampex-admin] invitasjon feilet:', error)
          return svar({ ok: false, error: error.message })
        }
      }

      // Samme grunn som ved firmaoppretting: `log_audit_event` henter firmaet
      // fra `current_company_id()`, og en Ampex-admin har som regel ikke et.
      // Raden skrives rett inn, på firmaet personen tilhører.
      if (profil.company_id) {
        await ctx.supabaseAdmin.from('audit_events').insert({
          company_id: profil.company_id,
          actor_id: user.id,
          actor_name: user.email ?? 'Ampex',
          operasjon: 'hendelse',
          hendelse: harKonto ? 'bruker.passordlenke_sendt' : 'bruker.invitert_paa_nytt',
          detaljer: { epost, av: 'ampex-admin' },
        })
      }

      return svar({ ok: true, sendt: { epost, slag } })
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

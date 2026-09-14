// Slett din egen bruker. Krever passordet på nytt.
//
// ── Hvorfor dette er en Edge Function ───────────────────────────────────────
//
// Retten til sletting (personvernforordningen art. 17) skal kunne utøves av
// brukeren selv, uten å be noen. Men en klient kan ikke gjøre det:
//
//   * `auth.users` nås bare med `service_role`.
//   * `profiles.id` kaskaderer fra `auth.users` (ON DELETE CASCADE), og rundt
//     førti tabeller peker på `profiles(id)` UTEN kaskade — timer, signaturer,
//     godkjenninger, audit. En hard sletting av auth-brukeren ville derfor
//     enten feile på første fremmednøkkel, eller (for en bruker uten data)
//     hard-slette profilen, som regel 5 forbyr.
//
// ── Hva som slettes, og hva som beholdes ────────────────────────────────────
//
// SLETTES / ANONYMISERES
//   profiles         full_name → «Slettet bruker», phone → null, deleted_at satt.
//                    Raden består: alt som peker på den skal fortsatt kunne
//                    peke på noe.
//   auth.users       myk sletting i GoTrue (`deleteUser(id, true)`): e-post og
//                    telefon skrives om, passordet fjernes, øktene og
//                    identitetene ryddes. Adressen blir ledig igjen.
//   mfa-faktorer     fjernes eksplisitt. Myk sletting lar dem ellers ligge.
//
// BEHOLDES
//   time_entries, order_signatures, order_approvals, audit_events m.fl.
//   Dette er regnskaps- og dokumentasjonsmateriale (bokføringsloven § 13,
//   bokføringsforskriften § 8-4 om timelister) som firmaet er PÅLAGT å
//   oppbevare i fem år. Lovpålagt oppbevaring er et unntak fra retten til
//   sletting (art. 17 nr. 3 b). `time_entries.user_name` står derfor igjen:
//   en timeliste uten hvem som utførte arbeidet er ikke en timeliste.
//
// ── Sperrene ────────────────────────────────────────────────────────────────
//
//   * Passordet må oppgis og sjekkes HER, med et vanlig `signInWithPassword`
//     mot anon-nøkkelen. En økt som står åpen på en delt kontor-PC skal ikke
//     kunne slette kontoen til den som glemte å logge ut.
//   * Den eneste eieren i et firma med andre aktive ansatte kan ikke slette
//     seg selv. Da ville firmaet stå uten noen som kan invitere, sette roller
//     eller avslutte. Gi en annen eierrollen først.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase functions deploy slett-bruker
//
// Ingen egne hemmeligheter: SUPABASE_URL, SUPABASE_ANON_KEY og
// SUPABASE_SERVICE_ROLE_KEY er der fra før.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'
import { createClient } from 'npm:@supabase/supabase-js@2'

type Svar = { ok: true; slettet: true } | { ok: false; error: string }
const svar = (s: Svar) => Response.json(s)

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: { passord?: string }
    try {
      body = await req.json()
    } catch {
      return svar({ ok: false, error: 'Ugyldig forespørsel.' })
    }

    const passord = typeof body.passord === 'string' ? body.passord : ''
    if (!passord) return svar({ ok: false, error: 'Skriv inn passordet ditt.' })

    // ── Hvem spør? ─────────────────────────────────────────────────────────
    const { data: { user }, error: brukerFeil } = await ctx.supabase.auth.getUser()
    if (brukerFeil || !user) return svar({ ok: false, error: 'Ikke logget inn.' })
    if (!user.email) return svar({ ok: false, error: 'Kontoen har ingen e-postadresse.' })

    // ── Er det virkelig deg? ───────────────────────────────────────────────
    //
    // En frisk klient uten lagring: innloggingen skal ikke etterlate seg noen
    // økt her, den skal bare svare ja eller nei.
    const anon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { data: prøve, error: prøveFeil } = await anon.auth.signInWithPassword({
      email: user.email,
      password: passord,
    })
    if (prøveFeil || prøve.user?.id !== user.id) {
      console.warn('[slett-bruker] feil passord:', user.id)
      return svar({ ok: false, error: 'Feil passord.' })
    }
    // Prøveøkta lagres ikke (persistSession: false), og den myke slettingen
    // under logger ut alle øktene til brukeren uansett.

    // ── Profilen, og den eneste eieren ─────────────────────────────────────
    const { data: meg, error: megFeil } = await ctx.supabaseAdmin
      .from('profiles')
      .select('company_id, role, full_name')
      .eq('id', user.id)
      .maybeSingle()
    if (megFeil) return svar({ ok: false, error: megFeil.message })

    if (meg?.company_id && meg.role === 'owner') {
      const { data: andre, error: andreFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('company_id', meg.company_id)
        .is('deleted_at', null)
        .neq('id', user.id)
      if (andreFeil) return svar({ ok: false, error: andreFeil.message })

      const harAndre = (andre ?? []).length > 0
      const harAnnenEier = (andre ?? []).some(p => p.role === 'owner' || p.role === 'admin')
      if (harAndre && !harAnnenEier) {
        return svar({
          ok: false,
          error:
            'Du er den eneste eieren i firmaet. Gi en annen eier- eller administratorrollen først, ' +
            'ellers står firmaet uten noen som kan styre det.',
        })
      }
    }

    // ── Spor i loggen, FØR navnet forsvinner ───────────────────────────────
    //
    // `actor_id` peker på profilen, som består. Navnet skrives i `actor_name`
    // fordi det er det siste stedet det skal finnes: loggen skal kunne si
    // «denne personen slettet seg selv», ikke «Slettet bruker slettet seg».
    if (meg?.company_id) {
      await ctx.supabaseAdmin.from('audit_events').insert({
        company_id: meg.company_id,
        actor_id: user.id,
        actor_name: meg.full_name || user.email,
        tabell: 'profiles',
        rad_id: user.id,
        operasjon: 'hendelse',
        hendelse: 'bruker.slettet_seg_selv',
        detaljer: { epost: user.email, rolle: meg.role },
      })
    }

    // ── Profilen anonymiseres og soft-slettes ──────────────────────────────
    //
    // `company_id` og `role` beholdes med vilje: radene som peker hit
    // tilhører fortsatt det firmaet, og RLS på dem leser firmaet fra raden
    // selv, ikke fra profilen. `profiles_vern` slipper service_role gjennom.
    if (meg) {
      const { error } = await ctx.supabaseAdmin
        .from('profiles')
        .update({ full_name: 'Slettet bruker', phone: null, deleted_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) return svar({ ok: false, error: error.message })
    }

    // ── Autentiseringsappen ────────────────────────────────────────────────
    const { data: faktorer } = await ctx.supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id })
    for (const f of faktorer?.factors ?? []) {
      await ctx.supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id }).catch(() => undefined)
    }

    // ── Innloggingen ───────────────────────────────────────────────────────
    //
    // Myk sletting, ikke hard: hard ville kaskadert til `profiles` og stoppet
    // på første fremmednøkkel (se toppen). GoTrue skriver om e-post og
    // telefon, tømmer passordet og setter `deleted_at`, så adressen kan
    // brukes til en ny invitasjon senere.
    const { error: authFeil } = await ctx.supabaseAdmin.auth.admin.deleteUser(user.id, true)
    if (authFeil) {
      // Profilen er alt deaktivert, så personen kommer ikke inn i appen —
      // men innloggingen består, og det må noen rydde i. Si det.
      console.error('[slett-bruker] profil slettet, auth feilet:', user.id, authFeil.message)
      return svar({
        ok: false,
        error: 'Profilen er slettet, men innloggingen kunne ikke fjernes: ' + authFeil.message +
          '. Ta kontakt med Ampex, så fullfører vi slettingen.',
      })
    }

    console.log('[slett-bruker] slettet:', user.id)
    return svar({ ok: true, slettet: true })
  }),
}

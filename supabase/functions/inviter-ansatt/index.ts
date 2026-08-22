// Inviter en ansatt inn i sitt eget firma.
//
// ── Hvorfor denne må være en Edge Function ──────────────────────────────────
//
// `profiles.company_id` kan ikke settes fra en klient. `profiles_vern`-triggeren
// i 20260821230000_sikkerhet.sql avviser enhver endring av kolonnen, uansett
// hvem som spør, og det er riktig: company_id ER tenancy-modellen — hele RLS-
// laget sier «company_id = current_company_id()». Kunne en klient skrive den,
// kunne en klient flytte seg selv inn i et fremmed firma.
//
// Triggeren har ett unntak: `auth.uid() is null`, altså `service_role`. Denne
// funksjonen er den eneste stedet det unntaket brukes til å legge til folk, og
// den bruker det ETTER å ha slått opp hvem som spør og hvilket firma HUN hører
// til. Klienten oppgir aldri et company_id — den finnes ikke i forespørselen.
//
// ── Utfallene ───────────────────────────────────────────────────────────────
//
//   invitert     ny konto, invitasjons-e-post sendt (supabase/templates/invite.html)
//   lagt-til     kontoen fantes uten firma, og er nå med. Ingen e-post.
//   finnes       står allerede i firmaet ditt. Ingen endring.
//   opptatt      adressen tilhoerer et ANNET firma. Avvist.
//
// Det siste er en avvisning og ikke en flytting, og det er med vilje. Å flytte
// en person mellom firmaer er en tenancy-endring: timene, signaturene og
// samsvarserklæringene hennes ligger i det gamle firmaet. Det skal ikke skje
// fordi noen tastet feil adresse i et invitasjonsfelt.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase functions deploy inviter-ansatt
//   supabase secrets set AMPEX_NETTSTED=https://www.ampex.no/
//
// AMPEX_NETTSTED må også stå i Authentication → URL Configuration → Redirect
// URLs, ellers sender invitasjonslenka folk til Site URL i stedet.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

const NETTSTED = Deno.env.get('AMPEX_NETTSTED') ?? 'https://www.ampex.no/'

/** Samme sju som `app_role` i basen og `Rolle` i lib/kontor-tilgang.ts. */
const ROLLER = ['owner', 'admin', 'bas', 'installator', 'montor', 'laerling', 'regnskapsforer'] as const
type Rolle = (typeof ROLLER)[number]

/**
 * Hvem får invitere.
 *
 * Eier og administrator, og ingen andre. De to er likestilte i denne modellen
 * — `MATRISE` i lib/kontor-tilgang.ts gir dem samme liste, og `profiles_vern`
 * lar begge endre roller — så det finnes ingen grunn til å finne opp et skille
 * akkurat her. Et halvt skille er verre enn ingen: det leser som en sperre uten
 * å være det.
 */
const KAN_INVITERE: readonly string[] = ['owner', 'admin']

type Foresporsel = {
  epost?: string
  navn?: string
  rolle?: string
}

type Svar =
  | { ok: true; status: 'invitert' | 'lagt-til' | 'finnes'; navn: string; epost: string }
  | { ok: false; error: string }

/** Svarer alltid 200 med et lesbart `ok`-felt — samme kontrakt som ai-voice. */
const svar = (s: Svar) => Response.json(s)

/**
 * Grov, med vilje.
 *
 * En streng regex på e-post avviser gyldige adresser og fanger ikke feilene som
 * faktisk skjer. Den ekte valideringen er at invitasjonen enten kommer fram
 * eller ikke gjør det, og det ser man i lista etterpå: «invitert, ikke tatt
 * imot».
 */
function gyldigEpost(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: Foresporsel
    try {
      body = await req.json()
    } catch {
      return svar({ ok: false, error: 'Ugyldig forespørsel.' })
    }

    const epost = (body.epost ?? '').trim().toLowerCase()
    const navn = (body.navn ?? '').trim()
    const rolle = (body.rolle ?? '') as Rolle

    if (!gyldigEpost(epost)) return svar({ ok: false, error: 'Skriv en gyldig e-postadresse.' })
    if (!navn) return svar({ ok: false, error: 'Skriv navnet til den som skal inviteres.' })
    if (!ROLLER.includes(rolle)) return svar({ ok: false, error: 'Ukjent rolle.' })

    // ── Hvem spør, og hvilket firma hører hun til? ─────────────────────────
    const { data: { user }, error: brukerFeil } = await ctx.supabase.auth.getUser()
    if (brukerFeil || !user) return svar({ ok: false, error: 'Ikke logget inn.' })

    const { data: meg, error: megFeil } = await ctx.supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .maybeSingle()

    if (megFeil) return svar({ ok: false, error: megFeil.message })
    if (!meg?.company_id) return svar({ ok: false, error: 'Du hører ikke til et firma.' })
    if (!KAN_INVITERE.includes(meg.role)) {
      return svar({ ok: false, error: 'Bare eier og administrator kan invitere.' })
    }

    const firma = meg.company_id as string

    // ── Finnes adressen fra før? ───────────────────────────────────────────
    const { data: funn, error: funnFeil } = await ctx.supabaseAdmin
      .rpc('finn_bruker_paa_epost', { p_epost: epost })
    if (funnFeil) return svar({ ok: false, error: funnFeil.message })

    const fra_for = Array.isArray(funn) ? funn[0] : funn

    if (fra_for?.company_id && fra_for.company_id !== firma) {
      return svar({ ok: false, error: 'Adressen er allerede i bruk i et annet firma.' })
    }
    if (fra_for?.company_id === firma) {
      return svar({ ok: true, status: 'finnes', navn, epost })
    }

    // ── Kontoen finnes, men uten firma ─────────────────────────────────────
    //
    // Rester fra den perioden `enable_signup` sto på: noen laget seg en konto
    // som aldri fikk et firma. Den adopteres i stedet for å avvises — å be
    // henne registrere seg på nytt med samme adresse virker uansett ikke.
    if (fra_for?.id) {
      const { error } = await ctx.supabaseAdmin
        .from('profiles')
        .update({ company_id: firma, role: rolle, full_name: navn })
        .eq('id', fra_for.id)
      if (error) return svar({ ok: false, error: error.message })

      await ctx.supabase.rpc('log_audit_event', {
        p_hendelse: 'bruker.lagt_til',
        p_detaljer: { epost, rolle, bruker_id: fra_for.id },
      })
      return svar({ ok: true, status: 'lagt-til', navn, epost })
    }

    // ── Ny konto ───────────────────────────────────────────────────────────
    //
    // `data` havner i user_metadata, som brukeren selv kan skrive til senere.
    // Derfor står bare navnet der — det er kosmetikk. Rolle og firma settes i
    // profiles rett etterpå, med service_role, og leses aldri fra metadata.
    const { data: invitert, error: inviteFeil } = await ctx.supabaseAdmin.auth.admin
      .inviteUserByEmail(epost, { data: { full_name: navn }, redirectTo: NETTSTED })

    if (inviteFeil || !invitert?.user) {
      console.error('[inviter-ansatt] invitasjon feilet:', inviteFeil)
      return svar({ ok: false, error: inviteFeil?.message ?? 'Fikk ikke sendt invitasjonen.' })
    }

    const { error: profilFeil } = await ctx.supabaseAdmin
      .from('profiles')
      .update({ company_id: firma, role: rolle, full_name: navn })
      .eq('id', invitert.user.id)

    // Kontoen finnes nå, men uten firma. Den blir liggende og kan adopteres av
    // et nytt forsøk (grenen over) — bedre enn å slette en auth-bruker som
    // kanskje allerede har fått e-posten sin.
    if (profilFeil) {
      console.error('[inviter-ansatt] profilen ble ikke oppdatert:', profilFeil)
      return svar({
        ok: false,
        error: 'Invitasjonen ble sendt, men rollen ble ikke satt. Prøv å invitere på nytt.',
      })
    }

    await ctx.supabase.rpc('log_audit_event', {
      p_hendelse: 'bruker.invitert',
      p_detaljer: { epost, rolle, bruker_id: invitert.user.id },
    })

    return svar({ ok: true, status: 'invitert', navn, epost })
  }),
}

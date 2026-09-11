// Inviter opptil ti ansatte inn i sitt eget firma. Krever fersk 2FA-kode.
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
// funksjonen bruker det unntaket ETTER å ha slått opp hvem som spør og hvilket
// firma HUN hører til. Klienten oppgir aldri et company_id — det finnes ikke i
// forespørselen.
//
// ── Hvorfor totrinnsbekreftelsen ligger HER og ikke i skjermbildet ──────────
//
// En sperre i grensesnittet er ingen sperre. Endepunktet er åpent for enhver
// med en gyldig sesjon, og et `fetch` utenom appen bryr seg ikke om hva Firma-
// flata viste. Derfor leses `aal` og `amr` rett ut av tokenet her.
//
// Vi kan stole på det tokenet fordi funksjonen er deployet med `verify_jwt`:
// plattformen har alt sjekket signaturen før koden vår kjører. Vi leser bare
// innholdet — vi verifiserer det ikke selv, og skal ikke gjøre det.
//
// `aal2` alene holder ikke. Det sier bare at brukeren en gang i denne økta
// skrev en kode, og en økt lever i dager. `amr` bærer et tidsstempel per
// autentiseringssteg, og vi krever at TOTP-steget er ferskt. En innlogget økt
// som står åpen på en ulåst kontor-PC skal ikke kunne invitere noen.
//
// ── Utfallene, per person ───────────────────────────────────────────────────
//
//   invitert     ny konto, invitasjons-e-post sendt (supabase/templates/invite.html)
//   lagt-til     kontoen fantes uten firma, og er nå med. Ingen e-post.
//   finnes       står allerede i firmaet ditt. Ingen endring.
//   avvist       adressen tilhører et ANNET firma, eller raden var ugyldig.
//
// Det nest siste er en avvisning og ikke en flytting, og det er med vilje. Å
// flytte en person mellom firmaer er en tenancy-endring: timene, signaturene og
// samsvarserklæringene hennes ligger i det gamle firmaet. Det skal ikke skje
// fordi noen tastet feil adresse i et invitasjonsfelt.
//
// Bunken avbrytes ikke av at én rad feiler. Ni gyldige invitasjoner skal ikke
// stoppes av en tastefeil i den tiende, og kvitteringen viser hva som skjedde
// med hver enkelt.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase functions deploy inviter-ansatt
//   supabase secrets set AMPEX_NETTSTED=https://www.ampex.no/
//
// Og i dashbordet: Authentication → Multi-Factor → TOTP må være på. Uten den
// kan ingen melde på en autentiseringsapp, og da kan ingen invitere.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

const NETTSTED = Deno.env.get('AMPEX_NETTSTED') ?? 'https://www.ampex.no/'

/**
 * Hvor gammelt TOTP-steget får være. Fem minutter.
 *
 * Lavere ville straffet den som fyller ut ti rader i ro og mak — koden skrives
 * jo før knappen trykkes. Høyere ville gjort «hver gang» til «en gang i timen».
 */
const FERSK_S = 300

/** Så mange i én omgang. */
const MAKS = 10

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

type Rad = { epost?: string; navn?: string; rolle?: string }
type Utfall = {
  epost: string
  navn: string
  status: 'invitert' | 'lagt-til' | 'finnes' | 'avvist'
  grunn?: string
}

type Svar = { ok: true; resultat: Utfall[] } | { ok: false; error: string }

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

/**
 * Les `aal` og `amr` ut av tokenet, og krev et ferskt TOTP-steg.
 *
 * Returnerer en feiltekst, eller null når alt er i orden. Ingen signatursjekk
 * her: `verify_jwt` har gjort den før vi kom hit.
 */
function toFaktorMangler(req: Request): string | null {
  const rå = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!rå) return 'Mangler økt.'

  let krav: { aal?: string; amr?: { method?: string; timestamp?: number }[] }
  try {
    const del = rå.split('.')[1]
    const b64 = del.replace(/-/g, '+').replace(/_/g, '/')
    krav = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
  } catch {
    return 'Klarte ikke lese økta.'
  }

  if (krav.aal !== 'aal2') {
    return 'Du må bekrefte med autentiseringsappen før du kan invitere.'
  }

  const stempler = (krav.amr ?? [])
    .filter(m => /totp/i.test(m.method ?? ''))
    .map(m => Number(m.timestamp) || 0)
  const nyeste = stempler.length ? Math.max(...stempler) : 0
  if (!nyeste) return 'Fant ingen kode i økta. Skriv den på nytt.'

  const alder = Math.floor(Date.now() / 1000) - nyeste
  if (alder > FERSK_S) {
    return 'Koden er for gammel. Skriv en ny fra autentiseringsappen.'
  }
  return null
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    let body: { ansatte?: Rad[] }
    try {
      body = await req.json()
    } catch {
      return svar({ ok: false, error: 'Ugyldig forespørsel.' })
    }

    const rader = Array.isArray(body.ansatte) ? body.ansatte : []
    if (rader.length === 0) return svar({ ok: false, error: 'Ingen å invitere.' })
    if (rader.length > MAKS) return svar({ ok: false, error: `Maks ${MAKS} om gangen.` })

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

    // ── Fersk kode? ────────────────────────────────────────────────────────
    //
    // Sjekkes ETTER rollen, med vilje: den som ikke har lov til å invitere i
    // det hele tatt skal få vite dét, ikke sendes på jakt etter telefonen sin.
    const mangler = toFaktorMangler(req)
    if (mangler) return svar({ ok: false, error: mangler })

    const firma = meg.company_id as string
    const resultat: Utfall[] = []
    const sett = new Set<string>()

    for (const rå of rader) {
      const epost = (rå.epost ?? '').trim().toLowerCase()
      const navn = (rå.navn ?? '').trim()
      const rolle = (rå.rolle ?? '') as Rolle

      const avvis = (grunn: string) => resultat.push({ epost, navn, status: 'avvist', grunn })

      if (!gyldigEpost(epost)) { avvis('ugyldig e-postadresse'); continue }
      if (!navn) { avvis('mangler navn'); continue }
      if (!ROLLER.includes(rolle)) { avvis('ukjent rolle'); continue }
      if (sett.has(epost)) { avvis('står to ganger i lista'); continue }
      sett.add(epost)

      const { data: funn, error: funnFeil } = await ctx.supabaseAdmin
        .rpc('finn_bruker_paa_epost', { p_epost: epost })
      if (funnFeil) { avvis(funnFeil.message); continue }

      const fraFor = Array.isArray(funn) ? funn[0] : funn

      if (fraFor?.company_id && fraFor.company_id !== firma) {
        avvis('adressen er i bruk i et annet firma')
        continue
      }
      if (fraFor?.company_id === firma) {
        resultat.push({ epost, navn, status: 'finnes' })
        continue
      }

      // ── Kontoen finnes, men uten firma ───────────────────────────────────
      //
      // Rester fra den perioden `enable_signup` sto på: noen laget seg en konto
      // som aldri fikk et firma. Den adopteres i stedet for å avvises — å be
      // henne registrere seg på nytt med samme adresse virker uansett ikke.
      if (fraFor?.id) {
        const { error } = await ctx.supabaseAdmin
          .from('profiles')
          .update({ company_id: firma, role: rolle, full_name: navn })
          .eq('id', fraFor.id)
        if (error) { avvis(error.message); continue }
        resultat.push({ epost, navn, status: 'lagt-til' })
        continue
      }

      // ── Ny konto ─────────────────────────────────────────────────────────
      //
      // `data` havner i user_metadata, som brukeren selv kan skrive til senere.
      // Derfor står bare navnet der — det er kosmetikk. Rolle og firma settes i
      // profiles rett etterpå, med service_role, og leses aldri fra metadata.
      const { data: invitert, error: inviteFeil } = await ctx.supabaseAdmin.auth.admin
        .inviteUserByEmail(epost, { data: { full_name: navn }, redirectTo: NETTSTED })

      if (inviteFeil || !invitert?.user) {
        console.error('[inviter-ansatt] invitasjon feilet:', inviteFeil)
        avvis(inviteFeil?.message ?? 'fikk ikke sendt invitasjonen')
        continue
      }

      const { error: profilFeil } = await ctx.supabaseAdmin
        .from('profiles')
        .update({ company_id: firma, role: rolle, full_name: navn })
        .eq('id', invitert.user.id)

      // Kontoen finnes nå, men uten firma. Den blir liggende og kan adopteres
      // av et nytt forsøk (grenen over) — bedre enn å slette en auth-bruker som
      // kanskje allerede har fått e-posten sin.
      if (profilFeil) {
        console.error('[inviter-ansatt] profilen ble ikke oppdatert:', profilFeil)
        avvis('e-posten gikk ut, men rollen ble ikke satt. Inviter på nytt.')
        continue
      }

      resultat.push({ epost, navn, status: 'invitert' })
    }

    // Én revisjonslinje for hele bunken. Ti linjer på samme sekund er ti
    // linjer å bla forbi; det som betyr noe er hvem som slapp inn hvem, og når.
    await ctx.supabase.rpc('log_audit_event', {
      p_hendelse: 'bruker.invitert',
      p_detaljer: {
        antall: resultat.length,
        med_totp: true,
        folk: resultat.map(u => ({ epost: u.epost, status: u.status })),
      },
    })

    return svar({ ok: true, resultat })
  }),
}

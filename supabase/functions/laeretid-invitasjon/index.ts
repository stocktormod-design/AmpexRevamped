// Invitasjoner til å følge en lærlings læretid: send og løs inn.
//
// ── Hvorfor denne må være en Edge Function ──────────────────────────────────
//
// Bare innløsningen, egentlig. Å SENDE en invitasjon kunne klienten gjort selv:
// RLS-policyen `laeretid_invitasjon_send` koder allerede hvem som får invitere
// hvem, og speiler `kanInvitere()` i lib/laeretid/tilgang.ts. Men tokenet skal
// ikke lages av en klient, og e-posten må sendes av noen.
//
// Innløsningen kan derimot ikke gjøres i RLS i det hele tatt. Den som trykker
// på lenka er ofte IKKE lærlingen — det er den faglige lederen han inviterte —
// og tilknytningsraden tilhører lærlingen. Policyen sier `laerling_id =
// auth.uid()`, så den faglige lederen får aldri skrive den. Derfor skjer
// innløsningen her, etter at tokenet er verifisert.
//
// ── Hvem som får tilgang ────────────────────────────────────────────────────
//
// Den som får tilgang er ALLTID motparten til lærlingen, ikke den som tilfeldig
// trykket på knappen:
//
//   Lærlingen inviterte faglig leder → faglig leder aksepterer, og får tilgang.
//     Samtykket lå i at lærlingen sendte den.
//   Kontoret inviterte lærlingen     → lærlingen aksepterer, og AVSENDEREN får.
//     Samtykket ligger i aksepten.
//
// Reglene er de samme som `aksepter()` i lib/laeretid/tilgang.ts, som er
// selvtestet i `npm run verify:laeretid`. Endres den ene, må den andre følge.
//
// ── Hva invitasjonen IKKE gir ───────────────────────────────────────────────
//
// Kladder, quizsvar og profil deles aldri, uansett rolle og uansett hvem som
// betaler. Det håndheves av `kan_se_laerling()` og av RLS på `laeretid_logg`,
// ikke her. Denne funksjonen bestemmer bare HVEM som kobles på — aldri hva
// kobling betyr.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase functions deploy laeretid-invitasjon
//   supabase secrets set AMPEX_NETTSTED=https://www.ampex.no/
//   supabase secrets set RESEND_API_KEY=…   (samme nøkkel som epost-videresend)
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'npm:@supabase/server'

const NETTSTED = Deno.env.get('AMPEX_NETTSTED') ?? 'https://www.ampex.no/'
const RESEND_API = 'https://api.resend.com'
const RESEND_NOKKEL = Deno.env.get('RESEND_API_KEY') ?? ''

/**
 * Avsender må ligge på vårt eget verifiserte domene, ellers avvises posten av
 * SPF og DMARC hos mottakeren. Lokaldelen er fri så lenge ampex.no er verifisert
 * i Resend — se `epost-videresend`, som gjør det samme.
 */
const FRA = 'Ampex <laeretid@ampex.no>'

/** Tretti dager. Lenger, og en glemt invitasjon blir en åpen dør. */
const LEVETID_DAGER = 30

const ROLLER = ['faglig_leder', 'instruktor', 'koordinator', 'ansatt'] as const
type Rolle = (typeof ROLLER)[number]

const ROLLENAVN: Record<Rolle, string> = {
  faglig_leder: 'faglig leder',
  instruktor: 'instruktør',
  koordinator: 'koordinator',
  ansatt: 'kollega',
}

function svar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Tilfeldig, ugjettbart, og trygt i en URL. */
function lagToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, m => ({ '+': '-', '/': '_', '=': '' }[m]!))
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx: any) => {
    if (req.method !== 'POST') return svar({ ok: false, error: 'Bruk POST.' }, 405)

    const { data: { user }, error: brukerFeil } = await ctx.supabase.auth.getUser()
    if (brukerFeil || !user) return svar({ ok: false, error: 'Ikke innlogget.' }, 401)

    const kropp = await req.json().catch(() => null)
    if (!kropp || typeof kropp !== 'object') return svar({ ok: false, error: 'Ugyldig forespørsel.' }, 400)

    // ── Send ────────────────────────────────────────────────────────────────
    if (kropp.handling === 'send') {
      const laerlingId = String(kropp.laerlingId ?? '')
      const epost = String(kropp.epost ?? '').trim().toLowerCase()
      const rolle = String(kropp.rolle ?? '') as Rolle

      if (!laerlingId || !epost.includes('@') || !ROLLER.includes(rolle)) {
        return svar({ ok: false, error: 'Mangler lærling, adresse eller rolle.' }, 400)
      }

      const token = lagToken()
      const utloper = new Date(Date.now() + LEVETID_DAGER * 86400_000)

      // Skrives som BRUKEREN, ikke som admin: da er det RLS-policyen som
      // avgjør om hun får lov, og regelen står ett sted i stedet for to.
      const { data: rad, error } = await ctx.supabase
        .from('laeretid_invitasjon')
        .insert({
          laerling_id: laerlingId,
          epost,
          rolle,
          fra_person_id: user.id,
          token,
          utloper_at: utloper.toISOString(),
        })
        .select('id')
        .single()

      if (error) {
        // RLS avviser med samme feil som en ekte databasefeil. Vi skiller ikke
        // for brukeren: begge betyr «dette får du ikke gjøre».
        console.error('[laeretid-invitasjon] send avvist:', error)
        return svar({ ok: false, error: 'Du kan ikke invitere til denne læretiden.' }, 403)
      }

      const lenke = `${NETTSTED.replace(/\/$/, '')}/laeretid/invitasjon?token=${token}`
      const { data: avsender } = await ctx.supabaseAdmin
        .from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      const navn = avsender?.full_name ?? 'En lærling'

      const sendt = await fetch(`${RESEND_API}/emails`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${RESEND_NOKKEL}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: FRA,
          to: [epost],
          subject: `${navn} vil at du skal følge læretiden`,
          // Det som står her er også løftet vårt. Mottakeren skal vite hva hun
          // får se FØR hun trykker, ikke oppdage grensen senere.
          text:
            `${navn} har invitert deg som ${ROLLENAVN[rolle]} i Ampex.\n\n` +
            `Du får se de innsendte loggene og hvor langt lærlingen er kommet mot ` +
            `kompetansemålene. Kladder og svar på oppfølgingsspørsmål deles aldri.\n\n` +
            `${lenke}\n\nLenka utløper om ${LEVETID_DAGER} dager.`,
        }),
      })

      if (!sendt.ok) {
        // Raden står. Å rulle den tilbake ville gjort «send på nytt» umulig.
        console.error('[laeretid-invitasjon] e-posten gikk ikke ut:', await sendt.text())
        return svar({ ok: true, id: rad.id, advarsel: 'Invitasjonen er laget, men e-posten gikk ikke ut.' })
      }

      return svar({ ok: true, id: rad.id })
    }

    // ── Løs inn ─────────────────────────────────────────────────────────────
    if (kropp.handling === 'aksepter' || kropp.handling === 'avslaa') {
      const token = String(kropp.token ?? '')
      if (!token) return svar({ ok: false, error: 'Mangler token.' }, 400)

      // Admin, fordi mottakeren ikke kan lese raden gjennom RLS.
      const { data: inv, error } = await ctx.supabaseAdmin
        .from('laeretid_invitasjon')
        .select('id, laerling_id, epost, rolle, fra_person_id, utloper_at, status')
        .eq('token', token)
        .is('deleted_at', null)
        .maybeSingle()

      if (error || !inv) return svar({ ok: false, error: 'Invitasjonen finnes ikke.' }, 404)
      if (inv.status !== 'sendt') return svar({ ok: false, error: 'Invitasjonen er allerede besvart.' }, 409)
      if (new Date(inv.utloper_at) < new Date()) {
        await ctx.supabaseAdmin.from('laeretid_invitasjon')
          .update({ status: 'utlopt', avgjort_at: new Date().toISOString() }).eq('id', inv.id)
        return svar({ ok: false, error: 'Invitasjonen er utløpt.' }, 410)
      }

      // Bare adressen den ble sendt til kan løse den inn.
      const minEpost = (user.email ?? '').trim().toLowerCase()
      if (minEpost !== String(inv.epost).trim().toLowerCase()) {
        return svar({ ok: false, error: 'Invitasjonen er sendt til en annen adresse.' }, 403)
      }

      if (kropp.handling === 'avslaa') {
        await ctx.supabaseAdmin.from('laeretid_invitasjon')
          .update({ status: 'avslatt', avgjort_at: new Date().toISOString() }).eq('id', inv.id)
        return svar({ ok: true, status: 'avslatt' })
      }

      const laerlingenInviterte = inv.fra_person_id === inv.laerling_id

      // Kom invitasjonen utenfra, må det være lærlingen selv som tar imot.
      if (!laerlingenInviterte && user.id !== inv.laerling_id) {
        return svar({ ok: false, error: 'Bare lærlingen kan ta imot denne.' }, 403)
      }

      const personId = laerlingenInviterte ? user.id : inv.fra_person_id
      const iDag = new Date().toISOString().slice(0, 10)

      const { error: tilknytFeil } = await ctx.supabaseAdmin
        .from('laeretid_tilknytning')
        .insert({
          laerling_id: inv.laerling_id,
          person_id: personId,
          rolle: inv.rolle,
          gyldig_fra: iDag,
          created_by: user.id,
        })

      if (tilknytFeil) {
        console.error('[laeretid-invitasjon] tilknytningen ble ikke opprettet:', tilknytFeil)
        return svar({ ok: false, error: 'Kunne ikke opprette tilknytningen. Prøv igjen.' }, 500)
      }

      await ctx.supabaseAdmin.from('laeretid_invitasjon')
        .update({ status: 'akseptert', avgjort_at: new Date().toISOString() }).eq('id', inv.id)

      // Hvem som slapp inn hvem, og når. Det er hele poenget med linja.
      await ctx.supabase.rpc('log_audit_event', {
        p_hendelse: 'laeretid.tilknytning.opprettet',
        p_detaljer: { laerling_id: inv.laerling_id, person_id: personId, rolle: inv.rolle },
      })

      return svar({ ok: true, status: 'akseptert', rolle: inv.rolle })
    }

    return svar({ ok: false, error: 'Ukjent handling.' }, 400)
  }),
}

// Videresender e-post som kommer til ampex.no.
//
// Resend tar imot posten (MX på root peker til deres inbound-server) og kaller
// denne funksjonen med en `email.received`-hendelse. Webhooken inneholder KUN
// metadata, så innholdet hentes med et eget API-kall før det sendes videre.
//
// Hvorfor ikke bare en videresendingstjeneste: domenet sender allerede gjennom
// Resend (SPF, DKIM og DMARC står der), og en tjeneste til ville betydd en ny
// konto, et nytt sted å glemme passordet, og en ny ting som kan slutte å
// virke uten at noen merker det.
//
// Secrets som må være satt:
//   RESEND_API_KEY      nøkkelen fra Resend
//   VIDERESEND_TIL      innboksen posten skal havne i
//
// Merk: `verify_jwt` må være AV for denne funksjonen. Resend kaller den med
// sin egen signatur, ikke med en Supabase-token.

const RESEND_API = 'https://api.resend.com'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('bruk POST', { status: 405 })

  const key = Deno.env.get('RESEND_API_KEY')
  const til = Deno.env.get('VIDERESEND_TIL')
  if (!key || !til) return svar({ feil: 'RESEND_API_KEY eller VIDERESEND_TIL mangler' }, 503)

  let hendelse: { type?: string; data?: { email_id?: string; from?: string; subject?: string } }
  try {
    hendelse = await req.json()
  } catch {
    return svar({ feil: 'ugyldig body' }, 400)
  }

  // Andre hendelsestyper (levert, åpnet, bounce) skal ikke videresendes.
  if (hendelse.type !== 'email.received') return svar({ hoppet_over: hendelse.type ?? 'ukjent' }, 200)

  const id = hendelse.data?.email_id
  if (!id) return svar({ feil: 'mangler email_id' }, 400)

  // Hent innholdet — webhooken har det ikke.
  const hentet = await fetch(`${RESEND_API}/emails/receiving/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!hentet.ok) return svar({ feil: `kunne ikke hente e-posten (${hentet.status})` }, 502)
  const post = await hentet.json()

  const fra = post.from ?? hendelse.data?.from ?? 'ukjent avsender'
  const emne = post.subject ?? hendelse.data?.subject ?? '(uten emne)'
  const tilOpprinnelig = Array.isArray(post.to) ? post.to.join(', ') : (post.to ?? '')

  // Avsender MÅ være en adresse på vårt eget verifiserte domene: å sende
  // videre med avsenderens adresse ville blitt avvist av SPF/DMARC hos
  // mottakeren, og posten ville forsvunnet i stillhet.
  const send = await fetch(`${RESEND_API}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Ampex <videresending@ampex.no>',
      to: [til],
      // Svar-knappen skal treffe den som faktisk skrev, ikke oss selv.
      reply_to: fra,
      subject: emne,
      text: `Fra: ${fra}\nTil: ${tilOpprinnelig}\n\n${post.text ?? ''}`,
      html: post.html
        ? `<p style="color:#6F675D;font:13px -apple-system,sans-serif">Fra: ${esc(fra)}<br>Til: ${esc(tilOpprinnelig)}</p><hr>${post.html}`
        : undefined,
    }),
  })
  if (!send.ok) return svar({ feil: `videresending feilet (${send.status})` }, 502)

  return svar({ videresendt: true, til, emne }, 200)
})

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svar(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

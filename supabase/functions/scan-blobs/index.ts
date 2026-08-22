// Presignerte R2-URL-er for skann. Den ene delen som manglet i hele kjeden:
// telefon → kø → worker → R2.
//
// ── Hvorfor denne finnes ────────────────────────────────────────────────────
//
// Verken telefonen eller worker-en skal noensinne se R2-nøklene. Telefonen er
// en app hvem som helst kan pakke opp; worker-en er en exe som kjører på en PC
// i et verksted. Begge får derfor kortlevde, presignerte URL-er som gjelder én
// nøkkel, én operasjon, og — for opplasting — én eksakt størrelse.
//
// ── Tre operasjoner ─────────────────────────────────────────────────────────
//
//   upload    telefonen ber om PUT-URL-er. Krever brukersesjon.
//   finish    telefonen sier «ferdig». VI teller i R2, klienten blir ikke trodd.
//   download  worker-en ber om GET-URL-er. Krever node-token, ikke sesjon.
//   output    worker-en ber om én PUT-URL for resultatet. Node-token.
//
// ── Hvorfor `finish` teller selv ────────────────────────────────────────────
//
// `scan_job_opplastet(job, bytes)` tar imot et tall. Kom det tallet fra
// klienten, er kvoten en høflig forespørsel: en modifisert app oppgir 1 MB og
// laster opp 900. Derfor lister denne funksjonen objektene under prefikset og
// summerer `ContentLength` fra R2 selv, og sender DEN summen inn i basen.
// Klientens anslag brukes kun til å avgjøre om den får URL-er i det hele tatt.
//
// ── Avvik fra ai-voice ──────────────────────────────────────────────────────
//
// ai-voice bruker `withSupabase({auth:'user'})`. Det går ikke her, fordi
// `download` autentiseres med et NODE-TOKEN og ikke en brukersesjon — en
// worker-node er ikke en person og har ingen rad i profiles. Derfor gjøres
// autentiseringen eksplisitt, per operasjon.
//
// ── Oppsett ─────────────────────────────────────────────────────────────────
//
//   supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... \
//     R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
//
// IKKE DEPLOYET ENNÅ: nøklene over er ikke satt i Supabase (de ligger i Vercel,
// fra den gamle appen). Funksjonen er skrevet, men aldri kjørt.
import '@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1'

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? ''
const R2_BUCKET = Deno.env.get('R2_BUCKET') ?? ''
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

/**
 * Levetid på URL-ene.
 *
 * Opplasting får lenger tid enn nedlasting fordi et skann på noen hundre
 * megabyte over dårlig wifi tar tid, og en URL som utløper midt i gir en
 * halvlastet mappe ingen oppdager. Nedlastingen skjer fra en PC på kabel.
 */
const UPLOAD_TTL_S = 60 * 60
const DOWNLOAD_TTL_S = 15 * 60

/** Så mange filer i én forespørsel. 600 keyframes = 1200 filer, så vi paginerer. */
const MAKS_FILER_PER_KALL = 200

type Handling = 'upload' | 'finish' | 'download' | 'output'

type Foresporsel = {
  action: Handling
  job_id: string
  /** upload: hva klienten har tenkt å legge opp. */
  files?: { name: string; bytes: number }[]
  /** download: worker-ens hemmelighet. Aldri en brukersesjon. */
  node_token?: string
}

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
})

/** Tjenesteklient. Brukes KUN etter at kallet er autentisert per operasjon. */
function tjeneste() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
}

function svar(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * En nøkkel må ligge under jobbens eget prefiks.
 *
 * Uten denne sjekken er en gyldig sesjon nok til å skrive hvor som helst i
 * bøtta — inkludert over et annet firmas ferdige skann. Prefikset kommer fra
 * basen, filnavnet fra klienten, og de settes sammen HER, aldri av klienten.
 */
function trygtNavn(navn: string): boolean {
  return /^[a-zA-Z0-9._-]{1,120}$/.test(navn) && !navn.startsWith('.')
}

/** Presignert URL. `extraHeaders` blir signert og MÅ sendes av klienten. */
async function presign(
  metode: 'GET' | 'PUT',
  key: string,
  ttl: number,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(ttl))
  // MERK: at `content-length` faktisk havner i x-amz-signedheaders avhenger av
  // at `allHeaders` gjor det den lover. Er den ikke signert, er URL-en bundet
  // til noekkelen men IKKE til stoerrelsen, og opplastingstaket hviler da alene
  // paa at `finish` teller i R2 etterpaa. Verifiser paa foerste ekte opplasting:
  // se etter «content-length» i X-Amz-SignedHeaders i URL-en som returneres.
  const signed = await r2.sign(
    new Request(url, { method: metode, headers: extraHeaders }),
    { aws: { signQuery: true, allHeaders: true } },
  )
  return signed.url
}

/** Sum av faktiske objektstørrelser under et prefiks. Sannheten, ikke anslaget. */
async function summerPrefiks(prefiks: string): Promise<{ bytes: number; antall: number }> {
  let bytes = 0
  let antall = 0
  let token: string | undefined

  do {
    const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}`)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', prefiks)
    url.searchParams.set('max-keys', '1000')
    if (token) url.searchParams.set('continuation-token', token)

    const r = await r2.fetch(url.toString(), { method: 'GET' })
    if (!r.ok) throw new Error(`R2 list feilet: ${r.status}`)
    const xml = await r.text()

    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      bytes += Number(m[1])
      antall++
    }
    const nt = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    token = xml.includes('<IsTruncated>true</IsTruncated>') && nt ? nt[1] : undefined
  } while (token)

  return { bytes, antall }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return svar({ feil: 'kun POST' }, 405)

  let inn: Foresporsel
  try {
    inn = await req.json()
  } catch {
    return svar({ feil: 'ugyldig JSON' }, 400)
  }
  if (!inn.job_id) return svar({ feil: 'job_id mangler' }, 400)

  const db = tjeneste()

  // ── download: worker-en, autentisert med node-token ───────────────────────
  if (inn.action === 'download') {
    if (!inn.node_token) return svar({ feil: 'node_token mangler' }, 401)

    const { data: node } = await db.rpc('worker_node_for_token', { node_token: inn.node_token })
    if (!node?.id) return svar({ feil: 'ukjent eller trukket node-token' }, 401)

    // Noden får KUN jobben den selv har tatt. Uten dette kan en hvilken som
    // helst gyldig node laste ned et hvilket som helst firmas skann — også en
    // node i Ampex-poolen som aldri fikk jobben tildelt.
    const { data: jobb } = await db
      .from('scan_jobs')
      .select('id, input_prefix, claimed_by, status')
      .eq('id', inn.job_id)
      .eq('claimed_by', node.id)
      .maybeSingle()
    if (!jobb) return svar({ feil: 'jobben er ikke tildelt denne noden' }, 403)

    const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}`)
    url.searchParams.set('list-type', '2')
    url.searchParams.set('prefix', jobb.input_prefix)
    url.searchParams.set('max-keys', '1000')
    const r = await r2.fetch(url.toString(), { method: 'GET' })
    if (!r.ok) return svar({ feil: `R2 list feilet: ${r.status}` }, 502)
    const xml = await r.text()

    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1])
    const files = await Promise.all(
      keys.map(async k => ({
        name: k.slice(jobb.input_prefix.length).replace(/^\//, ''),
        url: await presign('GET', k, DOWNLOAD_TTL_S),
      })),
    )
    return svar({ files })
  }

  // ── output: worker-en legger resultatet tilbake ───────────────────────────
  //
  // Egen gren fordi worker-en har node-token og ikke sesjon, og fordi den skal
  // skrive til et ANNET prefiks enn inndataene. Uten det skillet kan en node
  // overskrive rammene den nettopp lastet ned — og da er en mislykket bake
  // heller ikke mulig aa kjoere om.
  if (inn.action === 'output') {
    if (!inn.node_token) return svar({ feil: 'node_token mangler' }, 401)
    const navn = inn.files?.[0]?.name
    if (!navn || !trygtNavn(navn)) return svar({ feil: 'ugyldig filnavn' }, 400)

    const { data: node } = await db.rpc('worker_node_for_token', { node_token: inn.node_token })
    if (!node?.id) return svar({ feil: 'ukjent eller trukket node-token' }, 401)

    const { data: jobb } = await db
      .from('scan_jobs')
      .select('id, claimed_by, status')
      .eq('id', inn.job_id)
      .eq('claimed_by', node.id)
      .maybeSingle()
    if (!jobb) return svar({ feil: 'jobben er ikke tildelt denne noden' }, 403)
    if (!['claimed', 'running'].includes(jobb.status)) {
      return svar({ feil: `jobben er ${jobb.status}` }, 409)
    }

    // Resultatet navngis av OSS, ikke av noden. Da kan et kompromittert
    // node-token ikke skrive utenfor sin egen jobb.
    const key = `resultat/${jobb.id}/${navn}`
    return svar({ key, url: await presign('PUT', key, UPLOAD_TTL_S) })
  }

  // ── upload og finish: telefonen, autentisert med brukersesjon ─────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return svar({ feil: 'ikke innlogget' }, 401)

  const { data: bruker } = await db.auth.getUser(jwt)
  if (!bruker?.user) return svar({ feil: 'ugyldig sesjon' }, 401)

  const { data: profil } = await db
    .from('profiles')
    .select('company_id')
    .eq('id', bruker.user.id)
    .maybeSingle()
  if (!profil?.company_id) return svar({ feil: 'ingen firmatilhørighet' }, 403)

  const { data: jobb } = await db
    .from('scan_jobs')
    .select('id, company_id, input_prefix, status, bundle_bytes')
    .eq('id', inn.job_id)
    .eq('company_id', profil.company_id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!jobb) return svar({ feil: 'ukjent jobb' }, 404)

  if (inn.action === 'upload') {
    if (jobb.status !== 'venter') {
      return svar({ feil: `jobben er ${jobb.status}, ikke åpen for opplasting` }, 409)
    }
    const filer = inn.files ?? []
    if (filer.length === 0) return svar({ feil: 'ingen filer oppgitt' }, 400)
    if (filer.length > MAKS_FILER_PER_KALL) {
      return svar({ feil: `maks ${MAKS_FILER_PER_KALL} filer per kall` }, 400)
    }
    for (const f of filer) {
      if (!trygtNavn(f.name)) return svar({ feil: `ugyldig filnavn: ${f.name}` }, 400)
      if (!Number.isFinite(f.bytes) || f.bytes <= 0) {
        return svar({ feil: `ugyldig størrelse for ${f.name}` }, 400)
      }
    }

    // Content-Length signeres. Da er URL-en ikke bare bundet til én nøkkel, men
    // til én eksakt størrelse: den kan ikke gjenbrukes til å dytte inn noe
    // større. Dette er det som faktisk stopper misbruk — TTL alene gjør ikke det.
    const files = await Promise.all(
      filer.map(async f => ({
        name: f.name,
        url: await presign('PUT', `${jobb.input_prefix}/${f.name}`, UPLOAD_TTL_S, {
          'content-length': String(f.bytes),
        }),
        bytes: f.bytes,
      })),
    )
    return svar({ files, ttl_sekunder: UPLOAD_TTL_S })
  }

  if (inn.action === 'finish') {
    // Her telles det. Klientens tall spurte vi aldri om.
    let sum: { bytes: number; antall: number }
    try {
      sum = await summerPrefiks(jobb.input_prefix)
    } catch (e) {
      return svar({ feil: `klarte ikke telle i R2: ${e}` }, 502)
    }
    if (sum.antall === 0) return svar({ feil: 'ingen filer funnet under prefikset' }, 409)

    // Kalles med BRUKERENS sesjon, ikke tjenestenokkelen. Grunnen er konkret:
    // scan_job_opplastet slaar opp jobben med `current_company_id()`, som leser
    // `auth.uid()`. Med tjenestenokkelen er den NULL, og funksjonen ville svart
    // «ukjent jobb» paa en jobb som finnes. Samtidig beholder vi eierskapet i
    // basen framfor aa omga det — bytene er alt talt av OSS, saa det er ingenting
    // igjen aa stole paa klienten for.
    const somBruker = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } } },
    )
    const { data, error } = await somBruker.rpc('scan_job_opplastet', {
      p_job_id: jobb.id,
      p_uploaded_bytes: sum.bytes,
    })
    if (error) return svar({ feil: error.message, bytes: sum.bytes }, 409)

    return svar({ status: data?.status ?? 'queued', bytes: sum.bytes, filer: sum.antall })
  }

  return svar({ feil: `ukjent action: ${inn.action}` }, 400)
})

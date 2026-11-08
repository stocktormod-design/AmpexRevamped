/**
 * Bakgrunnen i Ampex-utvidelsen: innloggingen og alt som snakker med Supabase.
 *
 * Siden (side.ts) spør her i stedet for selv, fordi en innholdsside er bundet av
 * EFObasens egne nettleserregler — bakgrunnen har tilgang til Supabase-adressen
 * i manifestet. Alt går med brukerens egen økt, så RLS gjør det samme som i
 * kontorappen: bare eget firmas priser og egen handleliste.
 *
 * Handlelista er den samme som i appen (`lib/bestilling.ts`): en bestilling i
 * `utkast` per grossist, og samme el-nummer øker antallet i stedet for å gi en
 * ny linje. Radene synkes til telefonene som alt annet (sync_tables).
 */
import { createClient } from '@supabase/supabase-js'
import { byggPrisbilde, type Prisrad } from '@delt/pricing'
import { KONFIG } from './konfig'
import type { Foresporsel, Svar, Vare } from './meldinger'

// Økten lagres i utvidelsens egen lagring — en service worker har ikke localStorage.
const lagring = {
  getItem: async (k: string) => ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null,
  setItem: async (k: string, v: string) => { await chrome.storage.local.set({ [k]: v }) },
  removeItem: async (k: string) => { await chrome.storage.local.remove(k) },
}

const db = createClient(KONFIG.url, KONFIG.anonKey, {
  auth: { storage: lagring, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

async function status(): Promise<Svar> {
  const { data } = await db.auth.getSession()
  return { ok: true, epost: data.session?.user.email ?? null }
}

async function vare(elnummer: string): Promise<Svar> {
  const { data: okt } = await db.auth.getSession()
  if (!okt.session) return { ok: true, epost: null }

  const [{ data: priser, error }, { data: produkter }, { data: katalog }] = await Promise.all([
    db.from('product_prices')
      .select('supplier,net_price,gross_price,price_type,discount_percent,sales_pack,stocked,discontinued')
      .eq('elnummer', elnummer).is('deleted_at', null),
    db.from('products').select('id,name,unit').eq('elnummer', elnummer).is('deleted_at', null).limit(1),
    db.from('katalog_varer').select('navn,enhet').eq('elnummer', elnummer).limit(1),
  ])
  if (error) return { ok: false, feil: error.message }

  const rader: (Prisrad & { utgaar: boolean; lagerfort: boolean | null })[] = (priser ?? [])
    .filter(p => p.supplier && (p.net_price ?? p.gross_price) != null)
    .map(p => ({
      grossist: p.supplier as string,
      nettoPris: Number(p.net_price ?? p.gross_price),
      priceType: p.price_type,
      rabattProsent: p.discount_percent,
      utgaar: !!p.discontinued,
      lagerfort: p.stocked,
    }))
  const bilde = byggPrisbilde(rader)
  const produkt = produkter?.[0]
  const v: Vare = {
    elnummer,
    navn: produkt?.name ?? katalog?.[0]?.navn ?? null,
    enhet: produkt?.unit ?? katalog?.[0]?.enhet ?? 'stk',
    produktId: produkt?.id ?? null,
    priser: bilde.priser.map(p => {
      const ekstra = rader.find(r => r.grossist === p.grossist)
      return {
        grossist: p.grossist, pris: p.nettoPris, erListepris: p.erListepris,
        utgaar: ekstra?.utgaar ?? false, lagerfort: ekstra?.lagerfort ?? null,
      }
    }),
    billigste: bilde.billigste?.grossist ?? null,
  }
  return { ok: true, epost: okt.session.user.email ?? null, vare: v }
}

/** Samme regel som `leggIHandleliste()` i appen: ett utkast per grossist, én linje per el-nummer. */
async function leggIKurv(f: Extract<Foresporsel, { type: 'legg' }>): Promise<Svar> {
  const { data: okt } = await db.auth.getSession()
  if (!okt.session) return { ok: false, feil: 'Logg inn i Ampex-utvidelsen først.' }
  const antall = Number.isFinite(f.antall) && f.antall > 0 ? f.antall : 1

  const { data: utkast, error: e1 } = await db.from('purchase_orders').select('id')
    .eq('grossist', f.grossist).eq('status', 'utkast').is('deleted_at', null)
    .order('created_at').limit(1)
  if (e1) return { ok: false, feil: e1.message }
  let bestillingId = utkast?.[0]?.id as string | undefined
  if (!bestillingId) {
    bestillingId = crypto.randomUUID()
    const { error } = await db.from('purchase_orders').insert({ id: bestillingId, grossist: f.grossist, status: 'utkast' })
    if (error) return { ok: false, feil: error.message }
  }

  const { data: linjer, error: e2 } = await db.from('purchase_order_lines').select('id,elnummer,antall')
    .eq('purchase_order_id', bestillingId).is('deleted_at', null)
  if (e2) return { ok: false, feil: e2.message }
  const finnes = (linjer ?? []).find(l => l.elnummer === f.elnummer)
  if (finnes) {
    const { error } = await db.from('purchase_order_lines')
      .update({ antall: Number(finnes.antall ?? 0) + antall }).eq('id', finnes.id)
    if (error) return { ok: false, feil: error.message }
  } else {
    const { error } = await db.from('purchase_order_lines').insert({
      id: crypto.randomUUID(),
      purchase_order_id: bestillingId,
      product_id: f.produktId,
      elnummer: f.elnummer,
      beskrivelse: (f.navn ?? `EL ${f.elnummer}`).trim(),
      antall,
      enhet: f.enhet || 'stk',
      mottatt_antall: 0,
      sort_order: (linjer ?? []).length,
    })
    if (error) return { ok: false, feil: error.message }
  }
  return { ok: true, epost: okt.session.user.email ?? null, linjer: (linjer ?? []).length + (finnes ? 0 : 1) }
}

async function behandle(f: Foresporsel): Promise<Svar> {
  try {
    switch (f.type) {
      case 'status': return await status()
      case 'logginn': {
        const { error } = await db.auth.signInWithPassword({ email: f.epost, password: f.passord })
        return error ? { ok: false, feil: 'Feil e-post eller passord.' } : await status()
      }
      case 'loggut': await db.auth.signOut(); return { ok: true, epost: null }
      case 'vare': return await vare(f.elnummer)
      case 'legg': return await leggIKurv(f)
    }
  } catch (e) {
    return { ok: false, feil: e instanceof Error ? e.message : 'Noe gikk galt.' }
  }
}

chrome.runtime.onMessage.addListener((f: Foresporsel, _avsender, svar) => {
  void behandle(f).then(svar)
  return true // svaret kommer asynkront
})

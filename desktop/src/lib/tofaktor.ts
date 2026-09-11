import { supabase } from '@/supabase'

/**
 * Totrinnsbekreftelse med autentiseringsapp (TOTP).
 *
 * ── Hva dette er, og hva det IKKE er ──────────────────────────────────────
 *
 * Dette er ikke en innloggingssperre. Du logger inn med passord som før. Det
 * er en sperre foran ÉN handling: å slippe nye folk inn i firmaet.
 *
 * Grunnen er hvem invitasjonen egentlig gir bort. Den som inviterer, setter
 * rollen — og rollen bestemmer hvem som ser lønnsgrunnlag, dekningsbidrag og
 * kunderegister. Klarer noen å kapre en eiers økt, er invitasjonsskjemaet den
 * korteste veien til en permanent bakdør: en konto han eier selv, i et firma
 * som ikke er hans.
 *
 * ── Koden gjelder ikke lenge ──────────────────────────────────────────────
 *
 * Å være «logget inn med 2FA» holder ikke. Koden må skrives PÅ NYTT hver gang
 * det inviteres, og Edge Functionen sjekker at den er fersk — se `FERSK_S` i
 * `supabase/functions/inviter-ansatt`. En økt som står åpen på en ulåst
 * kontor-PC skal ikke kunne invitere noen.
 *
 * Klienten her kan ikke håndheve noe som helst. Alt den gjør er å skaffe et
 * token med `aal2` og et ferskt `totp`-stempel; det er serveren som leser det
 * stempelet og avviser. Se kommentaren i Edge Functionen.
 */

/** Navnet faktoren får hos Supabase. Én per bruker er nok. */
const NAVN = 'Ampex'

export type Pamelding = {
  faktorId: string
  /** QR-koden som SVG i en data-URI. Kan settes rett i `src` på en `<img>`. */
  qr: string
  /** Samme hemmelighet i tekst, for den som ikke får skannet. */
  hemmelighet: string
}

/**
 * Id-en til en ferdig verifisert autentiseringsapp, eller null.
 *
 * `listFactors()` gir bare det som er verifisert i `totp`-lista, men vi leser
 * `status` likevel: en halvferdig påmelding skal ikke telle som en sperre.
 */
export async function verifisertFaktor(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  const ferdig = (data?.all ?? []).find(f => f.factor_type === 'totp' && f.status === 'verified')
  return ferdig?.id ?? null
}

/**
 * Start påmelding, og gi tilbake QR-koden.
 *
 * Halvferdige faktorer ryddes først. Supabase nekter å opprette to med samme
 * navn, og en påmelding som ble avbrutt i går skal ikke stå i veien i dag —
 * hemmeligheten i den er uansett aldri tatt i bruk.
 */
export async function meldPa(): Promise<Pamelding> {
  const { data: liste } = await supabase.auth.mfa.listFactors()
  for (const f of liste?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: NAVN,
  })
  if (error) throw new Error(error.message)
  return {
    faktorId: data.id,
    qr: data.totp.qr_code,
    hemmelighet: data.totp.secret,
  }
}

/**
 * Skriv inn koden fra appen.
 *
 * Samme kall enten det er første gang (påmelding fullføres) eller den
 * hundrede (økta får et ferskt `totp`-stempel). `challenge` og `verify` hører
 * sammen: utfordringen er det serveren husker, koden er svaret på den.
 */
export async function bekreftKode(faktorId: string, kode: string): Promise<void> {
  const ren = kode.replace(/\s/g, '')
  if (!/^\d{6}$/.test(ren)) throw new Error('Koden er seks siffer.')

  const { data: utfordring, error: uFeil } = await supabase.auth.mfa.challenge({ factorId: faktorId })
  if (uFeil) throw new Error(uFeil.message)

  const { error } = await supabase.auth.mfa.verify({
    factorId: faktorId,
    challengeId: utfordring.id,
    code: ren,
  })
  if (error) {
    throw new Error(
      /invalid|incorrect/i.test(error.message)
        ? 'Feil kode. Sjekk at klokka på telefonen går riktig, og prøv den neste.'
        : error.message,
    )
  }
}

import { supabase } from '@/supabase'

/**
 * Firmachatten — én tråd per firma.
 *
 * Skrevet for én konkret ting: faglig ansvarlig sitter i flata, ser noe han
 * vil ha endret, og skal kunne skrive det ned DER, uten å bytte app. Derfor
 * ingen kanaler, ingen tråder og ingen vedlegg — det er en notatblokk to
 * personer deler, ikke et meldingssystem.
 *
 * RLS gjør avgrensningen: `company_id = current_company_id()` på lesing, og
 * `bruker_id = auth.uid()` på skriving, så ingen kan skrive i en annens navn.
 */

export type Melding = {
  id: string
  bruker_id: string
  navn: string
  tekst: string
  created_at: string
}

const KOLONNER = 'id,bruker_id,navn,tekst,created_at'

/** De siste meldingene, eldste først — som en samtale leses. */
export async function hentMeldinger(antall = 200): Promise<Melding[]> {
  const { data, error } = await supabase
    .from('firma_chat')
    .select(KOLONNER)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(antall)
  if (error) throw new Error(`Kunne ikke lese chatten: ${error.message}`)
  return ((data ?? []) as Melding[]).reverse()
}

export async function sendMelding(brukerId: string, navn: string, tekst: string, firmaId: string): Promise<void> {
  const rene = tekst.trim()
  if (!rene) return
  const { error } = await supabase.from('firma_chat').insert({
    id: crypto.randomUUID(),
    company_id: firmaId,
    bruker_id: brukerId,
    navn,
    tekst: rene,
  })
  if (error) throw new Error(`Meldingen ble ikke sendt: ${error.message}`)
}

export async function slettMelding(id: string): Promise<void> {
  const { error } = await supabase
    .from('firma_chat')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`Kunne ikke slette meldingen: ${error.message}`)
}

/**
 * Lytter på nye meldinger i firmaets tråd.
 *
 * Realtime og ikke polling: en samtale som henger etter i tretti sekunder er
 * ikke en samtale. Abonnementet lever så lenge fanen står åpen, og ryddes av
 * funksjonen som returneres.
 */
export function lyttPaaChat(firmaId: string, naar: (m: Melding) => void): () => void {
  const kanal = supabase
    .channel(`firma-chat-${firmaId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'firma_chat', filter: `company_id=eq.${firmaId}` },
      nyttet => naar(nyttet.new as Melding),
    )
    .subscribe()

  return () => { void supabase.removeChannel(kanal) }
}

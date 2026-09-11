import { byggFakturaCsv, filnavn, type Fakturarad } from '@delt/accounting/tripletex-csv'
import { hentFirma } from '@/lib/kontor-lager'
import { grunnlagFra, hentOrdredetalj } from '@/lib/ordre-lager'
import { supabase } from '@/supabase'

/**
 * Fakturaeksport som FIL, til regnskapsføreren.
 *
 * ── Hvorfor dette finnes ved siden av `regnskap.ts` ────────────────────────
 *
 * `regnskap.ts` pusher via Tripletex' API. Den veien krever API 2.0-
 * registrering, skriftlig AI-samtykke (§2.2.13), og gir Tripletex — som også
 * selger Elektro/VVS, altså konkurrenten — løpende innsyn i hvor mange kunder
 * vi har og hvor fort det vokser.
 *
 * En CSV regnskapsføreren importerer rører aldri API-et. Ingen søknad, ingen
 * paragrafer, ingen innsyn. Og fila virker like godt i Fiken eller PowerOffice
 * hvis hun bytter system.
 *
 * ── Hvorfor dette bygges i klienten, når API-veien bygges på serveren ──────
 *
 * `regnskap`-funksjonen regner grunnlaget serverside fordi den PUSHER — der
 * ville en manipulert klient sendt tall rett inn i et regnskap.
 *
 * Her er det ingen hemmeligheter involvert (ingen tokens), og fila går til et
 * menneske som ser den før hun importerer. Regningen er dessuten den samme
 * `lib/invoicing.ts` som skjermen allerede viser — altså nøyaktig de tallene
 * kontoret har lest gjennom.
 *
 * Det ene som IKKE kan ligge i klienten er fakturanummeret: en teller må
 * tildeles av databasen, ellers kan to eksporter gi samme nummer.
 */

export type Eksportvalg = {
  ordreIder: string[]
  /** Betalingsfrist i dager fra fakturadato. */
  forfallsdager?: number
}

export type Eksportresultat = {
  csv: string
  filnavn: string
  antallFakturaer: number
  antallLinjer: number
  bruttoOre: number
  /** Ordrer som ble hoppet over, med grunn — skal VISES, ikke skjules. */
  hoppetOver: { ordreId: string; nummer: number | null; grunn: string }[]
}

/**
 * Tildeler fakturanummer og bygger CSV-en.
 *
 * `tildel_fakturanummer` er idempotent: en ordre som allerede har et nummer
 * beholder det. Det betyr at man kan eksportere samme bunke to ganger — fordi
 * fila ble borte, eller importen feilet halvveis — uten at nummerserien får
 * hull eller at kunden får to fakturaer med ulike numre for samme jobb.
 */
export async function byggRegnskapsfil(valg: Eksportvalg): Promise<Eksportresultat> {
  if (valg.ordreIder.length === 0) throw new Error('Ingen ordrer valgt.')

  const firma = await hentFirma()

  const { data: numre, error: nrFeil } = await supabase
    .rpc('tildel_fakturanummer', { p_ordrer: valg.ordreIder })
  if (nrFeil) throw new Error(`Kunne ikke tildele fakturanummer: ${nrFeil.message}`)

  const nummerFor = new Map(
    ((numre ?? []) as { ordre_id: string; nummer: number }[]).map(r => [r.ordre_id, r.nummer]),
  )

  const fakturaer: Fakturarad[] = []
  const hoppetOver: Eksportresultat['hoppetOver'] = []
  const forfallsdager = valg.forfallsdager ?? 14
  const idag = new Date()
  const forfall = new Date(idag)
  forfall.setDate(forfall.getDate() + forfallsdager)

  for (const id of valg.ordreIder) {
    const detalj = await hentOrdredetalj(id)
    const o = detalj.ordre
    const grunnlag = grunnlagFra(detalj)

    const nummer = nummerFor.get(id)
    if (nummer == null) {
      hoppetOver.push({ ordreId: id, nummer: o.order_number, grunn: 'fikk ikke fakturanummer' })
      continue
    }
    if (grunnlag.linjer.length === 0) {
      hoppetOver.push({ ordreId: id, nummer: o.order_number, grunn: 'ingen fakturerbare linjer' })
      continue
    }

    // Kunderaden hentes for org.nr og adresse — Tripletex matcher på dem når
    // kundenummeret mangler. Uten org.nr kan importen lage en DUPLIKAT kunde.
    let kunde: Record<string, unknown> | null = null
    if (detalj.ordre.customer_id) {
      const { data } = await supabase
        .from('customers')
        .select('name,org_nr,email,phone,address,postal_code,city,external_id')
        .eq('id', detalj.ordre.customer_id).maybeSingle()
      kunde = (data as Record<string, unknown>) ?? null
    }

    fakturaer.push({
      fakturanummer: nummer,
      fakturadato: idag,
      forfallsdato: forfall,
      ordrenummer: o.order_number,
      ordredato: new Date(o.created_at),
      kunde: {
        nummer: (kunde?.external_id as string | null) ?? null,
        navn: (kunde?.name as string) ?? o.customer_name ?? 'Ukjent kunde',
        orgnr: (kunde?.org_nr as string | null) ?? null,
        epost: (kunde?.email as string | null) ?? null,
        telefon: (kunde?.phone as string | null) ?? o.customer_phone ?? null,
        adresse: (kunde?.address as string | null) ?? null,
        postnummer: (kunde?.postal_code as string | null) ?? null,
        poststed: (kunde?.city as string | null) ?? null,
      },
      leveringsadresse: o.address,
      // Ordretittelen blir prosjektnavn. Tripletex oppretter prosjektet hvis
      // det ikke finnes, så regnskapsføreren får jobbene gruppert uten å
      // måtte sette dem opp på forhånd.
      prosjektnavn: o.title,
      kommentar: o.order_number != null ? `Ampex ordre ${o.order_number}` : null,
      grunnlag,
    })
  }

  if (fakturaer.length === 0) {
    throw new Error('Ingen av ordrene hadde noe å fakturere.')
  }

  const datoer = fakturaer.map(f => f.ordredato.getTime())
  return {
    csv: byggFakturaCsv(fakturaer),
    filnavn: filnavn(firma.company?.name ?? 'Ampex', new Date(Math.min(...datoer)), new Date(Math.max(...datoer))),
    antallFakturaer: fakturaer.length,
    antallLinjer: fakturaer.reduce((n, f) => n + f.grunnlag.linjer.length, 0),
    bruttoOre: fakturaer.reduce((n, f) => n + f.grunnlag.bruttoOre, 0),
    hoppetOver,
  }
}

/**
 * Laster ned fila.
 *
 * BOM foran innholdet: uten den leser Excel på norsk oppsett UTF-8 som
 * Windows-1252, og «Kjøkken» blir «KjÃ¸kken» i kundenavnet. Tripletex tåler
 * BOM-en; Excel trenger den.
 */
export function lastNed(csv: string, navn: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = navn
  a.click()
  // Nettleseren trenger URL-en til nedlastingen er startet; frigi den etterpå.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

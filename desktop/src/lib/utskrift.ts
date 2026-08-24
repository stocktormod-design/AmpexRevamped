import { convertFirmSections } from '@delt/forms/firm-schema'
import { getTemplate } from '@delt/forms/templates'
import type { FormSection, FormTemplate } from '@delt/forms/types'
import { byggUtskriftHtml, type Utskrift, type UtskriftSeksjon } from '@delt/dokument/utskrift'
import { hentFirma } from '@/lib/kontor-lager'
import { supabase } from '@/supabase'

/**
 * Fra utfylt skjema til et ark kunden kan få.
 *
 * **I dette faget ER dokumentet leveransen.** Fram til nå fantes sluttkontroll
 * og samsvarserklæring bare inne i appen — de var notiser hos oss, ikke
 * dokumentasjon for kunden.
 *
 * Selve utseendet ligger i `lib/dokument/utskrift.ts`, delt med appen og
 * selvtestet (`npm run verify:dokument`). Denne fila gjør bare I/O: henter
 * svarene, finner malen, og oversetter til den formen utskriften vil ha.
 *
 * ── Hvorfor malen slås opp på VERSJON ─────────────────────────────────────
 *
 * Dokumentet ble fylt mot en bestemt versjon av skjemaet. Skriver vi det ut med
 * gjeldende ordlyd, får gamle svar nye spørsmål — og da lyver arket, stille og
 * troverdig. Samme regel som `resolveTemplateAt` i appen.
 *
 * `resolve.ts` kan ikke brukes her: den leser WatermelonDB, som kontoret ikke
 * har. Malene og konverteringen er derimot rene funksjoner, så de deles.
 */

type Dokumentrad = {
  id: string
  template_id: string
  template_version: number
  status: string
  data: string | null
  completed_at: string | null
  completed_by: string | null
}

/** Firmamal fra Supabase, i den versjonen dokumentet faktisk ble fylt mot. */
async function firmamal(templateId: string, versjon: number): Promise<FormTemplate | null> {
  const [mal, rev] = await Promise.all([
    supabase.from('form_templates').select('id,title,category,current_version').eq('id', templateId).maybeSingle(),
    supabase.from('form_template_revisions').select('schema,version')
      .eq('template_id', templateId).eq('version', versjon).maybeSingle(),
  ])
  if (mal.error || !mal.data) return null

  // Fant vi ikke akkurat den versjonen, faller vi tilbake til gjeldende — og
  // kalleren merker arket med versjonen den FANT, ikke den vi lette etter.
  const rad = rev.data
    ?? (await supabase.from('form_template_revisions').select('schema,version')
      .eq('template_id', templateId).eq('version', mal.data.current_version).maybeSingle()).data
  if (!rad) return null

  let seksjoner: unknown
  try {
    seksjoner = JSON.parse(rad.schema as string)
  } catch {
    return null
  }
  if (!Array.isArray(seksjoner) || seksjoner.length === 0) return null

  return {
    id: mal.data.id as string,
    version: rad.version as number,
    name: mal.data.title as string,
    source: `Firmaskjema · ${mal.data.category}`,
    sections: convertFirmSections(seksjoner as Parameters<typeof convertFirmSections>[0], mal.data.title as string),
  }
}

/**
 * Seksjonene fra malen + svarene → punktene arket skal vise.
 *
 * `info`-felt hoppes over: de er hjelpetekst i skjemaet, ikke spørsmål, og
 * lagres aldri. Alt annet tas med — også det ubesvarte. At noe ikke ble krysset
 * av er også dokumentasjon.
 */
function tilSeksjoner(seksjoner: FormSection[], verdier: Record<string, unknown>): UtskriftSeksjon[] {
  return seksjoner
    .map(s => ({
      tittel: s.title,
      punkter: s.fields
        .filter(f => f.type !== 'info')
        .map(f => ({
          sporsmal: f.label,
          type: f.type,
          svar: f.key in verdier ? verdier[f.key] : null,
          enhet: f.unit ?? null,
          alternativer: f.choices ?? null,
        })),
    }))
    .filter(s => s.punkter.length > 0)
}

/**
 * Bygger utskriften for ett dokument på én ordre.
 *
 * Kaster med lesbar tekst i stedet for å returnere et halvt ark: et dokument
 * der malen mangler kan ikke skrives ut forsvarlig, og en tom side sendt til
 * kunden er verre enn en feilmelding til kontoret.
 */
export async function byggDokumentutskrift(ordreId: string, dokumentId: string): Promise<string> {
  const [d, o, f] = await Promise.all([
    supabase.from('order_documents')
      .select('id,template_id,template_version,status,data,completed_at,completed_by')
      .eq('id', dokumentId).is('deleted_at', null).maybeSingle(),
    supabase.from('orders')
      .select('order_number,title,address,customer_id,customer_name')
      .eq('id', ordreId).is('deleted_at', null).maybeSingle(),
    hentFirma(),
  ])

  if (d.error) throw new Error(`Kunne ikke lese dokumentet: ${d.error.message}`)
  if (!d.data) throw new Error('Fant ikke dokumentet.')
  if (o.error) throw new Error(`Kunne ikke lese ordren: ${o.error.message}`)
  if (!o.data) throw new Error('Fant ikke ordren.')

  const dok = d.data as unknown as Dokumentrad
  const ordre = o.data as Record<string, unknown>

  const mal = dok.template_id.startsWith('ampex.')
    ? getTemplate(dok.template_id)
    : await firmamal(dok.template_id, dok.template_version)
  if (!mal) throw new Error('Fant ikke skjemamalen dokumentet ble fylt mot.')

  let verdier: Record<string, unknown> = {}
  if (dok.data) {
    try {
      verdier = JSON.parse(dok.data) as Record<string, unknown>
    } catch {
      throw new Error('Svarene i dokumentet lot seg ikke lese.')
    }
  }

  // Hvem som fullførte står som en bruker-ID på raden. Navnet ligger i
  // ansattlista vi allerede har hentet — ett oppslag, ingen ny rundtur.
  const utfortAv = dok.completed_by
    ? (f.ansatte.find(a => a.id === dok.completed_by)?.full_name ?? null)
    : null

  const kundenavn = (ordre.customer_name as string | null) ?? null

  const utskrift: Utskrift = {
    firma: {
      navn: f.company?.name ?? 'Ampex',
      orgnr: f.company?.org_number ?? null,
    },
    dokument: {
      tittel: mal.name,
      malversjon: mal.version,
      status: dok.status,
      fullfortAv: utfortAv,
      fullfortTid: dok.completed_at ? new Date(dok.completed_at) : null,
    },
    ordre: {
      nummer: (ordre.order_number as number | null) ?? null,
      tittel: ordre.title as string,
      adresse: (ordre.address as string | null) ?? null,
    },
    kunde: kundenavn ? { navn: kundenavn, adresse: (ordre.address as string | null) ?? null } : null,
    seksjoner: tilSeksjoner(mal.sections, verdier),
    // Signaturene henger på ORDREN, ikke på dokumentet. Kundens underskrift
    // gjelder at arbeidet er utført — den hører derfor på arket som viser at
    // det ble kontrollert.
    signaturer: await hentSignaturer(ordreId),
    skrevetUt: new Date(),
  }

  return byggUtskriftHtml(utskrift)
}

async function hentSignaturer(ordreId: string): Promise<Utskrift['signaturer']> {
  const { data, error } = await supabase
    .from('order_signatures')
    .select('purpose,signer_name,signer_title,strokes,aspect,note,signed_at')
    .eq('order_id', ordreId).is('deleted_at', null)
    .order('signed_at')
  if (error) return []

  return ((data ?? []) as Record<string, unknown>[]).flatMap(r => {
    let strok: { points: [number, number][] }[] = []
    try {
      const parsed = JSON.parse((r.strokes as string) ?? '[]')
      if (Array.isArray(parsed)) strok = parsed
    } catch {
      // En signatur med ulesbare strøk skal fortsatt STÅ på arket — navnet og
      // tidspunktet er beviset, streken er illustrasjonen.
      strok = []
    }
    return [{
      formaal: (r.purpose as string) ?? 'Annet',
      signertAv: (r.signer_name as string) ?? '',
      tittel: (r.signer_title as string | null) ?? null,
      signertTid: new Date(r.signed_at as string),
      strok,
      aspect: (r.aspect as number | null) ?? null,
      merknad: (r.note as string | null) ?? null,
    }]
  })
}

/**
 * Åpner dokumentet i et eget vindu og ber om utskrift.
 *
 * Nettleserens egen «Skriv ut → Lagre som PDF» er veien til fil. Et
 * PDF-bibliotek i klienten ville vært en tredje implementasjon av hvordan
 * dokumentet ser ut, ved siden av skjemavisningen og arkivpakken.
 *
 * Vinduet åpnes FØR `await` på innholdet: en popup som åpnes etter et
 * nettverkskall blir blokkert, fordi nettleseren ikke lenger ser den som et
 * resultat av klikket.
 */
export async function skrivUtDokument(ordreId: string, dokumentId: string): Promise<void> {
  const vindu = window.open('', '_blank')
  if (!vindu) throw new Error('Nettleseren blokkerte utskriftsvinduet. Tillat popup for denne siden.')

  vindu.document.write('<!doctype html><meta charset="utf-8"><title>Henter …</title><p>Henter dokumentet …</p>')
  try {
    const html = await byggDokumentutskrift(ordreId, dokumentId)
    vindu.document.open()
    vindu.document.write(html)
    vindu.document.close()
    vindu.focus()
    // Vent til stilene er lagt ut, ellers skriver Chrome ut et ustilt ark.
    vindu.onload = () => vindu.print()
    if (vindu.document.readyState === 'complete') vindu.print()
  } catch (e) {
    vindu.close()
    throw e
  }
}

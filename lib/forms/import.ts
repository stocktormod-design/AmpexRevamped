import { JA_NEI_IA } from './types'
import type { FormField, FormFieldColumn, FormFieldType, FormSection } from './schema'

/**
 * ── Import av et fremmed skjema ─────────────────────────────────────────────
 *
 * Veien som slår konkurrentene er ikke å lese SpeedyCraft-basen. Det er å la
 * firmaet laste opp SITT EGET skjema — da virker importen også mot Cordel,
 * Handyman og Word-dokumentet fra 2009, som er der de fleste småfirma faktisk
 * har skjemaene sine.
 *
 * Denne fila er det som står MELLOM modellen og malen. En språkmodell som leser
 * et skannet skjema vil alltid bomme på det mekaniske: den finner på id-er som
 * kolliderer, lager klikklister uten alternativer, og setter betingelser som
 * peker nedover i skjemaet. Å be mennesket rydde opp i det er feil bruk av
 * mennesket — det er deterministisk arbeid, og deterministisk arbeid gjør vi.
 *
 * Regelen er: **rett alt som kan rettes uten å gjette på innhold, og si fra om
 * hver eneste rettelse.** Da handler gjennomgangen om FAGET — stemmer punktene
 * med skjemaet? — og ikke om datastruktur.
 *
 * Ren funksjon, ingen database og ingen React Native. Derfor selvtestbar
 * (tools/verify-form-import.ts), som er hele grunnen til at den ligger for seg.
 */

/** Én ting som ble rettet automatisk. Vises for mennesket, ordrett. */
export type Rettelse = string

export type Importresultat = {
  tittel: string
  kategori: string
  seksjoner: FormSection[]
  /** Rettet automatisk — vises samlet, ikke som feil. */
  rettelser: Rettelse[]
  /** Punkt modellen selv flagget som usikre. Merkes i gjennomgangen. */
  usikre: Record<string, string>
  /** Én setning fra modellen om hva den så. */
  merknad: string
}

const TYPER: FormFieldType[] = ['check', 'text', 'multiline', 'number', 'choice', 'table', 'info', 'photo']

export const IMPORT_KATEGORIER = ['Sluttkontroll', 'Risiko / SJA', 'HMS', 'Måleprotokoll', 'Egenkontroll', 'Diverse']

/**
 * Etikett → id. Norsk tekst, så æøå må bli noe lesbart og ikke forsvinne — en
 * id på «mling_av_jordfeilbryter» hjelper ingen som senere skal feilsøke.
 */
export function tilId(tekst: string): string {
  const n = tekst
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '')
  return n || 'punkt'
}

function tekst(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function liste(v: unknown): string[] {
  return Array.isArray(v) ? v.map(tekst).filter(Boolean) : []
}

function kolonner(v: unknown): FormFieldColumn[] {
  if (!Array.isArray(v)) return []
  const ut: FormFieldColumn[] = []
  const sett = new Set<string>()
  for (const rå of v) {
    const label = tekst(typeof rå === 'string' ? rå : (rå as Record<string, unknown>)?.label)
    if (!label) continue
    let key = tilId(tekst((rå as Record<string, unknown>)?.key) || label)
    while (sett.has(key)) key = `${key}_2`
    sett.add(key)
    ut.push({ key, label })
  }
  return ut
}

/**
 * Modellens råsvar → en mal som er trygg å redigere.
 *
 * Rekkefølgen er nødvendig: id-ene må være unike og endelige FØR betingelser
 * kan slås opp, og alternativlista til et punkt må være kjent før vi kan
 * avgjøre om en betingelse peker på et svar som finnes.
 */
export function normaliserImport(rå: unknown): Importresultat {
  const r = (rå ?? {}) as Record<string, unknown>
  const rettelser: Rettelse[] = []
  const usikre: Record<string, string> = {}

  const råSeksjoner = Array.isArray(r.seksjoner) ? r.seksjoner : []
  const brukteIder = new Set<string>()

  // Runde 1: felt, med endelige id-er. Innhold røres ikke.
  type Mellom = { felt: FormField; rååVilkår: unknown }
  const seksjoner: { tittel: string; felt: Mellom[] }[] = []

  for (const råS of råSeksjoner) {
    const s = (råS ?? {}) as Record<string, unknown>
    const felt: Mellom[] = []
    for (const råF of Array.isArray(s.felt) ? s.felt : []) {
      const f = (råF ?? {}) as Record<string, unknown>
      const label = tekst(f.label)
      if (!label) {
        // Et punkt uten tekst kan ikke reddes — vi kan ikke finne på hva det
        // spurte om, og et tomt punkt i felt er verre enn ett punkt mindre.
        rettelser.push('Et punkt uten tekst ble fjernet — det kunne ikke leses av kilden.')
        continue
      }

      let type = (tekst(f.type) as FormFieldType) || 'text'
      if (!TYPER.includes(type)) {
        rettelser.push(`«${label}» hadde en ukjent felttype og ble satt til fritekst.`)
        type = 'text'
      }

      let id = tilId(tekst(f.id) || label)
      if (brukteIder.has(id)) {
        let n = 2
        while (brukteIder.has(`${id}_${n}`)) n++
        id = `${id}_${n}`
        rettelser.push(`«${label}» fikk ny id fordi et annet punkt hadde samme — svarene ville overskrevet hverandre.`)
      }
      brukteIder.add(id)

      const valg = liste(f.valg ?? f.choices)
      const kols = kolonner(f.kolonner ?? f.columns)

      if (type === 'choice' && valg.length === 0) {
        rettelser.push(`«${label}» var en klikkliste uten alternativer og ble gjort om til fritekst.`)
        type = 'text'
      }
      if (type === 'table' && kols.length === 0) {
        rettelser.push(`Tabellen «${label}» hadde ingen kolonner og ble gjort om til fritekst.`)
        type = 'multiline'
      }

      const ut: FormField = { id, type, label }
      if (f.paakrevd === true || f.required === true) ut.required = true
      const hjelp = tekst(f.hjelp ?? f.help)
      if (hjelp) ut.help = hjelp
      if (type === 'choice') ut.choices = valg
      if (type === 'table') ut.columns = kols
      const enhet = tekst(f.enhet ?? f.unit)
      if (type === 'number' && enhet) ut.unit = enhet

      const usikkert = tekst(f.usikkert)
      if (usikkert) usikre[id] = usikkert

      felt.push({ felt: ut, rååVilkår: f.vises_hvis ?? f.showIf })
    }
    seksjoner.push({ tittel: tekst(s.tittel ?? s.title), felt })
  }

  // Runde 2: betingelser. Nå er id-ene endelige og alternativene kjent.
  const alternativer = new Map<string, string[]>()
  const rekkefølge: string[] = []
  for (const s of seksjoner) {
    for (const m of s.felt) {
      rekkefølge.push(m.felt.id)
      if (m.felt.type === 'check') alternativer.set(m.felt.id, JA_NEI_IA)
      if (m.felt.type === 'choice') alternativer.set(m.felt.id, m.felt.choices ?? [])
    }
  }

  for (const s of seksjoner) {
    for (const m of s.felt) {
      const v = (m.rååVilkår ?? null) as Record<string, unknown> | null
      if (!v) continue
      const navn = m.felt.label
      const målId = tilId(tekst(v.felt ?? v.field))
      const opts = alternativer.get(målId)
      if (!opts) {
        rettelser.push(`Betingelsen på «${navn}» ble fjernet — den pekte på et punkt som ikke finnes, eller som ikke har svaralternativer.`)
        continue
      }
      if (rekkefølge.indexOf(målId) > rekkefølge.indexOf(m.felt.id)) {
        rettelser.push(`Betingelsen på «${navn}» ble fjernet — den pekte NEDOVER i skjemaet, og et punkt kan ikke styres av noe som kommer etter det.`)
        continue
      }
      const ønsket = liste(v.er ?? v.equals)
      const gyldige = ønsket.filter(x => opts.includes(x))
      if (gyldige.length === 0) {
        rettelser.push(`Betingelsen på «${navn}» ble fjernet — den ventet på et svar som ikke finnes i punktet den pekte på.`)
        continue
      }
      if (gyldige.length < ønsket.length) {
        rettelser.push(`Betingelsen på «${navn}» ble strammet inn til svar som faktisk finnes.`)
      }
      m.felt.showIf = { field: målId, equals: gyldige }
    }
  }

  // Runde 3: seksjoner. Tomme forsvinner — en overskrift uten punkt under er
  // en overskrift modellen leste, ikke en del av skjemaet.
  const ferdige: FormSection[] = []
  let n = 0
  for (const s of seksjoner) {
    if (s.felt.length === 0) {
      if (s.tittel) rettelser.push(`Overskriften «${s.tittel}» hadde ingen punkt under seg og ble utelatt.`)
      continue
    }
    n++
    ferdige.push({
      id: tilId(s.tittel || `del_${n}`),
      title: s.tittel || `Del ${n}`,
      fields: s.felt.map(m => m.felt),
    })
  }

  const kategori = tekst(r.kategori)
  return {
    tittel: tekst(r.tittel) || 'Importert skjema',
    kategori: IMPORT_KATEGORIER.includes(kategori) ? kategori : 'Diverse',
    seksjoner: ferdige,
    rettelser,
    usikre,
    merknad: tekst(r.merknad),
  }
}

/** Kort oppsummering til toppen av gjennomgangen. */
export function oppsummer(res: Importresultat): { seksjoner: number; punkt: number; usikre: number } {
  return {
    seksjoner: res.seksjoner.length,
    punkt: res.seksjoner.reduce((a, s) => a + s.fields.length, 0),
    usikre: Object.keys(res.usikre).length,
  }
}

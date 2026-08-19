/**
 * Fakturagrunnlag — fra ordre til beløp.
 *
 * Regnestykket ligger i rene funksjoner uten database, slik at det kan
 * selvtestes (`npm run verify:invoicing`). Penger regnes i **øre som heltall**;
 * kroner med desimaler brukes bare inn og ut. Flyttall som akkumuleres over
 * hundre linjer gir øreavvik som ingen klarer å forklare kunden.
 *
 * MVA-typene her er Ampex' egne. De skal IKKE være Fikens strenger — Fiken
 * bruker HIGH/MEDIUM/LOW/EXEMPT, Tripletex bruker sine egne koder, og adapteren
 * oversetter. Det er hele poenget med «adapter, ikke integrasjon».
 */

export type MvaType = 'hoy' | 'middels' | 'lav' | 'fritatt'

/** Norske satser per 2026. Elektroarbeid er alltid `hoy`. */
export const mvaSats: Record<MvaType, number> = {
  hoy: 25,
  middels: 15,
  lav: 12,
  fritatt: 0,
}

export const mvaLabel: Record<MvaType, string> = {
  hoy: '25 %',
  middels: '15 %',
  lav: '12 %',
  fritatt: 'Fritatt',
}

export const STANDARD_MVA: MvaType = 'hoy'

/** Ukjent eller tom verdi faller til høy sats — å utelate MVA er den dyre feilen. */
export function somMvaType(v: string | null | undefined): MvaType {
  return v === 'middels' || v === 'lav' || v === 'fritatt' ? v : 'hoy'
}

// ── Penger ────────────────────────────────────────────────────────────────────

/** Kroner → øre. Runder halve øre opp, slik en kasse gjør. */
export function tilOre(kroner: number): number {
  return Math.round(kroner * 100)
}

export function fraOre(ore: number): number {
  return ore / 100
}

/**
 * Linjebeløp i øre. Antall kan ha desimaler (12,5 m kabel), pris er øre/enhet.
 * Avrunding skjer én gang per linje — ikke på summen — slik at linjene i
 * fakturaen alltid legger sammen til totalen som står nederst.
 */
export function linjebelopOre(antall: number, enhetsprisOre: number): number {
  return Math.round(antall * enhetsprisOre)
}

export function mvaBelopOre(nettoOre: number, mva: MvaType): number {
  return Math.round((nettoOre * mvaSats[mva]) / 100)
}

export function formatKr(ore: number): string {
  const neg = ore < 0
  const abs = Math.abs(ore)
  const kr = Math.floor(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  // Hardt mellomrom (U+00A0) med vilje: «1 234 567» skal aldri brekke over
  // to linjer i en fakturatabell. Skrevet som escape så den ikke blir
  // «ryddet» til et vanlig mellomrom av et søk-og-erstatt.
  const grupper = String(kr).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
  return `${neg ? '−' : ''}${grupper},${rest}`
}

// ── Grunnlaget ────────────────────────────────────────────────────────────────

export type LinjeKilde = 'materiell' | 'timer' | 'tillegg'

export type Fakturalinje = {
  kilde: LinjeKilde
  /** IDene linja er bygget av. Flere ved gruppering — derfor alltid en liste. */
  kildeIder: string[]
  beskrivelse: string
  antall: number
  enhet: string
  enhetsprisOre: number
  mva: MvaType
  nettoOre: number
  mvaOre: number
  bruttoOre: number
  elnummer?: string | null
  /** Selvkost der den finnes — grunnlaget for dekningsbidrag. */
  kostOre?: number | null
}

export type UtelattLinje = {
  kilde: LinjeKilde
  id: string
  beskrivelse: string
  grunn: 'ikke_fakturerbar' | 'mangler_pris' | 'allerede_fakturert' | 'ikke_godkjent' | 'avvist'
}

export type Fakturagrunnlag = {
  linjer: Fakturalinje[]
  utelatt: UtelattLinje[]
  nettoOre: number
  mvaOre: number
  bruttoOre: number
  kostOre: number
  /** Dekningsbidrag i øre og prosent av netto. null når ingen kost er kjent. */
  dbOre: number | null
  dbProsent: number | null
  /** Per MVA-sats — fakturaen må kunne vise mva-spesifikasjon. */
  mvaFordeling: { mva: MvaType; nettoOre: number; mvaOre: number }[]
}

// Inndata er med vilje flate objekter, ikke WatermelonDB-modeller. Da kan
// regnestykket testes uten database, og AI-verktøyene kan gjenbruke det.

export type MateriellInn = {
  id: string
  beskrivelse: string
  antall: number
  enhet: string
  elnummer?: string | null
  enhetsprisKr?: number | null
  kostprisKr?: number | null
  mvaType?: string | null
  fakturerbar?: boolean | null
  fakturertTid?: number | null
}

export type TimeInn = {
  id: string
  aktivitetId?: string | null
  aktivitetNavn?: string | null
  aktivitetTimepris?: number | null
  aktivitetFakturerbar?: boolean | null
  aktivitetMva?: string | null
  personId: string
  personNavn: string
  dato: number
  timer: number
  /** Synlig på faktura. `internNotat` skal aldri havne her. */
  notat?: string | null
  fakturerbar?: boolean | null
  fakturertTid?: number | null
}

export type TilleggInn = {
  id: string
  tittel: string
  beskrivelse?: string | null
  /** 'fastpris' gir egen linje. 'medgatt' dekkes av timer og materiell. */
  prising: 'fastpris' | 'medgatt'
  prisKr?: number | null
  mvaType?: string | null
  status: 'foreslatt' | 'godkjent' | 'avvist'
  godkjentAv?: string | null
  fakturertTid?: number | null
}

export type Gruppering = 'aktivitet' | 'aktivitetOgPerson' | 'ingen'

export type GrunnlagValg = {
  /** Speiler Fikens tre valg i `/timeEntries/createInvoiceDraft`. */
  gruppering?: Gruppering
  /** Ta med linjer som allerede er merket fakturert. Normalt av. */
  inkluderFakturerte?: boolean
}

function timeBeskrivelse(navn: string, timer: number): string {
  const t = Number.isInteger(timer) ? String(timer) : timer.toFixed(2).replace('.', ',')
  return `${navn} — ${t} t`
}

/**
 * Bygger fakturagrunnlaget. Rekkefølgen er materiell først, så timer — samme
 * som en håndskrevet faktura i faget, og samme som ordredetaljen viser.
 */
export function byggFakturagrunnlag(
  materiell: MateriellInn[],
  timer: TimeInn[],
  valg: GrunnlagValg = {},
  tillegg: TilleggInn[] = [],
): Fakturagrunnlag {
  const gruppering = valg.gruppering ?? 'aktivitet'
  const linjer: Fakturalinje[] = []
  const utelatt: UtelattLinje[] = []

  for (const m of materiell) {
    if (m.fakturerbar === false) {
      utelatt.push({ kilde: 'materiell', id: m.id, beskrivelse: m.beskrivelse, grunn: 'ikke_fakturerbar' })
      continue
    }
    if (m.fakturertTid && !valg.inkluderFakturerte) {
      utelatt.push({ kilde: 'materiell', id: m.id, beskrivelse: m.beskrivelse, grunn: 'allerede_fakturert' })
      continue
    }
    // Uten pris kan linja ikke faktureres. Den skal vises som mangel, ikke
    // stilltiende bli null kroner — en faktura som mangler materiell oppdages
    // aldri, en advarsel gjør det.
    if (m.enhetsprisKr == null) {
      utelatt.push({ kilde: 'materiell', id: m.id, beskrivelse: m.beskrivelse, grunn: 'mangler_pris' })
      continue
    }
    const mva = somMvaType(m.mvaType)
    const enhetsprisOre = tilOre(m.enhetsprisKr)
    const nettoOre = linjebelopOre(m.antall, enhetsprisOre)
    const mOre = mvaBelopOre(nettoOre, mva)
    linjer.push({
      kilde: 'materiell',
      kildeIder: [m.id],
      beskrivelse: m.beskrivelse,
      antall: m.antall,
      enhet: m.enhet,
      enhetsprisOre,
      mva,
      nettoOre,
      mvaOre: mOre,
      bruttoOre: nettoOre + mOre,
      elnummer: m.elnummer ?? null,
      kostOre: m.kostprisKr == null ? null : linjebelopOre(m.antall, tilOre(m.kostprisKr)),
    })
  }

  // Timer: filtrer først, grupper etterpå. Motsatt rekkefølge ville latt en
  // ikke-fakturerbar føring dra en hel gruppe med seg.
  const brukbare: TimeInn[] = []
  for (const t of timer) {
    const fakturerbar = t.fakturerbar ?? t.aktivitetFakturerbar ?? true
    if (!fakturerbar) {
      utelatt.push({ kilde: 'timer', id: t.id, beskrivelse: t.aktivitetNavn ?? 'Timer', grunn: 'ikke_fakturerbar' })
      continue
    }
    if (t.fakturertTid && !valg.inkluderFakturerte) {
      utelatt.push({ kilde: 'timer', id: t.id, beskrivelse: t.aktivitetNavn ?? 'Timer', grunn: 'allerede_fakturert' })
      continue
    }
    if (t.aktivitetTimepris == null) {
      utelatt.push({ kilde: 'timer', id: t.id, beskrivelse: t.aktivitetNavn ?? 'Timer', grunn: 'mangler_pris' })
      continue
    }
    brukbare.push(t)
  }

  const grupper = new Map<string, TimeInn[]>()
  for (const t of brukbare) {
    const key =
      gruppering === 'ingen' ? t.id
      : gruppering === 'aktivitetOgPerson' ? `${t.aktivitetId ?? 'u'}|${t.personId}`
      : `${t.aktivitetId ?? 'u'}`
    const bucket = grupper.get(key)
    if (bucket) bucket.push(t)
    else grupper.set(key, [t])
  }

  for (const bucket of grupper.values()) {
    const forste = bucket[0]
    const timerSum = bucket.reduce((a, t) => a + t.timer, 0)
    const enhetsprisOre = tilOre(forste.aktivitetTimepris as number)
    const mva = somMvaType(forste.aktivitetMva)
    const nettoOre = linjebelopOre(timerSum, enhetsprisOre)
    const mOre = mvaBelopOre(nettoOre, mva)
    const navn = forste.aktivitetNavn ?? 'Arbeid'
    const base =
      gruppering === 'aktivitetOgPerson' ? `${navn}, ${forste.personNavn}`
      : gruppering === 'ingen' ? navn
      : navn
    // Notatene er montørens egne ord om hva som ble gjort. De er ofte det
    // eneste kunden faktisk leser, så de skal med — men bare de som finnes.
    const notater = bucket.map(t => t.notat?.trim()).filter((n): n is string => !!n)
    const beskrivelse = notater.length
      ? `${timeBeskrivelse(base, timerSum)}\n${notater.join('\n')}`
      : timeBeskrivelse(base, timerSum)
    linjer.push({
      kilde: 'timer',
      kildeIder: bucket.map(t => t.id),
      beskrivelse,
      antall: timerSum,
      enhet: 't',
      enhetsprisOre,
      mva,
      nettoOre,
      mvaOre: mOre,
      bruttoOre: nettoOre + mOre,
      kostOre: null,
    })
  }

  // Tilleggsarbeid til slutt — det er den rekkefølgen kunden leser fakturaen i,
  // og den som gjør det tydelig hva som IKKE var med i den opprinnelige avtalen.
  for (const x of tillegg) {
    if (x.status === 'avvist') {
      utelatt.push({ kilde: 'tillegg', id: x.id, beskrivelse: x.tittel, grunn: 'avvist' })
      continue
    }
    // Ikke godkjent tillegg skal ALDRI havne på en faktura. Det er hele poenget
    // med å registrere det: udokumentert tilleggsarbeid er arbeid du ikke får betalt for.
    if (x.status !== 'godkjent') {
      utelatt.push({ kilde: 'tillegg', id: x.id, beskrivelse: x.tittel, grunn: 'ikke_godkjent' })
      continue
    }
    if (x.fakturertTid && !valg.inkluderFakturerte) {
      utelatt.push({ kilde: 'tillegg', id: x.id, beskrivelse: x.tittel, grunn: 'allerede_fakturert' })
      continue
    }
    // Etter medgått: timene og materiellet ligger allerede som egne linjer.
    // En linje til ville fakturert samme arbeid to ganger.
    if (x.prising === 'medgatt') continue
    if (x.prisKr == null) {
      utelatt.push({ kilde: 'tillegg', id: x.id, beskrivelse: x.tittel, grunn: 'mangler_pris' })
      continue
    }
    const mva = somMvaType(x.mvaType)
    const enhetsprisOre = tilOre(x.prisKr)
    const mOre = mvaBelopOre(enhetsprisOre, mva)
    linjer.push({
      kilde: 'tillegg',
      kildeIder: [x.id],
      beskrivelse: x.godkjentAv ? `${x.tittel} (godkjent av ${x.godkjentAv})` : x.tittel,
      antall: 1,
      enhet: 'stk',
      enhetsprisOre,
      mva,
      nettoOre: enhetsprisOre,
      mvaOre: mOre,
      bruttoOre: enhetsprisOre + mOre,
      kostOre: null,
    })
  }

  const nettoOre = linjer.reduce((a, l) => a + l.nettoOre, 0)
  const mvaOre = linjer.reduce((a, l) => a + l.mvaOre, 0)
  const kostOre = linjer.reduce((a, l) => a + (l.kostOre ?? 0), 0)
  const harKost = linjer.some(l => l.kostOre != null)

  const perMva = new Map<MvaType, { nettoOre: number; mvaOre: number }>()
  for (const l of linjer) {
    const rad = perMva.get(l.mva) ?? { nettoOre: 0, mvaOre: 0 }
    rad.nettoOre += l.nettoOre
    rad.mvaOre += l.mvaOre
    perMva.set(l.mva, rad)
  }

  return {
    linjer,
    utelatt,
    nettoOre,
    mvaOre,
    bruttoOre: nettoOre + mvaOre,
    kostOre,
    dbOre: harKost ? nettoOre - kostOre : null,
    dbProsent: harKost && nettoOre !== 0 ? ((nettoOre - kostOre) / nettoOre) * 100 : null,
    mvaFordeling: [...perMva.entries()].map(([mva, r]) => ({ mva, ...r })),
  }
}

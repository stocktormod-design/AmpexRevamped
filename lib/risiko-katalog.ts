/**
 * Dynamisk risikovurdering (Edgar Karlsen via Tormod 30.10: «hvis det ikke er elbillader skal man
 * jo ikke ha spørsmål om det»). Én katalog over farer som går igjen i elektrikerjobber; hver fare
 * vet selv NÅR den er aktuell, ut fra det ordren faktisk inneholder: punktene på tegningen, rommene
 * og påvirkningene deres, ordreteksten og materiellet. Det som ikke gjelder jobben, vises ikke.
 *
 * Alt er forslag. S, K og tiltak er et utgangspunkt installatøren retter; NEK-henvisningen peker
 * til delen som må slås opp, ikke ordlyden. Forslaget sier alltid HVORFOR det kom opp, så den som
 * vurderer ser hva i jobben som utløste det — og kan avvise det med god samvittighet.
 *
 * Ren logikk, ingen I/O — `npm run verify:prosjektering`.
 */
import type { Fare, Prosjektering } from './prosjektering'

/** Det ordren består av, samlet fra tegningen og ordreraden. */
export type Jobb = {
  /** Ordretittel, beskrivelse og materiell — fritekst, matches på ord. */
  tekst: string
  tegning: Prosjektering
}

export type Forslag = {
  id: string
  tittel: string
  gjelder: Fare['gjelder']
  s: number
  k: number
  tiltak: string
  restS: number
  restK: number
  nek: string
  /** Hva i jobben som gjorde forslaget aktuelt. */
  fordi: string
  romId?: string
}

type Treff = { fordi: string; romId?: string } | null
type Mal = Omit<Forslag, 'fordi' | 'romId'> & { nar: (j: Kontekst) => Treff }

type Kontekst = {
  tekst: string
  punkter: Set<string>
  tegning: Prosjektering
  /** Første rom hvis navn eller bruk matcher. */
  rom: (re: RegExp) => { id: string; navn: string } | null
  /** Første rom med en av påvirkningskodene. */
  pav: (...koder: string[]) => { id: string; navn: string; kode: string } | null
  ord: (re: RegExp) => string | null
}

function kontekst(j: Jobb): Kontekst {
  const t = j.tegning
  const tekst = [j.tekst, ...t.punkter.map(p => p.notat ?? ''), ...t.rom.map(r => `${r.navn} ${r.bruk} ${r.notat}`), t.kunde]
    .join('\n').toLowerCase()
  return {
    tekst,
    punkter: new Set(t.punkter.map(p => p.type)),
    tegning: t,
    rom: re => t.rom.find(r => re.test(r.navn.toLowerCase()) || re.test(r.bruk.toLowerCase())) ?? null,
    pav: (...koder) => {
      for (const r of t.rom) {
        const k = r.pavirkninger.find(x => koder.includes(x))
        if (k) return { id: r.id, navn: r.navn, kode: k }
      }
      return null
    },
    ord: re => tekst.match(re)?.[0] ?? null,
  }
}

/** Ord i ordren som gjør et tema aktuelt. Delt med temavalget i skjemaet `ampex.risikovurdering`. */
export const RISIKO_ORD = {
  bad: /\b(bad|bath|dusj|våtrom|vaskerom|wc)\b/,
  kjokken: /kjøkken|kitchen|komfyr|induksjon|platetopp/,
  garasje: /garasje|garage|carport/,
  sov: /sov|bedroom|barnerom/,
  elbil: /elbil|lader|ladeboks|ladestasjon|easee|zaptec|wallbox|7-722/,
  varmekabel: /varmekabel|gulvvarme|varmefolie|7-753/,
  varmepumpe: /varmepumpe|luft.?til.?luft|luft.?vann|utedel/,
  tavle: /tavle|sikringsskap|fordeling|underfordeling|inntak|kurs/,
  inntak: /inntak|hovedsikring|nytt anlegg|nyanlegg|overspenningsvern/,
  eldre: /rehab|gammel|eldre|oppussing|asbest|\b19[0-8]\d\b/,
  komfyr: /komfyr|induksjon|platetopp/,
  styring: /dimmer|lysstyring|smarthus|plejd|shelly|knx/,
  ute: /\bute\b|utendørs|utvendig|fasade|terrasse|veranda|utelys/,
  hoyde: /stige|stillas|\btak|himling|høyde|lift/,
}
const RE = RISIKO_ORD

const KATALOG: Mal[] = [
  // ── Arbeidet (FSE § 10) ────────────────────────────────────────────────────
  {
    id: 'montor.spenning-tavle', gjelder: 'montor', tittel: 'Berøring av spenningssatte deler i tavla',
    s: 3, k: 5, restS: 1, restK: 5, nek: 'FSE §§ 10–14 (frakobling, sikring, prøving)',
    tiltak: 'Arbeid spenningsløst: frakoble, sikre mot innkobling (lås + skilt), prøve spenningsløshet med godkjent prøver, jorde/kortslutte ved behov. Berøringsskjerm mot deler som må stå på.',
    nar: c => (c.punkter.has('fordeling') || c.punkter.has('jordfeil') ? { fordi: 'tegningen har en fordeling' }
      : c.ord(RE.tavle) ? { fordi: `jobben nevner «${c.ord(RE.tavle)}»` } : null),
  },
  {
    id: 'montor.boring-skjult', gjelder: 'montor', tittel: 'Boring eller skjæring i skjult kabel eller rør',
    s: 3, k: 4, restS: 1, restK: 4, nek: 'FSE § 10',
    tiltak: 'Kabelsøker før boring, sjekk eksisterende tegninger, hold avstand fra installasjonssoner, frakoble kursene i området.',
    nar: c => (c.tegning.punkter.length > 0 ? { fordi: `${c.tegning.punkter.length} punkter skal monteres` } : null),
  },
  {
    id: 'montor.hoyde', gjelder: 'montor', tittel: 'Fall fra stige ved montasje i tak',
    s: 3, k: 3, restS: 1, restK: 3, nek: 'Arbeidsplassforskriften (arbeid i høyden)',
    tiltak: 'Riktig og kontrollert stige eller arbeidsplattform, stå aldri på øverste trinn, to personer ved tunge armaturer.',
    nar: c => (['lyspunkt', 'downlight', 'royk', 'armatur', 'sensor'].some(t => c.punkter.has(t))
      ? { fordi: 'tegningen har punkter i tak' } : null),
  },
  {
    id: 'montor.stov-asbest', gjelder: 'montor', tittel: 'Støv og mulig asbest ved inngrep i eldre bygg',
    s: 2, k: 4, restS: 1, restK: 4, nek: 'Forskrift om utførelse av arbeid (asbest), FSE § 10',
    tiltak: 'Avklar byggeår og materialer med kunden, ikke bor i ukjente plater før de er vurdert, P3-maske og avsug.',
    nar: c => (c.ord(RE.eldre) ? { fordi: `jobben nevner «${c.ord(RE.eldre)}»` } : null),
  },

  // ── Anlegget og brukerne (FEL § 16) ────────────────────────────────────────
  {
    id: 'anlegg.bad-sjokk', gjelder: 'anlegg', tittel: 'Elektrisk sjokk i våtrom',
    s: 3, k: 5, restS: 1, restK: 5, nek: 'NEK 400-7-701 (soner, 30 mA, tilleggsutjevning)',
    tiltak: 'Utstyr plassert etter sonene med riktig IP-grad, jordfeilvern 30 mA på alle kurser i rommet, tilleggsutjevning der det kreves.',
    nar: c => {
      const r = c.rom(RE.bad)
      if (r) return { fordi: `rommet «${r.navn}»`, romId: r.id }
      const p = c.pav('AD3', 'AD4', 'AD5')
      return p ? { fordi: `${p.kode} i «${p.navn}»`, romId: p.id } : null
    },
  },
  {
    id: 'anlegg.varmekabel', gjelder: 'anlegg', tittel: 'Overoppheting eller skade på varmekabel',
    s: 2, k: 4, restS: 1, restK: 4, nek: 'NEK 400-7-753',
    tiltak: 'Riktig W/m² for gulvet, ikke under faste innretninger, jordet skjerm, jordfeilvern 30 mA, isolasjonsmåling før og etter støp, plassering dokumentert med bilde og tegning.',
    nar: c => (c.ord(RE.varmekabel) ? { fordi: `jobben nevner «${c.ord(RE.varmekabel)}»` }
      : c.punkter.has('termostat') ? { fordi: 'tegningen har en termostat' } : null),
  },
  {
    id: 'anlegg.elbil-dc', gjelder: 'anlegg', tittel: 'DC-feilstrøm fra elbillader blinder jordfeilvernet',
    s: 2, k: 5, restS: 1, restK: 5, nek: 'NEK 400-7-722, 5-53 (RCD-type)',
    tiltak: 'Jordfeilvern type B, eller type A med 6 mA DC-deteksjon i laderen. Egen kurs per ladepunkt.',
    nar: c => (c.ord(RE.elbil) ? { fordi: `jobben nevner «${c.ord(RE.elbil)}»` } : null),
  },
  {
    id: 'anlegg.elbil-last', gjelder: 'anlegg', tittel: 'Overbelastning av inntaket ved lading',
    s: 3, k: 3, restS: 1, restK: 3, nek: 'NEK 400-3 (maksimal belastning), 4-43',
    tiltak: 'Lastberegning av hele boligen, dynamisk lastbalansering i laderen, vurder hovedsikring.',
    nar: c => (c.ord(RE.elbil) ? { fordi: `jobben nevner «${c.ord(RE.elbil)}»` } : null),
  },
  {
    id: 'anlegg.komfyr', gjelder: 'anlegg', tittel: 'Komfyrbrann',
    s: 3, k: 5, restS: 1, restK: 5, nek: 'NEK 400-4-42 (komfyrvakt)',
    tiltak: 'Komfyrvakt, egen kurs til komfyren dimensjonert etter effekten.',
    nar: c => {
      const r = c.rom(RE.kjokken)
      return r ? { fordi: `rommet «${r.navn}»`, romId: r.id } : c.ord(RE.komfyr) ? { fordi: `jobben nevner «${c.ord(RE.komfyr)}»` } : null
    },
  },
  {
    id: 'anlegg.royk', gjelder: 'anlegg', tittel: 'Sen varsling av brann der folk sover',
    s: 2, k: 5, restS: 1, restK: 5, nek: 'TEK17 § 11-12, NEK 400-5-56',
    tiltak: 'Seriekoblede røykvarslere på soverom og i rømningsvei, strømforsynt med batteribackup.',
    nar: c => {
      const r = c.rom(RE.sov)
      if (!r) return null
      return c.punkter.has('royk')
        ? { fordi: `soverommet «${r.navn}» (røykvarsler er tegnet — vurder plassering)`, romId: r.id }
        : { fordi: `soverommet «${r.navn}» har ingen røykvarsler på tegningen`, romId: r.id }
    },
  },
  {
    id: 'anlegg.garasje-stot', gjelder: 'anlegg', tittel: 'Mekanisk skade på utstyr i garasjen',
    s: 3, k: 3, restS: 1, restK: 3, nek: 'NEK 400-5-51 (AG2), 5-52',
    tiltak: 'Utstyr over støthøyde eller med beskyttelse, IP44 eller bedre, kabel i rør der den kan bli truffet.',
    nar: c => {
      const r = c.rom(RE.garasje)
      if (r) return { fordi: `rommet «${r.navn}»`, romId: r.id }
      const p = c.pav('AG2', 'AG3')
      return p ? { fordi: `${p.kode} i «${p.navn}»`, romId: p.id } : null
    },
  },
  {
    id: 'anlegg.brannfare-lagring', gjelder: 'anlegg', tittel: 'Brann i brennbart lagret materiale',
    s: 2, k: 4, restS: 1, restK: 4, nek: 'NEK 400-4-42, 5-51 (BE2)',
    tiltak: 'Lysarmaturer og varmekilder med avstand til lagret materiale, jordfeilvern for brannbeskyttelse, ikke skjøteledninger som fast løsning.',
    nar: c => {
      const p = c.pav('BE2')
      return p ? { fordi: `BE2 i «${p.navn}»`, romId: p.id } : null
    },
  },
  {
    id: 'anlegg.barn', gjelder: 'anlegg', tittel: 'Barn stikker gjenstander i stikkontakter',
    s: 3, k: 4, restS: 1, restK: 4, nek: 'NEK 400-5-51 (BA2), 4-41',
    tiltak: 'Stikkontakter med berøringsbeskyttelse (barnesikre), jordfeilvern 30 mA på stikkontaktkurser.',
    nar: c => {
      if (!c.punkter.has('stikk') && !c.punkter.has('stikk-jord')) return null
      const p = c.pav('BA2')
      return p ? { fordi: `barn (BA2) i «${p.navn}» og stikkontakter på tegningen`, romId: p.id } : null
    },
  },
  {
    id: 'anlegg.ute', gjelder: 'anlegg', tittel: 'Fukt og korrosjon på utstyr ute',
    s: 3, k: 3, restS: 1, restK: 3, nek: 'NEK 400-5-51 (AD4, AF2), 5-52',
    tiltak: 'IP44 eller bedre, korrosjonsbestandig materiell i kystklima, jordfeilvern 30 mA, drypp-sløyfe på kabelinnføringer.',
    nar: c => {
      const p = c.pav('AF2')
      if (p) return { fordi: `${p.kode} i «${p.navn}»`, romId: p.id }
      const r = c.rom(RE.ute)
      return r ? { fordi: `«${r.navn}»`, romId: r.id } : c.ord(RE.ute) ? { fordi: `jobben nevner «${c.ord(RE.ute)}»` } : null
    },
  },
  {
    id: 'anlegg.varmepumpe', gjelder: 'anlegg', tittel: 'Feil vern eller fukt ved varmepumpe',
    s: 2, k: 3, restS: 1, restK: 3, nek: 'NEK 400-5-53, 5-51 (AD4 ved utedel)',
    tiltak: 'Egen kurs etter produsentens krav (vern og karakteristikk), sikkerhetsbryter ved utedelen, IP-grad ute.',
    nar: c => (c.ord(RE.varmepumpe) ? { fordi: `jobben nevner «${c.ord(RE.varmepumpe)}»` } : null),
  },
  {
    id: 'anlegg.overspenning', gjelder: 'anlegg', tittel: 'Overspenning fra lyn eller nettet',
    s: 2, k: 4, restS: 1, restK: 3, nek: 'NEK 400-4-44, 5-534',
    tiltak: 'Overspenningsvern type 2 i hovedtavla, kort tilkobling til jord.',
    nar: c => (c.ord(RE.inntak) ? { fordi: `jobben nevner «${c.ord(RE.inntak)}»` }
      : c.pav('AQ2', 'AQ3') ? { fordi: 'lyn (AQ) er satt på et rom' } : null),
  },
  {
    id: 'anlegg.dimmer', gjelder: 'anlegg', tittel: 'Varmgang i dimmer eller styring mot feil last',
    s: 2, k: 3, restS: 1, restK: 3, nek: 'NEK 400-5-559, produsentens data',
    tiltak: 'Dimmer kompatibel med LED-driveren, nedregulert effekt ved flere i samme boks, ventilert montasje.',
    nar: c => (c.ord(RE.styring) ? { fordi: `jobben nevner «${c.ord(RE.styring)}»` } : null),
  },
  {
    id: 'anlegg.trehus-gjennomforing', gjelder: 'anlegg', tittel: 'Brannspredning gjennom kabelgjennomføringer',
    s: 2, k: 4, restS: 1, restK: 4, nek: 'NEK 400-5-527, TEK17 kap. 11',
    tiltak: 'Branntetting med godkjent system der kabler går gjennom brannskiller.',
    nar: c => {
      const p = c.pav('CA2')
      return p ? { fordi: `brennbare byggematerialer (CA2) i «${p.navn}»`, romId: p.id } : null
    },
  },
  {
    id: 'anlegg.overbelastning', gjelder: 'anlegg', tittel: 'Brann fra løse forbindelser eller overbelastet kurs',
    s: 2, k: 5, restS: 1, restK: 5, nek: 'NEK 400-4-42, 4-43, 5-52',
    tiltak: 'Vern dimensjonert etter kabel og forlegning, tiltrekkingsmoment etter produsent, termografi eller kontroll av forbindelser ved overlevering.',
    nar: c => (c.tegning.punkter.length > 0 || c.ord(RE.tavle) ? { fordi: 'gjelder alle nye kurser og koblinger' } : null),
  },
]

/** Alle id-ene i katalogen — for selvtesten og for å skille katalogforslag fra egne farer. */
export const KATALOG_IDER = KATALOG.map(m => m.id)

/**
 * Forslagene som gjelder DENNE jobben, minus det som allerede er lagt til eller avvist.
 * Rekkefølgen er katalogens: arbeidet først, så anlegget.
 */
export function forslag(j: Jobb): Forslag[] {
  const c = kontekst(j)
  const brukt = new Set([...j.tegning.farer.map(f => f.kilde).filter(Boolean), ...j.tegning.avvist])
  const ut: Forslag[] = []
  for (const { nar, ...m } of KATALOG) {
    if (brukt.has(m.id)) continue
    const t = nar(c)
    if (t) ut.push({ ...m, ...t })
  }
  return ut
}

/** Gjør et forslag til en fare i dokumentet. Teksten og S/K kan endres som på enhver annen fare. */
export function somFare(f: Forslag, id: string): Fare {
  return {
    id, kilde: f.id, tittel: f.tittel, gjelder: f.gjelder, romId: f.romId,
    s: f.s, k: f.k, tiltak: `${f.tiltak} (${f.nek})`, restS: f.restS, restK: f.restK,
  }
}

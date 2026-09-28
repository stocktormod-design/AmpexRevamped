/**
 * Loggmalene — oppsettet loggen SKAL følge. Selvtestes i `npm run verify:laeretid`.
 *
 * Malen er ikke vår. Den er oppsettet lærlingen allerede leverer til
 * fagbrev.io som PDF-vedlegg, og som faglig leder har godkjent 28 ganger:
 * oppdrag, risikovurdering med tolv faste punkter, materielliste, verktøy,
 * utførelse med begrunnelser, sluttkontroll, bilder, vurdering av arbeidet
 * med faste spørsmål, og egenvurdering. Hentet ORDRETT fra loggene hans
 * 27.09.2026 — spørsmålene i tabellene står slik de står i malen, for det er
 * de faglig leder leser etter.
 *
 * To maler finnes fordi han har brukt to: den lange fra 2025 (Word, tolv
 * vurderingsspørsmål og vedleggsliste) og den som gjelder nå (sju
 * vurderingsspørsmål og egenvurdering som fritekst). Flere kan legges til —
 * et kontor med egen mal er innholdsarbeid her, ikke kode et annet sted.
 *
 * Reglene som gjelder alle maler:
 *   - Seksjonene kommer i malens rekkefølge, med malens overskrifter.
 *   - Faste tabellrader står alltid, i malens rekkefølge, også når de er tomme.
 *     En tom rad er et spørsmål han må svare på, ikke en rad som kan forsvinne.
 *   - Modellen fyller bare ut det han har sagt. Det den ikke vet, står tomt.
 */
import type { Paakrevd } from './utsporing'
import { finnOppslag, UTGAVE } from './nek-kart'

export type TekstSeksjon = {
  id: string
  tittel: string
  slag: 'tekst'
  /** Hva som skal stå her, til modellen og til hjelpeteksten på skjermen. */
  hjelp: string
}

export type TabellSeksjon = {
  id: string
  tittel: string
  slag: 'tabell'
  /** Kolonnene som fylles ut. Den faste radteksten er ikke med her. */
  kolonner: string[]
  /** Overskriften over radteksten når tabellen har faste rader. */
  radkolonne?: string
  /** Faste rader, ordrett fra malen. Uten dem er tabellen fri (materielliste). */
  faste?: string[]
  hjelp: string
}

export type BildeSeksjon = { id: string; tittel: string; slag: 'bilder'; hjelp: string }

export type Seksjon = TekstSeksjon | TabellSeksjon | BildeSeksjon

export type Mal = {
  id: string
  navn: string
  beskrivelse: string
  seksjoner: Seksjon[]
  /** Det samtalen alltid må innom for å kunne fylle malen. */
  sporOm: Paakrevd[]
}

/** Utfyllingen: tekst for tekstseksjoner, rader med celler for tabeller. */
export type Utfylling = Record<string, string | string[][]>

/**
 * NEK-begrunnelsene ligger i utfyllingen under denne nøkkelen, som rader
 * [punkt, hva som skal begrunnes, hans begrunnelse].
 *
 * Boten vet HVOR i NEK noe står, aldri hva (nek-kart.ts). Når loggen skrives,
 * peker den derfor på punktet og sier hva som kan begrunnes. Henvisningen alene
 * holder («NEK 400:2026, punkt 522») — forklaringen med egne ord er frivillig,
 * men oppfordres til: å finne fram i boka er halve fagprøven.
 */
export const NEK_NOKKEL = '_nek'

// ── Malene ──────────────────────────────────────────────────────────────────
//
// Hentet ORDRETT fra «Felles dokumenter» i fagbrev.io (TENK Lofoten),
// 27.09.2026: «Mal-for-loggskriving-elektrofagene.docx» og «Mal skriftlig
// refleksjon.docx». Tabellspørsmålene står slik de står i Word-fila — også
// «arbeide i høyden» og «uforutsetthendelse»-skrivemåten er rettet bare der
// malen selv har en åpenbar skrivefeil. Malen sier selv hva som skjer med den:
// «Lagre dokumentet som pdf-fil, last opp i Fagbrev.io og kryss av alle
// relevante læreplanmål som du har vært innom i loggen.»

const RISIKO = [
  'Gjenstår det planlegging og avgrensing av opplegget?',
  'Pågår det andre oppdrag som kan medføre farlig hendelse?',
  'Kan oppdraget påvirke eksisterende anlegg/deler?',
  'Krever oppdraget at flere er tilstede?',
  'Mangler de som skal utføre arbeidet kompetanse?',
  'Er det behov for verneutstyr?',
  'Er oppdraget AUS-arbeid eller arbeid nært spenningsatt anlegg?',
  'Innebærer oppdraget arbeide i høyden?',
  'Er det nødvendig med dokumentert kompetanse utover fagbrev?',
  'Omfatter oppdraget arbeid i kummer, trange rom, avløp el.tilsv.?',
  'Kan ytre miljø bli utsatt for forurensning som følge av oppdraget?',
  'Kan noe gå galt, utover nevnte punkter?',
]

const VURDERING = [
  'Gikk arbeidet som planlagt?',
  'Ble det gjort endringer underveis?',
  'Fungerte alt som det skulle etter arbeidet?',
  'Ble det et større eller uforutsett tidsforbruk ved gjennomføringen av arbeidet?',
  'Ble arbeidet utført etter gjeldende lover og forskrifter?',
  'Oppsto det noen form for farlig/uforutsett hendelse ved utførelsen av oppgaven?',
  'Ble kunden fornøyd med arbeidet eller sluttproduktet?',
  'Er det noe som burde vært gjort annerledes ved gjennomføringen av arbeidet?',
  'Ble sluttresultatet bra?',
  'Er det noe DU mener burde vært gjort annerledes ved utførelsen av oppgaven?',
  'Har du lært noe ved gjennomførelse av arbeidet?',
  'Hva gjorde du bra og hvorfor?',
]

const VEDLEGG = [
  'Skjema for risikovurdering',
  'Samsvarserklæring',
  'Kursfortegnelse',
  'Sluttkontroll',
  'Tegninger',
  'Koblingsskjema',
  'Andre dokumenter? Angi hvilke',
]

export const MALER: Mal[] = [
  {
    id: 'tenk-loggmal',
    navn: 'Loggmal for elektrofagene',
    beskrivelse: 'Malen fra opplæringskontoret i fagbrev.io. Til logger fra jobben.',
    // Bare det som ikke kan gjettes. Resten fylles fra bildene og svaret hans,
    // og forståelsen sjekkes i quizen etterpå.
    sporOm: ['utfort-selv'],
    seksjoner: [
      {
        id: 'oppdrag', tittel: 'Oppdrag', slag: 'tekst',
        hjelp: 'En kort beskrivelse av oppdraget. Kort tekstavsnitt.',
      },
      {
        id: 'risiko', tittel: 'Risikovurdering', slag: 'tabell', radkolonne: 'Punkter',
        kolonner: ['Ja/nei', 'Risiko', 'Tiltak'], faste: RISIKO,
        hjelp: 'Svar ja eller nei på hvert punkt. Ved ja: risikoen og tiltaket.',
      },
      {
        id: 'materiell', tittel: 'Materielliste', slag: 'tabell', kolonner: ['Materiell', 'Antall'],
        hjelp: 'Materiellet som ble brukt.',
      },
      {
        id: 'verktoy', tittel: 'Verktøy/utstyr', slag: 'tekst',
        hjelp: 'Standardverktøy. Evt. spesialverktøy.',
      },
      {
        id: 'utforelse', tittel: 'Utførelse med begrunnelser for valg og henvisning til forskrifter', slag: 'tekst',
        hjelp: 'En god beskrivelse av utførelsen.',
      },
      {
        id: 'sluttkontroll', tittel: 'Sluttkontroll og dokumentasjon', slag: 'tekst',
        hjelp: 'Hvilken sluttkontroll som er gjennomført (med målinger og vurdering av disse), og hvilke dokumenter som er fylt ut og eventuelt vedlagt.',
      },
      {
        id: 'bilder', tittel: 'Bilder med bildeforklaring', slag: 'bilder',
        hjelp: 'Relevante bilder med forklaring.',
      },
      {
        id: 'vurdering', tittel: 'Vurdering av arbeidet og egenvurdering', slag: 'tabell', radkolonne: 'Vurdering',
        kolonner: ['Ja/nei', 'Problem', 'Hva/hvorfor', 'Tiltak/løsning'], faste: VURDERING,
        hjelp: 'Svar ja eller nei, og skriv problem, hva og hvorfor, og tiltak.',
      },
      {
        id: 'vedlegg', tittel: 'Vedlegg', slag: 'tabell', radkolonne: 'Vedlegg',
        kolonner: ['Ja/nei'], faste: VEDLEGG,
        hjelp: 'Hvilke dokumenter som er vedlagt.',
      },
    ],
  },
  {
    id: 'tenk-refleksjon',
    navn: 'Skriftlig refleksjon',
    beskrivelse: 'Mal fra opplæringskontoret for teoretiske logger om et læreplanmål. 3–5 setninger per del, i jeg-form.',
    sporOm: [],
    seksjoner: [
      {
        id: 'innledning', tittel: '1. Innledning', slag: 'tekst',
        hjelp: 'Hva er temaet (med egne ord), og hvorfor er det viktig i faget og i jobben din?',
      },
      {
        id: 'forstaelse', tittel: '2. Egen forståelse og eksempler fra praksis', slag: 'tekst',
        hjelp: 'Forklar begrepene i målet, hva du selv tenker, og en situasjon fra jobben: hva gikk bra eller dårlig, hva kunne vært gjort annerledes?',
      },
      {
        id: 'faglig', tittel: '3. Faglig kunnskap', slag: 'tekst',
        hjelp: 'Knytt refleksjonen til teori eller regelverk: kurs, skole, HMS-opplæring, lover, regler eller rutiner i virksomheten.',
      },
      {
        id: 'utvikling', tittel: '4. Vurdering og egen utvikling', slag: 'tekst',
        hjelp: 'Hva du har lært, hvordan du kan bruke det videre, og hvilke forbedringer du selv kan gjøre.',
      },
      {
        id: 'avslutning', tittel: '5. Avslutning', slag: 'tekst',
        hjelp: 'Oppsummer kort, og knytt det tilbake til hvorfor læreplanmålet er viktig i faget.',
      },
    ],
  },
]

export const STANDARD_MAL_ID = 'tenk-loggmal'

/** Ukjent eller manglende mal-id gir standardmalen — aldri ingen mal. */
export function finnMal(id: string | null | undefined): Mal {
  return MALER.find(m => m.id === id) ?? MALER.find(m => m.id === STANDARD_MAL_ID)!
}

// ── Utfylling ───────────────────────────────────────────────────────────────

export function tomUtfylling(mal: Mal): Utfylling {
  const u: Utfylling = {}
  for (const s of mal.seksjoner) {
    if (s.slag === 'tekst') u[s.id] = ''
    if (s.slag === 'tabell') u[s.id] = (s.faste ?? []).map(() => s.kolonner.map(() => ''))
  }
  return u
}

/** «ja», «JA.», «Yes» → «Ja». Alt annet enn ja/nei blir tomt: da må han svare selv. */
export function jaNei(verdi: string): string {
  const v = verdi.trim().toLowerCase().replace(/[.!]$/, '')
  if (['ja', 'yes', 'j'].includes(v)) return 'Ja'
  if (['nei', 'no', 'n'].includes(v)) return 'Nei'
  return ''
}

/**
 * Tvinger det modellen (eller en gammel lagring) leverte inn i malens form.
 *
 * Faste tabeller får nøyaktig malens rader, i malens rekkefølge — modellen kan
 * ikke fjerne et punkt ved å la være å svare på det. Frie tabeller mister tomme
 * rader. Ja/nei-kolonnen godtar bare Ja, Nei eller tomt.
 */
export function vaskUtfylling(mal: Mal, raa: unknown): Utfylling {
  const inn = (raa && typeof raa === 'object' ? raa : {}) as Record<string, unknown>
  const ut = tomUtfylling(mal)
  for (const s of mal.seksjoner) {
    const v = inn[s.id]
    if (s.slag === 'tekst') {
      ut[s.id] = typeof v === 'string' ? v.trim() : ''
      continue
    }
    if (s.slag !== 'tabell') continue
    const rader = Array.isArray(v) ? v : []
    const rens = (rad: unknown): string[] => s.kolonner.map((k, i) => {
      const c = Array.isArray(rad) && typeof rad[i] === 'string' ? (rad[i] as string).trim() : ''
      return k === 'Ja/nei' ? jaNei(c) : c
    })
    if (s.faste) {
      ut[s.id] = s.faste.map((_, i) => rens(rader[i]))
    } else {
      ut[s.id] = rader.map(rens).filter(r => r.some(c => c !== ''))
    }
  }
  // NEK-begrunnelsene: bare punkter som står i kartet, ett felt per punkt.
  const nek = Array.isArray(inn[NEK_NOKKEL]) ? inn[NEK_NOKKEL] as unknown[] : []
  const sett = new Set<string>()
  ut[NEK_NOKKEL] = nek
    .map(r => (Array.isArray(r) ? r : []).map(c => (typeof c === 'string' ? c.trim() : '')))
    .filter(r => {
      const punkt = r[0]
      if (!punkt || !finnOppslag(punkt) || sett.has(punkt) || !r[1]) return false
      sett.add(punkt)
      return true
    })
    .map(r => [r[0], r[1], r[2] ?? ''])
  return ut
}

export type NekFelt = { punkt: string; side: number; hva: string; begrunnelse: string }

/** NEK-feltene med sidetall, klare til å vises. */
export function nekFelter(u: Utfylling): NekFelt[] {
  const rader = Array.isArray(u[NEK_NOKKEL]) ? (u[NEK_NOKKEL] as string[][]) : []
  return rader
    .map(r => ({ punkt: r[0], side: finnOppslag(r[0])?.side ?? 0, hva: r[1], begrunnelse: r[2] ?? '' }))
    .filter(f => f.side > 0)
}

/** «NEK 400:2026, punkt 522, side 193» — slik henvisningen står i loggen. */
export function nekHenvisningstekst(f: { punkt: string; side: number }): string {
  return `${UTGAVE}, punkt ${f.punkt}, side ${f.side}`
}

/** Leser utfyllingen fra basen. Ødelagt JSON gir en tom utfylling, ikke et krasj. */
export function lesUtfylling(mal: Mal, json: string | null | undefined): Utfylling {
  if (!json) return tomUtfylling(mal)
  try { return vaskUtfylling(mal, JSON.parse(json)) } catch { return tomUtfylling(mal) }
}

/**
 * Sikkerhetsnett etter modellen: en fast rad den glemte, blir «Nei» og
 * «Ikke relevant.» Lærlingen skal ikke sitte igjen med en halvtom mal
 * (Tormod 27.09.2026: «alt i risikovurderingen skal fylles fullt ut»).
 * Rader modellen HAR fylt ut, røres ikke.
 */
export function fyllResten(mal: Mal, u: Utfylling): Utfylling {
  const ut: Utfylling = { ...u }
  for (const s of mal.seksjoner) {
    if (s.slag !== 'tabell' || !s.faste) continue
    const jn = s.kolonner.indexOf('Ja/nei')
    if (jn < 0) continue
    const rader = Array.isArray(u[s.id]) ? (u[s.id] as string[][]) : []
    ut[s.id] = s.faste.map((_, i) => {
      const rad = rader[i] ?? s.kolonner.map(() => '')
      if (rad[jn]) return rad
      return s.kolonner.map((_, j) => (j === jn ? 'Nei' : rad[j] || 'Ikke relevant.'))
    })
  }
  return ut
}

export type Mangel = { seksjon: string; tekst: string }

/**
 * Hva som står tomt og må fylles før innsending. Bilder regnes ikke — de er
 * ønsket, ikke påkrevd. Et tomt ja/nei i en fast rad er et ubesvart spørsmål.
 */
export function mangler(mal: Mal, u: Utfylling): Mangel[] {
  const ut: Mangel[] = []
  for (const s of mal.seksjoner) {
    const v = u[s.id]
    if (s.slag === 'tekst' && !(typeof v === 'string' && v.trim())) {
      ut.push({ seksjon: s.id, tekst: `${s.tittel} er tom` })
    }
    if (s.slag === 'tabell' && Array.isArray(v)) {
      if (s.faste) {
        const jn = s.kolonner.indexOf('Ja/nei')
        const tomme = jn < 0 ? 0 : v.filter(r => !r[jn]).length
        if (tomme > 0) ut.push({ seksjon: s.id, tekst: `${tomme} ${tomme === 1 ? 'punkt' : 'punkter'} i ${s.tittel.toLowerCase()} er ikke besvart` })
      } else if (v.length === 0) {
        ut.push({ seksjon: s.id, tekst: `${s.tittel} er tom` })
      }
    }
  }
  // NEK-forklaringen er frivillig (Tormod 27.09.2026): henvisningen alene holder.
  // Å forklare er bedre og oppfordres til, men stopper aldri innsending.
  return ut
}

/**
 * Loggen som ren tekst, seksjon for seksjon i malens rekkefølge. Det er denne
 * quizen og avkryssingen leser, og den som eksporteres til fagbrev.io.
 */
export function tilTekst(mal: Mal, u: Utfylling, notater: string[] = []): string {
  const deler: string[] = []
  for (const s of mal.seksjoner) {
    const v = u[s.id]
    if (s.slag === 'tekst') {
      let tekst = typeof v === 'string' && v.trim() ? v.trim() : '(tom)'
      if (s.id === 'utforelse') {
        const nek = nekFelter(u)
        if (nek.length) {
          tekst += '\n\nHenvisning til forskrifter:\n' + nek.map(f =>
            f.begrunnelse.trim() ? `${nekHenvisningstekst(f)}: ${f.begrunnelse.trim()}` : nekHenvisningstekst(f)).join('\n')
        }
      }
      deler.push(`${s.tittel}\n${tekst}`)
    } else if (s.slag === 'tabell') {
      const rader = Array.isArray(v) ? v : []
      const linjer = rader.map((r, i) => {
        const celler = r.filter(c => c).join(' · ')
        return s.faste ? `${s.faste[i]} ${celler || '(ikke besvart)'}` : celler
      })
      deler.push(`${s.tittel}\n${linjer.length ? linjer.join('\n') : '(tom)'}`)
    } else if (notater.length) {
      deler.push(`${s.tittel}\n${notater.map(n => `• ${n}`).join('\n')}`)
    }
  }
  return deler.join('\n\n')
}

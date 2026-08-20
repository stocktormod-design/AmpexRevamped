/**
 * Varegruppe utledet av varenavnet — ren logikk, selvtestet.
 *
 * **Hvorfor utledet og ikke hentet:** prisfila har `rabattGruppe`, men det er en
 * tallkode («4260») uten navn. Navnetabellen eier NELFO, og vi har den ikke.
 * EFObasen har et ekte varetre, men koster 29 412 kr/år og kan ikke
 * videreformidles av en systemleverandør.
 *
 * **Hvordan:** kandidatordene telles opp over HELE katalogen, og vinneren er
 * den med høyest **frekvens delt på posisjon**. To krefter, og begge trengs:
 *
 *   - *Frekvens*, fordi et ekte gruppeord brukes av mange varer
 *     («installasjonskabel» står i mange) mens en egenskap står i én
 *     («Lastbalansering»).
 *   - *Posisjon*, fordi et variantord kan være enda vanligere enn substantivet.
 *     «trykk» står i 20 varer og ville slått «Bryter» — men det står bakerst,
 *     og substantivet står først.
 *
 * Første forsøk tok bare første ord med stor forbokstav. Det ga «Skjermet» for
 * «PFSP 3G1,5 500V Skjermet installasjonskabel» — norsk skriver bare første ord
 * i en frase med stor bokstav, så substantivet er ofte det lille ordet etterpå.
 * Frekvens løser det uten en liste over adjektiver som aldri blir komplett.
 */

/** Ord som aldri er en varegruppe, uansett hvor ofte de går igjen. */
const IKKE_GRUPPE = new Set([
  'type', 'klasse', 'modell', 'farge', 'hvit', 'sort', 'grå', 'brun', 'gul',
  'grønn', 'blå', 'antrasitt', 'stål', 'krom', 'messing', 'komplett', 'inkl',
  'uten', 'med', 'for', 'til', 'per', 'stk', 'meter', 'lengde', 'infelt',
  'utenpå', 'dimbar', 'skjermet', 'halogenfri', 'trådløs', 'optisk', 'jord',
  'industri', 'sensor', 'universal', 'nedhengt', 'flis', 'støp', 'gips', 'dør',
])

/**
 * Er ordet et mulig gruppeord, eller en kode/dimensjon?
 *
 * Krav: minst fire tegn, bare bokstaver eller bindestrek (så «3G2,5»,
 * «100x100» og «22kW» faller ut), og minst én liten bokstav (så «PFXP», «IP44»
 * og «NEXANS» faller ut — typebetegnelser og produsenter er egne felt).
 */
function erKandidat(ord: string): boolean {
  if (ord.length < 4) return false
  if (!/[a-zæøå]/.test(ord)) return false
  if (!/^[A-Za-zÆØÅæøå-]+$/.test(ord)) return false
  return !IKKE_GRUPPE.has(ord.toLowerCase())
}

/**
 * Ordene i navnet som kan være en varegruppe, med posisjonen de har i NAVNET.
 *
 * Posisjonen må være den ekte, ikke plassen i den filtrerte lista: i «Bryter
 * 1-pol trykk Hvit» står «trykk» som ord nummer tre, ikke nummer to. Med feil
 * posisjon blir straffen for lav, og et vanlig variantord slår substantivet.
 */
export function kandidaterMedPos(navn: string): { ord: string; pos: number }[] {
  return navn
    .split(/[\s/]+/)
    .map((o, pos) => ({ ord: o.replace(/^[«"'(]+|[.,;:)»"']+$/g, ''), pos }))
    .filter(x => erKandidat(x.ord))
}

/** Ordene i navnet som kan være en varegruppe, i rekkefølge. */
export function kandidater(navn: string): string[] {
  return kandidaterMedPos(navn).map(x => x.ord)
}

/**
 * «installasjonskabel» → «Installasjonskabel», men «LED-panel» beholdes.
 * Bare første bokstav løftes — å normalisere hele ordet ville gitt «Led-panel».
 */
function stor(ord: string): string {
  return ord.charAt(0).toUpperCase() + ord.slice(1)
}

/**
 * Varegruppe for hvert navn, utledet av hele katalogen sett under ett.
 *
 * Vinneren er kandidaten som går igjen på flest varer. Ved likt antall vinner
 * den som står FØRST i navnet — «Ladeboks 22kW … Lastbalansering» skal bli
 * «Ladeboks», ikke egenskapen bakerst.
 */
export function utledKategorier(navn: string[]): (string | null)[] {
  const antall = new Map<string, number>()
  const kandidatliste = navn.map(kandidaterMedPos)
  for (const ord of kandidatliste) {
    // Samme ord to ganger i ett navn skal telle som én vare, ikke to.
    for (const o of new Set(ord.map(x => x.ord.toLowerCase()))) {
      antall.set(o, (antall.get(o) ?? 0) + 1)
    }
  }
  return kandidatliste.map(ord => {
    if (ord.length === 0) return null
    let beste = ord[0].ord
    let besteScore = -1
    for (const { ord: o, pos } of ord) {
      // Frekvens delt på posisjon i NAVNET: første ord teller fullt, ord lenger
      // bak stadig mindre. Ved lik score vinner det som står først (streng >).
      const score = (antall.get(o.toLowerCase()) ?? 0) / (1 + pos)
      if (score > besteScore) { beste = o; besteScore = score }
    }
    return stor(beste)
  })
}

/**
 * Varegruppe for ett enkelt navn, uten katalog å telle mot.
 *
 * Faller tilbake på første kandidat. Brukes når en vare opprettes for hånd —
 * importen bruker `utledKategorier`, som er merkbart bedre.
 */
export function utledKategori(navn: string): string | null {
  const ord = kandidater(navn)
  return ord.length > 0 ? stor(ord[0]) : null
}

/** Varegruppen slik den vises. Null blir «Annet», så ingenting forsvinner. */
export function kategoriNavn(k: string | null | undefined): string {
  return k?.trim() || 'Annet'
}

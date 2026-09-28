/**
 * NEK-kartet — hvor ting står, aldri hva som står der.
 * Selvtestes i `npm run verify:laeretid`.
 *
 * ── Grensen ─────────────────────────────────────────────────────────────────
 *
 * NEK 400 er opphavsrettsbeskyttet og kjøpes av NEK. Vi gjengir ALDRI tekst
 * derfra, og heller ikke overskriftene deres ordrett. Det vi lagrer er
 * punktnummer og sidetall — fakta om hvor noe står, og nummereringen er
 * dessuten arvet fra IEC 60364 — pluss vår egen setning om når du slår opp der.
 *
 * Det er ikke bare den ryddige løsningen, det er den bedre: «her slår du opp
 * når du lurer på om kabelen tåler å ligge i en fuktig kryperom» hjelper en
 * førsteårs mer enn normtittelen gjør.
 *
 * ── Utgave ──────────────────────────────────────────────────────────────────
 *
 * Sidetall gjelder NEK 400:2026, som trådte i kraft 1. juli 2026 og erstatter
 * 2022-utgaven. Standarden revideres hvert fjerde år, og et kart uten
 * utgavemerke råtner i stillhet — derfor står utgaven på hver rad.
 *
 * MERK at 2026 omnummererte verifikasjonsdelen: den er 6.1–6.5 nå, mot 61x
 * tidligere. En referanse som «NEK 400-6-61» peker på noe som ikke finnes i
 * boka lærlingen har foran seg.
 *
 * Kilde: innholdsfortegnelsen i NEK 400:2026, sidene 3–6.
 */

export const UTGAVE = 'NEK 400:2026'

/** De åtte hoveddelene. Strukturen står i NEK 400-1. */
export type Hoveddel =
  | '400-1' | '400-2' | '400-3' | '400-4'
  | '400-5' | '400-6' | '400-7' | '400-8'

export const HOVEDDELER: Record<Hoveddel, string> = {
  '400-1': 'Omfang og struktur',
  '400-2': 'Termer og definisjoner',
  '400-3': 'Generelle forhold og prinsipper',
  '400-4': 'Beskyttelse for sikkerhet',
  '400-5': 'Valg og montasje av utstyr',
  '400-6': 'Verifikasjon',
  '400-7': 'Krav til spesielle installasjoner eller områder',
  '400-8': 'Krav til andre spesielle installasjoner eller områder',
}

export type Oppslag = {
  /** Punktnummeret slik det står i boka. */
  punkt: string
  del: Hoveddel
  /** Sidetall i NEK 400:2026. */
  side: number
  /**
   * Når du slår opp her — i våre ord, ikke NEKs overskrift.
   * Utløseren, ikke tittelen: det er den som hjelper noen som lærer.
   */
  naar: string
}

export const KART: Oppslag[] = [
  // ── 400-4 Beskyttelse for sikkerhet ───────────────────────────────────────
  { punkt: '411', del: '400-4', side: 111, naar: 'Når du lurer på hvordan anlegget beskytter folk ved feil — utkobling av strømtilførselen, og hvor fort den må skje.' },
  { punkt: '412', del: '400-4', side: 113, naar: 'Når utstyret er dobbeltisolert og ikke har jording i det hele tatt.' },
  { punkt: '413', del: '400-4', side: 113, naar: 'Når to kretser skal skilles elektrisk fra hverandre i stedet for å jordes.' },
  { punkt: '414', del: '400-4', side: 114, naar: 'Når spenningen er så lav at den i seg selv er beskyttelsen — SELV og PELV.' },
  { punkt: '415', del: '400-4', side: 120, naar: 'Når du trenger noe i tillegg til hovedbeskyttelsen, som jordfeilbryter eller utjevning.' },
  { punkt: '421', del: '400-4', side: 130, naar: 'Når du skal vurdere brannfare som kommer fra selve utstyret.' },
  { punkt: '422', del: '400-4', side: 130, naar: 'Når anlegget står et sted der en brann sprer seg lett, eller der folk må komme seg ut.' },
  { punkt: '423', del: '400-4', side: 130, naar: 'Når noe kan bli varmt nok til å brenne noen — berøringstemperatur.' },
  { punkt: '431', del: '400-4', side: 139, naar: 'Når du skal velge vern som tåler kortslutning og beskytter kabelen mot overbelastning.' },
  { punkt: '443', del: '400-4', side: 147, naar: 'Når du vurderer overspenningsvern mot lyn og transienter utenfra.' },
  { punkt: '444', del: '400-4', side: 150, naar: 'Når signal og kraft ligger nær hverandre og du tenker på støy — jordsløyfer, skjerming, separasjon.' },
  { punkt: '445', del: '400-4', side: 169, naar: 'Når utstyr kan ta skade av at spenningen faller bort eller kommer tilbake.' },

  // ── 400-5-51 Generelt ─────────────────────────────────────────────────────
  { punkt: '511', del: '400-5', side: 171, naar: 'Når du skal sjekke at utstyret faktisk er laget for det du bruker det til.' },
  { punkt: '512', del: '400-5', side: 171, naar: 'Når stedet er fuktig, kaldt, støvete eller utsatt — ytre påvirkninger på utstyret.' },
  { punkt: '513', del: '400-5', side: 183, naar: 'Når noe må kunne nås for drift og vedlikehold senere.' },
  { punkt: '514', del: '400-5', side: 183, naar: 'Når du skal merke kurser, ledere og skap, og når dokumentasjonen skal på plass.' },
  { punkt: '515', del: '400-5', side: 186, naar: 'Når to anlegg står inntil hverandre og kan ødelegge for hverandre.' },
  { punkt: '516', del: '400-5', side: 187, naar: 'Når det går lekkasjestrøm i beskyttelseslederen — typisk mye elektronikk på samme kurs.' },
  { punkt: '517', del: '400-5', side: 188, naar: 'Når valget av utstyr henger sammen med hvilken beskyttelsesmetode anlegget bruker.' },

  // ── 400-5-52 Ledningssystemer ─────────────────────────────────────────────
  { punkt: '521', del: '400-5', side: 190, naar: 'Når du skal velge hvordan kabelen føres — rør, kanal, bro, direkte på vegg.' },
  { punkt: '522', del: '400-5', side: 193, naar: 'Når kabelen skal ligge i fukt, varme, sol, jord eller et sted den kan få mekanisk juling.' },
  { punkt: '523', del: '400-5', side: 197, naar: 'Når du regner på hvor mye strøm kabelen faktisk tåler der den ligger — Iz.' },
  { punkt: '524', del: '400-5', side: 199, naar: 'Når du skal bestemme tverrsnitt.' },
  { punkt: '525', del: '400-5', side: 200, naar: 'Når strekket er langt og du lurer på om spenningen holder helt fram.' },
  { punkt: '526', del: '400-5', side: 200, naar: 'Når du skjøter eller terminerer — krav til selve forbindelsen.' },
  { punkt: '527', del: '400-5', side: 201, naar: 'Når kabelen går gjennom en brannskillende vegg eller etasje.' },
  { punkt: '528', del: '400-5', side: 202, naar: 'Når elkabel ligger nær rør, ventilasjon eller andre installasjoner.' },
  { punkt: 'Tillegg 52B', del: '400-5', side: 212, naar: 'Tabellene du faktisk slår opp i når du skal finne strømføringsevne for en gitt kabel og forlegning.' },

  // ── 400-5-53 Vern og koblingsutstyr ───────────────────────────────────────
  { punkt: '531', del: '400-5', side: 251, naar: 'Når du velger jordfeilvern og skal vite hvilken type som passer.' },
  { punkt: '533', del: '400-5', side: 259, naar: 'Når du velger vernet som skal beskytte kabelen mot overstrøm — Ib ≤ In ≤ Iz.' },
  { punkt: '534', del: '400-5', side: 263, naar: 'Når du monterer overspenningsvern.' },
  { punkt: '537', del: '400-5', side: 290, naar: 'Når noe skal kunne gjøres spenningsløst for arbeid, og hvordan det sikres.' },
  { punkt: 'Tillegg 53A', del: '400-5', side: 298, naar: 'Når du skal skjønne forskjellen på type AC, A, F og B jordfeilvern.' },

  // ── 400-5-54 Jording og beskyttelsesledere ────────────────────────────────
  { punkt: '542', del: '400-5', side: 309, naar: 'Når du skal etablere eller vurdere jordingsanlegget.' },
  { punkt: '543', del: '400-5', side: 312, naar: 'Når du dimensjonerer eller kobler beskyttelsesledere — og når PE skal føres direkte forbi utstyr.' },
  { punkt: '544', del: '400-5', side: 317, naar: 'Når du kobler utjevning til rør, kanaler, kabelstiger og andre ledende deler.' },
  { punkt: '545', del: '400-5', side: 318, naar: 'Når du jorder av hensyn til funksjon og støy på IKT-utstyr, ikke av hensyn til sikkerhet.' },

  // ── 400-5-56 Nødstrøm ─────────────────────────────────────────────────────
  { punkt: '560.6', del: '400-5', side: 339, naar: 'Når du monterer nødstrøm, UPS eller batterianlegg.' },
  { punkt: '560.9', del: '400-5', side: 342, naar: 'Når du jobber med nødlys og markeringslys.' },
  { punkt: '560.10', del: '400-5', side: 344, naar: 'Når kurser må fortsette å virke mens det brenner.' },

  // ── 400-6 Verifikasjon ────────────────────────────────────────────────────
  { punkt: '6.4', del: '400-6', side: 353, naar: 'Når du skal sluttkontrollere et nytt anlegg. MERK: het 61x før 2026.' },
  { punkt: '6.4.2', del: '400-6', side: 353, naar: 'Når du går over anlegget visuelt før du måler noe som helst.' },
  { punkt: '6.4.4', del: '400-6', side: 356, naar: 'Når du måler — isolasjon, kontinuitet, utkoblingstid. Ikke spenningsmåling; den er funksjonskontroll.' },
  { punkt: '6.4.5', del: '400-6', side: 361, naar: 'Når kontrollen skal rapporteres og samsvarserklæringen skrives.' },
  { punkt: '6.5', del: '400-6', side: 362, naar: 'Når et eksisterende anlegg skal kontrolleres på nytt, og hvor ofte.' },

  // ── 400-7 Spesielle installasjoner ────────────────────────────────────────
  { punkt: '7-701', del: '400-7', side: 364, naar: 'Når du jobber i et bad eller et rom med dusj.' },
  { punkt: '7-703', del: '400-7', side: 366, naar: 'Når du jobber i badstue — soneinndeling etter høyde, og utstyr som tåler varmen.' },
  { punkt: '7-704', del: '400-7', side: 374, naar: 'Når du setter opp byggestrøm på en bygge- eller rivningsplass.' },
  { punkt: '7-705', del: '400-7', side: 383, naar: 'Når du jobber i fjøs, driftsbygning eller veksthus.' },
  { punkt: '7-708', del: '400-7', side: 389, naar: 'Når du jobber på campingplass eller bobilplass.' },
  { punkt: '7-709', del: '400-7', side: 397, naar: 'Når du jobber i marina eller havn.' },
  { punkt: '7-710', del: '400-7', side: 398, naar: 'Når du jobber i medisinske områder.' },
  { punkt: '7-712', del: '400-7', side: 411, naar: 'Når du monterer solcelleanlegg.' },
  { punkt: '7-722', del: '400-7', side: 472, naar: 'Når du monterer ladepunkt for elbil.' },
  { punkt: '7-729', del: '400-7', side: 474, naar: 'Når du jobber i et adgangsbegrenset område eller en betjeningsgang.' },
]

export function finnOppslag(punkt: string): Oppslag | null {
  return KART.find(o => o.punkt === punkt) ?? null
}

/** Alle oppslag i én hoveddel, i sidenummerrekkefølge. */
export function oppslagIDel(del: Hoveddel): Oppslag[] {
  return KART.filter(o => o.del === del).sort((a, b) => a.side - b.side)
}

/**
 * Referanser fra eldre utgaver som ikke lenger stemmer.
 *
 * Det er en funksjon i seg selv: varsle om utdaterte henvisninger når utgaven
 * skifter, i stedet for å la en lærling stå på fagprøven og bla etter et punkt
 * som ikke finnes.
 */
export const UTGAATT: { gammel: RegExp; ny: string; grunn: string }[] = [
  {
    gammel: /400-6-61\d?/,
    ny: '400-6, avsnitt 6.4',
    grunn: 'Verifikasjonsdelen ble omnummerert til 6.1–6.5 i NEK 400:2026. 61x finnes ikke lenger.',
  },
]

export function erUtgaatt(referanse: string): { ny: string; grunn: string } | null {
  const treff = UTGAATT.find(u => u.gammel.test(referanse))
  return treff ? { ny: treff.ny, grunn: treff.grunn } : null
}

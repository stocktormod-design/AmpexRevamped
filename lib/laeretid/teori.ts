/**
 * Teoristien — det han skal kunne til fagprøven, utenom jobbene han har gjort.
 * Ren data og logikk, selvtestet i `npm run verify:laeretid`.
 *
 * Tormod 27.09.2026: «teoretisk for resten, teori: Ohms lov, overspenningsvern,
 * karakteristikk osv.» Quizen etter en logg spør om JOBBEN. Stien her spør om
 * FAGET: formlene, vernene, jordingen, målingene. Den tilpasser seg nivået hans
 * (profil.ts) og sender ham dit han er svakest.
 *
 * Hvert tema er knyttet til en del av et kompetansemål, så teoriøvingen også
 * teller i læringsprofilen der den hører hjemme. Og til ett NEK-punkt: fasiten
 * peker dit — punkt og side, aldri NEK-tekst.
 *
 * `stikkord` er det modellen skal holde seg innenfor. Det er fagets egne
 * begreper, ikke sitater fra NEK: Ohms lov er fysikk, B/C/D-karakteristikk er
 * produktstandard, og det kan en lærebok forklare.
 */

export type Tema = {
  id: string
  navn: string
  /** Enheten på stien. */
  enhet: string
  /** Kompetansemålet øvingen teller mot. */
  maalNr: number
  delId: string
  /** NEK-punktet fasiten peker til. Null når temaet ikke står i NEK (ren fysikk). */
  nek: string | null
  /** Hva spørsmålene skal handle om. Til modellen. */
  stikkord: string
}

export const ENHETER = [
  'Grunnleggende',
  'Vern',
  'Kabel',
  'Jording',
  'Måling',
  'Anlegg',
] as const

export const TEMAER: Tema[] = [
  // ── Grunnleggende ─────────────────────────────────────────────────────────
  { id: 'ohm', navn: 'Ohms lov', enhet: 'Grunnleggende', maalNr: 5, delId: 'dimensjonere', nek: null,
    stikkord: 'U = R · I, regne ut spenning, strøm eller motstand, enkle tallregninger fra hverdagen (varmeovn, lampe)' },
  { id: 'effekt', navn: 'Effekt og energi', enhet: 'Grunnleggende', maalNr: 5, delId: 'dimensjonere', nek: null,
    stikkord: 'P = U · I, P = I² · R, kW og kWh, strømtrekk for vanlige laster på 230 V' },
  { id: 'serie-parallell', navn: 'Serie og parallell', enhet: 'Grunnleggende', maalNr: 5, delId: 'dimensjonere', nek: null,
    stikkord: 'total motstand i serie og parallell, strøm og spenning fordelt i kretsen' },
  { id: 'trefase', navn: 'Trefase', enhet: 'Grunnleggende', maalNr: 5, delId: 'dimensjonere', nek: null,
    stikkord: 'fasespenning og linjespenning (230/400), √3, trefase effekt, stjerne og trekant' },
  { id: 'cosphi', navn: 'Effektfaktor', enhet: 'Grunnleggende', maalNr: 5, delId: 'effektfaktor', nek: null,
    stikkord: 'cos φ, aktiv, reaktiv og tilsynelatende effekt, induktiv last, kompensering' },

  // ── Vern ──────────────────────────────────────────────────────────────────
  { id: 'overstromsvern', navn: 'Overstrømsvern', enhet: 'Vern', maalNr: 2, delId: 'overstrom', nek: '533',
    stikkord: 'overbelastning mot kortslutning, Ib ≤ In ≤ Iz, hva automatsikringen beskytter (kabelen)' },
  { id: 'karakteristikk', navn: 'Karakteristikk B, C, D', enhet: 'Vern', maalNr: 5, delId: 'dimensjonere', nek: '533',
    stikkord: 'utløsekurve B/C/D, magnetisk utløsning (3–5, 5–10, 10–20 × In), når du velger C for motorer og innkoblingsstrøm' },
  { id: 'jordfeilbryter', navn: 'Jordfeilbryter', enhet: 'Vern', maalNr: 2, delId: 'sjokk', nek: 'Tillegg 53A',
    stikkord: 'hvordan den måler forskjell mellom fase og N, 30 mA, type AC, A, F og B og når hver brukes' },
  { id: 'overspenningsvern', navn: 'Overspenningsvern', enhet: 'Vern', maalNr: 2, delId: 'overspenning', nek: '534',
    stikkord: 'transienter fra lyn og kobling, type 1, 2 og 3, hvor de monteres, korte ledninger til jord' },
  { id: 'selektivitet', navn: 'Selektivitet', enhet: 'Vern', maalNr: 5, delId: 'dimensjonere', nek: '533',
    stikkord: 'at bare vernet nærmest feilen løser ut, hovedsikring mot kurssikring' },

  // ── Kabel ─────────────────────────────────────────────────────────────────
  { id: 'stromforingsevne', navn: 'Strømføringsevne', enhet: 'Kabel', maalNr: 12, delId: 'iz', nek: '523',
    stikkord: 'Iz, forlegningsmåte, omgivelsestemperatur, samlet forlegning og korreksjonsfaktorer' },
  { id: 'spenningsfall', navn: 'Spenningsfall', enhet: 'Kabel', maalNr: 5, delId: 'dimensjonere', nek: '525',
    stikkord: 'hvorfor lange kurser gir spenningsfall, hva som påvirker det (lengde, tverrsnitt, strøm), enkel utregning' },
  { id: 'tverrsnitt', navn: 'Valg av tverrsnitt', enhet: 'Kabel', maalNr: 5, delId: 'dimensjonere', nek: '524',
    stikkord: 'sammenheng mellom vern, kabel og last, 1,5 / 2,5 / 4 / 6 mm², typiske kurser' },
  { id: 'kabeltyper', navn: 'Kabeltyper', enhet: 'Kabel', maalNr: 12, delId: 'forlegning', nek: '522',
    stikkord: 'PFSP, PFXP, PR, TFXP, halogenfri, hva bokstavene betyr og hvor de kan ligge' },

  // ── Jording ───────────────────────────────────────────────────────────────
  { id: 'jordingssystemer', navn: 'TN, TT og IT', enhet: 'Jording', maalNr: 5, delId: 'jording', nek: '411',
    stikkord: 'hva bokstavene betyr, IT 230 V og TN 400 V i Norge, hvordan en jordfeil oppfører seg i hvert system' },
  { id: 'utjevning', navn: 'Utjevning', enhet: 'Jording', maalNr: 2, delId: 'sjokk', nek: '544',
    stikkord: 'hovedutjevning og supplerende utjevning, hvorfor rør og ledende deler kobles til' },
  { id: 'pe', navn: 'Beskyttelsesleder', enhet: 'Jording', maalNr: 2, delId: 'sjokk', nek: '543',
    stikkord: 'hva PE gjør ved feil, farge, tverrsnitt, hvorfor den aldri skal brytes' },

  // ── Måling ────────────────────────────────────────────────────────────────
  { id: 'isolasjonsmaaling', navn: 'Isolasjonsmåling', enhet: 'Måling', maalNr: 15, delId: 'tilstand', nek: '6.4.4',
    stikkord: 'hva den viser, prøvespenning 500 V, MΩ, hva som må kobles fra før du måler' },
  { id: 'kontinuitet', navn: 'Kontinuitet', enhet: 'Måling', maalNr: 15, delId: 'sikkerhet', nek: '6.4.4',
    stikkord: 'måle at PE og utjevning henger sammen, lav motstand, hvorfor det er første måling' },
  { id: 'sloyfe', navn: 'Kortslutningsstrøm', enhet: 'Måling', maalNr: 5, delId: 'dimensjonere', nek: '6.4.4',
    stikkord: 'Ik og sløyfeimpedans, at kortslutningsstrømmen må være stor nok til at vernet løser ut raskt' },
  { id: 'funksjonsprove', navn: 'Funksjonsprøving', enhet: 'Måling', maalNr: 14, delId: 'feilsoking', nek: '6.4',
    stikkord: 'spenningsmåling er funksjonskontroll, ikke sluttkontroll, test av jordfeilbryter med testknapp og instrument' },

  // ── Anlegg ────────────────────────────────────────────────────────────────
  { id: 'motor', navn: 'Motorer', enhet: 'Anlegg', maalNr: 8, delId: 'motorstyring', nek: null,
    stikkord: 'startstrøm, motorvern, stjerne-trekant-start, frekvensomformer og hvorfor den gir støy' },
  { id: 'emc', navn: 'Elektromagnetisk støy', enhet: 'Anlegg', maalNr: 6, delId: 'emstoy', nek: '444',
    stikkord: 'skjermet kabel, skjerm jordet i én eller begge ender, avstand mellom kraft og signal' },
  { id: 'bad', navn: 'Bad og våtrom', enhet: 'Anlegg', maalNr: 2, delId: 'ytre', nek: '7-701',
    stikkord: 'soner, IP-grad, jordfeilbryter, hvorfor bad er et spesielt rom' },
  { id: 'nodlys', navn: 'Nødlys', enhet: 'Anlegg', maalNr: 10, delId: 'nodstrom', nek: '560.9',
    stikkord: 'hva nødlys og markeringslys skal gjøre ved strømbrudd, sentralanlegg mot enkeltbatteri, testing' },
  { id: 'lading', navn: 'Elbillading', enhet: 'Anlegg', maalNr: 9, delId: 'laststyring', nek: '7-722',
    stikkord: 'egen kurs, jordfeilvern type B eller DC-deteksjon, laststyring' },
  { id: 'solcelle', navn: 'Solcelleanlegg', enhet: 'Anlegg', maalNr: 9, delId: 'energiproduksjon', nek: '7-712',
    stikkord: 'DC-side og AC-side, vekselretter, at panelene alltid gir spenning i lys, plusskunde' },
]

export function finnTema(id: string | null | undefined): Tema | null {
  return TEMAER.find(t => t.id === id) ?? null
}

/** Temaene i en enhet, i stiens rekkefølge. */
export function temaerI(enhet: string): Tema[] {
  return TEMAER.filter(t => t.enhet === enhet)
}

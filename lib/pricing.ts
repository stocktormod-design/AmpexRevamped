/**
 * Listepris kontra nettopris — ren logikk, ingen database.
 * Selvtestes i `npm run verify:varesok`.
 *
 * **Skillet er det viktigste i hele grossistsporet.** En `V4`-fil er
 * grossistens fulle sortiment til LISTEPRIS. En `P4` er firmaets EGNE priser
 * etter forhandlet rabatt. Listeprisen er nesten identisk hos alle grossistene,
 * fordi den kommer fra produsenten — det er rabatten som skiller.
 *
 * Blandes de to, svarer systemet «Onninen og Solar koster det samme». Det er
 * usant, og verre enn ingen sammenligning, fordi det er selvsikkert galt.
 * Derfor sammenlignes ALDRI en listepris med en nettopris her.
 */

export type Prisrad = {
  grossist: string
  /** Prisen slik den ble lest inn. Er `erListepris` sann, er dette listeprisen. */
  nettoPris: number
  /** 'brutto' | 'netto' | 'ukjent' fra fila. */
  priceType?: string | null
  rabattProsent?: number | null
}

/**
 * En bruttopris uten rabatt er grossistens listepris, ikke firmaets pris.
 *
 * `netto` betyr at fila allerede oppgir firmaets pris. `brutto` med rabatt
 * betyr at vi har regnet den ut. `brutto` UTEN rabatt betyr at ingen har
 * fortalt oss hva firmaet betaler.
 */
export function erListepris(p: Prisrad): boolean {
  if (p.priceType === 'netto') return false
  return !p.rabattProsent
}

export type VurdertPris = Prisrad & { erListepris: boolean }

export type Prisbilde = {
  /** Stigende. Listepriser sist innenfor samme beløp — de er mindre å stole på. */
  priser: VurdertPris[]
  /** Billigste pris vi tør å peke på, eller null. */
  billigste: VurdertPris | null
  /**
   * Differansen mellom billigste og dyreste SAMMENLIGNBARE pris.
   * null når det ikke finnes to av samme slag å sammenligne.
   */
  besparelse: number | null
  /** Vi kjenner ingen nettopris — ingen vet hva firmaet faktisk betaler. */
  kunListepriser: boolean
  /** Både liste og netto finnes. Sammenligning ville vært epler mot pærer. */
  blandet: boolean
}

export function byggPrisbilde(rader: Prisrad[]): Prisbilde {
  const priser: VurdertPris[] = rader
    .map(r => ({ ...r, erListepris: erListepris(r) }))
    .sort((a, b) => a.nettoPris - b.nettoPris || Number(a.erListepris) - Number(b.erListepris))

  const netto = priser.filter(p => !p.erListepris)
  const liste = priser.filter(p => p.erListepris)

  if (priser.length === 0) {
    return { priser, billigste: null, besparelse: null, kunListepriser: false, blandet: false }
  }

  // Finnes minst to ekte nettopriser, er det DE som sammenlignes — listeprisene
  // sier ingenting om hva firmaet betaler og skal ikke kunne vinne.
  if (netto.length >= 2) {
    return {
      priser,
      billigste: netto[0],
      besparelse: Math.round((netto[netto.length - 1].nettoPris - netto[0].nettoPris) * 100) / 100,
      kunListepriser: false,
      blandet: liste.length > 0,
    }
  }

  // Én nettopris: den er den eneste vi vet noe om. Ingen besparelse å påstå.
  if (netto.length === 1) {
    return { priser, billigste: netto[0], besparelse: null, kunListepriser: false, blandet: liste.length > 0 }
  }

  // Bare listepriser. Vi viser den laveste, men påstår ingen besparelse:
  // listeprisene er nesten like uansett, så differansen er støy.
  return { priser, billigste: liste[0], besparelse: null, kunListepriser: true, blandet: false }
}

/**
 * Prisen `products.cost_price` skal settes til.
 *
 * Ekte nettopriser vinner alltid over listepriser, uansett beløp — et
 * dekningsbidrag regnet på listepris er et dekningsbidrag som er for lavt, og
 * som får en lønnsom jobb til å se ulønnsom ut.
 */
export function kostprisFra(rader: Prisrad[]): { pris: number; grossist: string; erListepris: boolean } | null {
  const bilde = byggPrisbilde(rader)
  if (!bilde.billigste) return null
  return {
    pris: bilde.billigste.nettoPris,
    grossist: bilde.billigste.grossist,
    erListepris: bilde.billigste.erListepris,
  }
}

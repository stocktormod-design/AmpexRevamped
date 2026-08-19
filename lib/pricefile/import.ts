import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { Product } from '../db/models/product'
import { syncQuietly } from '../db/sync'
import { elnummer, type ParseResultat, type Vare } from './efo-nelfo'

/**
 * Prisfil → varekartotek.
 *
 * Det manglende leddet: parseren leste fila, men prisene havnet aldri i
 * `products`, så alt nedstrøms — materiell på ordre, fakturagrunnlag,
 * dekningsbidrag — sto uten tall.
 *
 * To valg som er verdt å begrunne:
 *
 * **Kostpris = nettopris, utsalg røres ikke.** Grossistfila vet hva varen
 * koster oss. Den vet ingenting om hva vi tar for den. Å sette `unit_price`
 * fra grossisten ville gitt null i dekningsbidrag på hver eneste linje.
 * Påslaget er bedriftens beslutning, og settes med `paslagProsent`.
 *
 * **`supplier` og `price_updated_at` per vare.** Ferskhet må vises per
 * grossist — en fersk fil sammenlignet mot en tre måneder gammel gir feil svar
 * med selvtillit.
 */

export type ImportValg = {
  /** Navn på grossisten fila kom fra. Lagres på hver vare. */
  grossist: string
  /**
   * Påslag i prosent på nettoprisen → utsalgspris. Utelates den, settes
   * `unit_price` kun på varer som ikke har en fra før, og da til nettoprisen.
   */
  paslagProsent?: number
  /** Ta med varer grossisten har merket `utgaar`. Normalt av. */
  inkluderUtgaatte?: boolean
}

export type ImportResultat = {
  nye: number
  oppdaterte: number
  hoppetOver: number
  /** Varer uten el-nummer kan ikke kobles på tvers av grossister. */
  utenElnummer: number
  utgaatte: number
}

function utsalgspris(vare: Vare, valg: ImportValg, eksisterende: number | null): number | null {
  if (valg.paslagProsent != null) {
    return Math.round(vare.nettoPris * (1 + valg.paslagProsent / 100) * 100) / 100
  }
  // Uten påslagsregel skal en pris noen har satt for hånd aldri overskrives.
  return eksisterende ?? Math.round(vare.nettoPris * 100) / 100
}

export async function importerPrisfil(
  resultat: ParseResultat,
  valg: ImportValg,
): Promise<ImportResultat> {
  const ut: ImportResultat = { nye: 0, oppdaterte: 0, hoppetOver: 0, utenElnummer: 0, utgaatte: 0 }

  const kandidater = resultat.varer.filter(v => {
    if (v.status === 'utgaar' && !valg.inkluderUtgaatte) { ut.utgaatte++; return false }
    if (!elnummer(v)) { ut.utenElnummer++; return false }
    return true
  })
  if (kandidater.length === 0) return ut

  // Ett oppslag for alle el-numrene i stedet for ett per vare. En varefil har
  // titusenvis av linjer; N spørringer ville tatt minutter på en telefon.
  const nr = kandidater.map(v => elnummer(v) as string)
  const eksisterende = new Map<string, Product>()
  const BOLK = 500
  for (let i = 0; i < nr.length; i += BOLK) {
    const treff = await database.get<Product>('products')
      .query(Q.where('elnummer', Q.oneOf(nr.slice(i, i + BOLK)))).fetch()
    for (const p of treff) if (p.elnummer) eksisterende.set(p.elnummer, p)
  }

  const naa = new Date()
  const collection = database.get<Product>('products')
  await database.write(async () => {
    const operasjoner = kandidater.map(v => {
      const el = elnummer(v) as string
      const netto = Math.round(v.nettoPris * 100) / 100
      const funnet = eksisterende.get(el)
      if (funnet) {
        ut.oppdaterte++
        return funnet.prepareUpdate(p => {
          p.name = v.beskrivelse
          p.unit = v.maaleEnhet === 'ukjent' ? p.unit : v.maaleEnhet
          p.costPrice = netto
          p.unitPrice = utsalgspris(v, valg, p.unitPrice)
          p.vatType = p.vatType ?? 'hoy'
          p.supplier = valg.grossist
          p.priceUpdatedAt = naa
        })
      }
      ut.nye++
      return collection.prepareCreate(p => {
        p.elnummer = el
        p.name = v.beskrivelse
        p.unit = v.maaleEnhet === 'ukjent' ? 'stk' : v.maaleEnhet
        p.costPrice = netto
        p.unitPrice = utsalgspris(v, valg, null)
        p.vatType = 'hoy'
        p.incomeAccount = '3000'
        p.supplier = valg.grossist
        p.priceUpdatedAt = naa
      })
    })
    for (let i = 0; i < operasjoner.length; i += BOLK) {
      await database.batch(...operasjoner.slice(i, i + BOLK))
    }
  })

  syncQuietly()
  return ut
}

/**
 * Ferskhet per grossist — «Onninen: 3 dager siden, Solar: 94 dager siden».
 * Uten dette sammenlignes en fersk pris mot en gammel, og svaret blir feil
 * med full selvtillit.
 */
export async function prisferskhet(): Promise<{ grossist: string; sistOppdatert: Date; antall: number }[]> {
  const varer = await database.get<Product>('products').query(
    Q.where('supplier', Q.notEq(null)),
  ).fetch()
  const per = new Map<string, { sist: number; antall: number }>()
  for (const p of varer) {
    if (!p.supplier) continue
    const tid = p.priceUpdatedAt?.getTime() ?? 0
    const rad = per.get(p.supplier) ?? { sist: 0, antall: 0 }
    rad.sist = Math.max(rad.sist, tid)
    rad.antall++
    per.set(p.supplier, rad)
  }
  return [...per.entries()]
    .map(([grossist, r]) => ({ grossist, sistOppdatert: new Date(r.sist), antall: r.antall }))
    .sort((a, b) => b.sistOppdatert.getTime() - a.sistOppdatert.getTime())
}

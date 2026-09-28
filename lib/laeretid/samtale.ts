/**
 * Samtalen som skriver loggen — ren logikk, selvtestet i `npm run verify:laeretid`.
 *
 * Lærlingen skriver ikke loggen selv. Boten spør ham ut, og skriver loggen av
 * svarene hans, notatene og instruksen. Da er rekkverket alt:
 *
 *   1. HVILKE spørsmål som må stilles bestemmes her, ikke av modellen. Modellen
 *      formulerer spørsmålet og leser svaret — den kan ikke «glemme» å spørre
 *      hva han gjorde selv. Se `gjenstaaende()` i utsporing.ts.
 *   2. Boten sier ALDRI hva NEK krever. Den vet hvor ting står (nek-kart.ts:
 *      punkt og side), aldri hva som står der, og ber ham slå opp selv. Å finne
 *      fram i boka er halve fagprøven. `paastaarNek()` fanger en melding som
 *      glipper, og da erstattes den med en ren henvisning.
 *   3. Samtalen går ikke i ring. Et punkt spørres om høyst to ganger; svarer
 *      han fortsatt ikke, regnes det som «husker ikke» — som er et ærlig svar,
 *      og det som skal stå i loggen.
 */
import { finnOppslag, erUtgaatt, UTGAVE } from './nek-kart'
import { gjenstaaende, type Paakrevd, type Tilstand } from './utsporing'

export type Melding = {
  rolle: 'laerling' | 'bot'
  tekst: string
  /** På lærlingens melding: punktene svaret dekket, slik boten leste det. */
  dekker: Paakrevd[]
}

export type Grunnlag = {
  instruks: string | null
  notater: string[]
  bilderUtenNotat: number
  /** Det loggens mal alltid krever. Se `sporOm` i mal.ts. */
  malKrav?: Paakrevd[]
}

/** Hvor mange ganger et punkt spørres om før det regnes som «husker ikke». */
export const MAKS_FORSOK = 2

const MAALING = /\b(m[åa]lt|m[åa]ling|m[åa]lte|spenning|isolasjon|kontinuitet|jordfeilbryter.*test|megg)/i
const KABEL = /\b(kabel|kabler|pfsp|pfxp|prp|tfxp|pr\b|ex\b|leder|kvadrat|mm²|mm2)/i

/**
 * Går gjennom samtalen i rekkefølge og finner ut hva som er besvart, hva
 * som skal spørres om nå, og hvor mange ganger det alt er spurt.
 *
 * Reglene spilles av på nytt fra meldingene hver gang — ingen tilstand lagres
 * ved siden av, så den kan ikke komme ut av takt med det som faktisk ble sagt.
 */
export function gjennomgang(g: Grunnlag, meldinger: Melding[]): {
  besvart: Paakrevd[]
  /** Det som gjenstår, i den rekkefølgen det skal spørres, med antall forsøk. */
  igjen: { punkt: Paakrevd; forsok: number }[]
  neste: Paakrevd | null
  forsok: number
  ferdig: boolean
} {
  const besvart = new Set<Paakrevd>()
  const spurt = new Map<Paakrevd, number>()
  const hansOrd = [g.instruks ?? '', ...g.notater]

  const tilstand = (): Tilstand => {
    const alt = hansOrd.join(' ')
    return {
      instruks: g.instruks,
      innhold: hansOrd.slice(1).join(' ') || null,
      bilderUtenNotat: g.bilderUtenNotat,
      besvart: [...besvart],
      nevnerMaaling: MAALING.test(alt),
      nevnerKabel: KABEL.test(alt),
      malKrav: g.malKrav,
    }
  }

  for (const m of meldinger) {
    if (m.rolle === 'bot') {
      const n = gjenstaaende(tilstand())[0]
      if (n) spurt.set(n, (spurt.get(n) ?? 0) + 1)
      continue
    }
    hansOrd.push(m.tekst)
    for (const d of m.dekker) besvart.add(d)
    // Spurt to ganger uten svar: «husker ikke». Ikke mas mer.
    for (const [p, antall] of spurt) {
      if (antall >= MAKS_FORSOK) besvart.add(p)
    }
  }

  const igjen = gjenstaaende(tilstand()).map(p => ({ punkt: p, forsok: spurt.get(p) ?? 0 }))
  const neste = igjen[0] ?? null
  return {
    besvart: [...besvart], igjen,
    neste: neste?.punkt ?? null, forsok: neste?.forsok ?? 0, ferdig: igjen.length === 0,
  }
}

// ── NEK: hvor, aldri hva ────────────────────────────────────────────────────

export type NekHenvisning = { punkt: string; side: number; linje: string }

/**
 * Gjør et punktnummer fra modellen om til en henvisning med sidetall — eller
 * ingenting. Et punkt som ikke står i kartet, eller som er fra en gammel
 * utgave, sendes aldri videre: en henvisning han ikke finner i boka er verre
 * enn ingen.
 */
export function nekHenvisning(punkt: string | null | undefined): NekHenvisning | null {
  if (!punkt) return null
  const renset = punkt.replace(/^NEK\s*400[-:\s]*/i, '').trim()
  if (erUtgaatt(`NEK 400-${renset}`) || erUtgaatt(renset)) return null
  const o = finnOppslag(renset)
  if (!o) return null
  return { punkt: o.punkt, side: o.side, linje: `${UTGAVE} · ${o.punkt} · side ${o.side}` }
}

/**
 * Påstår teksten hva NEK sier?
 *
 * Et punktnummer alene er greit — det er et faktum om hvor noe står. Det er
 * kombinasjonen av NEK og et kravord i samme setning som er innhold: «NEK 522
 * krever at …», «ifølge NEK skal …». Den fanger ikke alt, men den fanger den
 * vanlige formen, og den er billig å kjøre på hver melding.
 */
export function paastaarNek(tekst: string): string[] {
  const setninger = tekst.split(/(?<=[.!?])\s+|\n+/)
  const nek = /\bNEK\b|\b(?:4[1-4]\d|5[1-5]\d|6\.[1-5]|7-7\d\d)(?:\.\d+)*\b/
  const krav = /\b(krever|kreves|sier|står det|står at|ifølge|i følge|skal|må|tillater|tillatt|forbyr|forbudt|minst|maks(?:imalt)?|ikke over|ikke under)\b/i
  return setninger.filter(s => nek.test(s) && krav.test(s))
}

/** Det boten sier i stedet, når den glapp og siterte normen. */
export function trygtNekSvar(h: NekHenvisning | null): string {
  if (!h) return 'Det skal jeg ikke svare på for deg. Slå det opp i NEK, eller spør faglig leder, og fortell meg med egne ord hva du fant.'
  return `Slå opp ${h.punkt} på side ${h.side} i ${UTGAVE}, og fortell meg med egne ord hva som gjelder her.`
}

/**
 * Tar ut setningene som påstår hva NEK sier, og lar resten stå. Spørsmålet
 * boten stilte skal ikke forsvinne fordi én setning før det glapp. Blir det
 * ingenting igjen, er svaret en ren henvisning.
 */
export function rensNek(melding: string, h: NekHenvisning | null): string {
  const tekst = melding.trim()
  const ut = paastaarNek(tekst)
  if (!tekst) return trygtNekSvar(h)
  if (ut.length === 0) return tekst
  const rest = tekst.split(/(?<=[.!?])\s+|\n+/).filter(s => !ut.includes(s)).join(' ').trim()
  if (!rest) return trygtNekSvar(h)
  return h ? `${trygtNekSvar(h)} ${rest}` : rest
}

// ── Belegg fra loggen modellen skrev ────────────────────────────────────────

export type ForeslattBelegg = { maalNr: number; delId: string; utfortSelv: boolean }

/** Fire til åtte er normalt. Over åtte bærer tabellene kryssene, ikke teksten. */
export const MAKS_MAAL_PER_LOGG = 8

/**
 * Vasker belegget modellen foreslo. Del-id-en må finnes, én rad per del, og
 * antall MÅL stoppes på åtte — ellers ville vi bygget maskinen som ga 1.17 på
 * tretten logger.
 */
export function vaskBelegg(
  forslag: ForeslattBelegg[],
  finnesDel: (maalNr: number, delId: string) => boolean,
): ForeslattBelegg[] {
  const deler = new Set<string>()
  const maal = new Set<number>()
  const ut: ForeslattBelegg[] = []
  for (const f of forslag) {
    if (!Number.isInteger(f.maalNr) || !finnesDel(f.maalNr, f.delId)) continue
    const k = `${f.maalNr}/${f.delId}`
    if (deler.has(k)) continue
    if (!maal.has(f.maalNr) && maal.size >= MAKS_MAAL_PER_LOGG) continue
    deler.add(k)
    maal.add(f.maalNr)
    ut.push({ maalNr: f.maalNr, delId: f.delId, utfortSelv: f.utfortSelv === true })
  }
  return ut
}

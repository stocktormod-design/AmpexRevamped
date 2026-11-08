/**
 * Samtalen som skriver loggen, koblet til modellen og til de lokale radene.
 *
 * Reglene står i `samtale.ts` (selvtestet). Her er rekkefølgen som gjør dem
 * til rekkverk:
 *
 *   1. Svaret hans lagres lokalt FØR modellen kalles. Uten dekning står det
 *      der fortsatt, og samtalen fortsetter når nettet er tilbake.
 *   2. Hva som gjenstår regnes ut her (`gjennomgang()`) og sendes med. Modellen
 *      formulerer — den bestemmer ikke hva som må spørres om.
 *   3. Det modellen svarer vaskes før det lagres: en NEK-påstand byttes ut med
 *      en ren henvisning, og et punkt som ikke står i kartet forsvinner.
 */
import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import {
  LaeretidBelegg, LaeretidBilde, LaeretidLaerling, LaeretidLogg, LaeretidMelding,
} from '../db/models/laeretid'
import { laereplan, type Laereplankode } from './laereplan'
import { KART } from './nek-kart'
import { finnForbudte, SPORSMAAL, type Paakrevd } from './utsporing'
import {
  EKSTRA, MAKS_EKSTRA, ekstraBrukt, gjennomgang, nekHenvisning, paastaarNek, rensNek, vaskBelegg,
  type ForeslattBelegg, type Grunnlag, type Melding,
} from './samtale'
import { lastOppVentende } from './bilder'
import { signedR2Url } from '../drawings-storage'
import { finnesDel, kall, loggKontekst, maalForModell, type Feil } from './quiz-klient'
import { kanBeOmEndring } from './abonnement'
import { BILDE_NOKKEL, delBeskrivelse, finnMal, fyllResten, slaaSammenBeskrivelse, tilTekst, vaskUtfylling } from './mal'

export function tilMelding(r: LaeretidMelding): Melding {
  return {
    rolle: r.rolle,
    tekst: r.tekst,
    dekker: (r.dekker ?? '').split(',').filter(Boolean) as Paakrevd[],
  }
}

export async function grunnlagFor(logg: LaeretidLogg): Promise<Grunnlag> {
  const bilder = await database.get<LaeretidBilde>('laeretid_bilde')
    .query(Q.where('logg_id', logg.id)).fetch()
  return {
    instruks: logg.instruks,
    notater: bilder.map(b => b.notat?.trim() ?? '').filter(Boolean),
    // Et bilde modellen har lest trenger ikke et notat for å bli forstått.
    bilderUtenNotat: bilder.filter(b => !b.notat?.trim() && !b.modellbeskrivelse?.trim()).length,
    malKrav: finnMal(logg.malId).sporOm,
  }
}

/**
 * La modellen se bildene — én gang per bilde. Det den leser (typeskilt,
 * merking, tekst på tegningen) lagres i `modellbeskrivelse` og sendes som
 * tekst etterpå, så bildene ikke lastes opp til modellen i hver runde.
 *
 * Feiler det, går samtalen videre uten: da spør boten om bildet i stedet.
 */
export async function lesBilder(logg: LaeretidLogg): Promise<void> {
  try {
    await lastOppVentende(logg.id)
    const bilder = (await database.get<LaeretidBilde>('laeretid_bilde')
      .query(Q.where('logg_id', logg.id)).fetch())
      .filter(b => b.r2Nokkel && !b.modellbeskrivelse?.trim())
    if (bilder.length === 0) return
    const med = await Promise.all(bilder.map(async b => ({
      id: b.id,
      url: await signedR2Url(b.r2Nokkel!, 'get').catch(() => null),
      tid: b.tattAt ? b.tattAt.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : null,
      notat: b.notat,
    })))
    const svar = await kall<{ beskrivelser: { id: string; bildetekst?: string; beskrivelse: string }[] }>({
      mode: 'se',
      instruks: logg.instruks,
      bilder: med.filter(b => b.url),
    })
    if (!svar.ok) return
    await database.write(async () => {
      for (const { id, bildetekst, beskrivelse } of svar.beskrivelser) {
        const b = bilder.find(x => x.id === id)
        if (b && beskrivelse.trim()) await b.update(r => { r.modellbeskrivelse = slaaSammenBeskrivelse(bildetekst ?? '', beskrivelse) })
      }
    })
  } catch {
    // Ingen dekning eller ingen signering: prøves igjen neste runde.
  }
}

/**
 * Samtalen på nytt: meldingene slettes (synkes som sletting, ikke fjernet), og
 * neste runde åpner boten fra start med dagens regler. Bildene og det boten
 * så på dem beholdes — de er ikke samtalen. Loggteksten står til den skrives på
 * nytt. Kom av første ekte logg 13.10.2026, der reglene ble endret underveis.
 */
export async function startSamtalenPaaNytt(logg: LaeretidLogg): Promise<void> {
  const rader = await meldingerFor(logg.id)
  await database.write(async () => {
    for (const r of rader) await r.markAsDeleted()
  })
}

async function meldingerFor(loggId: string) {
  return database.get<LaeretidMelding>('laeretid_melding')
    .query(Q.where('logg_id', loggId), Q.sortBy('created_at', Q.asc)).fetch()
}

/**
 * Én runde: lagre det han sa (om noe), be modellen om neste replikk, vask den,
 * lagre den. Kalles uten tekst for å åpne samtalen, og uten tekst igjen for å
 * prøve på nytt når forrige kall feilet på nett.
 */
export async function nesteReplikk(
  logg: LaeretidLogg, brukerId: string, tekst: string | null,
): Promise<{ ok: true } | Feil> {
  let hans: LaeretidMelding | null = null
  if (tekst?.trim()) {
    hans = await database.write(async () =>
      database.get<LaeretidMelding>('laeretid_melding').create(r => {
        r.laerlingId = brukerId
        r.loggId = logg.id
        r.rolle = 'laerling'
        r.tekst = tekst.trim()
        r.dekker = null
        r.nek = null
      }),
    )
  }

  await lesBilder(logg)
  const rader = await meldingerFor(logg.id)
  const siste = rader[rader.length - 1]
  // Siste melding er hans og ikke lest ennå: den skal modellen lese nå.
  if (!hans && siste?.rolle === 'laerling' && siste.dekker === null) hans = siste

  const grunnlag = await grunnlagFor(logg)
  const status = gjennomgang(grunnlag, rader.map(tilMelding))

  // Budsjettet sendes alltid: svaret han nettopp ga kan tømme lista, og da skal
  // det smarte spørsmålet komme i samme runde, ikke en «ferdig» for tidlig.
  const ekstra = Math.max(0, MAKS_EKSTRA - ekstraBrukt(rader))
  const svar = await kall<{ dekker: Paakrevd[]; melding: string; nek: string | null; ferdig?: boolean }>({
    mode: 'samtale',
    logg: await loggKontekst(logg),
    meldinger: rader.map(r => ({ rolle: r.rolle, tekst: r.tekst })),
    gjenstaar: status.igjen.map(g => ({ punkt: g.punkt, hvorfor: SPORSMAAL[g.punkt], forsok: g.forsok })),
    nek: KART.map(k => ({ punkt: k.punkt, side: k.side, naar: k.naar })),
    ekstra,
    mal: ekstra > 0 ? { navn: finnMal(logg.malId).navn, seksjoner: finnMal(logg.malId).seksjoner } : undefined,
  })
  if (!svar.ok) return svar

  // Modellen får bare krysse av for det som faktisk sto på lista.
  const lovlig = new Set(status.igjen.map(g => g.punkt))
  const dekker = svar.dekker.filter(d => lovlig.has(d))

  const henvisning = nekHenvisning(svar.nek)
  const melding = rensNek(svar.melding, henvisning)

  await database.write(async () => {
    if (hans) await hans.update(r => { r.dekker = dekker.join(',') })
    // På botens melding betyr `dekker` punktet den spurte om (tomt = ferdig).
    // Da vet skjermen neste gang om malen har fått et nytt krav siden.
    // Et nøkkelspørsmål merkes for seg, så skjermen vet at det venter et svar.
    const spurteOm = status.igjen.map(g => g.punkt).find(p => !dekker.includes(p))
      ?? (ekstra > 0 && svar.ferdig === false ? EKSTRA : '')
    await database.get<LaeretidMelding>('laeretid_melding').create(r => {
      r.laerlingId = brukerId
      r.loggId = logg.id
      r.rolle = 'bot'
      r.tekst = melding
      r.dekker = spurteOm
      r.nek = henvisning?.punkt ?? null
    })
  })
  return { ok: true }
}

export type Skrevet = {
  ok: true
  /** Formuleringer i den ferdige teksten som bør rettes før innsending. */
  advarsler: string[]
}

/**
 * Skriv loggen av samtalen. Første gang er gratis; hver omskriving etter det
 * teller mot grensa i `abonnement.ts` — han kan alltid rette teksten selv.
 *
 * Belegg lages første gang, og alle er `generert`: teksten er modellens, så
 * ingen del holder før han har svart for den i utspørringen. Det er
 * avkryssingsregelen, ikke en innstilling.
 */
export async function skrivLogg(
  logg: LaeretidLogg, brukerId: string, kode: Laereplankode,
): Promise<Skrevet | Feil> {
  const omskriving = !!logg.innhold?.trim()
  if (omskriving) {
    const kan = kanBeOmEndring(logg.aiEndringerBrukt)
    if (!kan.kan) return { ok: false, grunn: kan.grunn }
  }

  const rader = await meldingerFor(logg.id)
  const laerling = await database.get<LaeretidLaerling>('laeretid_laerling').find(brukerId).catch(() => null)

  const mal = finnMal(logg.malId)
  await lesBilder(logg)
  const kontekst = await loggKontekst(logg)
  // Alle bildene i tidsrekkefølge, nummerert: modellen skriver bildeteksten til
  // de han ikke har skrevet notat til, og nummeret fører teksten tilbake hit.
  const bilder = (await database.get<LaeretidBilde>('laeretid_bilde')
    .query(Q.where('logg_id', logg.id)).fetch())
    .sort((a, b) => (a.tattAt?.getTime() ?? 0) - (b.tattAt?.getTime() ?? 0) || a.rekkefolge - b.rekkefolge)
  const svar = await kall<{
    tittel: string; utfylling: unknown; belegg: ForeslattBelegg[]; bildetekster?: { nr: number; tekst: string }[]
  }>({
    mode: 'skriv',
    // Svarene hans går i `meldinger`; den gamle teksten trengs ikke — serveren
    // kaster begge uansett, og de dobler bare størrelsen på forespørselen.
    logg: { ...kontekst, svar: [], innhold: null },
    meldinger: rader.map(r => ({ rolle: r.rolle, tekst: r.tekst })),
    maal: maalForModell(laereplan(kode).maal),
    tone: laerling?.tone ?? null,
    mal: { navn: mal.navn, seksjoner: mal.seksjoner },
    nek: KART.map(k => ({ punkt: k.punkt, side: k.side, naar: k.naar })),
    bilder: bilder.map((b, i) => ({
      nr: i + 1,
      tid: b.tattAt ? b.tattAt.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : null,
      notat: b.notat?.trim() || null,
      beskrivelse: delBeskrivelse(b.modellbeskrivelse).beskrivelse || null,
    })),
  })
  if (!svar.ok) return svar

  // Malen følges uansett hva modellen leverte: faste rader står, rekkefølgen er malens.
  const raa = (svar.utfylling && typeof svar.utfylling === 'object' ? svar.utfylling : {}) as Record<string, unknown>
  raa[BILDE_NOKKEL] = (Array.isArray(svar.bildetekster) ? svar.bildetekster : [])
    .map(t => [bilder[Number(t?.nr) - 1]?.id, typeof t?.tekst === 'string' ? t.tekst : ''])
  const utfylling = fyllResten(mal, vaskUtfylling(mal, raa))
  const tekst = tilTekst(mal, utfylling, kontekst.notater.map(n => (n.tid ? `${n.tid} ${n.notat}` : n.notat)))
  if (!tekst.trim()) return { ok: false, grunn: 'Fikk ingen tekst tilbake. Prøv igjen.' }

  const belegg = vaskBelegg(svar.belegg, finnesDel(kode))
  const finnes = await database.get<LaeretidBelegg>('laeretid_belegg')
    .query(Q.where('logg_id', logg.id)).fetchCount()

  await database.write(async () => {
    await logg.update(l => {
      l.malId = mal.id
      l.utfylling = JSON.stringify(utfylling)
      l.innhold = tekst
      if (!l.tittel?.trim() && svar.tittel) l.tittel = svar.tittel
      if (omskriving) l.aiEndringerBrukt = l.aiEndringerBrukt + 1
    })
    if (finnes > 0) return
    for (const b of belegg) {
      await database.get<LaeretidBelegg>('laeretid_belegg').create(r => {
        r.laerlingId = brukerId
        r.loggId = logg.id
        r.maalNr = b.maalNr
        r.delId = b.delId
        r.kilde = 'brodtekst'
        r.generert = true
        r.utfortSelv = b.utfortSelv
        r.utspurt = null
      })
    }
  })

  return { ok: true, advarsler: advarslerFor(tekst) }
}

/** Det han bør se over i teksten før han sender den. */
export function advarslerFor(tekst: string): string[] {
  return [
    ...finnForbudte(tekst).map(f => `«${f.treff}»: ${f.hvorfor}`),
    ...paastaarNek(tekst).map(s => `«${s.trim()}»: Loggen skal ikke si hva NEK krever — bare det du selv slo opp og forklarte.`),
  ]
}

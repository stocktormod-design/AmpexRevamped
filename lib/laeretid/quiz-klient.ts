/**
 * Utspørringen mot modellen — det eneste i læretid som krever nett.
 *
 * Reglene ligger i `quiz.ts` og er selvtestet; her kobles de til
 * `laeretid-ai` og til de lokale radene. Spørsmål og svar skrives til
 * WatermelonDB og synkes som alt annet — det er bare selve modellkallet som
 * trenger dekning (se «Avvik fra regel 2» i docs/LAERLING.md). Uten nett får
 * han beskjed om det, og ingenting er tapt: loggen står, og spørsmålene kan
 * lages senere.
 */
import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { supabase } from '../supabase'
import {
  LaeretidBelegg, LaeretidBilde, LaeretidLogg, LaeretidMelding, LaeretidSporsmaal,
} from '../db/models/laeretid'
import { finnMaal, laereplan, type Kompetansemaal, type Laereplankode } from './laereplan'
import { KART } from './nek-kart'
import { NIVAAHINT, byggProfil, fokus, nivaaFor, temaProfil, type Temanivaa } from './profil'
import { finnTema } from './teori'
import {
  isoDag, utspurtForDel, vaskForslag,
  type Fasit, type Forslag, type Runde, type Sporsmaal, type SvaktTema, type Vurdering,
} from './quiz'

export type Feil = { ok: false; grunn: string }

/**
 * Ett modellkall per nøkkel om gangen. Et dobbelttrykk på «Send inn», eller å
 * lukke og åpne quizen mens et kall pågår, skal ikke gi dobbelt så mange
 * spørsmål. Kallet tar opptil et minutt, så en sjekk før kallet er ikke nok.
 */
const underveis = new Map<string, Promise<unknown>>()
function enGang<T>(nokkel: string, jobb: () => Promise<T>): Promise<T> {
  const pagar = underveis.get(nokkel)
  if (pagar) return pagar as Promise<T>
  const p = jobb().finally(() => underveis.delete(nokkel))
  underveis.set(nokkel, p)
  return p
}

export function tilSporsmaal(r: LaeretidSporsmaal): Sporsmaal {
  return {
    id: r.id,
    loggId: r.loggId,
    tema: r.tema,
    maalNr: r.maalNr,
    delId: r.delId,
    runde: r.runde,
    tekst: r.tekst,
    svar: r.svar,
    vurdering: r.vurdering,
    laget: isoDag(r.lagetAt),
    besvart: r.besvartAt ? isoDag(r.besvartAt) : null,
  }
}

export async function kall<T>(body: Record<string, unknown>): Promise<(T & { ok: true }) | Feil> {
  try {
    const { data, error } = await supabase.functions.invoke('laeretid-ai', { body })
    if (error) return { ok: false, grunn: 'Fikk ikke kontakt. Prøv igjen når du har dekning.' }
    if (!data?.ok) return { ok: false, grunn: typeof data?.error === 'string' ? data.error : 'Noe gikk galt.' }
    return data
  } catch {
    return { ok: false, grunn: 'Fikk ikke kontakt. Prøv igjen når du har dekning.' }
  }
}

const klokke = (d: Date | null) =>
  d ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : null

/**
 * Alt modellen får vite om én logg. Hans egne ord — instruks, notater og det
 * han sa i samtalen — er med ordrett, så quizen spør om det HAN sa, ikke om
 * det modellen skrev for ham.
 */
export async function loggKontekst(logg: LaeretidLogg) {
  const bilder = (await database.get<LaeretidBilde>('laeretid_bilde')
    .query(Q.where('logg_id', logg.id)).fetch())
    .sort((a, b) => (a.tattAt?.getTime() ?? 0) - (b.tattAt?.getTime() ?? 0) || a.rekkefolge - b.rekkefolge)
  const meldinger = await database.get<LaeretidMelding>('laeretid_melding')
    .query(Q.where('logg_id', logg.id), Q.where('rolle', 'laerling'), Q.sortBy('created_at', Q.asc)).fetch()
  return {
    tittel: logg.tittel, arbeidsdato: logg.arbeidsdato,
    instruks: logg.instruks, innhold: logg.innhold,
    notater: bilder.filter(b => b.notat?.trim()).map(b => ({ tid: klokke(b.tattAt), notat: b.notat!.trim() })),
    utenNotat: bilder.filter(b => !b.notat?.trim()).map(b => klokke(b.tattAt) ?? `bilde ${b.rekkefolge + 1}`),
    svar: meldinger.map(m => m.tekst),
  }
}

export function maalForModell(maal: Kompetansemaal[]) {
  return maal.map(m => ({
    nr: m.nr, etikett: m.etikett, tekst: m.tekst,
    deler: m.deler.map(d => ({ id: d.id, navn: d.navn })),
  }))
}

export function finnesDel(kode: Laereplankode) {
  return (maalNr: number, delId: string) =>
    laereplan(kode).maal.some(m => m.nr === maalNr && m.deler.some(d => d.id === delId))
}

async function lagre(brukerId: string, loggId: string, runde: Runde, forslag: Forslag[]) {
  const naa = new Date()
  await database.write(async () => {
    for (const f of forslag) {
      await database.get<LaeretidSporsmaal>('laeretid_sporsmaal').create(r => {
        r.laerlingId = brukerId
        r.loggId = loggId
        r.maalNr = f.maalNr
        r.delId = f.delId
        r.runde = runde
        r.tekst = f.tekst
        r.svar = null
        r.vurdering = null
        r.lagetAt = naa
        r.besvartAt = null
      })
    }
  })
}

async function sporsmaalForLogg(loggId: string) {
  return database.get<LaeretidSporsmaal>('laeretid_sporsmaal')
    .query(Q.where('logg_id', loggId)).fetch()
}

/** Læringsprofilen akkurat nå, regnet ut fra det som ligger på telefonen. */
export async function profilNaa(brukerId: string): Promise<Temanivaa[]> {
  const [sp, bl] = await Promise.all([
    database.get<LaeretidSporsmaal>('laeretid_sporsmaal').query(Q.where('laerling_id', brukerId)).fetch(),
    database.get<LaeretidBelegg>('laeretid_belegg').query(Q.where('laerling_id', brukerId)).fetch(),
  ])
  return byggProfil(sp.map(tilSporsmaal), bl.map(b => ({
    loggId: b.loggId, maalNr: b.maalNr, delId: b.delId, utfortSelv: b.utfortSelv,
  })), isoDag(new Date()))
}

/** Nivå per del for de målene quizen kan velge fra — modellen tilpasser seg dette. */
function nivaaTilModell(profil: Temanivaa[], maal: Kompetansemaal[]) {
  return maal.flatMap(m => m.deler.map(d => {
    const n = nivaaFor(profil, m.nr, d.id)
    return { maalNr: m.nr, delId: d.id, nivaa: n, hint: NIVAAHINT[n] }
  }))
}

/**
 * Runde 1 — samme kveld, rett etter at loggen er sendt.
 *
 * Har loggen belegg, spørres det bare om de målene: det er de krysset skal
 * settes på. Uten belegg får modellen hele planen og velger det loggen faktisk
 * redegjør for.
 */
export function lagRunde1(
  logg: LaeretidLogg, brukerId: string, kode: Laereplankode,
): Promise<{ ok: true; antall: number } | Feil> {
  return enGang(`r1/${logg.id}`, () => lagRunde1Nå(logg, brukerId, kode))
}

async function lagRunde1Nå(
  logg: LaeretidLogg, brukerId: string, kode: Laereplankode,
): Promise<{ ok: true; antall: number } | Feil> {
  const finnes = await sporsmaalForLogg(logg.id)
  if (finnes.some(s => s.runde === 1)) return { ok: true, antall: 0 }

  const belegg = await database.get<LaeretidBelegg>('laeretid_belegg')
    .query(Q.where('logg_id', logg.id)).fetch()
  const nr = new Set(belegg.map(b => b.maalNr))
  const maal = nr.size > 0 ? laereplan(kode).maal.filter(m => nr.has(m.nr)) : laereplan(kode).maal

  const profil = await profilNaa(brukerId)
  const svar = await kall<{ sporsmaal: Forslag[] }>({
    mode: 'lag', runde: 1, logg: await loggKontekst(logg), maal: maalForModell(maal),
    nivaa: nivaaTilModell(profil, maal),
  })
  if (!svar.ok) return svar
  const vasket = vaskForslag(svar.sporsmaal, finnesDel(kode), 1)
  if (vasket.length === 0) return { ok: false, grunn: 'Loggen har for lite å spørre om ennå. Skriv litt mer om hva du gjorde.' }
  // Sjekk igjen: en annen enhet kan ha laget dem mens modellen tenkte.
  if ((await sporsmaalForLogg(logg.id)).some(s => s.runde === 1)) return { ok: true, antall: 0 }
  await lagre(brukerId, logg.id, 1, vasket)
  return { ok: true, antall: vasket.length }
}

/**
 * Runde 2 — lages når runde 1 er ferdig, så den kan bygge på det han svarte.
 * Den ligger så og modnes; `anbefaltDytt()` avgjør når den er verdt å ta.
 */
export function lagRunde2(
  logg: LaeretidLogg, brukerId: string, kode: Laereplankode,
): Promise<{ ok: true } | Feil> {
  return enGang(`r2/${logg.id}`, () => lagRunde2Nå(logg, brukerId, kode))
}

async function lagRunde2Nå(
  logg: LaeretidLogg, brukerId: string, kode: Laereplankode,
): Promise<{ ok: true } | Feil> {
  const alle = await sporsmaalForLogg(logg.id)
  const runde1 = alle.filter(s => s.runde === 1)
  if (runde1.length === 0 || runde1.some(s => !s.besvartAt)) return { ok: true }
  if (alle.some(s => s.runde === 2)) return { ok: true }

  const nr = new Set(runde1.map(s => s.maalNr))
  const maal2 = laereplan(kode).maal.filter(m => nr.has(m.nr))
  const svar = await kall<{ sporsmaal: Forslag[] }>({
    mode: 'lag', runde: 2, logg: await loggKontekst(logg),
    maal: maalForModell(maal2),
    nivaa: nivaaTilModell(await profilNaa(brukerId), maal2),
    tidligere: runde1.map(s => ({ tekst: s.tekst, svar: s.svar, vurdering: s.vurdering })),
  })
  if (!svar.ok) return svar
  const vasket = vaskForslag(svar.sporsmaal, finnesDel(kode), 2)
  if (vasket.length > 0 && !(await sporsmaalForLogg(logg.id)).some(s => s.runde === 2)) {
    await lagre(brukerId, logg.id, 2, vasket)
  }
  return { ok: true }
}

/**
 * Et svakt tema kommer tilbake, tre uker etter siste bom. Knyttes til loggen
 * han bommet i, så spørsmålet fortsatt handler om en jobb han gjorde.
 */
export function lagRepetisjon(
  tema: SvaktTema, alle: Sporsmaal[], brukerId: string, kode: Laereplankode,
): Promise<{ ok: true } | Feil> {
  return enGang(`rep/${tema.maalNr}/${tema.delId}`, () => lagRepetisjonNå(tema, alle, brukerId, kode))
}

async function lagRepetisjonNå(
  tema: SvaktTema, alle: Sporsmaal[], brukerId: string, kode: Laereplankode,
): Promise<{ ok: true } | Feil> {
  const paaTema = alle.filter(s => s.maalNr === tema.maalNr && s.delId === tema.delId && s.loggId)
  const sisteBom = paaTema
    .filter(s => s.vurdering === 'stroket')
    .sort((a, b) => (b.besvart ?? '').localeCompare(a.besvart ?? ''))[0]
  if (!sisteBom?.loggId) return { ok: true }
  const logg = await database.get<LaeretidLogg>('laeretid_logg').find(sisteBom.loggId).catch(() => null)
  if (!logg) return { ok: true }

  const maal = finnMaal(kode, tema.maalNr)
  const svar = await kall<{ sporsmaal: Forslag[] }>({
    mode: 'lag', runde: 2, logg: await loggKontekst(logg),
    maal: maalForModell([{ ...maal, deler: maal.deler.filter(d => d.id === tema.delId) }]),
    tidligere: paaTema.map(s => ({ tekst: s.tekst, svar: s.svar, vurdering: s.vurdering })),
  })
  if (!svar.ok) return svar
  const vasket = vaskForslag(svar.sporsmaal, (m, d) => m === tema.maalNr && d === tema.delId, 2)
  const aapent = await database.get<LaeretidSporsmaal>('laeretid_sporsmaal').query(
    Q.where('laerling_id', brukerId), Q.where('maal_nr', tema.maalNr), Q.where('del_id', tema.delId),
    Q.where('besvart_at', null), Q.where('tema', null),
  ).fetchCount()
  if (vasket.length > 0 && aapent === 0) await lagre(brukerId, logg.id, 2, vasket)
  return { ok: true }
}

export type Dom = { vurdering: Vurdering; tilbakemelding: string; fasit: Fasit }

/**
 * Vurder ett svar, lagre det ordrett, og — i runde 1 — la det slå inn på
 * belegget. Svaret skrives først når vurderingen er kommet: et svar uten dom
 * ville sett besvart ut og aldri blitt spurt igjen.
 */
export async function vurderSvar(
  rad: LaeretidSporsmaal, svarTekst: string, kode: Laereplankode,
): Promise<({ ok: true } & Dom) | Feil> {
  const tema = finnTema(rad.tema)
  const logg = rad.loggId
    ? await database.get<LaeretidLogg>('laeretid_logg').find(rad.loggId).catch(() => null)
    : null
  if (!logg && !tema) return { ok: false, grunn: 'Fant ikke loggen spørsmålet hører til.' }
  const maal = finnMaal(kode, rad.maalNr)
  const del = maal.deler.find(d => d.id === rad.delId)

  const dom = await kall<Dom>({
    mode: 'vurder', runde: rad.runde,
    ...(logg ? { logg: await loggKontekst(logg) } : {}),
    ...(tema ? { tema: { navn: tema.navn, stikkord: tema.stikkord } } : {}),
    sporsmaal: rad.tekst, svar: svarTekst,
    maal: { etikett: maal.etikett, tekst: maal.tekst, delNavn: del?.navn ?? rad.delId },
    nek: KART.map(k => ({ punkt: k.punkt, naar: k.naar })),
  })
  if (!dom.ok) return dom

  await database.write(async () => {
    await rad.update(r => {
      r.svar = svarTekst
      r.vurdering = dom.vurdering
      r.besvartAt = new Date()
    })
    if (rad.runde !== 1 || !rad.loggId) return
    // Runde 2 og teori rører aldri krysset. Se `utspurtForDel()`.
    const alle = (await sporsmaalForLogg(rad.loggId)).map(tilSporsmaal)
    const utspurt = utspurtForDel(alle, rad.loggId, rad.maalNr, rad.delId)
    const belegg = await database.get<LaeretidBelegg>('laeretid_belegg').query(
      Q.where('logg_id', rad.loggId), Q.where('maal_nr', rad.maalNr), Q.where('del_id', rad.delId),
    ).fetch()
    for (const b of belegg) {
      if (b.utspurt !== utspurt) await b.update(x => { x.utspurt = utspurt })
    }
  })

  // Teori: pek til temaets eget NEK-punkt når modellen ikke fant et.
  const fasit = tema && !dom.fasit.nek ? { ...dom.fasit, nek: tema.nek } : dom.fasit
  return { ok: true, vurdering: dom.vurdering, tilbakemelding: dom.tilbakemelding, fasit }
}

/**
 * Teoriøving: tre spørsmål i ett tema, på hans nivå. Spørsmålene legges som
 * runde 2 uten logg — de tar aldri et kryss, de øver, og de teller i
 * læringsprofilen under temaets del av kompetansemålet.
 */
export function lagTeori(
  brukerId: string, temaId: string, antall = 3,
): Promise<{ ok: true; antall: number } | Feil> {
  return enGang(`teori/${temaId}`, () => lagTeoriNå(brukerId, temaId, antall))
}

async function lagTeoriNå(
  brukerId: string, temaId: string, antall: number,
): Promise<{ ok: true; antall: number } | Feil> {
  const tema = finnTema(temaId)
  if (!tema) return { ok: false, grunn: 'Ukjent tema.' }
  const alle = await database.get<LaeretidSporsmaal>('laeretid_sporsmaal')
    .query(Q.where('laerling_id', brukerId), Q.where('tema', temaId)).fetch()
  // Ligger det alt åpne spørsmål i temaet, brukes de — ikke lag flere.
  const aapne = alle.filter(s => !s.besvartAt).length
  if (aapne >= antall) return { ok: true, antall: aapne }

  const niv = temaProfil(alle.map(tilSporsmaal), isoDag(new Date())).get(temaId)?.nivaa ?? 0
  const svar = await kall<{ sporsmaal: string[] }>({
    mode: 'teori',
    tema: { id: tema.id, navn: tema.navn, stikkord: tema.stikkord },
    nivaa: niv, hint: NIVAAHINT[niv],
    tidligere: alle.slice(-8).map(s => ({ tekst: s.tekst, svar: s.svar, vurdering: s.vurdering })),
    antall: antall - aapne,
  })
  if (!svar.ok) return svar
  const tekster = svar.sporsmaal.map(t => t.trim()).filter(t => t.endsWith('?')).slice(0, antall - aapne)
  if (tekster.length === 0) return { ok: false, grunn: 'Fikk ingen spørsmål tilbake. Prøv igjen.' }
  const naa = new Date()
  await database.write(async () => {
    for (const tekst of tekster) {
      await database.get<LaeretidSporsmaal>('laeretid_sporsmaal').create(r => {
        r.laerlingId = brukerId
        r.loggId = null
        r.tema = temaId
        r.maalNr = tema.maalNr
        r.delId = tema.delId
        r.runde = 2
        r.tekst = tekst
        r.svar = null
        r.vurdering = null
        r.lagetAt = naa
        r.besvartAt = null
      })
    }
  })
  return { ok: true, antall: aapne + tekster.length }
}

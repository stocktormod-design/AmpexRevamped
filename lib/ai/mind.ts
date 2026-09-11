import { Q } from '@nozbe/watermelondb'
import { database } from '../db'
import { AssistantNote } from '../db/models/assistant-note'
import { Reminder } from '../db/models/reminder'
import { listAllTemplates, type TemplateCatalogEntry } from '../forms/resolve'
import { getCurrentUser, type CurrentUser } from '../order-access'
import { SYSTEM_INSTRUCTION, TOOL_DECLARATIONS } from './assistant-contract'
import { askMind, type Funksjonskall } from './gemini-client'
import { runTool, type ToolCallbacks } from './tools-runtime'
import type { VoiceRouteContext } from './voice-drafts'

/**
 * Turbasert assistentmotor — erstatteren for Gemini Live (lib/ai/live-session.ts).
 *
 * Forskjellen er taksameteret, ikke øret. Live holder en WebSocket åpen og
 * fakturerer sesjonen: stillheten din, tenketiden, og sin egen tale til 4x
 * inngangsprisen. Her sendes ett lydklipp når brukeren er ferdig å snakke, og
 * modellen svarer med et VERKTØYKALL — ikke med lyd. Telefonen setter setningen
 * sammen selv (lib/ai/voice-speaker.ts). Det er det som tar regninga fra
 * ~$1700/mnd til ~$15-35 for 100 brukere.
 *
 * Modulen SNAKKER IKKE selv. Den returnerer hva som skal sies, og lar talelaget
 * avgjøre hvordan. Det holder motoren testbar uten lyd-hardware, og det er
 * forutsetningen for at malbaserte svar kan hentes fra cache i stedet for å
 * syntetiseres på nytt hver gang.
 */

/** Alt som varierer per bruker og skjerm. Legges ETTER den statiske kontrakten. */
export type AssistantContext = {
  user: CurrentUser | null
  templateCatalog: TemplateCatalogEntry[]
  userNotes: { id: string; content: string }[]
  dueReminders: string[]
  routeContext: VoiceRouteContext
}

/**
 * Henter alt modellen trenger å vite om HER OG NÅ. Kjøres én gang ved øktstart,
 * ikke per tur — katalogen og hukommelsen endrer seg ikke midt i en samtale, og
 * å bygge dem på nytt per tur ville brutt den implisitte cachen uten å gi noe.
 */
export async function loadAssistantContext(routeContext: VoiceRouteContext): Promise<AssistantContext> {
  const user = await getCurrentUser()
  const templateCatalog = await listAllTemplates().catch(() => [])

  let userNotes: { id: string; content: string }[] = []
  let dueReminders: string[] = []

  if (user) {
    userNotes = await database
      .get<AssistantNote>('assistant_notes')
      .query(Q.where('user_id', user.id), Q.sortBy('created_at', Q.asc))
      .fetch()
      .then(rows => rows.map(n => ({ id: n.id, content: n.content })))
      .catch(() => [])

    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)
    dueReminders = await database
      .get<Reminder>('reminders')
      .query(
        Q.where('user_id', user.id),
        Q.where('status', 'open'),
        Q.where('due_at', Q.lte(endOfDay.getTime())),
        Q.sortBy('due_at', Q.asc),
      )
      .fetch()
      .then(rows => rows.map(r => r.title))
      .catch(() => [])
  }

  return { user, templateCatalog, userNotes, dueReminders, routeContext }
}

/**
 * Systeminstruksen: statisk kontrakt først, variabel kontekst sist.
 *
 * REKKEFØLGEN ER ET KOSTNADSVALG. Geminis implisitte cache nøkler på felles
 * prefiks og gir 90 % rabatt på det som treffer. SYSTEM_INSTRUCTION er identisk
 * for alle brukere i alle firma, så den delen treffer alltid — hvis den står
 * først. Flyttes brukernavnet opp, faller hele instruksen ut av cachen og hver
 * tur blir 2-3x dyrere uten at noe annet ser annerledes ut.
 */
export function buildSystemInstruction(ctx: AssistantContext): string {
  const screenInfo =
    ctx.routeContext.screen === 'prosjekt'
      ? 'Brukeren står inne på et prosjekt — prosjekt_status uten navn gjelder dette prosjektet.'
      : ctx.routeContext.screen === 'ordre'
        ? 'Brukeren står på ordrelisten.'
        : 'Brukeren er et sted i appen uten spesiell kontekst.'

  const userInfo = ctx.user
    ? `BRUKER: ${ctx.user.name || 'ukjent navn'} (rolle: ${ctx.user.role || 'ukjent'}). Du handler alltid PÅ VEGNE AV denne brukeren og kan aldri gjøre mer enn rollen deres tillater.`
    : ''

  const catalog =
    ctx.templateCatalog.length > 0
      ? `\nTILGJENGELIGE SKJEMAMALER (bruk mal_id ordrett):\n${ctx.templateCatalog.map(t => `- ${t.id}: ${t.name} (${t.source})`).join('\n')}`
      : ''

  const reminders =
    ctx.dueReminders.length > 0
      ? `\nPÅMINNELSER SOM FORFALLER I DAG/ER FORFALT — nevn dem kort i din FØRSTE replikk: ${ctx.dueReminders.join('; ')}`
      : ''

  const notes =
    ctx.userNotes.length > 0
      ? `\nHUKOMMELSE OM BRUKEREN (bruk naturlig, ikke les opp; slett med glem_notat om brukeren ber om det):\n${ctx.userNotes.map(n => `- [${n.id}] ${n.content}`).join('\n')}`
      : ''

  return `${SYSTEM_INSTRUCTION}\n\n${userInfo}\nNÅVÆRENDE SKJERM: ${screenInfo}${catalog}${reminders}${notes}`
}

/**
 * Verktøykall per tur før vi gir oss.
 *
 * Modellen kan lovlig kjede kall — «finn ordre 1042» så «legg til materiell på
 * den». Men en løkke som fyrer av kall uten stopp er den ene måten dette designet
 * kan bli dyrt på, og på en byggeplass merker ingen det før regninga kommer. Fire
 * runder dekker enhver ekte flyt vi har sett; den femte er en bug.
 */
const MAX_VERKTOYRUNDER = 4

/** Hvor mange tidligere turer vi bærer med oss. Se `klippHistorikk`. */
const HISTORIKK_MAKS_DELER = 24

/** Ett verktøy som faktisk ble kjørt, med det det svarte. */
export type UtfoertVerktoy = {
  navn: string
  argumenter: Record<string, unknown>
  resultat: Record<string, unknown>
}

export type MindTurnResultat =
  | {
      ok: true
      /** Hva som skal sies. Null når modellen bare utførte noe uten å kommentere. */
      si: string | null
      /** Verktøyene som faktisk ble kjørt, i rekkefølge — UI-et bruker dem til å vise hva som skjedde. */
      utfoerte: UtfoertVerktoy[]
      /** Oppdatert historikk å sende inn i neste tur. */
      historikk: Record<string, unknown>[]
      /** Tokenforbruk, summert over alle rundene i turen. */
      bruk: { inn: number; cachet: number; ut: number }
    }
  | { ok: false; grunn: 'network' | 'timeout' | 'server_error' | 'avbrutt'; detalj?: string }

export type MindTurnArgs = {
  ctx: AssistantContext
  callbacks: ToolCallbacks
  /** Lydklippet brukeren nettopp snakket. Utelates kun når `text` er satt (tekstinngang). */
  audio?: { base64: string; mimeType: string }
  text?: string
  historikk?: Record<string, unknown>[]
  /** Barge-in og spekulativ utsending kansellerer turen gjennom denne. */
  avbryt?: AbortSignal
}

/**
 * Én komplett samtaletur: lyd inn → verktøy kjørt → hva som skal sies ut.
 *
 * Løkken finnes fordi function calling er en dialog, ikke ett kall: modellen ber
 * om et verktøy, vi kjører det lokalt mot WatermelonDB, og sender resultatet
 * tilbake så den kan svare på grunnlag av ekte data. Uten den runden ville den
 * måttet gjette hva verktøyet returnerte — som er nøyaktig det systeminstruksen
 * forbyr den å gjøre.
 */
export async function runMindTurn(args: MindTurnArgs): Promise<MindTurnResultat> {
  const systemInstruction = buildSystemInstruction(args.ctx)
  const toolCtx = {
    callbacks: args.callbacks,
    templateCatalog: args.ctx.templateCatalog,
    routeContext: args.ctx.routeContext,
  }

  const historikk = [...(args.historikk ?? [])]
  const utfoerte: UtfoertVerktoy[] = []
  const bruk = { inn: 0, cachet: 0, ut: 0 }

  // Første runde bærer brukerens lyd; senere runder bærer verktøysvar.
  let audio = args.audio
  let text = args.text

  for (let runde = 0; runde < MAX_VERKTOYRUNDER; runde++) {
    if (args.avbryt?.aborted) return { ok: false, grunn: 'avbrutt' }

    const svar = await askMind({
      routeContext: args.ctx.routeContext.screen,
      systemInstruction,
      tools: TOOL_DECLARATIONS,
      audio,
      text,
      historikk,
      avbryt: args.avbryt,
    })

    if (!svar.ok) {
      return { ok: false, grunn: svar.reason, detalj: svar.detail }
    }

    bruk.inn += svar.svar.bruk.inn
    bruk.cachet += svar.svar.bruk.cachet
    bruk.ut += svar.svar.bruk.ut

    // Brukerturen vi nettopp sendte, inn i historikken. Lyden erstattes av en
    // markør: å bære base64-lyd videre i hver runde ville tredoblet forespørselen
    // uten å gi modellen noe den ikke allerede har hørt.
    historikk.push({
      role: 'user',
      parts: audio ? [{ text: '[talemelding fra brukeren]' }] : [{ text: text ?? '' }],
    })
    historikk.push({ role: 'model', parts: svar.svar.modellDeler })

    audio = undefined
    text = undefined

    if (svar.svar.funksjonskall.length === 0) {
      return {
        ok: true,
        si: svar.svar.tekst,
        utfoerte,
        historikk: klippHistorikk(historikk),
        bruk,
      }
    }

    const svarDeler: Record<string, unknown>[] = []
    for (const kall of svar.svar.funksjonskall) {
      if (args.avbryt?.aborted) return { ok: false, grunn: 'avbrutt' }
      const resultat = await runTool(toolCtx, kall.navn, kall.argumenter)
      utfoerte.push({ navn: kall.navn, argumenter: kall.argumenter, resultat })
      svarDeler.push({ functionResponse: { name: kall.navn, response: resultat } })
    }

    historikk.push({ role: 'user', parts: svarDeler })
  }

  // Taket er nådd. Vi har kjørt verktøyene, så handlingene ER utført — brukeren
  // skal få vite det, ikke møte stillhet fordi modellen ikke ble ferdig å prate.
  return {
    ok: true,
    si: oppsummerUtfoerte(utfoerte),
    utfoerte,
    historikk: klippHistorikk(historikk),
    bruk,
  }
}

/**
 * Holder historikken kort og komplett på samme tid.
 *
 * Kompletthet er ikke valgfritt: kutter du mellom et verktøykall og svaret på
 * det, sitter modellen igjen med en forespørsel den aldri fikk svar på, og
 * kaller verktøyet på nytt. Derfor klipper vi bare på en modell-tur, som alltid
 * er et rent snitt i dialogen.
 */
function klippHistorikk(historikk: Record<string, unknown>[]): Record<string, unknown>[] {
  if (historikk.length <= HISTORIKK_MAKS_DELER) return historikk
  let start = historikk.length - HISTORIKK_MAKS_DELER
  while (start < historikk.length && historikk[start]?.role !== 'user') start++
  return historikk.slice(start)
}

/** Nødsetning når verktøytaket ble nådd. Sier hva som skjedde, ikke at noe gikk galt. */
function oppsummerUtfoerte(
  utfoerte: { navn: string; resultat: Record<string, unknown> }[],
): string {
  const vellykkede = utfoerte.filter(u => !('feil' in u.resultat))
  if (vellykkede.length === 0) return 'Jeg fikk ikke gjort det. Prøv å si det på nytt.'
  return `Jeg utførte ${vellykkede.length === 1 ? 'det' : `${vellykkede.length} ting`}, men mistet tråden på slutten. Sjekk gjerne at det ble riktig.`
}

export type { Funksjonskall }

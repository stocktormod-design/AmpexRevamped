/**
 * Verktøykjøringen — de 37 tingene assistenten faktisk KAN gjøre.
 *
 * Løftet ut av LiveSession fordi den turbaserte motoren (lib/ai/mind.ts) trenger
 * nøyaktig det samme: navn + argumenter inn, resultatobjekt ut. Alt kjører mot
 * WatermelonDB lokalt, så et verktøykall er en lokal skriving — ikke et nettverkskall.
 * Det er derfor kontrakten hører hjemme på klienten og ikke i edge-funksjonen.
 *
 * Kaster ALDRI. Enhver feil kommer tilbake som `{ feil: string }`, fordi et kastet
 * unntak her ville drept samtaleturen i stedet for å gi modellen noe å si til
 * brukeren. Assistenten skal kunne svare «det gikk ikke, fordi …».
 */
import { Q } from '@nozbe/watermelondb'
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AudioBufferQueueSourceNode,
} from 'react-native-audio-api'
import { database } from '../db'
import { Order, orderStatusLabel } from '../db/models/order'
import { OrderDocument } from '../db/models/order-document'
import { OrderScan } from '../db/models/order-scan'
import { FormTemplate } from '../db/models/form-template'
import { Project } from '../db/models/project'
import { Room } from '../db/models/room'
import { findByOrderNumber } from '../orders'
import { kanKalle, type Verktoyrett } from './verktoy-tilgang'
import {
  addOrderMember,
  findColleagueByName,
  getCurrentUser,
  getOrderMembers,
  isOrderMember,
  listMyOrders,
  type CurrentUser,
} from '../order-access'
import { syncQuietly } from '../db/sync'
import { TimeEntry } from '../db/models/time-entry'
import { Activity } from '../db/models/activity'
import { finnAktivitet, opprettAktivitet } from '../activities'
import { sokKunder, finnKunde, opprettKunde } from '../customers'
import { OrderExtra, type TilleggPrising } from '../db/models/order-extra'
import { Quote } from '../db/models/quote'
import { resolveTemplate, listAllTemplates, type TemplateCatalogEntry } from '../forms/resolve'
import { startVoiceFill, applyVoiceFill, type VoiceFillEntry } from '../forms/voice-fill'
import { emitVoiceLevel } from './voice-level'
import { isEchoCancelledMicAvailable, startEchoCancelledMic } from '../../modules/ampex-splat'
import { getPreferredVoice } from './voice-prefs'
import { Reminder } from '../db/models/reminder'
import { AssistantNote } from '../db/models/assistant-note'
import {
  spenningsfall,
  lastStroem,
  vernKarakteristikk,
  koordinerKabelVern,
  kortslutningEnde,
  regnUt,
  VARMEKABEL_VEILEDNING,
} from '../elektro'
import { getForecast } from '../weather'
import { computeProjectProgress, progressToSpokenContext } from '../project-progress'
import { fetchLiveToken } from './gemini-client'
import type { VoiceRouteContext } from './voice-drafts'
import { sokVareVerktoy, taUtMateriellVerktoy, leggTilMateriellVerktoy } from './materiell-tools'
import { nyttTilbudVerktoy, tilbudslinjeVerktoy, tilbudssumVerktoy } from './tilbud-tools'

/** Det lille runTool trenger av økt-tilstand. Begge motorene fyller dette selv. */
export type ToolCallbacks = {
  onOrderFound?: (order: Order) => void
  onOpenForm?: (orderId: string, templateId: string) => void
  onNavigate?: (path: string) => void
}

export type ToolContext = {
  callbacks: ToolCallbacks
  /** Malkatalogen, hentet én gang ved øktstart — skjemaverktøyene slår opp i den. */
  templateCatalog: TemplateCatalogEntry[]
  /** Hvilken skjerm brukeren står på, så «denne ordren» betyr noe. */
  routeContext: VoiceRouteContext
}

  /** Felles oppslag + medlemssjekk for ordre-verktøyene. */
type ProjectMatch =
  | { kind: 'one'; project: Project }
  | { kind: 'ambiguous'; candidates: Project[] }
  | { kind: 'none' }

/**
 * Talegjenkjent prosjektnavn er sjelden ordrett likt DB-navnet («løkkeveien» vs
 * «Løkkeveien 12, Hansen»). Prosjektlisten er liten og lokal, så vi matcher raust:
 * eksakt > navnet starter med det sagte > det sagte inngår i navn/kunde. Flere
 * treff sendes tilbake til modellen som kandidater — DEN spør brukeren, ikke vi.
 */
async function resolveProjectByName(spoken: string): Promise<ProjectMatch> {
  const q = spoken.toLowerCase()
  const projects = await database.get<Project>('projects').query().fetch()

  const exact = projects.filter(p => p.name.toLowerCase() === q)
  if (exact.length === 1) return { kind: 'one', project: exact[0] }

  const starts = projects.filter(p => p.name.toLowerCase().startsWith(q))
  const contains = projects.filter(
    p => p.name.toLowerCase().includes(q) || (p.customerName ?? '').toLowerCase().includes(q),
  )
  const candidates = starts.length > 0 ? starts : contains
  if (candidates.length === 1) return { kind: 'one', project: candidates[0] }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: candidates.slice(0, 5) }
  return { kind: 'none' }
}

async function resolveOrder(
    args: Record<string, unknown>,
  ): Promise<{ order: Order; n: number; member: boolean; user: CurrentUser } | { feil: string; funnet?: boolean }> {
    const n = typeof args.ordrenummer === 'number' ? args.ordrenummer : NaN
    if (!Number.isInteger(n)) return { feil: 'Ordrenummer mangler eller er ikke et tall.' }
    const user = await getCurrentUser()
    if (!user) return { feil: 'Ingen innlogget bruker.' }
    const order = await findByOrderNumber(n)
    if (!order) return { feil: `Fant ingen ordre med nummer ${n}.`, funnet: false }
    return { order, n, member: await isOrderMember(order, user.id), user }
  }

/**
 * Hvilke verktøy som krever hvilken rett. Kun de som SKRIVER står her.
 *
 * Oppslag (mine_ordrer, finn_ordre, sok_vare) og regnestykker har ingen rad: de
 * endrer ingenting, og medlemskapsvernet i finn_ordre gjør sin egen jobb.
 * Påminnelser og notater er brukerens egne. En lærling som ikke får be appen huske
 * hvor han parkerte, har fått en app som er sur.
 *
 * DETTE ER IKKE SIKKERHETSMODELLEN — RLS er det. Men verktøykallene skriver til
 * lokal WatermelonDB, og RLS ser ingenting før `watermelon_push` kjører, kanskje
 * timer senere. Uten denne sperren sier assistenten «ordren er opprettet», brukeren
 * hører det, og avvisningen kommer som en synkfeil lenge etterpå.
 *
 * (Gjenopprettet 2026-09-11 under flettingen av grossist-og-pool: omskrivingen av
 * live-økten hadde mistet koblingen, mens verktoy-tilgang.ts lå igjen ubrukt.)
 */
const VERKTOY_KREVER: Record<string, Verktoyrett> = {
  opprett_ordre: 'ordre.opprett',
  opprett_kunde: 'kunde.opprett',
  opprett_timetype: 'register.endre',
  bli_med_pa_ordre: 'ordre.bli_med',
  oppdater_ordre: 'ordre.endre',
  legg_til_medlem: 'ordre.endre',
  foer_timer: 'timer.egne',
  utfyll_timenotat: 'timer.egne',
  start_skjema: 'skjema.fyll',
  fyll_skjemafelt: 'skjema.fyll',
  legg_til_materiell: 'materiell.for',
  ta_ut_materiell: 'materiell.for',
  foresla_tillegg: 'materiell.for',
  nytt_tilbud: 'tilbud.skriv',
  legg_til_tilbudslinje: 'tilbud.skriv',
}

export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Rollesjekk FØR noe skrives. Se VERKTOY_KREVER for hvorfor RLS alene ikke holder
    // når appen er offline-først.
    const krav = VERKTOY_KREVER[name]
    if (krav) {
      const rolle = (await getCurrentUser())?.role
      const dom = kanKalle(rolle, krav)
      if (!dom.tillatt) {
        console.warn(`Verktøy: ${name} avvist lokalt (${dom.grunn}) for rolle ${rolle ?? 'ukjent'}`)
        return { feil: dom.beskjed, grunn: dom.grunn }
      }
    }
    try {
      if (name === 'finn_ordre') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        const { order, n, member, user } = resolved
        const members = await getOrderMembers(order.id)
        const memberNames = members.map(m => m.userName || 'ukjent navn')
        if (!member) {
          // Visittkortet — og IKKE mer. Innhold (kunde, adresse, beskrivelse,
          // dokumentasjon) er forbeholdt de som er med på ordren.
          return {
            funnet: true,
            du_er_med: false,
            ordrenummer: n,
            tittel: order.title,
            medlemmer: memberNames,
            beskjed: 'Brukeren er IKKE med på ordren — del kun dette, og tilby bli_med_pa_ordre for full tilgang.',
          }
        }
        ctx.callbacks.onOrderFound?.(order)
        return {
          funnet: true,
          du_er_med: true,
          ordrenummer: n,
          tittel: order.title,
          status: orderStatusLabel[order.status] ?? order.status,
          kunde: order.customerName ?? undefined,
          adresse: order.address ?? undefined,
          beskrivelse: order.description ?? undefined,
          medlemmer: memberNames.length > 0 ? memberNames : [user.name || 'deg'],
          beskjed: 'Appen viser en snarvei til ordren nå.',
        }
      }
      if (name === 'ordre_dokumentasjon') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) {
          return { feil: 'Brukeren er ikke med på denne ordren og kan ikke se dokumentasjonen. Tilby bli_med_pa_ordre.' }
        }
        const [docs, scans, templates] = await Promise.all([
          database.get<OrderDocument>('order_documents').query(Q.where('order_id', resolved.order.id)).fetch(),
          database.get<OrderScan>('order_scans').query(Q.where('order_id', resolved.order.id)).fetch(),
          database.get<FormTemplate>('form_templates').query().fetch(),
        ])
        // Malnavn må slås opp i BEGGE kilder. `form_templates` inneholder kun
        // firmaets egne; et dokument fylt fra en Ampex-mal har id 'ampex.*' og
        // ble tidligere rapportert som «Ukjent skjema» — altså alle
        // sluttkontroller og samsvarserklæringer. Katalogen dekker begge.
        const templateTitle = new Map<string, string>([
          ...ctx.templateCatalog.map(t => [t.id, t.name] as [string, string]),
          ...templates.map(t => [t.id, t.title] as [string, string]),
        ])
        return {
          skjemaer: docs.map(d => ({
            tittel: templateTitle.get(d.templateId) ?? 'Ukjent skjema',
            status: d.status === 'fullfort' ? 'fullført' : 'utkast',
          })),
          skanninger: scans.map(s => ({ tittel: s.title, type: s.kind })),
          beskjed:
            docs.length === 0 && scans.length === 0
              ? 'Ingen dokumentasjon på ordren ennå — si det ærlig.'
              : 'Dette er ALT som finnes — ikke legg til noe selv.',
        }
      }
      if (name === 'bli_med_pa_ordre') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (resolved.member) return { ok: true, beskjed: 'Brukeren er allerede med på ordren.' }
        await addOrderMember(resolved.order.id, resolved.user)
        return { ok: true, beskjed: `Brukeren er nå med på ordre ${resolved.n} og har full tilgang.` }
      }
      if (name === 'opprett_ordre') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        if (!tittel) return { feil: 'Tittel mangler.' }
        // Kunden kommer fra registeret: finnes navnet der, kobles ordren på kunden
        // (id, telefon, adresse). Finnes det ikke, står navnet som fritekst og svaret
        // sier fra, så assistenten kan tilby å opprette kunden.
        const kundenavn = typeof args.kundenavn === 'string' && args.kundenavn.trim() ? args.kundenavn.trim() : null
        const kunde = kundenavn ? await finnKunde(kundenavn) : null
        const created = await database.write(async () =>
          database.get<Order>('orders').create(o => {
            o.title = tittel
            o.customerId = kunde?.id ?? null
            o.customerName = kunde?.name ?? kundenavn
            o.customerPhone = kunde?.phone ?? null
            o.address = (typeof args.adresse === 'string' && args.adresse.trim() ? args.adresse.trim() : null) ?? kunde?.postalAddress ?? null
            o.description = typeof args.beskrivelse === 'string' && args.beskrivelse.trim() ? args.beskrivelse.trim() : null
            o.status = 'mottatt'
            o.assignedTo = user.id
          }),
        )
        await addOrderMember(created.id, user)
        syncQuietly() // ordrenummer settes av server-trigger ved synk
        // Guide-adferd: ÅPNE ordren direkte i stedet for å tilby en snarvei.
        ctx.callbacks.onNavigate?.(`/(app)/ordre/${created.id}`)
        return {
          opprettet: true,
          tittel,
          kunde: kunde ? { navn: kunde.name, telefon: kunde.phone } : null,
          beskjed:
            'Ordren er opprettet, brukeren er med på den, og den vises på skjermen nå. Ordrenummer kommer ved synk — ikke finn på ett. Ikke start et intervju — spør kun hvis noe viktig åpenbart mangler.'
            + (kundenavn && !kunde ? ` Kunden «${kundenavn}» finnes ikke i registeret — tilby å opprette henne med opprett_kunde (spør om telefon), så kobles hun på ordren.` : '')
            + (!kundenavn ? ' Ordren har INGEN kunde. Si det i én kort setning og tilby å legge til en (finnes → mine_kunder ved navn, finnes ikke → opprett_kunde).' : ''),
        }
      }
      if (name === 'mine_kunder') {
        const sok = typeof args.sok === 'string' ? args.sok : ''
        if (!sok.trim()) return { feil: 'Oppgi et navn eller telefonnummer — ett oppslag, ikke hele registeret.' }
        const kunder = await sokKunder(sok, 5)
        return {
          antall: kunder.length,
          kunder: kunder.map(k => ({ navn: k.name, telefon: k.phone, adresse: k.postalAddress, bedrift: k.isCompany })),
          ...(kunder.length === 0 ? { beskjed: sok.trim() ? `Ingen kunder matcher «${sok.trim()}».` : 'Kunderegisteret er tomt. Tilby å opprette den første kunden.' } : {}),
        }
      }
      if (name === 'opprett_kunde') {
        const navn = typeof args.navn === 'string' ? args.navn.trim() : ''
        if (!navn) return { feil: 'Navn mangler.' }
        const finnes = await finnKunde(navn)
        if (finnes && finnes.name.toLowerCase() === navn.toLowerCase()) {
          return { finnes: true, kunde: { navn: finnes.name, telefon: finnes.phone }, beskjed: 'Kunden finnes allerede — bruk den.' }
        }
        const kunde = await opprettKunde({
          name: navn,
          phone: typeof args.telefon === 'string' ? args.telefon : null,
          address: typeof args.adresse === 'string' ? args.adresse : null,
          email: typeof args.epost === 'string' ? args.epost : null,
          isCompany: args.bedrift === true,
        })
        return {
          opprettet: true,
          kunde: { navn: kunde.name, telefon: kunde.phone },
          beskjed: kunde.phone ? 'Kunden er lagret med telefon.' : 'Kunden er lagret uten telefon — spør om nummeret én gang, ikke mas.',
        }
      }
      if (name === 'timetyper') {
        const alle = await database.get<Activity>('activities').query(Q.where('archived', false)).fetch()
        return {
          antall: alle.length,
          timetyper: alle.map(a => ({ navn: a.name, timepris: a.hourlyRate, fakturerbar: a.billable })),
          ...(alle.length === 0 ? { beskjed: 'Firmaet har ingen timetyper. Tilby å opprette et sett (opprett_timetype) — timer uten timetype får ingen pris.' } : {}),
        }
      }
      if (name === 'opprett_timetype') {
        const navn = typeof args.navn === 'string' ? args.navn.trim() : ''
        if (!navn) return { feil: 'Navn mangler.' }
        const finnes = await finnAktivitet(navn)
        if (finnes && finnes.name.toLowerCase() === navn.toLowerCase()) return { finnes: true, beskjed: `«${finnes.name}» finnes allerede.` }
        const fakturerbar = args.fakturerbar !== false
        if (fakturerbar && typeof args.timepris !== 'number') {
          return { feil: `Timepris mangler for «${navn}». Spør hva timen koster eks. mva (eller om den er intern og ikke faktureres), og opprett så.` }
        }
        const a = await opprettAktivitet({
          name: navn,
          hourlyRate: typeof args.timepris === 'number' ? args.timepris : null,
          billable: args.fakturerbar !== false,
        })
        syncQuietly()
        return { opprettet: true, timetype: { navn: a.name, timepris: a.hourlyRate, fakturerbar: a.billable } }
      }
      if (name === 'prosjekt_status') {
        const navn = typeof args.prosjektnavn === 'string' ? args.prosjektnavn.trim() : ''
        let project: Project | null = null
        if (navn) {
          const match = await resolveProjectByName(navn)
          if (match.kind === 'none') {
            return { feil: `Fant ikke noe prosjekt som ligner på «${navn}». Bruk mine_prosjekter for å se hva som finnes.` }
          }
          if (match.kind === 'ambiguous') {
            return { flertydig: true, kandidater: match.candidates.map(p => p.name), beskjed: 'Flere prosjekter matcher — spør brukeren hvilket de mener.' }
          }
          project = match.project
        } else if (ctx.routeContext.screen === 'prosjekt') {
          project = await database.get<Project>('projects').find(ctx.routeContext.projectId).catch(() => null)
        }
        if (!project) {
          return { feil: 'Ingen prosjektnavn oppgitt og brukeren står ikke i et prosjekt — spør hvilket prosjekt de mener.' }
        }
        const rooms = await database.get<Room>('rooms').query(Q.where('project_id', project.id)).fetch()
        return {
          prosjekt: project.name,
          kunde: project.customerName ?? undefined,
          status: project.status,
          fremdrift: progressToSpokenContext(computeProjectProgress(rooms)),
        }
      }
      if (name === 'varmekabel_cc') {
        const areal = typeof args.areal_m2 === 'number' ? args.areal_m2 : NaN
        const lengde = typeof args.kabellengde_m === 'number' ? args.kabellengde_m : NaN
        if (!(areal > 0) || !(lengde > 0)) return { feil: 'Areal og kabellengde må være positive tall.' }
        const cc = (areal * 100) / lengde
        const kabelW = typeof args.kabel_W === 'number' && args.kabel_W > 0 ? args.kabel_W : null
        return {
          cc_cm: Math.round(cc * 10) / 10,
          ...(kabelW ? { effekt_W_per_m2: Math.round(kabelW / areal), effekt_W_per_m: Math.round((kabelW / lengde) * 10) / 10 } : {}),
          veiledende_effektbehov: VARMEKABEL_VEILEDNING,
          beskjed:
            'c/c = areal × 100 / kabellengde. Rund av NEDOVER til nærmeste hele/halve cm i praksis — produsentens leggeanvisning (min/maks c/c og maks W/m for gulvtypen) gjelder. Sjekk W/m² mot veiledningsspennet for rommet.',
        }
      }
      if (name === 'varmekabel_ohm') {
        const W = typeof args.kabel_W === 'number' ? args.kabel_W : NaN
        if (!(W > 0)) return { feil: 'Merkeeffekt må være et positivt tall.' }
        const U = typeof args.spenning_V === 'number' && args.spenning_V > 0 ? args.spenning_V : 230
        const nominal = (U * U) / W
        return {
          nominell_ohm: Math.round(nominal * 10) / 10,
          toleranseomraade_ohm: `${Math.round(nominal * 0.95 * 10) / 10} – ${Math.round(nominal * 1.1 * 10) / 10}`,
          forutsetninger: `R = U²/P ved ${U}V, vanlig produsenttoleranse −5/+10 % — sjekk databladet`,
          beskjed: 'Mål også isolasjonsresistans (megging) før og etter støp — ohmsjekken alene fanger ikke skadet isolasjon.',
        }
      }
      if (name === 'spenningsfall') {
        const L = typeof args.lengde_m === 'number' ? args.lengde_m : NaN
        const I = typeof args.stroem_A === 'number' ? args.stroem_A : NaN
        const A = typeof args.tverrsnitt_mm2 === 'number' ? args.tverrsnitt_mm2 : NaN
        if (!(L > 0) || !(I > 0) || !(A > 0)) return { feil: 'Lengde, strøm og tverrsnitt må være positive tall.' }
        return {
          ...spenningsfall({
            lengde_m: L,
            stroem_A: I,
            tverrsnitt_mm2: A,
            system: args.system === 'trefase' ? 'trefase' : 'enfase',
            spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
            cosphi: typeof args.cosphi === 'number' ? args.cosphi : undefined,
            materiale: args.materiale === 'al' ? 'al' : 'cu',
            ledertemp_C: typeof args.ledertemp_C === 'number' ? args.ledertemp_C : undefined,
          }),
          beskjed: 'NEK 400 anbefaler ≤ 4 % totalt fra tilknytning til forbruk (veiledende) — vurder mot resten av kursen.',
        }
      }
      if (name === 'last_stroem') {
        const kW = typeof args.kW === 'number' ? args.kW : NaN
        if (!(kW > 0)) return { feil: 'kW må være et positivt tall.' }
        return lastStroem({
          kW,
          spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
          cosphi: typeof args.cosphi === 'number' ? args.cosphi : undefined,
          virkningsgrad: typeof args.virkningsgrad === 'number' ? args.virkningsgrad : undefined,
          system: args.system === 'enfase' ? 'enfase' : 'trefase',
        })
      }
      if (name === 'vern_karakteristikk') {
        const In = typeof args.In === 'number' ? args.In : NaN
        if (!(In > 0)) return { feil: 'In må være et positivt tall.' }
        return vernKarakteristikk(typeof args.karakteristikk === 'string' ? args.karakteristikk : '', In)
      }
      if (name === 'koordiner_kabel_vern') {
        const Ib = typeof args.belastning_Ib_A === 'number' ? args.belastning_Ib_A : NaN
        const In = typeof args.vern_In_A === 'number' ? args.vern_In_A : NaN
        const Iz = typeof args.kabel_Iz_A === 'number' ? args.kabel_Iz_A : NaN
        if (!(Ib > 0) || !(In > 0) || !(Iz > 0)) return { feil: 'Ib, In og Iz må være positive tall.' }
        return koordinerKabelVern({ belastning_Ib_A: Ib, vern_In_A: In, kabel_Iz_A: Iz })
      }
      if (name === 'kortslutning_ende') {
        const ik = typeof args.ik_start_A === 'number' ? args.ik_start_A : NaN
        const L = typeof args.lengde_m === 'number' ? args.lengde_m : NaN
        const A = typeof args.tverrsnitt_mm2 === 'number' ? args.tverrsnitt_mm2 : NaN
        if (!(ik > 0) || !(L > 0) || !(A > 0)) return { feil: 'Ik, lengde og tverrsnitt må være positive tall.' }
        return kortslutningEnde({
          ik_start_A: ik,
          lengde_m: L,
          tverrsnitt_mm2: A,
          spenning_V: typeof args.spenning_V === 'number' ? args.spenning_V : undefined,
          materiale: args.materiale === 'al' ? 'al' : 'cu',
        })
      }
      if (name === 'regn_ut') {
        return regnUt(typeof args.uttrykk === 'string' ? args.uttrykk : '')
      }
      if (name === 'husk_notat') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const innhold = typeof args.innhold === 'string' ? args.innhold.trim() : ''
        if (!innhold) return { feil: 'Innhold mangler.' }
        await database.write(async () => {
          await database.get<AssistantNote>('assistant_notes').create(n => {
            n.userId = user.id
            n.content = innhold
          })
        })
        return { ok: true, beskjed: 'Husket — gjelder fra neste samtale også.' }
      }
      if (name === 'glem_notat') {
        const id = typeof args.id === 'string' ? args.id : ''
        const note = await database.get<AssistantNote>('assistant_notes').find(id).catch(() => null)
        if (!note) return { feil: 'Fant ikke notatet.' }
        await database.write(async () => {
          await note.destroyPermanently()
        })
        return { ok: true }
      }
      if (name === 'opprett_paaminnelse') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        const dato = typeof args.dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dato) ? args.dato : null
        if (!tittel || !dato) return { feil: 'Tittel eller dato mangler/ugyldig.' }
        const tid = typeof args.tid === 'string' && /^\d{2}:\d{2}$/.test(args.tid) ? args.tid : '07:00'
        const dueAt = new Date(`${dato}T${tid}:00`)
        let orderId: string | null = null
        if (typeof args.ordrenummer === 'number') {
          const order = await findByOrderNumber(args.ordrenummer)
          orderId = order?.id ?? null
        }
        await database.write(async () => {
          await database.get<Reminder>('reminders').create(r => {
            r.userId = user.id
            r.title = tittel
            r.dueAt = dueAt
            r.orderId = orderId
            r.note = typeof args.notat === 'string' && args.notat.trim() ? args.notat.trim() : null
            r.status = 'open'
          })
        })
        return { ok: true, beskjed: `Påminnelse «${tittel}» satt til ${dato} kl. ${tid}.` }
      }
      if (name === 'mine_paaminnelser') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const reminders = await database
          .get<Reminder>('reminders')
          .query(Q.where('user_id', user.id), Q.where('status', 'open'), Q.sortBy('due_at', Q.asc))
          .fetch()
        return {
          paaminnelser: reminders.map(r => ({
            id: r.id,
            tittel: r.title,
            naar: r.dueAt.toISOString().slice(0, 16).replace('T', ' kl. '),
            notat: r.note ?? undefined,
          })),
        }
      }
      if (name === 'paaminnelse_utfort') {
        const id = typeof args.id === 'string' ? args.id : ''
        const reminder = await database.get<Reminder>('reminders').find(id).catch(() => null)
        if (!reminder) return { feil: 'Fant ikke påminnelsen.' }
        await database.write(async () => {
          await reminder.update(r => { r.status = 'done' })
        })
        return { ok: true }
      }
      if (name === 'sjekk_vaer') {
        const sted = typeof args.sted === 'string' ? args.sted.trim() : ''
        if (!sted) return { feil: 'Sted mangler.' }
        const result = await getForecast(sted)
        if (!result.ok) return { feil: result.feil }
        return {
          sted: result.sted,
          varsel: result.dager,
          beskjed: 'Temperaturer i °C, nedbør i mm per dag. Vurder selv mot arbeidet (f.eks. varmekabler krever normalt tørt og ikke sterk kulde) — og si tallene kort.',
        }
      }
      if (name === 'legg_til_medlem') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren må selv være med på ordren for å legge til andre.' }
        const navn = typeof args.navn === 'string' ? args.navn.trim() : ''
        if (!navn) return { feil: 'Navn mangler.' }
        const match = await findColleagueByName(navn)
        if (match.kind === 'offline') return { feil: 'Får ikke slått opp kolleger uten nett akkurat nå.' }
        if (match.kind === 'none') return { feil: `Fant ingen kollega som ligner på «${navn}».` }
        if (match.kind === 'ambiguous') {
          return { flertydig: true, kandidater: match.candidates, beskjed: 'Flere kolleger matcher — spør hvem brukeren mener.' }
        }
        await addOrderMember(resolved.order.id, match.colleague)
        return { ok: true, beskjed: `${match.colleague.name} er lagt til på ordre ${resolved.n}.` }
      }
      if (name === 'vis_ordre') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — kan ikke åpne den. Tilby bli_med_pa_ordre.' }
        ctx.callbacks.onNavigate?.(`/(app)/ordre/${resolved.order.id}`)
        return { ok: true, beskjed: `Ordre ${resolved.n} vises på skjermen nå.` }
      }
      if (name === 'oppdater_ordre') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — kan ikke endre den.' }
        const scheduled =
          typeof args.planlagt_dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.planlagt_dato)
            ? new Date(args.planlagt_dato)
            : null
        const endret: string[] = []
        await database.write(async () => {
          await resolved.order.update(o => {
            if (typeof args.beskrivelse === 'string' && args.beskrivelse.trim()) { o.description = args.beskrivelse.trim(); endret.push('beskrivelse') }
            if (typeof args.kundenavn === 'string' && args.kundenavn.trim()) { o.customerName = args.kundenavn.trim(); endret.push('kunde') }
            if (typeof args.telefon === 'string' && args.telefon.trim()) { o.customerPhone = args.telefon.trim(); endret.push('telefon') }
            if (typeof args.adresse === 'string' && args.adresse.trim()) { o.address = args.adresse.trim(); endret.push('adresse') }
            if (scheduled) {
              o.scheduledAt = scheduled
              if (o.status === 'mottatt') o.status = 'planlagt' // samme regel som ordre/ny.tsx
              endret.push('planlagt dato')
            }
          })
        })
        if (endret.length === 0) return { feil: 'Ingen gyldige felter å oppdatere.' }
        syncQuietly()
        return { ok: true, oppdatert: endret }
      }
      if (name === 'start_skjema' || name === 'fyll_skjemafelt' || name === 'vis_skjema') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) {
          return { feil: 'Brukeren er ikke med på ordren — dokumentasjon krever medlemskap. Tilby bli_med_pa_ordre.' }
        }
        const template = typeof args.mal_id === 'string' ? await resolveTemplate(args.mal_id) : undefined
        if (!template) {
          return { feil: `Ukjent mal-id. Gyldige: ${ctx.templateCatalog.map(t => t.id).join(', ')}.` }
        }
        if (name === 'start_skjema') {
          const state = await startVoiceFill(resolved.order, template)
          return { mal: template.name, ...state }
        }
        if (name === 'fyll_skjemafelt') {
          const entries = Array.isArray(args.felter)
            ? (args.felter as VoiceFillEntry[]).filter(
                e => e && typeof e.key === 'string' && typeof e.verdi === 'string',
              )
            : []
          if (entries.length === 0) return { feil: 'Ingen gyldige felter å fylle.' }
          const result = await applyVoiceFill(resolved.order, template, entries)
          return { ...result }
        }
        ctx.callbacks.onOpenForm?.(resolved.order.id, template.id)
        return { ok: true, beskjed: 'Skjemaet vises på skjermen nå — be brukeren se over, rette og fullføre selv.' }
      }
      if (name === 'sok_vare') {
        return sokVareVerktoy(typeof args.sok === 'string' ? args.sok : '')
      }
      if (name === 'ta_ut_materiell') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        return taUtMateriellVerktoy(args as { vare?: string; antall?: number; lokasjon?: string }, user.id)
      }
      if (name === 'legg_til_materiell') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        // Samme sperre som resten: materiell føres kun på ordrer brukeren er med på.
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren. Tilby bli_med_pa_ordre først.' }
        return leggTilMateriellVerktoy(args as { vare?: string; antall?: number }, resolved.order.id, resolved.n)
      }
      if (name === 'nytt_tilbud') {
        return nyttTilbudVerktoy(args as { tittel?: string; kunde?: string; gyldig_dager?: number })
      }
      if (name === 'legg_til_tilbudslinje') {
        return tilbudslinjeVerktoy(args as Parameters<typeof tilbudslinjeVerktoy>[0])
      }
      if (name === 'tilbudssum') {
        return tilbudssumVerktoy(args.tilbudsnummer)
      }
      if (name === 'vis_tilbud') {
        const n = typeof args.tilbudsnummer === 'number' ? args.tilbudsnummer : NaN
        if (!Number.isInteger(n)) return { feil: 'Tilbudsnummer mangler.' }
        const [q] = await database.get<Quote>('quotes').query(Q.where('quote_number', n)).fetch()
        if (!q) return { feil: `Fant ingen tilbud med nummer ${n}.` }
        ctx.callbacks.onNavigate?.(`/(app)/tilbud/${q.id}`)
        return { ok: true, beskjed: `Tilbud ${n} vises på skjermen nå.` }
      }
      if (name === 'foer_timer') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — timer føres kun på egne ordrer.' }
        const hours = typeof args.timer === 'number' ? args.timer : NaN
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { feil: 'Antall timer må være mellom 0 og 24.' }
        const day = typeof args.dato === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dato) ? new Date(args.dato) : new Date()
        day.setHours(0, 0, 0, 0)
        // Uten aktivitet har timene ingen pris, og linja faller ut av
        // fakturagrunnlaget som «mangler pris». Standardaktiviteten er montasje,
        // fordi det er det en elektriker gjør mesteparten av dagen.
        const aktivitet = typeof args.aktivitet === 'string' && args.aktivitet.trim()
          ? await finnAktivitet(args.aktivitet)
          : await finnAktivitet('Montasje')
        if (!aktivitet) {
          // Uten timetype får timene ingen pris. Si det FØR føringen, med det som
          // finnes, så assistenten kan velge riktig eller tilby å opprette.
          const alle = await database.get<Activity>('activities').query(Q.where('archived', false)).fetch()
          const bedt = typeof args.aktivitet === 'string' ? args.aktivitet.trim() : ''
          return alle.length === 0
            ? { feil: 'Firmaet har ingen timetyper ennå, så timene ville stått uten pris. Tilby å opprette timetyper med opprett_timetype (f.eks. Montasje 850, Internt 0), og før timene etterpå.' }
            : { feil: `Fant ingen timetype «${bedt || 'Montasje'}». Finnes: ${alle.map(a => a.name).join(', ')}. Spør hvilken, eller tilby å opprette den.` }
        }
        await database.write(async () => {
          await database.get<TimeEntry>('time_entries').create(e => {
            e.orderId = resolved.order.id
            e.userId = resolved.user.id
            e.userName = resolved.user.name
            e.date = day
            e.hours = hours
            e.note = typeof args.notat === 'string' && args.notat.trim() ? args.notat.trim() : null
            e.activityId = aktivitet?.id ?? null
          })
        })
        const fikkNotat = typeof args.notat === 'string' && !!args.notat.trim()
        return {
          ok: true,
          beskjed: `Førte ${hours} timer på ordre ${resolved.n}${aktivitet ? ` som ${aktivitet.name.toLowerCase()}` : ''}.`,
          ...(aktivitet ? {} : { advarsel: 'Fant ingen aktivitet — timene får ingen pris før aktivitet er satt.' }),
          // Kommentaren står på FAKTURAEN til kunden og er ofte det eneste hun
          // leser. Montøren tilbyr den aldri selv — så assistenten spør, ÉN gang,
          // og bare når den mangler.
          ...(fikkNotat ? {} : {
            oppfolging: 'Timene er ført uten kommentar. Spør kort om hva som ble gjort, og bruk utfyll_timenotat. Godtar de ikke, la det ligge — ikke mas.',
          }),
        }
      }
      if (name === 'utfyll_timenotat') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        const notat = typeof args.notat === 'string' ? args.notat.trim() : ''
        if (!notat) return { feil: 'Tom kommentar — ingenting å legge til.' }

        /*
         * Bare DIN egen føring, bare på den ordren, bare i dag, og bare hvis den
         * ikke alt har en kommentar.
         *
         * Uten de fire grensene kunne assistenten skrive over en kollegas
         * beskrivelse av hva HAN gjorde — og den teksten står på fakturaen til
         * kunden. En kommentar som er feil er verre enn ingen kommentar.
         */
        const idag = new Date(); idag.setHours(0, 0, 0, 0)
        const mine = await database.get<TimeEntry>('time_entries')
          .query(
            Q.where('order_id', resolved.order.id),
            Q.where('user_id', resolved.user.id),
            Q.where('date', Q.gte(idag.getTime())),
            Q.sortBy('created_at', Q.desc),
          ).fetch()
        const foring = mine.find(e => !e.note)
        if (!foring) {
          return { feil: 'Fant ingen timeføring fra deg på den ordren i dag uten kommentar fra før. Før timene først.' }
        }
        await database.write(async () => { await foring.update(e => { e.note = notat }) })
        syncQuietly()
        return { ok: true, beskjed: `La kommentaren på timene: «${notat}»` }
      }
      if (name === 'foresla_tillegg') {
        const resolved = await resolveOrder(args)
        if ('feil' in resolved) return resolved
        if (!resolved.member) return { feil: 'Brukeren er ikke med på ordren — tillegg registreres kun på egne ordrer.' }
        const tittel = typeof args.tittel === 'string' ? args.tittel.trim() : ''
        if (!tittel) return { feil: 'Tillegget må ha en kort tittel.' }
        const prising: TilleggPrising = args.prising === 'fastpris' ? 'fastpris' : 'medgatt'
        const pris = typeof args.pris === 'number' && args.pris > 0 ? args.pris : null
        if (prising === 'fastpris' && pris == null) {
          return { feil: 'Fastpris krever et beløp. Spør om prisen, eller registrer som etter medgått.' }
        }
        await database.write(async () => {
          await database.get<OrderExtra>('order_extras').create(x => {
            x.orderId = resolved.order.id
            x.title = tittel
            x.description = typeof args.beskrivelse === 'string' && args.beskrivelse.trim() ? args.beskrivelse.trim() : null
            x.pricing = prising
            x.price = prising === 'fastpris' ? pris : null
            x.vatType = 'hoy'
            // ALLTID foreslått. AI-en kan ikke godkjenne på kundens vegne —
            // det er nettopp godkjenningen som er verdien i denne raden.
            x.status = 'foreslatt'
          })
        })
        return {
          ok: true,
          beskjed: `Registrerte «${tittel}» som tilleggsarbeid på ordre ${resolved.n}, foreslått.`,
          maa_godkjennes: 'Si til brukeren at tillegget må godkjennes av kunden før det kan faktureres, '
            + 'og at navnet på den som sier ja må registreres på skjermen.',
        }
      }
      if (name === 'mine_timer') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const since = Date.now() - 7 * 24 * 60 * 60 * 1000
        const entries = await database
          .get<TimeEntry>('time_entries')
          .query(Q.where('user_id', user.id), Q.where('date', Q.gte(since)))
          .fetch()
        const orders = await database.get<Order>('orders').query().fetch()
        const orderName = new Map(orders.map(o => [o.id, o.orderNumber ? `ordre ${o.orderNumber}` : o.title]))
        return {
          totalt_timer: entries.reduce((sum, e) => sum + e.hours, 0),
          foeringer: entries.map(e => ({
            ordre: orderName.get(e.orderId) ?? 'ukjent ordre',
            dato: e.date.toISOString().slice(0, 10),
            timer: e.hours,
            notat: e.note ?? undefined,
          })),
        }
      }
      if (name === 'mine_prosjekter') {
        const projects = await database.get<Project>('projects').query().fetch()
        return {
          prosjekter: projects.map(p => ({ navn: p.name, kunde: p.customerName ?? undefined, status: p.status })),
        }
      }
      if (name === 'mine_ordrer') {
        const user = await getCurrentUser()
        if (!user) return { feil: 'Ingen innlogget bruker.' }
        const orders = await listMyOrders(user.id)
        return {
          ordrer: orders.map(o => ({
            ordrenummer: o.orderNumber ?? undefined,
            tittel: o.title,
            kunde: o.customerName ?? undefined,
            status: orderStatusLabel[o.status] ?? o.status,
          })),
          beskjed: 'Dette er kun ordrene brukeren selv er med på.',
        }
      }
      return { feil: `Ukjent verktøy: ${name}` }
    } catch (e) {
      return { feil: e instanceof Error ? e.message : 'ukjent feil' }
    }
  }

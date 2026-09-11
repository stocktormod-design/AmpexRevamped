import { forhandsrendre } from './tale-cache'

/**
 * Setningene assistenten sier oftest — rendret på forhånd så de aldri høres ut
 * som systemstemmen.
 *
 * Uten dette låter HVER setning som 2012-Siri første gang noen sier den, og
 * førsteinntrykket av appen er det inntrykket. Lista er bevisst kort: bare
 * strenger som er BIT-IDENTISKE hver gang. Setninger med tall eller varenavn
 * («La 10 meter PN 3x2,5 på ordre 1042») kan ikke forhåndsrendres uten å
 * generere tusenvis av varianter, så de tar systemstemmen første gang og er
 * cachet for alle andre etterpå.
 *
 * Kostnaden er engangs for HELE systemet, ikke per bruker: første telefon som
 * kjører dette legger klippene i R2, resten laster dem bare ned.
 */
const VANLIGE = [
  // Mikrokvitteringer — spilles mens nettverkskallet går, og er derfor de
  // hyppigste lydene i hele appen.
  'Mm.',
  'Ok.',
  'Ja?',
  'Et øyeblikk.',
  'Skjønner.',

  // Faste bekreftelser fra malene (lib/ai/tale-maler.ts).
  'Husket.',
  'Glemt.',
  'Kvittert ut.',
  'Ordren er opprettet, og du er med på den.',

  // Feilsetningene fra mind-session. Sjeldnere, men verst å høre robotisk —
  // de kommer alltid når noe allerede har gått galt.
  'Jeg mistet nettet. Si det en gang til når du har dekning.',
  'Det gikk ikke. Prøv å si det på nytt.',
  'Jeg fikk ikke gjort det. Prøv å si det på nytt.',

  // Oppfølgingene assistenten bruker oftest i en ordresamtale.
  'Noe mer?',
  'Var det alt?',
  'Hvilken ordre?',
  'Hvilken vare?',
  'Hvor mange?',
  'Skal jeg gjøre det?',
  'Da er det gjort.',
]

let harKjort = false

/**
 * Fyller cachen i bakgrunnen. Trygg å kalle ved hver øktstart — den gjør ingenting
 * andre gang, og hopper over alt som allerede ligger lokalt.
 *
 * Kjøres SEKVENSIELT med vilje. Parallelle kall ville gitt tjue samtidige
 * TTS-rendringer på en telefon som samtidig skal føre en samtale; ventetiden
 * spiller ingen rolle når ingen hører på.
 */
export async function forvarmTalecache(): Promise<void> {
  if (harKjort) return
  harKjort = true

  let nye = 0
  let feilet = 0
  console.log(`Tale: forvarmer ${VANLIGE.length} setninger`)
  for (const setning of VANLIGE) {
    try {
      if (await forhandsrendre(setning)) nye++
    } catch (e) {
      // Én setning som feiler skal ikke stoppe resten — men den skal SES.
      // Første versjon svelget unntakene her, og da var forvarmingen umulig å
      // feilsøke: ingen lyd, ingen logg, ingen anelse om hvor det gikk galt.
      feilet++
      if (feilet <= 3) console.warn(`Tale: forvarming feilet på «${setning}»:`, e)
    }
  }
  console.log(`Tale: forvarming ferdig — ${nye} nye, ${feilet} feilet, ${VANLIGE.length - nye - feilet} fantes fra før`)
}

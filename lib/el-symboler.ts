/**
 * Elkraft-forklaringen → punkttypene i tegneverktøyet. Brann har sin egen (`kindFraEtikett` i
 * brann-symboler.ts); symbolsøket selv er det samme for alle fag — det leser tegningens egen
 * forklaring, og dette gir bare etiketten et navn vi kjenner.
 *
 * Skrevet mot en ekte norsk forklaring (NEK 144-stil, 30.10): «Stikkontakt, 2-veis m/jord»,
 * «Bryter, serievender», «Koblingsboks, innfelt» … Rekkefølgen betyr noe: det spesifikke
 * («bevegelsesføler», «2-polt») må prøves før det generelle («bryter»).
 *
 * `null` = vi kjenner den ikke; kalleren legger punktet inn med etiketten som notat.
 */

const REGLER: Array<[RegExp, string]> = [
  // Svakstrøm først (30.10): «Uttak, data dobbel» skal ikke bli et vanlig datauttak, og
  // «Rack, for data» ikke et uttak i det hele tatt.
  [/\brack\b/, 'rack'],
  [/fiber/, 'fiber-dobbel'],
  [/data.*dobbel|dobbel.*data/, 'data-dobbel'],
  [/tele.*dobbel|dobbel.*tele/, 'tele-dobbel'],
  [/adresse\s*ledd/, 'adresseledd'],
  [/alarm\s*sender/, 'alarmsender'],
  [/sirene/, 'sirene'],
  [/summer/, 'summer'],
  [/brannklokke|alarmklokke/, 'klokke'],
  [/d[øo]rholder|d[øo]rmagnet/, 'dorholder'],
  [/\bir\s*-?\s*detektor/, 'ir-detektor'],
  [/kamera.*dome|dome.*kamera/, 'kamera-dome'],
  [/kamera/, 'kamera'],
  [/kortleser.*tastatur/, 'kortleser-tastatur'],
  [/kortleser/, 'kortleser'],
  [/inngangsenhet/, 'inngangsenhet'],
  [/utgangsenhet/, 'utgangsenhet'],
  [/n[øo]kkelsafe/, 'nokkelsafe'],
  [/blinklampe|blinklys/, 'blinklampe'],
  [/magnetkontakt/, 'magnetkontakt'],
  [/n[øo]d[åa]pner|\bkac\b/, 'nodapner'],
  [/ranskontakt|overfallsknapp/, 'ranskontakt'],
  [/utpassering/, 'utpasseringsknapp'],
  [/fordeling|tavle|sikringsskap/, 'fordeling'],
  [/bevegelse|pir\b|tilstedev/, 'sensor'],
  [/lys\s*f[øo]ler|lux|skumring/, 'lysfoler'],
  [/termostat/, 'termostat'],
  [/varmekabel|gulvvarme/, 'varmekabel'],
  [/dimmer/, 'dimmer'],
  [/serievender|vekselbryter|trapp(e)?bryter|korsbryter/, 'serievender'],
  [/bryter.*2\s*-?\s*pol/, 'bryter-2pol'],
  [/bryter|str[øo]mstiller/, 'bryter'],
  [/stikk.*(3\s*-?\s*pol|industri|rundstift|cee|400\s*v)/, 'stikk-3fas'],
  [/stikk.*jord|jordet stikk/, 'stikk-jord'],
  [/stikk|uttak.*230/, 'stikk'],
  [/koblingsboks.*innfelt|innfelt.*koblingsboks/, 'koblingsboks-innfelt'],
  [/koblingsboks|boks.*p[åa]\s*vegg/, 'koblingsboks'],
  [/levert av andre|tilkoblingspunkt|fast tilkobl/, 'tilkobling'],
  [/elbil|lader/, 'elbillader'],
  [/komfyr|koketopp/, 'komfyr'],
  [/\bovn|panelovn|varmeovn/, 'ovn'],
  [/varmepumpe/, 'varmepumpe'],
  [/bereder|varmtvann/, 'bereder'],
  [/vifte|ventilasjon|avtrekk/, 'vifte'],
  [/downlight|spot/, 'downlight'],
  [/utelys|utebelysning|fasadelys/, 'utelys'],
  [/armatur|lysr[øo]r|lysliste/, 'armatur'],
  [/lyspunkt|lampeuttak|takpunkt|belysning/, 'lyspunkt'],
  [/data|tele|nettverk|rj\s*45|tv\b/, 'data'],
  [/r[øo]yk/, 'royk'],
]

export function punkttypeFraEtikett(etikett: string): string | null {
  const t = etikett.toLowerCase()
  for (const [re, type] of REGLER) if (re.test(t)) return type
  return null
}

/** «Tilleggssymbol for uttak montert i kanal», «Sammenkobling av kabler» o.l. er ikke punkter. */
export function erTilleggssymbol(etikett: string): boolean {
  return /tilleggssymbol|sammenkobling|skr[åa]stilte|angir ikke/i.test(etikett)
}

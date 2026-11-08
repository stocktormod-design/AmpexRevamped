import { RISIKO_ORD } from '../risiko-katalog'
import { JA_NEI_IA, type FormField, type FormSection, type FormTemplate } from './types'

/**
 * De 5 sikre — Ampex-maler v1.
 *
 * INNHOLDSSTATUS: UTKAST. Feltstrukturen følger DSB-malene fra gamleappen
 * (public/ordre-docs/), men punktene må kvalitetssikres av faglig ansvarlig
 * før dette brukes som reell dokumentasjon. reviewNote vises i UI til
 * malen er godkjent — fjernes ved faglig QA.
 *
 * Ingen felt er markert `required` ennå — det er en egen compliance-gjennomgang
 * (hvilke punkter forskriften faktisk krever), ikke noe som skal gjettes her.
 * Til den er gjort spør AI-utfylling (gap-check) aldri om manglende felt.
 */

const REVIEW = 'Ampex-mal (utkast). Faglig ansvarlig i firmaet må vurdere om malen passer arbeidet.'

/** Et tema i risikovurderingen: Ja/Nei-valget og seksjonen det slår på. */
function tema(key: string, label: string, title: string, fields: FormField[]): { valg: FormField; seksjon: FormSection } {
  const felt = `tema_${key}`
  return {
    valg: { key: felt, label, type: 'choice', choices: ['Ja', 'Nei'] },
    seksjon: { title, fields: fields.map(f => ({ ...f, showIf: { field: felt, equals: ['Ja'] } })) },
  }
}
const jn = (key: string, label: string, help?: string): FormField => ({ key, label, type: 'choice', choices: JA_NEI_IA, help })

/**
 * Temaene. Rekkefølgen er rekkefølgen i valget og i skjemaet. Ordene i `RISIKO_ORD`
 * (lib/risiko-katalog.ts) krysser av på forhånd når ordren nevner dem — montøren retter.
 */
const TEMAER = [
  tema('tavle', 'Arbeid i tavle eller sikringsskap', 'Tavle og sikringsskap', [
    jn('tavle_frakoblet', 'Er tavla frakoblet, sikret mot innkobling (lås og skilt) og prøvd spenningsløs?', 'FSE §§ 12–14'),
    jn('tavle_skjerm', 'Er deler som må stå på skjermet mot berøring?'),
    jn('tavle_vern', 'Er vern dimensjonert etter kabel og forlegning?', 'NEK 400-4-43, 5-52'),
  ]),
  tema('inntak', 'Inntak eller hovedsikring', 'Inntak', [
    jn('inntak_nettselskap', 'Er arbeidet avtalt med nettselskapet (plombering, frakobling)?'),
    jn('inntak_overspenning', 'Er overspenningsvern vurdert?', 'NEK 400-4-44, 5-534'),
    jn('inntak_last', 'Er lastberegning gjort for hovedsikringen?'),
  ]),
  tema('bad', 'Bad eller våtrom', 'Bad og våtrom', [
    jn('bad_soner', 'Er utstyret plassert etter sonene med riktig IP-grad?', 'NEK 400-7-701'),
    jn('bad_jordfeil', 'Har alle kurser i rommet jordfeilvern 30 mA?', 'NEK 400-7-701'),
    jn('bad_utjevning', 'Er tilleggsutjevning vurdert?', 'NEK 400-7-701'),
  ]),
  tema('varmekabel', 'Varmekabel eller gulvvarme', 'Varmekabel', [
    jn('varme_effekt', 'Passer W/m² for gulvet, og ligger kabelen ikke under faste innretninger?', 'NEK 400-7-753'),
    jn('varme_maling', 'Er isolasjonsmåling gjort før og etter støp/flislegging?'),
    jn('varme_dok', 'Er plasseringen dokumentert med bilde og tegning?'),
  ]),
  tema('elbil', 'Elbillader', 'Elbillading', [
    jn('elbil_rcd', 'Er jordfeilvernet type B, eller type A med 6 mA DC-deteksjon i laderen?', 'NEK 400-7-722, 5-53'),
    jn('elbil_kurs', 'Har hvert ladepunkt egen kurs?', 'NEK 400-7-722'),
    jn('elbil_last', 'Er lastberegning eller lastbalansering på plass?'),
  ]),
  tema('varmepumpe', 'Varmepumpe', 'Varmepumpe', [
    jn('vp_vern', 'Er kurs og vern etter produsentens krav?'),
    jn('vp_bryter', 'Er det sikkerhetsbryter ved utedelen?'),
    jn('vp_ip', 'Har utstyret ute riktig IP-grad?', 'NEK 400-5-51'),
  ]),
  tema('kjokken', 'Kjøkken eller komfyr', 'Kjøkken', [
    jn('kjokken_komfyrvakt', 'Er komfyrvakt montert?', 'NEK 400-4-42'),
    jn('kjokken_kurs', 'Har komfyren egen kurs dimensjonert etter effekten?'),
  ]),
  tema('ute', 'Utendørs', 'Utendørs', [
    jn('ute_ip', 'Har utstyret IP44 eller bedre, og tåler det kystklima?', 'NEK 400-5-51 (AD, AF)'),
    jn('ute_jordfeil', 'Har uttak ute jordfeilvern 30 mA?'),
  ]),
  tema('styring', 'Lysstyring, dimmer eller smarthus', 'Lysstyring', [
    jn('styring_last', 'Passer dimmeren lasten (LED-driver), med nedregulering ved flere i samme boks?'),
  ]),
  tema('hoyde', 'Arbeid i høyden', 'Arbeid i høyden', [
    jn('hoyde_utstyr', 'Er stige eller plattform kontrollert og riktig for jobben?'),
    jn('hoyde_to', 'Er det to personer ved tunge løft i høyden?'),
  ]),
  tema('eldre', 'Eldre bygg eller rehabilitering', 'Eldre bygg', [
    jn('eldre_asbest', 'Er byggeår og materialer avklart (mulig asbest)?'),
    jn('eldre_kabelsok', 'Er det søkt etter skjulte kabler og rør før boring?'),
  ]),
]

export const risikovurdering: FormTemplate = {
  id: 'ampex.risikovurdering',
  // v2 (30.10): temavalg øverst, seksjoner per tema. v1-nøklene står uendret, og temaseksjonene
  // er skjult uten valg, så et v1-dokument leses akkurat som før.
  version: 2,
  name: 'Risikovurdering',
  source: 'Basert på DSB «Rapport fra risikovurdering» (fel § 16, fse)',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Anlegg og arbeid',
      fields: [
        { key: 'kunde', label: 'Kunde/eier', type: 'text', prefill: 'customerName' },
        { key: 'adresse', label: 'Anleggsadresse', type: 'text', prefill: 'address' },
        { key: 'arbeid', label: 'Beskrivelse av arbeidet', type: 'multiline', prefill: 'orderTitle' },
        { key: 'dato', label: 'Dato', type: 'text', prefill: 'today' },
        { key: 'utfort_av', label: 'Vurdering utført av', type: 'text' },
      ],
    },
    {
      title: 'Jobben inneholder',
      fields: TEMAER.map(x => x.valg),
      velger: { match: Object.fromEntries(TEMAER.map(x => [x.valg.key, RISIKO_ORD[x.valg.key.slice(5) as keyof typeof RISIKO_ORD]])) },
    },
    {
      title: 'Farevurdering',
      fields: [
        { key: 'spenningslost', label: 'Kan arbeidet utføres spenningsløst (AUS unngås)?', type: 'choice', choices: JA_NEI_IA },
        { key: 'beroring', label: 'Fare for berøring av spenningssatte deler?', type: 'choice', choices: JA_NEI_IA },
        { key: 'kortslutning', label: 'Kortslutningsfare ved arbeidsstedet?', type: 'choice', choices: JA_NEI_IA },
        { key: 'hoyde', label: 'Arbeid i høyden / vanskelig adkomst?', type: 'choice', choices: JA_NEI_IA },
        { key: 'miljo', label: 'Særskilte forhold (fukt, brann-/eksplosjonsfare, barn/dyr)?', type: 'choice', choices: JA_NEI_IA },
        { key: 'verneutstyr', label: 'Er nødvendig verneutstyr tilgjengelig og vurdert?', type: 'choice', choices: JA_NEI_IA },
      ],
    },
    ...TEMAER.map(x => x.seksjon),
    {
      title: 'Tiltak og konklusjon',
      fields: [
        { key: 'tiltak', label: 'Risikoreduserende tiltak', type: 'multiline', placeholder: 'Frakobling, sperring, merking, verneutstyr …' },
        { key: 'konklusjon', label: 'Konklusjon', type: 'choice', choices: ['Arbeidet kan utføres', 'Krever ytterligere tiltak'] },
      ],
    },
  ],
}

export const samsvarserklaering: FormTemplate = {
  id: 'ampex.samsvar',
  version: 1,
  name: 'Samsvarserklæring',
  source: 'fel § 12, erklæring om at anlegget er utført iht. forskrift',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Anlegg',
      fields: [
        { key: 'eier', label: 'Eier/bruker av anlegget', type: 'text', prefill: 'customerName' },
        { key: 'adresse', label: 'Anleggsadresse', type: 'text', prefill: 'address' },
        { key: 'arbeid', label: 'Arbeidet omfatter', type: 'multiline', prefill: 'orderDescription' },
      ],
    },
    {
      title: 'Erklæring',
      fields: [
        { key: 'norm', label: 'Benyttet norm', type: 'choice', choices: ['NEK 400:2022', 'NEK 400 + avvik (beskriv under)', 'Annen norm (beskriv under)'] },
        { key: 'norm_kommentar', label: 'Utdyping norm/avvik', type: 'multiline', placeholder: 'Kun ved avvik eller annen norm' },
        {
          key: 'erklaering_info',
          label: 'Det erklæres at arbeidet er planlagt, utført og kontrollert i samsvar med forskrift om elektriske lavspenningsanlegg (fel), og at anlegget er overlevert i sikker stand. «Fullfør» nedenfor gjelder som signatur med navn, firma og tidspunkt.',
          type: 'info',
        },
      ],
    },
  ],
}

export const sluttkontroll: FormTemplate = {
  id: 'ampex.sluttkontroll',
  version: 1,
  name: 'Sluttkontroll',
  source: 'Basert på DSB «Rapport fra sluttkontroll» (NEK 400-6)',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Kontrollpunkter',
      fields: [
        { key: 'visuell', label: 'Visuell kontroll utført (kap. 61)', type: 'choice', choices: JA_NEI_IA },
        { key: 'kontinuitet', label: 'Kontinuitet i beskyttelsesleder/utjevning målt', type: 'choice', choices: JA_NEI_IA },
        { key: 'isolasjon', label: 'Isolasjonsresistans målt', type: 'choice', choices: JA_NEI_IA },
        { key: 'isolasjon_verdi', label: 'Måleverdi isolasjonsresistans (MΩ)', type: 'text', placeholder: 'f.eks. >200' },
        { key: 'jordfeilbryter', label: 'Jordfeilbryter funksjonstestet', type: 'choice', choices: JA_NEI_IA },
        { key: 'vern', label: 'Vern kontrollert mot belastning/kortslutningsstrøm', type: 'choice', choices: JA_NEI_IA },
        { key: 'funksjonstest', label: 'Funksjonstest av anlegget utført', type: 'choice', choices: JA_NEI_IA },
      ],
    },
    {
      title: 'Resultat',
      fields: [
        { key: 'avvik', label: 'Avvik/merknader', type: 'multiline' },
        { key: 'instrument', label: 'Måleinstrument (fabrikat/type)', type: 'text' },
        { key: 'dato', label: 'Kontrolldato', type: 'text', prefill: 'today' },
      ],
    },
  ],
}

export const kursfortegnelse: FormTemplate = {
  id: 'ampex.kursfortegnelse',
  version: 1,
  name: 'Kursfortegnelse',
  source: 'Basert på DSB «Kursfortegnelse» (NEK 400)',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Fordeling',
      fields: [
        { key: 'fordeling', label: 'Fordeling/tavle', type: 'text', placeholder: 'f.eks. Hovedfordeling garasje' },
        { key: 'adresse', label: 'Anleggsadresse', type: 'text', prefill: 'address' },
      ],
    },
    {
      title: 'Kurser',
      fields: [
        {
          key: 'kurser',
          label: 'Kurs',
          type: 'table',
          columns: [
            { key: 'nr', label: 'Kurs nr' },
            { key: 'vern', label: 'Vern (A)' },
            { key: 'kabel', label: 'Kabel/ledning' },
            { key: 'forsyner', label: 'Forsyner' },
          ],
        },
      ],
    },
  ],
}

export const utstyrsdokumentasjon: FormTemplate = {
  id: 'ampex.utstyr_fel36',
  version: 1,
  name: 'Utstyrsdokumentasjon',
  source: 'fel § 36, dokumentasjon av installert utstyr (FDV)',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Installert utstyr',
      fields: [
        {
          key: 'utstyr',
          label: 'Utstyr',
          type: 'table',
          columns: [
            { key: 'fabrikat', label: 'Fabrikat/type' },
            { key: 'elnummer', label: 'El-nummer' },
            { key: 'plassering', label: 'Plassering' },
          ],
        },
        { key: 'fdv_overlevert', label: 'FDV-dokumentasjon overlevert kunde', type: 'choice', choices: ['Ja', 'Nei'] },
        { key: 'kommentar', label: 'Kommentar', type: 'multiline' },
      ],
    },
  ],
}

/**
 * «SJA – elbillader og tavle» (04.11.2026).
 *
 * Tormod: «når du gjør en risikovurdering skal du få noen spørsmål først, så
 * resten er tilpasset — hvis det ikke er elbillader får du ingen spørsmål om
 * laderen.»
 *
 * Inntaket er formens FØRSTE DEL, ikke et eget flagg i formatet. Betingelser
 * kan bare peke oppover (`validateFirmSections`), så det som står først er per
 * definisjon det som styrer resten. Det holder lagringsformatet uendret og
 * gjør regelen synlig i byggeren: «Innledende spørsmål» er del 1, og alt
 * nedenfor kan henvise til svarene der.
 *
 * Bare Ja/Nei i inntaket: et «Ikke aktuelt» ville gjort hvert eneste
 * oppfølgingsspørsmål betinget av en tredje verdi ingen husker å krysse av.
 */
const JN: string[] = ['Ja', 'Nei']

export const sjaElbilTavle: FormTemplate = {
  id: 'ampex.sja-elbil-tavle',
  version: 1,
  name: 'SJA – elbillader og tavle',
  source: 'Ampex-mal · inntak først, resten tilpasses svarene',
  reviewNote: REVIEW,
  sections: [
    {
      title: 'Innledende spørsmål',
      fields: [
        { key: 'sja_elbil', label: 'Skal det monteres elbillader?', type: 'choice', choices: JN },
        { key: 'sja_spenning', label: 'Skal du arbeide i tavle under spenning?', type: 'choice', choices: JN },
        { key: 'sja_hoyde', label: 'Skal du arbeide i høyden?', type: 'choice', choices: JN },
        { key: 'sja_bad', label: 'Er arbeidet i bad eller våtrom?', type: 'choice', choices: JN },
      ],
    },
    {
      title: 'Elbillader',
      fields: [
        {
          key: 'sja_elbil_vern',
          label: 'Er vernet type B, eller type A med 6 mA DC-deteksjon?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_elbil', equals: ['Ja'] },
        },
        {
          key: 'sja_elbil_kurs',
          label: 'Har ladepunktet egen kurs?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_elbil', equals: ['Ja'] },
        },
        {
          key: 'sja_elbil_last',
          label: 'Er lastberegning eller lastbalansering gjort?',
          type: 'choice', choices: JN,
          showIf: { field: 'sja_elbil', equals: ['Ja'] },
        },
        {
          key: 'sja_elbil_kabel',
          label: 'Kabeltype og tverrsnitt til ladepunktet',
          type: 'text',
          showIf: { field: 'sja_elbil', equals: ['Ja'] },
        },
      ],
    },
    {
      title: 'Tavle under spenning',
      fields: [
        {
          key: 'sja_tavle_frakobling',
          label: 'Er anlegget gjort spenningsløst, låst og prøvd?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_spenning', equals: ['Ja'] },
        },
        {
          key: 'sja_tavle_verneutstyr',
          label: 'Er verneutstyr og verktøy kontrollert?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_spenning', equals: ['Ja'] },
        },
        {
          key: 'sja_tavle_tiltak',
          label: 'Tiltak før arbeidet starter',
          type: 'multiline',
          showIf: { field: 'sja_spenning', equals: ['Ja'] },
        },
      ],
    },
    {
      title: 'Arbeid i høyden',
      fields: [
        {
          key: 'sja_hoyde_utstyr',
          label: 'Er stige eller stillas kontrollert?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_hoyde', equals: ['Ja'] },
        },
        {
          key: 'sja_hoyde_sikring',
          label: 'Er området under sikret?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_hoyde', equals: ['Ja'] },
        },
      ],
    },
    {
      title: 'Bad og våtrom',
      fields: [
        {
          key: 'sja_bad_soner',
          label: 'Er utstyret plassert etter sonene med riktig IP-grad?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_bad', equals: ['Ja'] },
        },
        {
          key: 'sja_bad_jordfeil',
          label: 'Har alle kurser i rommet jordfeilvern 30 mA?',
          type: 'choice', choices: JN, required: true,
          showIf: { field: 'sja_bad', equals: ['Ja'] },
        },
      ],
    },
    {
      title: 'Vurdering',
      fields: [
        { key: 'sja_konklusjon', label: 'Oppsummering av risiko og tiltak', type: 'multiline', required: true },
        { key: 'sja_utfort_av', label: 'Utført av', type: 'text', required: true },
      ],
    },
  ],
}

/** De 5 sikre i visningsrekkefølge (samme som gamleappen) */
export const AMPEX_TEMPLATES: FormTemplate[] = [
  risikovurdering,
  sjaElbilTavle,
  samsvarserklaering,
  sluttkontroll,
  kursfortegnelse,
  utstyrsdokumentasjon,
]

export function getTemplate(id: string): FormTemplate | undefined {
  return AMPEX_TEMPLATES.find(t => t.id === id)
}

import { FormTemplate, JA_NEI_IA } from './types'

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

export const risikovurdering: FormTemplate = {
  id: 'ampex.risikovurdering',
  version: 1,
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

/** De 5 sikre i visningsrekkefølge (samme som gamleappen) */
export const AMPEX_TEMPLATES: FormTemplate[] = [
  risikovurdering,
  samsvarserklaering,
  sluttkontroll,
  kursfortegnelse,
  utstyrsdokumentasjon,
]

export function getTemplate(id: string): FormTemplate | undefined {
  return AMPEX_TEMPLATES.find(t => t.id === id)
}

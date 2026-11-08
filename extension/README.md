# Ampex-utvidelsen

EFObasen er katalogen, Ampex er handlekurven. På `efobasen.efo.no/produkt/<elnr>`
viser utvidelsen firmaets grossistpriser (fra prisfilene, samme prisbilde som
appen: `lib/pricing.ts`) og legger valgt antall i handlelista for valgt grossist
— den samme lista som i appen (`lib/bestilling.ts`, synkes til telefonene).
Utsending skjer som før: PDF på e-post (`lib/bestilling-send.ts`), EDI senere.

Vi leser bare el-nummeret av adressen (`elnummerFraEfobasen`) og legger en egen
boks over siden. Vi henter, lagrer eller endrer ingenting av EFObasens innhold.

    npm run utvidelse:bygg        → extension/dist

Installer: chrome://extensions → Utviklermodus på → «Last inn upakket» → velg
`extension/dist`. Trykk Ampex-ikonet og logg inn med Ampex-kontoen.
(Chrome godtar ikke lenger `--load-extension` fra kommandolinja.)

Ikke gjort: EFObasens brukervilkår er ikke lest (siden er en SPA) — les dem før
utvidelsen gis til flere enn piloten. Ikke i Chrome Web Store (5 USD engang).

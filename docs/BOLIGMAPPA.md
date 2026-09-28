# Boligmappa — hva som er verifisert, og hva som står igjen

Sandkassetilgang mottatt 2026-09-11 (Shaibal Sarkar, Technical Lead Professional
Services). Alt under er PRØVD mot den levende sandkassen, ikke lest ut av
dokumentasjonen — og der de to er uenige, står målingen. Sist kjørt 2026-09-15:
`npm run verify:boligmappa -- --opprett --fil`.

## Tre tjenester på tre verter

| | URL (staging) |
|---|---|
| Auth (Keycloak) | `testauth.boligmappa.no/auth/realms/professional-realm-staging/protocol/openid-connect` |
| Jobs API | `staging-jobs.boligmappa.no/api/v1` — jobber, og kobling av fil til jobb |
| Proff API | `staging-proff-api.boligmappa.no/v1` — gate-/adresse-/eiendomssøk, plant, filer |
| Portal (innlogging som firma) | `testbedrift.boligmappa.no` → `staging-pro.boligmappa.no` |

Gatesøket ligger på **proff-api** (`/v1/search/streets`), ikke på noen egen
søkevert. Det er de to øverste radene som gjelder for alt vi gjør.

**Timen jeg brukte på ingenting:** alt gikk først mot proff-api og fikk
`403 Missing Authentication Token`. Det er AWS API Gateway sitt språk for **ruten
finnes ikke** — ikke for manglende token. Jobs-endepunktene ligger på en annen
vert. Får du den meldingen: sjekk verten før du sjekker tokenet.

Jobs API har åpen spesifikasjon på `/swagger/v1/swagger.json`. Proff API har det
ikke (den ligger bak gatewayen) — den er kun dokumentert på Stoplight.

**Stoplight-sidene lar seg ikke lese med `curl` eller `WebFetch`** — de rendres
i nettleseren, så du får bare tittelen. Headless Chrome får ut alt:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --user-data-dir=/tmp/sl --virtual-time-budget=20000 --dump-dom \
  "https://boligmappa.stoplight.io/docs/professional-apis/…" > side.html
```

Det var slik hele filveien under ble funnet, etter at to runder med spørsmål på
helpdesken bare ga de samme ulesbare lenkene tilbake.

## Innlogging: tre flyter, og bare én virker i dag

- `client_credentials` — **sperret** til Onboarding-API-et. Keycloak svarer
  «Client not enabled to retrieve service account». Dokumentasjonen sier det
  samme: *«This grant should only be used when accessing our Onboarding APIs.»*
- `authorization_code` — den de peker på for Proff/Jobs. **Delvis rettet
  2026-09-15:** Shaibal registrerte `ampex://oauth` på `ampex-staging` (svar i
  IPI-90), og `/auth`-endepunktet gir nå en ekte innloggingsside for den i
  stedet for `Invalid parameter: redirect_uri`. Vår andre oppgitte adresse,
  `http://localhost:8081` (lokal utvikling), står IKKE registrert ennå — samme
  feil som før. Spurt Shaibal om å legge til den også.
- `password` — **virker**. Token 1800 s, refresh 86 400 s. Det er derfor de
  sendte en testbruker sammen med klientnøklene.

Password grant er sandkassevei. I produksjon logger montøren inn hos Boligmappa
(authorization code) og vi lever på refresh-tokenet — passord skal aldri ligge
i appen.

## Verifisert som virker

- innlogging med password grant
- `GET /v1/jobs` — jobbliste i testkontoen (Elektro Sør, orgnr 980684989)
- `GET /v1/jobs/{nr}` — enkeltjobb
- ukjent jobbnummer avvises
- gate- og adressesøk, og eiendommene på en adresse
- oppretting av jobb, plant og fil, opplasting av innhold og kobling til jobben

## To feller i svarformatet

1. **Enkeltjobben er pakket i `{success, response}`. Lista er ikke.** Samme API,
   to konvolutter.
2. **`jobNumber` er streng i enkeltjobben og tall i lista.** `===` over de to
   er alltid usant.

Begge normaliseres i `lib/boligmappa/klient.ts`.

## Oppretting

`status` må være `InProgress` ved oppretting. `Done`, `Pending` og utelatt gir
alle `INVALID_JOB_STATUS`. Ferdigstilling skjer etterpå med
`PUT /v1/jobs/{jobNumber}/status`.

Svaret er **ikke** en hel jobb, bare `{jobNumber, version}`, og det er pakket i
`{success, response}`. Leser du `jobNumber` rett av svaret, får du `undefined`.

## Hele veien fra ferdig jobb til fil i mappa — LØST 2026-09-15

Filene går gjennom **Proff API**, ikke Jobs API, og mellomleddet heter **plant**
— et arbeidsrom firmaet får på eiendommen. Det ordet står ikke nevnt noe sted i
Jobs-API-et, og det var derfor kjeden ikke lot seg gjette: uten plant finnes det
ingen fil-ID å gi til `POST /jobs/{nr}/files`.

```
GET  /v1/search/streets?q=Oslo gate          → id «301-15449»
GET  /v1/streets/{id}/addresses              → id «301-15449-1-A»
GET  /v1/addresses/{id}/properties           → boligmappaNumber   (markørpaginert)
POST /v1/plants {boligmappaNumber}           → plantId
POST /v1/plants/{bmNr}/files  (metadata)     → {id, uploadLink}
PUT  {uploadLink}             (bytes)        → fila er lastet opp
POST /jobs/{jobbNr}/files {files:[id]}       → koblet til jobben
```

Kjørt ende til ende mot sandkassen 2026-09-15:
`npm run verify:boligmappa -- --opprett --fil`. Alt grønt.

**Fem ting som ikke står i dokumentasjonen, og som kostet tid:**

1. `POST /plants` er **ikke** idempotent, selv om doksene sier «returns the
   existing one». Finnes plantet, får du `409 PLANT_ALREADY_EXISTS`. Bruk
   `sikrePlant()`, som svelger den.
2. `documentType` er **påkrevd** i filmetadataen. Utelates den, svarer API-et
   `INVALID_REQUEST` uten å si hvilket felt det gjelder. `orderNumber`,
   `chapterTags` og `description` er derimot valgfrie, og `name`/`tagName` inne
   i objektene trengs ikke — bare `id`.
3. Opplastingen er **to steg**. Fila teller ikke som lastet opp før både
   metadataen er sendt og bytesene ligger på `uploadLink`.
4. `uploadLink` er forhåndssignert og bærer sin egen autorisasjon.
   `Authorization`-hodet skal **ikke** med — S3 avviser signaturen da. Bytesene
   går som rå kropp i en PUT, ikke som skjemadata (deres egen prosatekst sier
   «form data», men deres eget kodeeksempel sender `body: f["file"]`).
5. Lista over filer på plantet henger **et par sekunder** etter opplastingen.
   Sjekker du med én gang, er fila ikke der.

S3-bøtta portalen laster til (`staging-boligmappa-documents`) viste seg å være
den samme som partner-API-et gir oss en signert lenke til. Den mistanken i
forrige versjon av dette dokumentet — at det var deres interne vei og ikke vår —
var altså feil.

## PROPERTY_NOT_FOUND: det er ikke plantet, det er eiendommen

Årsaken er avklart, og den er ikke det vi trodde. Målt 2026-09-15:

| Eiendom | Hvor den kom fra | `POST /plants` | Jobboppretting |
|---|---|---|---|
| OON4288, VEL1760 + 9 til | kontoens egne jobber | `INVALID_BOLIGMAPPA_NUMBER` | `PROPERTY_NOT_FOUND` |
| FPH4639/46/53/60 | **søket**, på 301-15449-1-A | `500 EXCEPTION_OCCURRED` | `PROPERTY_NOT_FOUND` |
| ABH8615, ABH8622 | Boligmappas **eget doc-eksempel**, samme adresse | virker | virker |

To ting følger av tabellen:

- Numrene på kontoens egne jobber er produksjonsdata som ikke finnes i staging.
  Det er dette Shaibal mente, og det er ikke en feil vi kan rette.
- **Søket og eiendomsbasen er ikke enige i staging.** For nøyaktig samme adresse
  gir søke-endepunktet FPH46xx, mens Boligmappas egen dokumentasjon oppgir
  ABH86xx. Bare de siste virker. Følger man oppskriften Shaibal viste til, lander
  man altså på numre som ikke kan brukes til noe. Meldt inn 2026-09-15.

Plantet er **ikke** en forutsetning for jobboppretting — testet direkte:
jobb på ABH8622 går like fint før som etter at plantet er opprettet.

`verify:boligmappa` bruker derfor ett av de tjue numrene Boligmappa selv oppga
(`ACQ3920`), overstyrbart med `BOLIGMAPPA_TEST_EIENDOM`. Se avsnittet nederst.

## Lukket 2026-09-15, kveld — ingenting står igjen hos Boligmappa

Shaibal svarte i IPI-90 og løste begge de gjenstående:

1. **`http://localhost:8081` er registrert.** Årsaken til at den ikke ble lagt
   inn første gang var vår: adressen i e-posten vår var pakket inn i Googles
   klikksporing (`google.com/url?q=…`), så han registrerte den innpakningen.
   Verifisert: `/auth` godtar nå BEGGE våre URI-er uten
   «Invalid parameter: redirect_uri».
2. **Tjue gyldige boligmappanumre oppgitt**, med «there are issues with the data
   in staging»:
   `ACQ3920 ACQ3937 ACQ3944 ACQ3982 ACQ3999 ACQ4002 ACQ4019 ACQ4026 ACQ4033`
   `ACQ4040 ACQ4057 ACQ4064 ACQ4071 ACQ4088 ACQ4095 AEY7417 AEY7424`
   `AQZ0638 AQZ0645 AQZ0652`

   `verify:boligmappa` bruker `ACQ3920`. Hele kjeden kjørt på den samme kveld:
   plant 373117, jobb 5348998, fil 632755 lastet opp og koblet. Alt grønt.
3. Han tar med rettelsene i dokumentasjonen (plant er ikke idempotent,
   `documentType` er påkrevd).

**Søkefeilen består** — den er bare ikke vår blokker lenger. `GET
/addresses/301-15449-1-A/properties` returnerer fortsatt FPH46xx, som `POST
/plants` svarer 500 på. Deres egen anbefalte oppskrift leder altså fremdeles til
ubrukelige numre i staging; vi går utenom med de oppgitte.

**En felle å kjenne til:** å bare LESE et nummer skiller ikke gyldig fra
ugyldig. `GET /plants/{nr}/files` svarer `PLANT_NOT_FOUND` både for et gyldig
nummer uten arbeidsrom og for et nummer basen ikke kjenner. Det er `POST
/plants` som avslører forskjellen (`INVALID_BOLIGMAPPA_NUMBER` eller 500). Jeg
«verifiserte» først alle tjue med en lesing og fikk 20 av 20 — det tallet var
verdiløst.

## Det viktigste for produktet

`boligmappaNumber` bestemmer hvilken eiendom. Har vi nummeret, slipper vi
adressematching mot matrikkelen — som er der denne typen integrasjon pleier å
dø. Spørsmålet blir da hvordan montøren får tak i nummeret: søk (searchapi),
eller at kunden oppgir det.

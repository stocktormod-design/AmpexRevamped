# Boligmappa — hva som er verifisert, og hva som står igjen

Sandkassetilgang mottatt 2026-09-11 (Shaibal Sarkar, Technical Lead Professional
Services). Alt under er PRØVD mot den levende sandkassen samme dag, ikke lest ut
av dokumentasjonen. Kjør `npm run verify:boligmappa`.

## Tre tjenester på tre verter

| | URL (staging) |
|---|---|
| Auth (Keycloak) | `testauth.boligmappa.no/auth/realms/professional-realm-staging/protocol/openid-connect` |
| Jobs API | `staging-jobs.boligmappa.no/api/v1` |
| Proff API | `staging-proff-api.boligmappa.no/v1` |
| Søk | `staging-searchapi.boligmappa.no/api/v1` |
| Portal (innlogging som firma) | `testbedrift.boligmappa.no` → `staging-pro.boligmappa.no` |

**Timen jeg brukte på ingenting:** alt gikk først mot proff-api og fikk
`403 Missing Authentication Token`. Det er AWS API Gateway sitt språk for **ruten
finnes ikke** — ikke for manglende token. Jobs-endepunktene ligger på en annen
vert. Får du den meldingen: sjekk verten før du sjekker tokenet.

Jobs API har åpen spesifikasjon på `/swagger/v1/swagger.json`. Proff API har det
ikke (den ligger bak gatewayen).

## Innlogging: tre flyter, og bare én virker i dag

- `client_credentials` — **sperret** til Onboarding-API-et. Keycloak svarer
  «Client not enabled to retrieve service account». Dokumentasjonen sier det
  samme: *«This grant should only be used when accessing our Onboarding APIs.»*
- `authorization_code` — den de peker på for Proff/Jobs, men klienten
  `ampex-staging` har **ingen redirect-URI registrert**. Hver adresse vi prøvde
  ga `Invalid parameter: redirect_uri`. Flyten kan ikke starte.
- `password` — **virker**. Token 1800 s, refresh 86 400 s. Det er derfor de
  sendte en testbruker sammen med klientnøklene.

Password grant er sandkassevei. I produksjon logger montøren inn hos Boligmappa
(authorization code) og vi lever på refresh-tokenet — passord skal aldri ligge
i appen.

## Verifisert som virker

- innlogging med password grant
- `GET /v1/jobs` — 12 jobber i testkontoen (Elektro Sør, orgnr 980684989)
- `GET /v1/jobs/{nr}` — enkeltjobb
- ukjent jobbnummer avvises

## To feller i svarformatet

1. **Enkeltjobben er pakket i `{success, response}`. Lista er ikke.** Samme API,
   to konvolutter.
2. **`jobNumber` er streng i enkeltjobben og tall i lista.** `===` over de to
   er alltid usant.

Begge normaliseres i `lib/boligmappa/klient.ts`.

## Oppretting: to sperrer, én løst

**Løst:** `status` må være `InProgress` ved oppretting. `Done`, `Pending` og
utelatt gir alle `INVALID_JOB_STATUS`. Ferdigstilling skjer etterpå med
`PUT /v1/jobs/{jobNumber}/status`.

**Åpent:** med gyldig status svarer tjenesten `PROPERTY_NOT_FOUND` — også for
boligmappanumre som ALLEREDE har jobber i samme konto (OON4288, VEL1760). Det er
ikke noe vi kan rette selv.

## Filopplasting er ikke løst

`POST /v1/jobs/{jobNumber}/files` tar **fil-ID-er, ikke innhold**. Hvor en fil
får sin ID står ikke i noen publisert spesifikasjon: Proff API har ingen
fil-seksjon, og portalen laster rett til en S3-bøtte
(`staging-boligmappa-documents`) og registrerer fila etterpå gjennom sitt eget
BFF. Det er deres interne vei, ikke partner-API-et, og skal ikke kopieres.

## Spurt Boligmappa om (2026-09-11)

1. Registrer redirect-URI på `ampex-staging` (`ampex://oauth` for appen,
   `http://localhost:8081` for utvikling) så authorization code kan brukes.
2. `PROPERTY_NOT_FOUND` ved oppretting på eiendommer som finnes i kontoens egne
   jobber — hva mangler?
3. Hvilket endepunkt laster opp en fil og returnerer `fileId`?

## Det viktigste for produktet

`boligmappaNumber` bestemmer hvilken eiendom. Har vi nummeret, slipper vi
adressematching mot matrikkelen — som er der denne typen integrasjon pleier å
dø. Spørsmålet blir da hvordan montøren får tak i nummeret: søk (searchapi),
eller at kunden oppgir det.

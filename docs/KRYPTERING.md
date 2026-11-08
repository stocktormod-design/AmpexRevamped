# Kryptering — innholdet er uleselig selv om Supabase og R2 lekker

Status: **design, ikke kodet.** Skrevet 2026-11-07 etter samtale med Tormod. Ingen kode,
migrasjon eller endring i synken før han har sagt ja til rekkefølgen nederst.

## Løftet

> Lekker hele databasen vår og hele R2, får angriperen bare støy. Ikke engang Ampex kan
> lese firmaets kunder, priser, skjema, tegninger eller skann.

Det er salgsargumentet mot elektrofirmaene (de har ingen egen database — vår må være
skuddsikker) og mot grossistene (kundens nettopriser er det de vokter hardest, se
`GROSSIST_AVTALE.md`).

**Formuleringen som er sann:** «kryptert med firmaets egen nøkkel — selv om serverne våre
brytes, er innholdet uleselig». **Ikke** «umulig å hacke». Se trusselmodellen.

## Hva vi har i dag, og hvorfor det ikke holder

- Supabase og R2 krypterer disken (AES-256) og all trafikk går over TLS. Det beskytter mot
  stjålne disker, ikke mot noen som kommer inn i databasen: lekket service-nøkkel, SQL-feil,
  feil i RLS, innbrudd hos Supabase/Cloudflare. Da leses alt i klartekst.
- Base64 er ikke kryptering — det er en annen skrivemåte av samme data.

## Hvorfor dette passer Ampex spesielt godt

Appen er offline-først (CLAUDE.md regel 2): telefonen har all data lokalt i WatermelonDB og
gjør søk, summering og visning selv. Serveren er i praksis en postkasse for synk. En postkasse
kan bære forseglede konvolutter uten at noe annet endrer seg for montøren.

## Nøkkelmodellen

```
Gjenopprettingsnøkkel (eier, papir/QR) ─┐
Enhetsnøkkel (Keychain/WebCrypto) ──────┼─ pakker inn ─▶ Firmanøkkel (CDK, v1, v2 …)
                                        │                     │
Firmaets nøkkelpar (X25519) ◀───────────┘                     ├─ krypterer felt i rader
   offentlig del ligger på serveren                           └─ pakker inn filnøkler (R2)
```

| Nøkkel | Hva | Hvor den bor | Serveren ser |
|---|---|---|---|
| **Firmanøkkel (CDK)** | 256-bit symmetrisk, XChaCha20-Poly1305 | Bare på godkjente enheter, i minnet/Keychain | Kun innpakkede kopier |
| **Enhetsnøkkel** | Nøkkelpar per enhet. iPhone: Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), helst Secure Enclave (P-256). Kontor: WebCrypto, `extractable: false`, i IndexedDB | Forlater aldri enheten | Bare offentlig del |
| **Firmaets nøkkelpar** | X25519 for *innkommende* data (prisfiler, e-post) | Privat del innpakket som CDK; offentlig del i klartekst | Offentlig del |
| **Filnøkkel** | Tilfeldig per fil i R2 | Innpakket med CDK, i raden som peker på fila | Kun innpakket |
| **Gjenopprettingsnøkkel** | 256-bit, vist én gang som QR + 24 ord | Hos eier, utskrevet, i safen | Kun CDK innpakket med den |

Bibliotek: libsodium på begge flater (`react-native-libsodium` i appen, `libsodium-wrappers`
på kontoret) så formatet er bit-likt. Ikke egen krypto.

### Livsløp

1. **Firma opprettes:** eiers telefon lager CDK + firmaets nøkkelpar + gjenopprettingsnøkkel.
   Eier MÅ bekrefte at gjenopprettingsnøkkelen er skrevet ut/lagret før firmaet kan brukes.
2. **Ny ansatt / ny enhet:** logger inn → enheten lager nøkkelpar og legger offentlig del i
   `enhet_nokler` med status «venter». Eier/admin får varsel → «Godkjenn Ola sin iPhone»
   → godkjennerens enhet pakker CDK for den nye enheten. Før godkjenning ser den nye enheten
   bare metadata. (Dette er også en sikkerhetsgevinst: et stjålet passord alene gir ingenting.)
3. **Enhet mistet / ansatt slutter:** enheten trekkes tilbake → ny CDK-versjon lages og pakkes
   for gjenværende enheter. Nye skriv bruker ny versjon. Gamle data leses fortsatt med gammel
   versjon (de var uansett på enheten); full omkryptering er en valgfri bakgrunnsjobb.
4. **Alle enheter tapt:** eier skriver inn gjenopprettingsnøkkelen på ny enhet → CDK pakkes
   ut. **Uten den er dataene tapt for alltid.** Det må stå svart på hvitt ved oppstart —
   det er prisen for «ikke engang Ampex kan lese det».

## Hva krypteres og hva står i klartekst

Prinsipp: **innhold krypteres, struktur står åpent.** Synk og RLS trenger å vite hvem som eier
en rad og når den endret seg — ikke hva som står i den.

Hver tabell får én kolonne `enc bytea` (krypterte felt som én JSON-klump) + `enc_v int`
(CDK-versjon). De krypterte feltene fjernes fra skjemaet når tabellen er migrert.

| Alltid klartekst | Krypteres |
|---|---|
| `id`, `company_id`, `created_at`, `updated_at`, `deleted_at`, `created_by` | Navn, adresser, telefon, e-post på kunder (`customers`) |
| Fremmednøkler (`order_id`, `project_id` …) | Ordretekst, beskrivelser, notater (`orders`, `tasks`, `activities`) |
| Status-enum der synk/varsel trenger den | Skjemasvar, kommentarer, avvik (`form_*`, `deviations`, `ik_*`) |
| El-nummer og felles katalog (`katalog_varer` — offentlig uansett) | Firmaets priser og rabatter (`product_prices`, prisfiler) |
| `profiles.role` (RLS trenger den) | Timer med tekst, materialer, tilbud (`time_entries`, `order_materials`, `quote*`) |
| | Tegningsmarkering, rom, markører (`drawing_markup`, `rooms`, `mesh_markers`) |
| | Chat (`firma_chat`), læretid-logg og bilder |

Telemetri vi selv trenger for drift (`skannlogg`, `tilbakemelding`, `voice_usage`) står i
klartekst — det er driftsdata brukeren sender bevisst, ikke kundedata. Det må stå i
personvernerklæringen.

**Unike nøkler på krypterte felt** (f.eks. «samme kunde-orgnr to ganger»): blind indeks —
`HMAC(CDK-avledet nøkkel, orgnr)` i egen kolonne. Bare der det faktisk trengs.

## Filer i R2

- Hver fil krypteres med egen filnøkkel, i **blokker à 1 MB** (libsodium secretstream). Da
  kan store filer strømmes og en del av fila leses uten å laste ned alt.
- Tegningsfliser: hver flis er egen fil, krypteres for seg, dekrypteres på enheten rett før
  pdf.js/render-core. Må bygges inn i render-core, ikke limes på — og flisgrensen på iOS
  (4096 px) er uendret.
- Filnavn i R2 blir tilfeldige id-er; originalt filnavn ligger kryptert i raden.
- Et R2-brudd alene gir ingenting. Et brudd på både R2 og database gir heller ingenting uten CDK.

## Det som må flytte eller endre seg

| I dag | Med kryptering |
|---|---|
| Stemme-AI (`ai-voice`, Gemini Live) | Telefonen dekrypterer og sender bare det samtalen trenger. **Lagret kryptert, men AI-en ser innholdet under samtalen.** Si det ærlig |
| `laeretid-ai`, `regnskap` (Tripletex), `delt-ordre`, `epost-videresend` | Gjennomgås én og én: flyttes til klienten, eller får engangstilgang til akkurat det jobben trenger. Tripletex-kallet kan gå fra kontorappen |
| Prisfiler / e-post inn (Worker, sFTP-henting) | Serveren krypterer **ved ankomst** med firmaets offentlige nøkkel (sealed box) og kaster klarteksten. Etterpå kan heller ikke serveren lese fila |
| Skann-bake på RunPod / `scan-blobs` | Jobben får filnøkkelen for akkurat den jobben, krypterer resultatet før opplasting. Eller: bake kun på telefonen (er allerede hovedveien) |
| Push-varsler | Ingen innhold i varselet, bare «Ny oppgave». Appen henter og dekrypterer |
| Kontorappen i nettleser | Fungerer med WebCrypto, men krever enhetsgodkjenning som en telefon |
| `ampex-admin` / support | Vi kan ikke lenger se kundens data for å hjelpe. Support skjer på kundens skjerm. Det er en funksjon, ikke en feil — men det må vi vite |

## Trusselmodell — hva vi lover og ikke

| Angrep | Beskyttet? |
|---|---|
| Hele Supabase-basen lekker (dump, lekket service-nøkkel, SQL-feil) | **Ja** — kun støy + metadata |
| Hele R2 lekker | **Ja** |
| Feil i RLS lar firma A lese firma B | **Ja** — B sine rader er kryptert med B sin nøkkel |
| Ampex-ansatt eller -agent ser i basen | **Ja** |
| Stjålet passord | **Ja**, så lenge ny enhet krever godkjenning |
| Stjålet ulåst telefon | Nei — enheten er tillitsgrensen (iOS-datavern hjelper når den er låst) |
| Ondsinnet app-oppdatering fra oss | Nei — vi leverer koden som holder nøklene |
| Metadata | Synlig: at firmaet finnes, antall brukere/rader, tidspunkter, filstørrelser |

## Rekkefølge

0. **Bestem dette dokumentet.** Særlig: gjenoppretting (papir-QR), enhetsgodkjenning og at
   support ikke kan se data.
1. **Nøkkelmodellen alene:** CDK, enhetsnøkler, godkjenning, gjenoppretting, versjoner.
   Tabeller `firma_nokler`, `enhet_nokler`. Testes med en `verify:krypto`-pakke (pakk inn/ut,
   tilbaketrekking, gjenoppretting, bit-likhet app ↔ kontor) før noe data røres.
2. **Første tabeller:** `customers` og `product_prices` + prisfil-inngangen (sealed box).
   Minst kode, størst argument, og det henger sammen med grossistknappen.
3. **R2-filer:** nye opplastinger krypteres; render-core og skannviseren dekrypterer.
4. **Resten av tabellene**, én migrasjon per gruppe, med omkryptering av eksisterende rader
   gjort fra en godkjent enhet (serveren kan ikke gjøre det — den har ikke nøkkelen).
5. **Serverfunksjonene** gjennomgås én og én (tabellen over).

Billigst nå: én kundebedrift i dag. Med 50 firma må hver omkryptering gjøres på 50 firmaers
enheter.

## Åpne spørsmål

- Secure Enclave støtter P-256, ikke X25519. Velg P-256 ECDH for enhetsnøkler på iOS, eller
  X25519 i Keychain uten Enclave? (Enclave er sterkere; koster litt kode.)
- Lokal WatermelonDB lagres i klartekst på enheten (iOS-filvern). Holder det, eller SQLCipher?
- Skal en eier kunne gi Ampex-support midlertidig innsyn (pakke CDK for vår supportnøkkel
  med utløp)? Det svekker løftet; ville vært av som standard.

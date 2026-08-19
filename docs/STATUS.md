# Status — les denne først

Sist oppdatert: 2026-08-19. Holdes oppdatert; ikke lag daterte kopier.

## Hvor vi står

Branch **`grossist-og-pool`**, siste commit `9ee75e0`.
**53 filer er endret eller nye og ikke committet** — hele ordresystemet under.

Grønt: `npm run typecheck`, `npm run verify:pricefile`, `npm run verify:invoicing`.

> **Ingenting er kjørt på en enhet.** Ikke iOS, ikke Android. Alt er verifisert
> med typecheck, selvtester og SQL mot databasen. Første installasjon på en
> telefon som allerede har data er den ekte prøven — skjemaet gikk fra v21 til
> **v23**, så migrasjonen kjører.

### Uncommittet som IKKE er mitt

`modules/ampex-splat/ios/MeshBakeV2.swift` og `MeshScanPresenter.swift` er din
WIP fra før. Urørt.

---

## Hva som ble bygget

Ordresystemet går nå hele veien: **kunde → ordre → timer og materiell →
tilleggsarbeid → fakturagrunnlag → regnskap**, og alt synker.

### Datamodellen (skjema v22 og v23)

| Nytt | Hvorfor |
|------|---------|
| `customers` | Både Fiken og Tripletex krever en kunde med **ID** for å motta en faktura. Ordren hadde bare løse navnefelt, og hver synk ville laget duplikater i regnskapet |
| `activities` | Begge systemene modellerer timer som aktivitet × person × dato. Uten aktivitet har en time ingen pris |
| `order_extras` | Tilleggsarbeid med dokumentert godkjenning |
| `external_id` + `source_system` | På ordre, kunder, varer, aktiviteter. Uten dem kan en ordre ikke spores til fakturaen sin |
| Pris og MVA på `products` / `order_materials` | Prisen lagres som **snapshot** på linja, så en gammel ordre ikke endrer beløp når varen prises om |
| `time_entries`: `activity_id`, `internal_note`, `billable`, `invoiced_at` | `internal_note` er aldri synlig på faktura — «kunden var sur» skal ikke ut til kunden |

### Moduler

| Fil | Ansvar |
|-----|--------|
| `lib/invoicing.ts` | Fakturagrunnlaget. **Rene funksjoner, ingen database** — derfor selvtestbart. Penger regnes i **øre som heltall** |
| `lib/order-billing.ts` | Kobler ordredataene til regnestykket. `markerFakturert` / `angreFakturert` |
| `lib/customers.ts`, `lib/activities.ts`, `lib/products.ts` | Registrene og varesøket |
| `lib/accounting/adapter.ts` + `fiken.ts` | `Regnskapsadapter`-grensesnittet og adapter nummer én |
| `lib/pricefile/import.ts` | Prisfil → varekartotek |

### Skjermer

`ordre/faktura.tsx` · `ordre/timer.tsx` · `ordre/tillegg.tsx` ·
`ordre/deltakere.tsx` · `kunder/` (liste, detalj, ny, velger) ·
`aktiviteter.tsx` · `lager/prisfil.tsx` ·
`components/product-picker.tsx` · `components/sheet.tsx`

Registrene er skjult fra tab-baren (`href: null`) — de settes opp sjelden.

---

## De fem tingene som er lette å ødelegge ved uhell

1. **Beløp er øre som heltall.** Fiken vil ha `net: 25000` for 250,00 kr.
   Sendes kroner blir fakturaen 100× for lav.
2. **MVA-koden er engelsk hos Fiken** (`HIGH`/`MEDIUM`/`LOW`/`EXEMPT`), ikke
   norsk. Ampex' egne typer er nøytrale og oversettes i adapteren.
3. **Prisfila er CP1252, ikke UTF-8.** Den må leses som bytes gjennom
   `base64TilBytes` → `dekodAnsi`. Leses den som tekst blir æøå ødelagt i hvert
   eneste varenavn, og det oppdages først når noen leter etter «Vernebryter».
4. **Tusenskilleren er U+00A0**, skrevet som escape. Et vanlig mellomrom lar
   «1 234 567» brekke over to linjer i en fakturatabell.
5. **`Alert.prompt` finnes ikke på Android** og gjør ingenting — stille.
   `Alert.alert` viser maks tre knapper der. Bruk `components/sheet.tsx`.

---

## Databasen

**`supabase/migrations/` er IKKE sannheten.** Repoet lå 18 migrasjoner bak
databasen. Skjemaet er sikret i `supabase/baseline/schema_2026-08-19.sql`
(2873 linjer, 28 funksjoner). **Spør databasen via Supabase-MCP, ikke mappa.**
Full redegjørelse i `docs/DB_DRIFT.md`.

### Synken er bygget om

Fire migrasjoner kjørt mot `ampex-revamped` (`vymgogzcicbaizjlaurr`):

| Migrasjon | Hva |
|-----------|-----|
| `order_system_tables_and_columns` | `customers`, `activities`, **`time_entries`**, `order_members`. Timene lå kun på én telefon og forsvant med telefonen |
| `generic_watermelon_sync` | Synken er **registerdrevet**. `sync_tables` har én rad per tabell; kolonnene leses fra katalogen |
| `generic_sync_push_update_first` | Rettelse av en ekte feil en testrunde fant |
| `order_extras` | Tilleggsarbeid — koblet på synken med **én rad i `sync_tables`** |

Den gamle håndskrevne synken (`_watermelon_pull_core`, `_watermelon_push_core`,
`watermelon_push_*`) står **ubrukt som tilbakevei**. Rulle tilbake = `create or
replace` de to inngangspunktene til å kalle `_core`-funksjonene igjen.

Verifisert med full rundtur mot `time_entries` i en transaksjon som ble rullet
tilbake: insert → delvis update → pull → soft delete. 22 tabeller i pull.

---

## Hva som trengs fra deg

**1. Én ekte EFO/NELFO-prisfil.** Dette er fortsatt hovedblokkeringen, og nå
blokkerer det mer enn før: varesøket virker, men **varelista er tom** til en fil
er importert. Skaff en `V4*`- eller `P4*`-fil fra Onninen, Solar eller Ahlsell.

Ny mulighet: **spør om FTP-tilgang i samme telefonsamtale.** Prisfilene ligger i
kundens egen katalog på grossistens FTP — tilgangen er din, ikke en
systemleverandørs. Spør om tre ting: FTP-vert og brukernavn, om `F*`-fakturafiler
ligger i samme katalog, og om de tar imot bestilling på samme server. Se
`docs/GROSSIST_INTEGRASJON.md`.

**2. Fire e-postmaler mangler.** `supabase/config.toml` peker på
`supabase/templates/invite.html`, `recovery.html`, `confirmation.html` og
`magic_link.html`. Ingen finnes, og det **blokkerer hele `supabase`-CLI-en**
(`db reset`, `db push`, `db pull`).

**3. Regnskap: start på Fiken.** 229 kr/mnd ENK, 349 kr AS. Ikke på grunn av
API-et, men fordi Fiken er den eneste veien der Ampex kan være koblet **fra dag
én** — OAuth tar to minutter. Tripletex krever 2–3 ukers godkjenning pluss et
skjønnsmessig AI-samtykke etter §2.2.13 som kan avslås.

> Vær klar over hva det koster: **Tripletex Elektro/VVS til 699 kr/mnd er Ampex'
> direkte konkurrent**, ikke en integrasjon. Ordre, prosjekt, timer, regnskap,
> faktura, lønn, grossistintegrasjon og sjekklister — og den er medlemsfordel
> hos NELFO. Velger han Fiken, velger han bort den pakken, og da må Ampex dekke
> ordre, beholdning og grossist. Det er planen uansett, men det skal være et
> bevisst valg.

---

## Neste steg, i rekkefølge

1. **Kjør appen på en enhet.** Ingenting er sett. Skjemamigrasjonen v21→v23 bør
   prøves på en telefon som allerede har data, ikke bare frisk installasjon.
2. **Tilbud.** Største gjenstående hull i livsløpet — vi kan fakturere arbeid,
   men ikke vinne det. Modellen: tilbud med linjer, status
   utkast/sendt/akseptert/avslått, «akseptert» oppretter ordren med linjene
   kopiert over. Fiken har `/offers` klart.
3. **Foto og kundesignatur på ordren.** Foto finnes bare inne i skjemaer,
   signatur ikke i det hele tatt. Begge er bevis når noe bestrides.
4. **Mine timer på tvers av ordre.** Ukesvisning for lønn. I dag ser du timer per
   ordre, ikke per person per uke.
5. **Fiken-adapteren må kobles til noe.** Den er skrevet uten
   React Native-avhengigheter og skal kjøre i en Edge Function eller Ampex
   Desktop — et Fiken-token hører ikke hjemme på en montørtelefon. «Marker som
   fakturert» skriver i dag kun lokalt.
6. **Bestilling til grossist som objekt.** Designet ligger i
   `GROSSIST_INTEGRASJON.md`, ingenting er bygget. Bygg e-post ut + FTP inn, ikke
   EDI — Minuba har 80+ grossister på nettopp det.
7. **Ordre ↔ prosjekt.** To øyer i dag.
8. **Poolen må avklares.** `20260815120000_gpu_bake_worker_pool.sql` og
   `20260817200000_ampex_public_pool.sql` er **aldri kjørt og kan ikke kjøres
   slik de står** — `scan_jobs` finnes med et annet skjema, `worker_nodes`
   overlapper med `scan_workers`. Enten skrives de om mot det som finnes, eller
   så droppes `scan_workers`/`scan_jobs` og de kjøres rent.

### Fortsatt ikke synket

`reminders`, `assistant_notes`, `nfc_tags`, `mesh_markers`. De to første er
**bruker**skopet, ikke firmaskopet, og trenger en annen RLS-form enn resten.

### Android

Fungerer, men **LiDAR-skanning gjør ikke** — `ampex-splat` er
`platforms: ["apple"]`. Lastes i try/catch, så appen starter og degraderer.
Ordre, timer, materiell, faktura og varesøk virker fullt ut.

---

## Beslutninger som er tatt (ikke ta dem opp igjen)

- **EFObasen droppes for v1.** API-tilgang koster **29 412 kr/år eks. mva**
  (offentlig prisliste hos EFO), pluss etablering 6 000 kr. Prisfila fra
  grossisten dekker behovet, koster null, og har kundens egne priser.
- **Ampex public pool skal finnes**, med egen node først og Ampex som fallback.
- **Aktivering av AI-en er LUKKET.** To-finger-dobbelttrykk beholdes, og
  Ampex-merket er den synlige inngangen. Rist, back tap, dobbeltbank,
  løft-til-øret, vekkeord, App Intents, Flic, volumknapp og nærhetssensor er
  vurdert og forkastet. **Ikke foreslå en tolvte gest.**
- **AR er den vanskeligste anvendelsen av LiDAR, ikke den viktigste.** Tegning
  fra skann og måling uten målebånd krever mindre presisjon og treffer større
  marked. **Selg LiDAR på rehab** — SmartCraft Spark eier nybygg fra i år, med
  plantegning → visuell oppmerking → automatisk tilbud, gratis.
- **Ampex Desktop: Tauri v2 + React + TypeScript.** Ikke Electron, ikke RN for
  Windows.
- **Regnskap: Fiken først** (snudd 19. august — se begrunnelsen over).
  Tripletex som adapter nummer to.
- **Fargevalg: tonet grunn med hvite kort, ikke mørkt tema.** Kobber som eneste
  identitetsfarge.
- **Bygg ikke EDI mot grossist.** Minuba har 80+ grossister på e-postmal ut og
  FTP inn, med inntil 20 minutters forsinkelse. Det holder.
- **AI-en kan foreslå tilleggsarbeid, aldri godkjenne det.** Et tillegg som
  fødes godkjent er et tillegg ingen spurte kunden om.
- **Rist-lytteren bør slettes** (`useShakeListener()` i `app/_layout.tsx`).
  50 Hz akselerometer i forgrunnen for ti aktiveringer om dagen. Ikke gjort.

---

## Bake-poolen — Ampex public pool og pool per firma

### Én programvare, to slags noder

`worker/` **er** Pool Exe-en. Det er ikke to produkter. En Ampex-node og en
kundenode kjører identisk kode; forskjellen er én boolean i databasen.

```
worker_nodes.is_public = false   →  privat node (kundens egen PC)
worker_nodes.is_public = true    →  offentlig node (Ampex driver den)
```

Ampex setter `is_public` på sine egne noder. Kunden kan ikke sette den selv —
den ligger bak `service_role`, ikke i innmeldingen.

### Hvordan en node kommer inn i poolen

1. Admin i firmaet ber om en innmeldingskode i appen → `create_worker_enrollment()`
   lager en engangskode med TTL (30 min som standard)
2. Firmaet laster ned Pool Exe, kjører den på kontor-PC-en, taster koden
3. `enroll_worker_node()` bytter koden i et **node-token**. Tokenet lagres bare
   som sha256-hash i basen; klartekst vises én gang
4. Noden hører nå til det firmaet. Tokenet **er** autentiseringen — exe-en kjører
   med anon-nøkkel og trenger ingen brukerinnlogging

### Hvordan jobber fordeles

`claim_scan_job()` avgjør alt, og prioriteringen er **emergent** — det finnes
ingen scheduler, ingen broker, ingen leader election. Bare en `where`-klausul:

| Nodetype | Ser hvilke jobber | Ventetid |
|----------|-------------------|----------|
| Privat | Kun `company_id = node.company_id` | Ingen |
| Offentlig | Alle firmaer med `allow_ampex_pool = true` | Kun jobber eldre enn `public_pool_grace_seconds` (90 s) |

Nådetiden er hele mekanismen: **er firmaets egen node oppe, rekker den alltid
først.** Er den nede eller opptatt, plukker Ampex-poolen opp jobben etter 90
sekunder. Ingen av nodene vet om hverandre.

`for update skip locked` gjør at to noder aldri tar samme jobb, så «plugg inn en
maskin til» virker uten kodeendring.

### Hvorfor det er trygt

**Isolasjonen ligger i SQL, ikke i klienten.** En kunde som dekompilerer eller
modifiserer exe-en kan ikke claime et annet firmas jobber — tokenet mapper til
ett `company_id`, og `claim_scan_job` er `security definer`.

**Kunder som ikke vil ha data utenfor huset** setter `allow_ampex_pool = false`.
Da forlater skannet aldri firmaets egne maskiner. Det er et salgsargument, ikke
en begrensning.

**Versjonsskjevhet stoppes i claim.** Med kunder som kjører egen exe blir gamle
versjoner uunngåelig, og gammel bake gir *stille forskjellig resultat* i stedet
for en feilmelding. `pool_settings.min_worker_version` avviser for gamle noder.
Sammenlignes som `int[]`, fordi «0.9.0» < «0.10.0» må være sant.

### Hva modellen gir forretningsmessig

- **Kapasitet skalerer med kundemassen.** Hvert firma som plugger inn en PC tar
  sin egen last. Da forsvinner både kø, båndbredde over internett og strømregning
  for de kundene.
- **Ampex-poolen er fallback — og den betalte planen.** Firmaer uten egen maskin
  får bakingen levert. `scan_jobs.pool` (`'firm'` / `'ampex'`) registrerer hvem
  som faktisk gjorde jobben, og er dermed faktureringsgrunnlaget.
- **~10–12 firmaer per node** i burst ved dagens slutt. Fire firmaer er én node
  med god margin. (Anslag — se usikkerheter.)
- **Grunnen til node nummer to er redundans, ikke kapasitet.** Dør maskinen,
  stopper alle kundenes skann samtidig.

### Ikke bygget ennå

| Mangler | Konsekvens |
|---------|-----------|
| **All app-side kode** — ingen treff på `worker_node`/`scan_job` i `app/` eller `lib/` | Appen kan ikke lage innmeldingskoder, ikke køe jobber, ikke vise køposisjon. Poolen finnes kun som SQL + Python |
| Ampex driver ingen offentlig node | `is_public`-veien er uprøvd i praksis |
| Auto-oppdatering av Pool Exe | Kunder havner på gamle versjoner og blir avvist av versjonssperren uten å forstå hvorfor |
| Fakturering på `pool`-kolonnen | Ingen inntekt fra fallback-poolen |
| Opplasting av frames til R2 fra telefonen | Jobben har `input_prefix`, men ingen laster opp dit fra appen |

Dette er ikke etterslep — poolen er så vidt begynt på Windows-PC-en, og resten
er fortsatt planlegging. Men rekkefølgen som gir mest er **klientsiden først**
(innmelding, køing, køposisjon), for uten den er poolen utilgjengelig fra
produktet.

Og den hører sannsynligvis i **Ampex Desktop**, ikke i montørappen — se
`docs/DESKTOP_OG_IMPORT.md`.

---

---

## Sikkert / usikkert

### Sikkert (verifisert mot kode, kilde eller database)

- **Databasen synker 22 tabeller** etter ombyggingen, registerdrevet. Verifisert
  med `watermelon_pull(0)`.
- **Fiken vil ha øre som heltall** og engelsk MVA-enum. Lest rett fra
  `api.fiken.no/api/v2/docs/swagger.yaml` (111 endepunkter).
- **Fiken HAR timeføring i API-et** — `/timeEntries`, `/activities`, `/timeUsers`
  og `/timeEntries/createInvoiceDraft`. Tidligere påstand om det motsatte var feil.
- **Tripletex har 490 endepunkter**, `/order` 21, `/project` 40, `/timesheet` 37.
- **EFObasen API: 29 412 kr/år eks. mva.** Fra EFOs egen prisliste.
- **Cordel har lagerstatus mot åtte grossister**, FTP-prisfiler fra fire, og
  elektronisk bestilling. Vår antakelse om at grossistene var lukket var feil.
- **Minuba aktiveres med e-postmal + FTP-polling**, inntil 20 min forsinkelse.
- **Ahlsell Partner har allerede bil-som-lager med strekkodeuttak og automatisk
  påfylling.** Autobestilling er ikke ny — men den er ny som *nøytral*.
- **simPRO lanserte JobScribe 13. mai 2026** (tale → jobbdokumentasjon).
  Stemme → tekst er ikke lenger en differensiator. Stemme → *transaksjon* er.
- **WatermelonDB dropper ukjente kolonner fra serveren** — `sanitizedRaw` bygger
  raden fra det lokale skjemaet. Lest i `node_modules`. Superset-pull er trygt.
- **`ampex-splat` er `platforms: ["apple"]`** og lastes i try/catch.
- **Formatspesifikasjonen E-NVare4.0r4** — semikolon, CP1252, CR+LF, `V4*`/`P4*`,
  implisitte desimaler.

### Usikkert (anslag eller uprøvd)

- **Parseren er ikke møtt med en ekte fil.** Fixturen er håndskrevet mot spec.
  **Fortsatt den viktigste usikkerheten i alt som er levert.**
- **Ingenting er kjørt på en enhet.** Verken skjermene, migrasjonen v21→v23,
  eller en ekte synk fra appen.
- **Fiken-adapteren er ikke testet mot ekte API** — kun mot spesifikasjonen.
- **Om FTP-veien er åpen for tredjeparter** eller kun for systemleverandører med
  avtale. Viktigste enkeltspørsmål i grossistsporet.
- **Om Onninen har API/EDI i det hele tatt.** E-handelssiden nevner det ikke.
- **Tripletex' AI-samtykke (§2.2.13)** er skjønnsmessig og kan avslås.
- **Om §2.2.10 forbyr å sende Tripletex-data til Gemini.** Min lesning er ja,
  og at data derfor må holdes ute av modellkonteksten. Ikke bekreftet.
- **Baketiden er gjettet**, og «10–12 firmaer per node» arver den usikkerheten.
- **VRAM-anslaget (4–8 GB)** er regnet, ikke målt.
- **Om `ARWorldMap` er nøyaktig nok** til relokalisering. Utestet.
- **Ekvivalensmatching på tvers av produsent** via ETIM er en hypotese.

---

## Dokumentkart

| Fil | Innhold |
|-----|---------|
| `docs/STATUS.md` | Denne — hvor vi står, hva som er neste |
| `docs/DB_DRIFT.md` | **Les før du rører databasen.** Repoet er 18 migrasjoner bak |
| `docs/KONKURRENTANALYSE.md` | Hva Cordel, Handyman, Minuba, simPRO og Ahlsell faktisk har |
| `docs/GROSSIST_INTEGRASJON.md` | Prisfiler, FTP-kanalen, prissammenligning, autobestilling |
| `docs/REGNSKAPSINTEGRASJON.md` | Fiken/Tripletex — API-diff, kompatibilitet, friksjon |
| `docs/ROADMAP_2026-08.md` | Full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering |
| `docs/DESKTOP_OG_IMPORT.md` | Ampex Desktop, SpeedyCraft-import |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Skann-planen (utracket) |
| `docs/NEW_APP_PLAN.md` | Opprinnelig domene- og datamodell-plan |

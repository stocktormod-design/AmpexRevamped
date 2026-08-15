# GPU-bake-plan — LiDAR-skann på PC-pool

Status: **plan, ikke implementert.** Ingen kode i repoet gjør noe av dette ennå.

## Formål

Flytte teksturbaken for LiDAR-skann fra iPhone til GPU-maskiner, slik at et skann
kan bakes på nytt mot *alle* keyframes samtidig i stedet for i én grådig pass på
enheten.

To pooler, samme worker-binær:

| Pool | Eier maskinene | Kostnad for Ampex | Bruk |
|------|----------------|-------------------|------|
| **Firma-pool** | Kundens eget firma | ingen | firmaet laster ned Worker-EXE og melder inn egne PC-er |
| **Ampex-pool** | Ampex | GPU-timer | overflow / firmaer uten egne PC-er |

Worker-noden er **ikke** en person. `profiles.role`
(`owner` `admin` `bas` `installator` `montør` `lærling` `regnskapsforer`) beskriver
saksbehandlere og montører — en PC i poolen får egen tabell og egen auth-vei.

## Hvorfor on-device ikke holder

Dagens pipeline (`modules/ampex-splat/ios/`) baker på telefonen: `TSDFFusion.swift`
→ `MeshPoseRefineV2.swift` → `XatlasUnwrap.swift` → `MeshBakeV2.swift`.

Ett jevnt drag over rommet ser bra ut. Går du tilbake for å dekke en blindsone
kollapser det, av tre grunner:

1. **Posedrift** — andre pass treffer ikke samme TSDF-voksler, så geometrien blir
   tykk i stedet for skarp.
2. **Kjempende bilder** — to keyframes vil eie samme texel med ulik eksponering og
   hvitbalanse. Grådig best-view velger én, og du får flekkvis tekstur.
3. **Grå felt** — texels der ingen view vinner sikkert. Dette *måles allerede*:
   `filledFraction` i `MeshScanResult` er nettopp den andelen.

Fiksen er global, ikke en parameterjustering: bundle-adjust alle keyframes under
ett, og løs teksturen som et labeling-problem over alle views (MRF view-selection
+ fargeharmonisering + seam-leveling). Begge deler er minne- og regnetunge på en
måte `thermalState` (regel 8) aldri vil tillate på telefon.

**Vi har allerede riktig input-format.** `presentMeshScan` eksporterer et
nerfstudio-datasett ved siden av GLB-en. `framesDir` er altså allerede en
standard, verktøy-vennlig pakke — worker-en trenger ingen nytt eksportformat.

## Arkitektur

Supabase = kø og koordinering. R2 = blob-lager. All GPU-regning skjer på maskiner
vi ikke betaler for (firma-pool) eller på egne noder (Ampex-pool).

```
iPhone                 Supabase                R2                Worker (PC)
  │                       │                     │                     │
  ├─ skann ──────────────────────────────────► frames/ ──────────────┤
  ├─ scan_jobs (queued) ─►│                     │                     │
  │                       │◄── claim_scan_job ──────────────────────  ┤
  │                       │                     │◄─ presigned GET ──  ┤
  │                       │                     │                  [bake]
  │                       │                     │◄─ presigned PUT ─   ┤
  │◄── pull (done) ───────┤◄── complete_scan_job ───────────────────  ┤
```

### Datamodell

**`worker_nodes`** — én rad per PC. `company_id`, `hostname`, `gpu_name`,
`worker_version`, `status`, `last_heartbeat_at`, `enrolled_by`, `revoked_at`.
Ampex-poolen er bare rader med Ampex' eget `company_id`.

**`scan_jobs`** — `company_id`, `room_id` / `order_scan_id`, `status`
(`queued` `claimed` `running` `done` `failed`), `input_prefix` (R2), `output_key`
(R2), `progress`, `error`, `claimed_by` → `worker_nodes`, `lease_expires_at`,
`attempt_count`, `pool` (`firm` | `ampex`), `gpu_ms`, `keyframes`.

**`companies`** trenger `bake_pool_policy` (`firm_only` | `firm_then_ampex` |
`ampex_only`) — se «Åpne beslutninger».

RLS per `company_id` via `current_company_id()`, `touch_updated_at()`-trigger og
soft delete (`deleted_at`, regel 5) som resten av skjemaet.

### Claiming

`claim_scan_job(node_id)` med `for update skip locked` + fornybart lease
(heartbeat). To PC-er i samme firma-pool må aldri bake samme skann, og en PC som
blir slått av midt i jobben skal requeues når leaset løper ut — ikke etterlate
skannet hengende. `attempt_count` gir gi-opp-grense så en korrupt frames-pakke
ikke sirkulerer evig.

### Auth for worker-noder — den viktige delen

Worker-EXE-en skal **aldri** ha firmaets Supabase-brukersesjon eller R2-nøklene
fra `scripts/set-r2-secrets.sh`.

1. Firma-admin genererer en **innmeldingskode** i appen (kortlevd, engangsbruk).
2. Koden limes inn i Worker-EXE-en én gang.
3. Worker bytter den mot et **node-token** — smalt og trekkbart, kun for
   `claim_scan_job` / `heartbeat` / `complete_scan_job`.
4. All R2-tilgang går via **kortlevde presignerte URL-er** utstedt av en Edge
   Function *etter* at node-tokenet er verifisert.

En stjålet laptop blir da én `revoke` i appen, ikke nøkkelrotasjon for hele
firmaet.

## Telefon-siden (må følge regel 2)

UI leser og skriver **kun** WatermelonDB. Etter skann:

1. Last opp `framesDir` til R2 under `{company_id}/scans/{job_id}/`.
2. Skriv `ScanJob`-rad lokalt → eksisterende `watermelon_push` tar den videre.
3. Statuslinje leser lokal rad; `watermelon_pull` bringer status tilbake. Ingen
   polling-løkke og ingen synk-knapp (regel 2 + 8).
4. **Bakested velges av brukeren** — se under. Skanning skal aldri blokkere på at
   en PC er våken.

## Valg av bakested: på enheten eller i pool

Dette er et brukervalg, ikke bare en automatisk fallback.

|  | På enheten | Pool |
|--|-----------|------|
| Resultat | med en gang | i kø, avhenger av ledig node |
| Nett | virker offline | krever upload (flere hundre MB) |
| Batteri/termikk | tungt på telefonen | ingenting |
| Kvalitet ved nye synsvinkler | grå felt, flekkvis | global bake, hele poenget |

**Valget er ikke enten/eller.** Siden `framesDir` uansett lastes opp, kan et skann
som ble baket på enheten sendes til pool *etterpå* — fra skann-detaljvisningen —
og komme tilbake som en ny revisjon. Det gjør valget til «nå kontra også senere»
i stedet for et veiskille, og fjerner det meste av presset fra beslutningen.

Tre nivåer:

1. **Firmapolicy** (`companies.bake_pool_policy`) bestemmer hva som er *tillatt*.
2. **Firmastandard** — hva som er forhåndsvalgt.
3. **Per skann** — montøren kan overstyre.

Foreslått standard, som følger av selve problemet: **første skann bakes på
enheten** (rask tilbakemelding, montøren står i rommet og vil se om dekningen er
god nok), **re-skann og påfylling av synsvinkler går til pool** — det er nettopp
der on-device-baken ryker. Ikke spør på hvert eneste skann; det blir mas.

Pool-valget må gråes ut, med begrunnelse, når det ikke er mulig: ingen dekning,
ingen node online, eller policy `firm_only` uten innmeldte PC-er. Offline-først
(regel 2) betyr at en montør i en kjeller alltid har en vei videre.

**Android er view-only.** Skanning forblir iOS Pro; Android-porten er vieweren.
Det betyr at R2-upload ikke bare er en forutsetning for GPU-bake — det er
forutsetningen for at Android i det hele tatt har noe å vise. I dag ligger GLB-ene
kun på telefonen som skannet, så *ingen andre* i firmaet ser skannet: ikke
Android, ikke saksbehandler på kontoret, ikke en annen montør på samme ordre.
Fase 1 løser den lekkasjen alene, uavhengig av om en eneste worker finnes.

Ferdig bake blir en **ny revisjon**, ikke en overskriving — `lib/scan-revisions.ts`
arkiverer allerede forrige sti (`MAX_REVISIONS = 10`), og «Skann på nytt» er
bevisst ikke-destruktivt. Server-baken arver den regelen.

`order_scans.scan_path` er allerede dokumentert som «R2-nøkkel til skann» i
`lib/db/schema.ts`, og `lib/scan-revisions.ts` sier eksplisitt «R2-upload kommer».
Denne planen er den upload-en.

## Worker-EXE

**Samme binær i begge pooler.** Ampex-poolen kjører nøyaktig den buildet firmaene
laster ned, bare innmeldt til Ampex' egen pool. Splittes den i en «server-versjon»
driver de to bake-veiene fra hverandre, og skann ser forskjellige ut avhengig av
hvem som baket dem.

Porting fra Swift:

- `xatlas.cpp` / `xatlas_wrap.cpp` er allerede vendret portabel C++ → flyttes rett over.
- `TSDFFusion`, `MeshPoseRefineV2`, `MeshBakeV2`, `MeshSimplify` → reimplementeres (CUDA/compute).
- `CoverageMesh.metal` → HLSL/CUDA-ekvivalent.
- `ARMeshGlbExporter` → GLB-kontrakten må være **identisk**, slik at
  `AmpexMeshViewerView` viser server-baket og telefon-baket resultat uten å vite forskjell.

Behold `geometryPath`-verdiene (`fusion-v2` / `anchor-v2` / `anchor-fallback`) og
`filledFraction` i output — de er allerede regresjonsmålet vårt, og gjør det mulig
å sammenligne server-bake mot `rebakeMeshScan` på samme `framesDir`.

## Ikke bygg fra bunnen — dette er løst arbeid

Problemet vårt (kjempende bilder, grå felt, posedrift ved nye synsvinkler) er
et velkjent forskningsproblem med moden, fritt tilgjengelig kode. Fase 3 bør
derfor være «orkestrer bevist kode», ikke «reimplementer TSDF + MVS i CUDA».
Den egne CUDA-jobben krymper til det som faktisk ikke dekkes.

| Prosjekt | Lisens | Hva det løser for oss |
|----------|--------|----------------------|
| **mvs-texturing** (nmoehrle) | BSD 3-Clause | *Selve* fiksen: MRF view-selection + global fargejustering + Poisson seam-leveling. Waechter et al., ECCV 2014, «Let There Be Color!» |
| **Open3D `color_map_optimization`** | MIT | Zhou & Koltun, SIGGRAPH 2014 — laget for *consumer depth cameras*, altså nøyaktig vårt tilfelle. Retter uskarp/ghostet tekstur når farge- og dybdebilder ikke er perfekt justert, og optimerer kameraposene sammen med teksturen |
| **COLMAP** | BSD | Global bundle adjustment hvis `MeshPoseRefineV2` ikke er nok |
| **nerfstudio** | Apache 2.0 | Kjører rett på `framesDir` — vi eksporterer allerede formatet |
| **xatlas** | MIT | Allerede vendret i repoet |

⚠️ **OpenMVS er AGPL-3.0-only.** `TextureMesh` gjør omtrent samme jobb som
mvs-texturing, men AGPL er en felle når vi distribuerer en EXE til kunder — det
utløser krav om kildekode. Hold den unna, og sjekk transitive avhengigheter for
GPL/AGPL i samme slengen.

Det virkelige arbeidet blir da Windows-bygg og CUDA-oppsett for disse
komponentene, ikke algoritmene. Lisensene bør bekreftes en siste gang mot
prosjektenes egne `LICENSE`-filer før vi låser valget.

## Ruting, rettferdighet og måling

- **Ruting:** firma-pool først, Ampex som overflow (foreslått standard, se under).
- **Rettferdighet:** Ampex-poolen deles på tvers av firmaer og trenger en
  samtidighetsgrense per firma. Firma-pooler trenger det ikke — et firma som
  sulter seg selv er firmaets eget problem.
- **Måling fra dag én:** `gpu_ms` og `keyframes` per jobb. Firma-pool koster oss
  ingenting, Ampex-pool koster ekte GPU-minutter. Å ettermontere forbruksmåling
  når firmaer allerede bruker tjenesten er vondt, og uten den kan vi verken
  prise nivået eller oppdage et firma som dumper 500 skann over natta.
- **Tomgang:** GPU-bokser som står ledige brenner penger. Scale-to-zero hos en
  leid GPU-leverandør slår fast flåte til volumet forsvarer noe annet.

## Personvern

Firma-pool: bildene av kundens lokaler blir på firmaets egne maskiner.
Ampex-pool: vi behandler dem på våre.

Det er et databehandler-spørsmål, ikke bare et teknisk et. **Ampex-pool skal være
et eksplisitt samtykke per firma**, ikke en stille fallback — et firma som antok
on-prem og ble overflowet til vår flåte uten å ha sagt ja er den dårlige
varianten av dette.

## Kostnadsregelen må endres

`CLAUDE.md` sier i dag «null løpende kostnad — kun Supabase + R2 tillatt som
utgifter». En Ampex-drevet GPU-flåte er en tredje utgiftspost. Firma-poolen alene
bryter ikke regelen; Ampex-poolen gjør det.

Denne planen erstatter den klausulen. `CLAUDE.md` bør oppdateres når første fase
lander, ikke før.

## Åpne beslutninger

1. **Rutingstandard** — antatt `firm_then_ampex`. Alternativer: nivåbasert
   (gratis = egne PC-er, betalt = vår pool) eller rent preferansestyrt.
2. **Frame-oppbevaring** — henger sammen med bakestedvalget over, og den
   opprinnelige antakelsen holder ikke. «Slett frames etter vellykket bake»
   ville drept muligheten til å sende et on-device-baket skann til pool i
   etterkant — altså nettopp oppgraderingsveien som gjør valget ufarlig.

   Revidert forslag: **behold frames til en pool-bake har skjedd**, deretter
   slett dem (GLB-en beholdes alltid). Skann som aldri sendes til pool trenger en
   tidsgrense uansett — 30 eller 90 dager er kandidater. R2 har null egress, men
   lagrede bytes koster fortsatt, og et tett skann er lett flere hundre MB.

## Faser

1. **R2-upload — leverer verdi uten én eneste worker.** To separate opplastinger:
   GLB-en (så Android, saksbehandler og resten av ordren faktisk ser skannet) og
   `framesDir` (input til senere bake). `scan_jobs`-tabellen legges inn og jobber
   køes, men bakes fortsatt på enheten. Beviser upload + synk, og fjerner
   «skannet sitter fast på én telefon»-problemet med det samme.

   GLB-en som lastes opp her er **on-device-baken** — iPhone baker som i dag, og
   resultatet er det Android ser. Når fase 3 lander legger server-baken seg oppå
   som en bedre revisjon. Android trenger ingen endring for å nyte godt av det:
   den henter bare siste revisjon, uansett hvem som baket den.
2. `worker_nodes`, innmeldingskode, claim/lease-RPC-er, Edge Function for
   presignerte URL-er.
3. Worker-EXE på firma-pool. Regresjon: server-bake vs `rebakeMeshScan` på samme
   `framesDir`, sammenlign `filledFraction`.
4. Ampex-pool: samme binær, samtidighetsgrense, måling, samtykke-flagg.

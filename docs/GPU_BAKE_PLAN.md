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

**Algoritmene er ikke problemet.** V2-baken er allerede nær state of the art:

- Eksponering og hvitbalanse **låses** ved skannstart
  (`MeshScanPresenter.swift:226-227`), og frames tatt før låsen vektes ned (`preLock`).
- Vinnervalget er en **MRF løst med ICM**, ikke grådig best-view — med
  okklusjonstest, dybdekant-avvisning, utbrent-hvitt-deteksjon og
  skarphet/bevegelse-vekting.
- **Multiband blending** over topp-3 kandidater per face utjevner sheen, skygge
  og eksponering, med per-frame gains.
- Per-plan fotovalg etter et forenklet **TwinTex**-kriterium.
- `MeshPoseRefineV2` er en **port av Zhou-Koltun (SIGGRAPH 2014)** —
  Gauss-Newton-justering av hver keyframes 6-DoF-pose mot en proxy, samme metode
  som Open3D `pipelines::color_map`. Den kjører *før* vinnervalg, altså mot
  årsaken til uskarphet.

**Taket er budsjettene, ikke metoden.** Det som ryker når du legger til
synsvinkler:

| Budsjett | I dag | Hvorfor det svir |
|----------|-------|------------------|
| Keyframes i baken | `maxKF` = **96–120** | Nye synsvinkler får ikke plass — de *konkurrerer* om de samme ~100 plassene. `selectCoverageAware` må kaste frames, så flere pass gir ikke mer data, bare fortynning |
| Atlas | 8192 (≥6 GB RAM), ellers 4096 | Mer dekning trenger flere texels; oppløsningen står stille |
| Pose-refine | rigid, 8 iterasjoner, 50k verteks-subsett | Ikke-rigid warp er **bevisst utelatt** i V1 — det er den som tar residual forvrengning |
| Termikk | `thermalState` (regel 8) | Alt over må holdes lavt nettopp fordi det er en telefon |

Derfor er `filledFraction` fortsatt målet, men diagnosen er en annen: grå felt og
flekker kommer i hovedsak av at **keyframe-budsjettet er brukt opp**, ikke av at
vinnervalget er dumt.

Det er verdt å presse budsjettene noe på enheten (særlig `maxKF` på 8 GB-modeller,
og ikke-rigid warp), men taket er RAM og varme. En PC har ingen av delene.

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
- `TSDFFusion`, `MeshPoseRefineV2`, `MeshBakeV2`, `MeshSimplify` → **port, ikke
  redesign**. Samme algoritmer, oversatt fra Swift/Metal til C++/CUDA.
- `CoverageMesh.metal` → HLSL/CUDA-ekvivalent.
- `ARMeshGlbExporter` → GLB-kontrakten må være **identisk**, slik at
  `AmpexMeshViewerView` viser server-baket og telefon-baket resultat uten å vite forskjell.

Budsjettene er hele poenget med å flytte jobben. Foreslåtte startverdier for
worker, mot telefonens i parentes:

- Keyframes: **alle** (96–120)
- Atlas: 16384 eller 32768 (8192)
- Pose-refine: flere iterasjoner, fullt verteks-sett, **ikke-rigid** warp (8 iter,
  50k subsett, rigid)
- Global bundle adjustment med loop closure (finnes ikke)
- Ingen termisk brems (`thermalState` styrer alt på telefon)

Behold `geometryPath`-verdiene (`fusion-v2` / `anchor-v2` / `anchor-fallback`) og
`filledFraction` i output — de er allerede regresjonsmålet vårt, og gjør det mulig
å sammenligne server-bake mot `rebakeMeshScan` på samme `framesDir`.

## Ikke bygg fra bunnen — dette er løst arbeid

**Referanseimplementasjonen er vår egen Swift-kode.** V2-pipelinen har allerede
MRF/ICM-vinnervalg, multiband blending, TwinTex-plan­valg og en Zhou-Koltun-port.
Worker-en skal derfor ikke være en ny algoritme, men *samme pipeline med
budsjettene skrudd opp*: alle keyframes i stedet for 96, større atlas, flere
iterasjoner, ingen termisk brems.

Det gjør porten enklere enn den ser ut — logikken er skrevet og verifisert, det
er språket og budsjettene som endres.

Eksterne prosjekter er bare aktuelle for **hullene**:

| Prosjekt | Lisens | Hullet det fyller |
|----------|--------|-------------------|
| **COLMAP** | BSD | Global bundle adjustment med loop closure på tvers av pass. `MeshPoseRefineV2` justerer poser mot en proxy, men lukker ikke løkker — det er nettopp det som mangler når du går tilbake til et område |
| **Open3D `pipelines::color_map`** | MIT | Den **ikke-rigide** varianten, som er bevisst utelatt i Swift-porten |
| **mvs-texturing** (nmoehrle) | BSD 3-Clause | Stort sett overlappende med det vi har. Mest verdt som referanse og fasit å måle mot |
| **nerfstudio** | Apache 2.0 | Kjører rett på `framesDir` — vi eksporterer allerede formatet |
| **xatlas** | MIT | Allerede vendret i repoet |

⚠️ **OpenMVS er AGPL-3.0-only.** `TextureMesh` gjør omtrent samme jobb, men AGPL
er en felle når vi distribuerer en EXE til kunder — det utløser krav om
kildekode. Hold den unna, og sjekk transitive avhengigheter for GPL/AGPL i samme
slengen. (mvs-texturing BSD-3 og OpenMVS AGPL er verifisert; øvrige lisenser bør
bekreftes mot prosjektenes egne `LICENSE`-filer før valget låses.)

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

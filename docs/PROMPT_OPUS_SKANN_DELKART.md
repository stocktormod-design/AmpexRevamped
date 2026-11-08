# Prompt til Opus: skriv om skannerens kjerne rundt delkart

Du er senior iOS/Metal/3D-rekonstruksjonsingeniør på LiDAR-skanneren i Ampex, en norsk app
for elektrikere bygd med Expo og React Native. Skanneren er en egen Swift- og Metal-modul i
`modules/ampex-splat/ios/`. Repoet ligger i `/Users/tormodholand/Documents/AmpexRevamp`.
Eieren heter Tormod. Han tester på en iPhone 13 Pro og dømmer på det han ser på telefonen.

Arkitekturen er alt vurdert og valgt. Vurderingen ligger i
`docs/SKANN_VURDERING_2026-10-26.md`, og den er fasiten for *hva* som skal bygges. Dette
dokumentet er *hvordan*: milepæl for milepæl, med filer, typer, hva som skal måles, og hva
Tormod skal se på telefonen før neste milepæl begynner. Les vurderingen først, så
`docs/PROMPT_FABLE_SKANN.md` (kravene), så dette.

Premisset står fast: Tormod er ikke fornøyd med noe ennå, heller ikke ett rom. Ingenting er
løst. Du skal aldri kalle noe ferdig eller bra; du skal si hva som ble gjort, hva som ble
målt, og hva Tormod skal se etter.

---

## Reglene du jobber under

1. **Rekkefølgen er M0 → M1 → … → M6.** Ingen milepæl begynner før Tormod har sett den
   forrige på telefonen og sagt gå videre. M0 er bare målinger og endrer ingen oppførsel.
2. **Aldri kvalitetstap.** Varme og minne gir pauser, mindre batcher og lengre tid. Aldri
   færre bilder, færre dybdekart, mindre atlas, grovere voxel eller kutt i regioner. Et tak
   som finnes for ett rom skal gjelde per delkart, ikke per hus.
3. **Minimal diff innenfor hver milepæl.** Du skriver om orkestreringen; du rører ikke
   fusjonskjernen, SIFT, bindingen, texel-blandingen eller opptaksdisiplinen uten at
   milepælen krever det. Delene som beholdes er listet i vurderingen under «Hva som
   beholdes, skrives om og slettes».
4. **Gammel vei lever til ny vei er sett.** Alt nytt ligger bak `meshscan.delkart` (på som
   standard fra M1, `off` gir dagens kjede). Gammel kode slettes først når Tormod har godkjent
   milepælen som erstatter den. Da slettes den, ikke kommenteres ut.
5. **Ikke simulator. Spør før hvert Xcode-bygg.** Typesjekk med
   `swiftc -typecheck` mot iOS-SDK-en og kompiler Metal-kildene for seg (se «Praktisk»).
   Tormod bygger til telefonen selv når du sier at en milepæl er klar for test.
6. **Commit bare når Tormod ber om det.** Mye skannkode er ukommittert, sjekk `git status`
   før du begynner og ikke rydd i det.
7. **Skriv til Tormod på vanlig norsk,** i hele setninger, ikke tabeller og punktlister i hver
   melding. Ærlige svar, også når noe ikke virket.
8. **Måltall må først vise at de skiller bilder Tormod alt har rangert med øyet** på minst
   tre fixturer (§88/§90 i `docs/SKANN_BESLUTNINGER.md`). Måleskriptene har pekt feil vei
   fem ganger. Tekstur dømmes med øyet på renders fra faste kameraer.
9. **Dokumentér underveis.** Hver milepæl får en paragraf i `docs/SKANN_BESLUTNINGER.md`
   (fortsett fra §115) med hva som ble målt, hva som ble forkastet og hvorfor. `docs/NAA.md`
   oppdateres når en milepæl er klar for test og når den er godkjent.

---

## Terreng: det du bygger på

Alt under er lest og verifisert 26.10. Linjetall kan ha flyttet seg; søk på symbolnavnet.

**Opptaket** (`MeshScanPresenter.swift`, 2 600 linjer) strømmer alt til
`Documents/scan-frames/<bundle>/`: `dense.jsonl` + `dense-N.f32` (256×192 Float32 LiDAR,
5 Hz, `maybeRecordDenseDepth`, record `{i,t,w,h,fx,fy,cx,cy,m[16]}` der `m` er
kamera→verden kolonnevis), `frame-N.jpg` (4K nøkkelbilder, `storeKeyframe`), `luma-N.u8`
(halv oppløsning, header 2×UInt32 w,h), `depth-N.f32` per nøkkelbilde, `sift-N.bin`
(forhåndstrukket under skanning, `MeshBildebinding.forhåndsTrekk`), `frames.json`
(`Keyframe`-manifest, `writeKeyframesManifest`), `fixture-mesh.bin` + `fixture-kf.json`
(ARKit-nettet og nøkkelbildene ved Ferdig, `MeshBakeV2.writeFixture`). `Lagringsvakt` stopper
ved 20 GB eller 3 GB ledig. `maxKeyframes` 20 000, `denseMax` 100 000. Per ramme kjører
`session(_:didUpdate:)` → `updateSpeedHint`, dekningsfeltets `splat`, `maybeCaptureKeyframe`,
`maybeRecordDenseDepth`, veiledning. Ferdig → `doneTapped` → `export(anchors:)` →
`MeshBakeV2.exportTextured`.

**Dekningsfeltet** (`CoverageField.swift`, `CoverageMesh.metal` → prekompilert til
`vendor/coverage.metallib`): 240×100×240 celler à 5 cm i verdensrommet, ringbuffer som
følger kameraet med blokker à 1 m og skiver til disk (22.10, utestet). Males av LiDAR-splats
med ARKits live-poser, vekt q·cos²·oppløsning, c = 1−exp(−Σw/12), terskel 0,40.
`coverageFrag` tegner ARKit-meshen med striper der c < terskel, med normal-tapper ±2 celler
og okklusjonstest mot siste LiDAR-kart. Dette er den ene av de to verdensmodellene som
aldri blir enige, og den erstattes i M1.

**Geometrien** (`MeshTsdfBuild.swift`, 2 340 linjer): `build(framesDir:options:tillegg:poseSink:)`
leser alle dybdekart (`loadDense`, tillit fra fart via `trustForMotion`), nøkkelbildenes
dybde JBU-oppskalert (`loadKeyframesJBU`, ~1,8 MB per bilde i minnet, husets krasjpunkt
nr. 1), kjører `driftrett` (plan-RANSAC per kart → globale plan → dempet translasjon,
glatting σ 2,5 s, maks 20 cm per kart), fusjonerer på GPU med `ampex_fuse` (MSL-streng i
fila, én inline-funksjon som både den tette `integrateGPU` og den sparsomme
`integrateSparseGPU` kaller; `P`-structen er parametrene), `Blokkvolum` (8³-blokker, tett
Int32-indeks over hele boksen, `allokerFra` merker blokker fra alle kart på forhånd),
`blurVolume`, `surfaceNetsRå`, `etterbehandle` (Taubin, plansnapp, hullfylling, UV-blokker
à 3 m). `Options`: voxel 20 mm, trunc 3,2, minWeight 2,5, maxVelocity 0,35, jbuScale 3,
maxVoxels 40 M (voxelen vokser 1,25× til det passer, det er krav 3 brutt). Sparsomt volum
er opt-in (`meshscan.sparse`).

**Bindingen** (`MeshSift.swift` GPU-SIFT, `MeshBildebinding.swift` matching + RANSAC-F +
spor + LM bundle adjustment med Schur, `MeshBildebindingBake.bind` inngangen): hoppes over
> 450 bilder (`meshscan.bbmaks`). Resultat i `<bundle>/bildebinding.json` + landemerkekart
`relok.bin` (format `RLB1`); filnavnene og `påslått` ligger i `MeshBildebindingBake.swift`.
Tar 3–9 s per rom. Beholdes uendret, kalles per delkart.

**Baken** (`MeshBakeV2.swift`, 6 000 linjer): `exportTextured` → `bind` → `MeshTsdfBuild.build`
→ `driftrettedeKeyframes` → `bake(mesh:keyframes:framesDir:to:)`. `bake` setter budsjett
fra `os_proc_available_memory` (atlas 8192/4096, maxKF, topK), forenkler alt over 300 000
trekanter til 250 000 (`meshscan.simplify`), xatlas, `MeshPoseRefineV2.refine` (laster
960 px luma Float for alle bilder, krasjpunkt nr. 2), `texelBlend` (per-texel myke vekter,
to bånd, `members()` går gjennom alle trekanter per bilde), fliser maks 4×4 à 8192,
`ARMeshGlbExporter.writeTiledGlb`. `MeshRelok.skrivKart` skriver `<glb>.relok` ved siden av.
`MeshRebakeHarness.run` (i `AmpexSplatModule.swift`) bygger om et bundle uten UI fra
launch-argumenter.

**Vieweren** (`AmpexMeshViewerView.swift`): `load(path:)` → `AmpexGlbLoader.loadNode`, én GLB,
alle fliser som fulle teksturer (krasjpunkt nr. 3 for et hus).

**AR** (`MeshRelok.swift`, `MeshArPresenter.swift`): `MeshRelokLokalisator.finn` mot ett
kart per modell. Bygget, ikke testet på telefon etter siste lagfiks.

**Verktøy på Mac** (`tools/`): `audit-scan-drift.py` (planoffset over tid, rå og rettede
poser), `audit-scan-sett-tapt.py` (sett-men-tapt per 10 cm-rute), `audit-scan-shell.py`
(gulv/tak-tykkelse), `audit-scan-dekningsfelt.py` (replikerer feltet), `glb-veggflat.py`
(render av vegger fra fast kamera), `scan-loop-closure.py` (prototypen, Python, ikke i appen).
Fixturer på Mac i `~/AmpexFixtures/` (0daef323, 9ef06228, a1b507ed ettroms; f97d682a
tre rom 3 min 390 bilder; f92f1be0 847 dybdekart 10×8 m). De samme ligger på telefonen under
`Documents/scan-frames/`.

---

## Målarkitekturen i én side

Et **delkart** er et sparsomt 8³-blokk-TSDF i sitt eget koordinatsystem, med utstrekning
inntil 12 × 5 × 12 m, voxel 20 mm (10 mm i M5), blokkindeks tett per delkart
(75 × 32 × 75 Int32 = 720 kB, ingen hash). Det lukkes ved det første av: kameraet går ut av
utstrekningen, 45 s, 120 nøkkelbilder, 600 dybdekart. Fusjonen skjer **live**, per dybdekart,
på GPU, med nøyaktig `ampex_fuse`. Dekning **er** vekten W i volumet, terskel `minWeight`.
Hvert delkart er forankret til én `ARAnchor` lagt i delkartets origo; delkartets transform
til verden er `T_anker_nå · T_anker_0⁻¹ · T_0`, så ARKits egne korreksjoner flytter hele
delkartet som én blokk (om ARKit faktisk flytter ankere, måles i M0; gjør den ikke det, er
uttrykket identiteten og ingenting brekker).

Ved lukking går delkartet til en **bake-arbeider** i bakgrunnen: binding på delkartets
≤ 120 bilder → `driftrett` på delkartets egne kart → re-fusjon fra disk med rettede poser
(samme kjerne) → surface nets → etterbehandling → forenkling til fast mål per delkart →
xatlas → texel-blanding med 1–2 fliser à 8192 **per delkart** → `delkart-N.glb` +
`delkart-N.glb.relok`. Ved termikk serious pauser køen. Bare ett delkart bakes om gangen, og
bare det aktive delkartet ligger i GPU-minnet som volum; de lukkede ligger på disk, og i
GPU-minnet som en liten W-tekstur hver (for overlegget) og som ferdig GLB (for visning).

Mellom delkart: en **posegraf** med ≤ ~50 noder, løst ved Ferdig og ved kryss mot eldre
delkart. Bånd: ARKits kontinuitet ved byttet, SIFT-landemerker mellom overlappende delkart,
gulvplan per etasje, veggplan-par. Loop closure flytter delkart rigid: en ny matrise i
`hus.json`, ingen ny bake. Vieweren laster GLB-er fra `hus.json` med full oppløsning bare for
de nærmeste.

---

## Filer og typer som skal finnes når M3 er ferdig

Alle nye filer ligger i `modules/ampex-splat/ios/` og må inn i `AmpexSplat.podspec` om den
lister filer eksplisitt (sjekk).

- `MeshDelkart.swift`: `final class Delkart` (id, `ankerID`, `T0` og `T` (simd_float4x4),
  `lo`/`dim`/`vox`, `Blokkvolum`-indeks på GPU, `sumWD`/`sumW`-buffere, lister over
  dybdekart-indekser og nøkkelbilde-indekser, `åpnet`/`lukket` tidspunkt, `tilstand`
  (.aktiv, .lukket, .bakes, .ferdig, .feilet)), `struct DelkartKart: Codable` (det som
  skrives til `delkart/N/kart.json`), `enum DelkartLager` (skriv/les blokker, kart, GLB-sti).
- `MeshDelkartFusjon.swift`: live-fusjonen. Inkrementell blokkallokering per dybdekart
  (GPU-kjerne som merker blokker, CPU som nummererer nye og utvider bufferne), dispatch av
  `ampex_fuse` for det aktive delkartet, W-konvertering til dekningstekstur.
  `ampex_fuse` og `P` flyttes ut av `MeshTsdfBuild` til en delt MSL-streng (`MeshFuseKernel.swift`)
  som både live-veien og re-fusjonen bygger pipeline fra. **Ikke endre en linje i kjernen.**
- `MeshBakeArbeider.swift`: seriell kø, én delkart om gangen, termikkpause, fremdrift til
  `MeshLog` og til UI-et, skriver `delkart-N.glb`.
- `MeshPosegraf.swift` (M3): noder, bånd, LM-løser, `hus.json`.
- `MeshHus.swift`: `struct HusManifest: Codable` (`delkart: [{id, glb, relok, T[16], etasje}]`,
  `etasjer: [{gulvY}]`), lesing i vieweren og i AR.
- `CoverageMesh.metal`: `coverageFrag` leser W-teksturer per delkart i stedet for feltet.
  Prekompileres på nytt til `vendor/coverage.metallib` (se «Praktisk»).
- `AmpexMeshViewerView.swift`: laster `hus.json` → flere noder, LOD.
- `MeshArPresenter.swift` (M6): relok-kart per delkart.

Dette er ikke en fasit på navn, men på ansvar. Ikke lag flere filer enn disse uten grunn.

---

## M0: to målinger, ingen endring i oppførsel

Mål: svare på det eneste arkitekturspørsmålet som ikke kan avgjøres fra Mac-en, og lage
referansetallet alt senere måles mot. Dager, ikke uker.

**M0a, flytter ARKit sine ankere?** I `MeshScanPresenter.session(_:didUpdate:)`: hvert
30. sekund med normal sporing, `session.add(anchor: ARAnchor(transform: kameraets transform))`
og husk `(id, T0, tidspunkt)`. Implementer `session(_:didUpdate anchors:)` og logg til
`pipeline.log` hver gang et av *våre* ankere får ny transform:
`anker — <kortid> t=<sek siden lagt> dT=<dx dy dz i mm> dR=<grader>`. Logg også summen ved
Ferdig: `anker — N ankere, største flytting <mm>, median <mm>`. Ingen annen oppførsel endres.
Bak flagget `meshscan.ankerlogg` (på som standard i denne milepælen, fjernes i M1).

Test Tormod gjør: skann tre rom og gå tilbake til start, som i det første flerromsskannet.
Hent `pipeline.log` (se «Praktisk»). Kjør `audit-scan-drift.py` på bundelen. Svaret er ett
av to: ankrene flytter seg i samme størrelsesorden som driften på veggen (8–12 cm på
f97d682a), og da bærer ankerforankringen overlegget mellom lukking og posegraf; eller de
står stille, og da er `T_anker_nå · T_anker_0⁻¹` identiteten, posegrafen bærer alt, og
overlegget for lukkede delkart kan ligge noen cm feil fram til Ferdig. Begge er akseptable
utfall. Det som ikke er akseptabelt er å gjette.

**M0b, overlegg-sannhet.** Ved Ferdig, før baken: les dekningsteksturen tilbake fra GPU
(`MTLTexture.getBytes`) sammen med `loG`, `dims`, `voxel` og terskelen, og skriv
`<bundle>/dekning-ferdig.bin` (header: 4×Int32 dims+pad, 3×Float origo, Float voxel, Float
terskel; så r8 eller Float per celle). Lag `tools/audit-scan-overlegg-sannhet.py <bundle>
<glb>`: for hver celle som var vist som dekket (c ≥ terskel), finnes det trekantflate i den
ferdige GLB-en innen 5 cm? Rapporter andelen (det er «overlegg-sannhet»), og motsatt:
andel av meshens flate som lå i celler overlegget viste som udekket. Bruk `trimesh` eller ren
numpy mot GLB-en (`audit-scan-glb-layout.py` viser hvordan GLB-ene leses i dag).

Referansen tas på samme treromsskann som M0a, og på en ny bake av f92f1be0 om feltet kan
rekonstrueres der (`audit-scan-dekningsfelt.py` prøver; sjekk om den stemmer med
telefonens felt før du stoler på den). Noter tallene i §115.

**Leveranse M0:** to tall og én setning om ankrene, i `docs/SKANN_BESLUTNINGER.md` §115 og i
`docs/NAA.md`. Så stopper du og venter på Tormods gå-videre.

---

## M1: delkart-TSDF live, overlegg fra W

Mål: overlegget og resultatet kommer fra samme volum og samme vektregel. Baken er
**uendret** i denne milepælen (global, som i dag), så bare én ting endres om gangen.

### Steg

1. **Flytt kjernen ut.** `ampex_fuse`, `P`, `dep`, `kamp` og de to kjernene som kaller den
   går til `MeshFuseKernel.swift` som én `static let msl: String`. `MeshTsdfBuild` bygger
   sine pipelines fra den. Verifiser at en rebake av 0daef323 på telefonen gir byte-identisk
   GLB før og etter (determinisme er sikret siden 11.09, §81; bruk det).

2. **`Delkart` og live-fusjon.** Når opptaket starter og hver gang et delkart lukkes:
   nytt delkart med origo = kameraets posisjon rundet til blokk, `lo` = origo − (6, 2.4, 6) m
   (samme loddrette fordeling som feltet bruker i dag, gulvet er 1,5–1,7 m under kameraet),
   `dim` = 600 × 250 × 600 voxler à 20 mm, blokkindeks 75 × 32 × 75 Int32 på GPU satt til −1,
   `sumWD`/`sumW` som voksende `MTLBuffer` (start 4 M plasser = 32 MB, dobles ved behov;
   taket er 64 M plasser = 512 MB, og nås det, lukkes delkartet, det er ikke en kvalitetsgrense
   men en størrelsesgrense). Legg `ARAnchor(transform: T0)` og husk id.

   I `maybeRecordDenseDepth`, etter at dybdekartet er skrevet til disk: `fusjoner(depth,
   intrinsics, c2w)` på det aktive delkartet, med `trust` fra `trustForMotion` på samme
   måte som `loadDense` gjør det (samme fart-tillit live som i baken, ellers blir W ulik).
   Blokkallokering: en liten GPU-kjerne går gjennom dybdekartets piksler (49 k tråder),
   regner trunkeringssonen langs strålen akkurat som `Blokkvolum.allokerFra` og setter et
   merke per blokk i en 180 k UInt8-buffer. CPU leser merkene (180 kB, under 1 ms),
   nummererer nye blokker, skriver indeksen, utvider bufferne om nødvendig. Så
   `ampex_fuse` over de allokerte blokkene (den sparsomme kjernen, uendret). Alt i ett
   kommandobuffer per dybdekart; mål tiden og logg p50/p95 én gang per minutt.

   Dybdefrekvens: **5 Hz live, 5 Hz i baken** (begge fra samme `dense-N.f32`), så W blir
   likt. Ikke fusjoner 30 Hz live.

3. **Lukkeregel.** Lukk når det første inntreffer: kameraet mer enn 1 m utenfor
   `lo…lo+dim`, 45 s siden åpning, 120 nøkkelbilder, 600 dybdekart, eller plassene over
   64 M. Ved lukking: `DelkartLager.skriv` (koord-liste + `sumWD`/`sumW` for allokerte
   blokker, `kart.json` med dybdekart- og nøkkelbilde-indekser, `T0`, `ankerID`), W-tekstur
   (under) beholdes på GPU, volumbufferne frigis. Logg `delkart — N lukket: X blokker,
   Y dybdekart, Z bilder, W MB`. Nytt delkart åpnes med én gang; dybdekart som kommer i
   samme ramme går til det nye.

   Nådeperiode: det nye delkartet overlapper det gamle fordi de første dybdekartene i det
   nye ser det gamles rom. Det er greit; det er det sveisingen i M3 er til. Ikke prøv å
   fusjonere ett dybdekart inn i to delkart.

4. **Dekning fra W.** En `convert`-kjerne per delkart (erstatter dagens `convert` i
   `CoverageField`): for hver 5 cm-celle, c = clamp(max W over cellens voxler som har
   |S| < 1 voxel / minWeight, 0, 1), til en `r8Unorm` 3D-tekstur. For det aktive delkartet
   kjøres den hver 4. ramme (7,5 Hz, som i dag) over hele volumet (240 × 100 × 240, samme
   kost som dagens `convert`). For et lukket delkart kjøres den én gang ved lukking, og
   teksturen **beskjæres til de allokerte blokkenes bounding box** (et rom på 6 × 3 × 6 m
   er da under 1 MB).

   `coverageFrag`: `Field`-uniformen blir en liste på inntil 8 delkart (tekstur, verden→delkart
   4×4, origo, invExtent). Fragmentet slår opp i det aktive først, så i de lukkede i
   rekkefølge, og tar **maks** c. Terskelen er `minWeight / minWeight = 1`, altså
   «c ≥ 1 betyr dekket»; bruk 0,999 for avrunding. Normal-tappene (±2 celler) beholdes
   foreløpig; okklusjonstesten beholdes. Hvilke 8: det aktive pluss de 7 nærmeste lukkede
   målt fra kameraet; listen oppdateres én gang per sekund.

   De lukkede delkartenes transformer i shaderen er `T_anker_nå · T_anker_0⁻¹ · T_0`
   (M0a avgjør om første ledd gjør noe).

5. **Slett** `CoverageField`s ringbuffer (`følg`, `bytt`, `Skive`, `ioKø`, `lager`) og
   `splat`-kjernen, og CPU-dekningspasset (`coverageGeometry`, `CellCache`, `doneCells`,
   `kfCams`) **bortsett fra** det veiledningen bruker (`frameNovelty`, «pek mot taket»,
   «gå nærmere»). Veiledningen skal lese fra W-teksturene i stedet der den i dag leser
   `doneCells`; gjør det i samme milepæl, ellers lever to sannheter videre.
   `TSDFFusion.swift` (`meshscan.geometry=fusion`) slettes.

6. **Ved Ferdig** (uendret bake): lukk aktivt delkart, skriv `dekning-ferdig.bin` som i M0b
   men nå fra W-teksturene (alle delkart, i verden), kjør dagens `exportTextured` som før.
   Fjern `meshscan.ankerlogg`; ankerloggen blir fast, men bare summen ved Ferdig.

### Minne i M1

Aktivt delkart: inntil 512 MB GPU (vanligvis 50–150 MB). Lukkede: ~1 MB tekstur hver.
Baken er fortsatt global og har fortsatt krasjpunktene 1–3; det tas i M2. Si det til Tormod
før han skanner et hus i M1: tre–fem rom er det M1 tåler.

### Test Tormod gjør

Tre rom og tilbake: stripene kommer ikke tilbake når han går tilbake, overlegget tegner
ikke på nytt når han snur seg, og `audit-scan-overlegg-sannhet.py` gir ≥ 95 % mot
referansen fra M0b. Han tar samtidig **første trappeskann**: opp én etasje og ett rom der
oppe, som fixture til M3. Det bundelet skal kopieres til `~/AmpexFixtures/` med én gang.

### Leveranse M1

§116 med tidene for live-fusjonen (p50/p95 per dybdekart), minne per delkart, antall
delkart på de tre rommene, overlegg-sannhet før og etter, og hva som ble slettet.

---

## M2: bake bak deg, per delkart, fast budsjett

Mål: krav 1 (samme kvalitet uansett størrelse) og krav 7 (skann og bake er ett steg) av
konstruksjon. Etter M2 er det ikke én global bake lenger.

### Steg

1. **`MeshBakeArbeider`.** Seriell `DispatchQueue` (qos `.userInitiated`, ikke `.background`;
   iOS struper `.background` hardt). Tar lukkede delkart i kø i rekkefølge. Per delkart:

   a. `MeshBildebinding.bind` på delkartets nøkkelbilder (≤ 120, under taket, så
      `bbmaks`-hoppet forsvinner; fjern flagget). Resultat til `delkart/N/bildebinding.json`.
   b. `driftrett` på delkartets egne dybdekart (`loadDense` må ta en indeksliste, ikke hele
      `dense.jsonl`). 20 cm-taket og 12–15 cm-terskelen passer et 45 s-vindu.
   c. **Re-fusjon** fra disk med rettede poser, inn i et nytt volum med samme `lo`/`dim`/`vox`
      som live-delkartet, samme kjerne, pluss nøkkelbildenes JBU-dybde (`loadKeyframesJBU`
      begrenset til delkartets ≤ 120 bilder: 216 MB i stedet for ubegrenset; les dem
      **strømmende**, ett om gangen, inn i fusjonen, ikke som liste). Denne re-fusjonen
      erstatter live-volumet på disk, og W-teksturen for overlegget konverteres på nytt fra
      den. Logg hvor mange 5 cm-celler som flippet fra dekket til udekket; det tallet skal
      være under 1 %, ellers er live- og bakevekten ikke like, og det må finnes.
   d. `surfaceNetsRå` → `etterbehandle` (uendret).
   e. Forenkling til **fast mål per delkart**: `meshscan.simplify` tolkes nå per delkart,
      standard 300 000 trekanter (ett rom i dag ligger under det og forenkles ikke; det er
      poenget).
   f. xatlas per delkart, `MeshPoseRefineV2.refine` på delkartets bilder (≤ 120 × 2 MB,
      kjent tak), `texelBlend` med **fast** atlas: 1 flis 8192 for delkart under 60 m² flate,
      2 fliser over. Fjern budsjettstigen i `bake` (`headroomMB`, `maxKF`, `topK`-trappen);
      `maxKF` er 120 av konstruksjon, `topK` er dagens beste verdi uansett minne.
   g. `writeTiledGlb` → `delkart/N/delkart-N.glb`, `MeshRelok.skrivKart` → `.relok`.
   h. Slett `frame-*.jpg` og `luma-*.u8` for delkartets bilder. Behold `sift-*.bin`,
      `depth-*.f32`, `dense-*.f32` og `kart.json` til Ferdig (posegrafen trenger dem).

   Termikk: før hvert av trinnene a–g, sjekk `ProcessInfo.processInfo.thermalState`; ved
   `.serious` eller `.critical`, vent (sov 5 s, sjekk igjen) og logg `bake — pause termikk`.
   Aldri endre en parameter. Minne: `os_proc_available_memory` under 400 MB → vent på samme
   måte. GPU-arbeid i små kommandobuffere (én flis, én fusjonsbatch à 50 kart) så
   kamerabildet aldri venter mer enn ~20 ms; mål kamera-fps under bake og logg det.

2. **Ferdig.** Lukk aktivt delkart, vent på køen, skriv `hus.json` (alle delkart med `T`,
   GLB-stier, `etasje` = 0 inntil M3), én miniatyr. `MeshScanResult.fileURL` peker på
   `hus.json` for delkart-skann; TS-siden (`modules/ampex-splat/index.ts`,
   `app/(app)/skann.tsx`) må tåle at «modellen» er en mappe. Hold endringen i TS minimal:
   samme `glbPath`-felt, men stien ender på `.json`.

   Enkel sveising nå, full i M3: trekanter i delkart N hvis sentroide ligger innen 2 voxler
   av flate med W ≥ minWeight i et **eldre** delkart M slettes før xatlas (slå opp i M-ets
   volum på disk, bare for blokker i overlappet). Det fjerner z-fighting ved skjøtene;
   hull i skjøten godtas til M3.

3. **Vieweren.** `load(path:)` leser `hus.json`, lager én `SCNNode` per delkart med `T`,
   laster GLB-er. Mipmap på alle materialer (`mipFilter = .linear`, `generateMipmaps`).
   De to nærmeste delkartene (fra kameraets posisjon, oppdatert ved hver kamerabevegelse)
   får full tekstur, resten får en nedskalert kopi som lages én gang ved bake
   (`delkart-N.lod.jpg`, 2048 px) og lagres ved siden av. Mål GPU-minnet med
   `device.currentAllocatedSize` og logg.

4. **Rebake-harnessen** (`MeshRebakeHarness`) må kunne bygge om et delkart-bundle:
   `-meshscan.autorebake <bundle>` bygger alle delkart i kø og skriver `hus.json` på nytt.
   Uten den kan ingen A/B kjøres på fixturene fra M1 og senere.

5. Når Tormod har godkjent M2: slett den globale veien (`exportTextured`-stien uten delkart,
   `selectCoverageAware`, budsjettstigen, `loadKeyframesJBU` som liste, `MeshSplatBuild`,
   DTSDF-koden i `MeshTsdfBuild` om den ikke er et flagg som brukes).

### Test Tormod gjør

Fem rom. Ventetid etter Ferdig under 2 minutter på 13 Pro (mål og rapporter; blir det 3–5
med termikkpauser, si det, det er innenfor kravet). Deretter det samme rommet skannet
**alene** og som **del av de fem**: render begge fra samme kamera med `glb-veggflat.py`
og vis side om side på telefonen. De skal ikke kunne skilles. Det er krav 1.

### Leveranse M2

§117 med ventetid, antall termikkpauser, toppminne, kamera-fps under bake, flippede celler
etter re-fusjon, og de to renderne.

---

## M3: posegraf, sveising, gjenbesøk

Mål: krav 6 (etasjene ligger riktig oppå hverandre) og krav 10 (å gå tilbake gjør resultatet
bedre, ikke verre). Det er Glenns borevinkel.

### Steg

1. **Bånd.** `MeshPosegraf` har én node per delkart (6 frihetsgrader, start = `T` fra
   `hus.json`) og fire typer bånd:

   a. *Odometri*: for påfølgende delkart N, N+1, den relative transformen ARKit ga ved byttet
      (`T_N⁻¹ · T_{N+1}` i verden ved lukketidspunktet). Sterkt bånd, informasjonsmatrise
      som tilsvarer σ = 1 cm, 0,5°.
   b. *Landemerker*: for hvert par delkart hvis bounding-bokser (i verden) overlapper eller
      er innen 2 m: match SIFT-trekk mellom inntil 20 × 20 nøkkelbilder (de med størst
      synsoverlapp, fra `kart.json` og posene), med `MeshBildebinding`s matcher og
      `ransacF`. Trekk med dybde (`depth-N.f32`, samme `sampleDepth`-regel som bindingen)
      løftes til 3D i hvert delkart; Kabsch gir relativ transform, inlier-antall gir vekten
      (σ = 2 cm ved ≥ 200 inliers, voksende til 10 cm ved 30, under 30 inliers ingen kant).
      Dette er porten av `tools/scan-loop-closure.py`; les prototypen, den har
      parametrene og fellene.
   c. *Gulvplan*: for hvert delkart, det dominerende vannrette planet i det bakte nettet
      (normal innen 5° av opp, størst areal, `kartPlan`-logikken på meshen). Delkart
      klynges i **etasjer** på gulvhøyde (terskel 1 m). Innen en etasje: bånd «gulvhøyde lik»,
      σ = 1 cm. Delkart uten dominerende gulv (trapp) får ingen gulvbånd og hører til
      ingen etasje.
   d. *Veggplan-par*: for nabo-delkart, vertikale plan med samme normal (innen 6°) og
      offset innen 15 cm regnes som samme vegg, bånd «koplanar», σ = 2 cm. Pass på
      parallelle vegger i ulike rom: krev at planenes bounding-bokser overlapper i
      verden.

2. **Løser.** LM med dense Cholesky (≤ 50 noder × 6 = 300 parametre; `cholSolve` i
   `MeshBildebinding` kan gjenbrukes). Første node låses. Robust kjerne (Huber, 3σ) på
   landemerkebåndene, ingen på odometrien. Løses ved Ferdig, og **underveis** hver gang et
   nytt delkart får ≥ 100 landemerke-inliers mot et delkart eldre enn forrige (det er et
   kryss). Resultatet er nye `T` i `hus.json`; GLB-ene røres ikke. Logg residualene per
   båndtype før og etter.

3. **Sveising av overlapp.** Erstatter M2s enkle klipp. For hvert par overlappende delkart
   etter løsning: trekanter i det nyere som ligger innen 2 voxler av flate i det eldre
   slettes (som i M2), **og** randen som da oppstår lukkes ved å flytte randvertekser til
   nærmeste punkt på det eldres flate (det eldres volum på disk, `S` interpolert) så skjøten
   er vanntett innen en voxel. Tone over skjøten: konstant per delkart, løst som
   søm-nivelleringen gjør (`seamlevel`), først i M5.

4. **Gjenbesøk.** Når kameraet med normal sporing står inne i bounding-boksen til et lukket
   delkart som er `ferdig`, og mer enn 3 m fra det aktive delkartets origo: lukk det aktive,
   **gjenåpne** det gamle: les blokker fra disk til GPU, fortsett live-fusjon i det, og sett
   det i kø for ny bake ved lukking (det gamle GLB-et beholdes til det nye er klart). Flere
   runder gir mer vekt i samme volum (§112). Er gjenåpning ikke på plass innen M3s tid, er
   nytt overlappende delkart pluss sveising en godtatt første versjon; si hvilken det ble.

5. **Trapp.** Ingen særbehandling i koden utover 1c. Veiledningen ber om én ekstra runde på
   reposet når et delkart lukkes uten gulvplan («gå en runde til her før du går videre»).

### Test Tormod gjør

To etasjer via trapp. Merk et punkt i taket i første etasje og det tilsvarende punktet på
gulvet rett over (lodd og tommestokk, mål den vannrette avstanden til to vegger). Avviket
i modellen, målt i vieweren, ≤ 3 cm. Skillevegger er én vegg, ikke to. Og f92f1be0-typen
på nytt: ingen hakk der runden møter seg selv.

### Leveranse M3

§118 med residualer per båndtype, antall kryss, avviket gjennom gulvet, og om gjenåpning
eller nytt-delkart ble valgt.

---

## M4: vegger sett fra én side

Mål: krav 5, ingen gjennomsiktige vegger. Målingene 26.10 viste at LiDAR aldri så 36–39 %
av hver side av skilleveggen, og at det som tapes av det den så, er streifet i én–to rammer
(33–70 piksler mot 1200–1600 for det som overlever). Det er opptak, ikke fusjon.

1. **Veiledning ved lukking.** Når et delkart lukkes: finn gulvplanet, finn hvor gulvets
   rand går uten at det finnes vertikal flate over randen (innen 30 cm, høyde ≥ 1 m).
   Det er «vegg mangler her». Vis det som en pil i overlegget i 10 s og logg arealet.
   Samme regel for tak over gulv (finnes delvis i dag, «pek mot taket»).
2. **Planfylling vegg.** `fillPlanarHoles` fyller hull inne i et plan. Utvid til å fylle
   **mellom gulv og tak** der et vertikalt plan har flate over ≥ 40 % av høyden og hullet
   er avgrenset av gulv under og tak over.
3. **Veggpar på tvers av delkart.** To vertikale plan med motsatte normaler, 8–15 cm fra
   hverandre, i to delkart: hvert fyller den andres hull ved å speile flaten over tykkelsen,
   med vertex-farge fra naboen og uten tekstur (texel-blandingen maler det ikke; det blir
   en nøytral flate, ikke et hull). Gjør det før xatlas i det delkartet som bakes sist.
4. Retningsdelt TSDF (§114) står av og skal ikke prøves på nytt.

Test: et f92f1be0-skann, med veiledningen fulgt. Ingen gjennomsyn fra noen av rommene,
og `audit-scan-sett-tapt.py` viser at «sett»-andelen går opp (det er veiledningen), ikke
bare at tapt-andelen går ned.

---

## M5: kvalitet per rom, til konstant pris

Dette er der «ikke ett rom er godt nok» angripes. Det kommer sist fordi hvert grep nå
koster det samme uansett hus. Rekkefølgen her er Tormods, ikke din; foreslå, mål, vis.

- Voxel 10 mm per delkart (sparsomt: et rom på 150 m² flate × 6 cm sone = 9 M voxler,
  72 MB; innenfor), med `truncVoxels` og blur skalert som i dag.
- Prompt Depth Anything (CoreML) mot JBU på de tre ettromsfixturene; kjøretid og kantene
  på lister og karmer avgjør.
- Hull rundt møbler: det er W-terskelen mot tynne ting (§69); A/B `minWeight` 1,5 kun i
  voxler som ikke ligger på et dominerende plan.
- Sprekker i tak: §103s lærdom (ikke ARKit-tillegget); mål med `audit-scan-shell.py`.
- Tone over skjøter mellom delkart.

Hver av disse er en egen A/B i rebake-harnessen på fixturene, og hver får sin paragraf.

---

## M6: AR mot huset

Relok-kart per delkart finnes alt (`delkart-N.glb.relok`). `MeshRelokLokalisator` får en
grov-til-fin: først hvilket delkart (grovt, på deskriptor-avstand mot alle kart), så PnP
mot det kartet, så nabo-kartene om inliers er få. Linjene lagres i delkartets
koordinatsystem (`T` fra `hus.json` brukes ved visning), så en ny posegraf-løsning flytter
linjene med delkartet. Test: tegn en linje i ett rom, gå til et annet, tilbake, hold opp
telefonen: linjen ligger innen 1 cm i rommet den ble tegnet i. På tvers av rom rapporterer
du avviket; det er ventet 2–3 cm der og er ikke en feil i M6.

---

## Risikoer du skal måle, ikke anta

- **GPU-konkurranse under bake.** Kamera-fps logges under bake i M2. Faller den under 25,
  må kommandobufferne bli mindre (ikke baken tregere i snitt, men i kortere stykker).
- **Varme.** 13 Pro nådde serious etter 65 s på flerromsskannet uten bakgrunnsbake. Med
  bake bak seg kommer det før. Logg termikk-tilstanden hvert 10. sekund og antall pauser.
  Blir ventetiden ved Ferdig over 5 minutter for fem rom, er det en M2-feil, ikke en
  13 Pro-begrensning, og du skal finne hvor tiden går (fasene logges hver for seg).
- **Sporing i trapp.** Tap av sporing deler delkart. Posegrafen må feste etasjen via
  bindingen på reposet. Klarer den ikke, flyter etasjen: si det, og foreslå veiledningen
  i M3.5 («skann reposet en gang til»), ikke en heuristikk.
- **Flippede celler etter re-fusjon** (M2c). Over 1 % betyr at live og bake ikke bruker samme
  vektregel. Finn forskjellen; ikke hev terskelen.
- **Delkart-grenser midt i en vegg.** Skjøten vil synes i tone til M5. Si det til Tormod
  før han ser det.

---

## Praktisk

**Typesjekk uten Xcode-bygg** (dette er lov uten å spørre):
```
cd modules/ampex-splat/ios
SDK=$(xcrun --sdk iphoneos --show-sdk-path)
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios16.0 \
  $(ls *.swift | grep -v -e AmpexSplatModule -e AmpexMeshViewerView -e AmpexPdfModule -e AmpexMicModule -e AmpexProximityModule)
xcrun -sdk iphoneos metal -c CoverageMesh.metal -o /tmp/coverage.air && xcrun -sdk iphoneos metallib /tmp/coverage.air -o vendor/coverage.metallib
```
De fem filene som holdes utenfor importerer `ExpoModulesCore` og typesjekkes bare i
Xcode-bygget. Endrer du en av dem (vieweren i M2, modulen for harnessen), hold endringen
liten og si fra at den ikke er typesjekket før Tormod bygger.

**Bygg til telefon** (bare når Tormod sier ja; viftene går amok):
```
xcodebuild -workspace ios/Ampex.xcworkspace -scheme Ampex -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates \
  -derivedDataPath ~/Library/Developer/Xcode/DerivedData/Ampex-device build
DEV=$(xcrun devicectl list devices | grep "Tormod sin iPhone" | awk '{print $4}')
xcrun devicectl device install app --device $DEV ~/Library/Developer/Xcode/DerivedData/Ampex-device/Build/Products/Release-iphoneos/Ampex.app
```

**Logg og bundler fra telefonen** (telefonen må være låst opp):
```
xcrun devicectl device copy from --device $DEV --domain-type appDataContainer \
  --domain-identifier no.ampex.app --source Documents/room-scans/pipeline.log --destination ./pipeline.log
xcrun devicectl device info files --device $DEV --domain-type appDataContainer \
  --domain-identifier no.ampex.app --subdirectory Documents/scan-frames --no-recurse
```
Et bundle er 0,2–3 GB; kopier i bakgrunnen og til `~/AmpexFixtures/`.

**Ombygging på telefonen uten UI:**
```
xcrun devicectl device process launch --device $DEV --terminate-existing no.ampex.app \
  -- -meshscan.autorebake <bundle-navn> -meshscan.<flagg> <verdi>
```
Resultat i `Documents/scan-frames/<bundle>/rebake-harness-*.glb` (fra M2: `hus.json`),
`harness-done.txt` når den er ferdig.

**Renders på Mac:** `python3 tools/glb-veggflat.py <glb> …` (les headeren), hjørne-render
i samme fil. Tekstur dømmes der, med øyet, før noe vises til Tormod.

---

## Hvordan du rapporterer

Etter hver milepæl: en melding til Tormod på vanlig norsk med hva som er bygget, hva som
er målt (tallene i én setning hver, ikke tabell), hva han skal gjøre på telefonen og hva
han skal se etter, og hva som ikke er gjort. Så venter du. Ikke start neste milepæl på
eget initiativ, og ikke lov noe om hvordan det kommer til å se ut.

# Skann-pipelinen — beslutningslogg og forkastede veier

**Hva dette er:** listen over ting vi har PRØVD i skann- og bake-pipelinen, hva som ble
målt, og hvorfor de fleste av dem ble forkastet. Ikke en arkitekturbeskrivelse — den
ligger i `ON_DEVICE_SCAN_PLAN.md`, `GPU_BAKE_PLAN.md`, `SUBPIXEL_ALIGN_PLAN.md` og i
kodekommentarene, som er skrevet for å bære begrunnelsen.

**Hvorfor den finnes:** pipelinen har gått gjennom flere måneder med A/B på ekte skann.
Uten denne lista foreslår neste utvikler (menneske eller modell) ting som alt er prøvd og
målt tre ganger. Hver linje under koster en kveld å gjenoppdage.

**Regel for den som endrer noe her:** kvalitet itereres på FIXTURES, ikke på knotter.
Alle `meshscan.*`-flagg er A/B-armer, ikke innstillinger for brukeren. Standardverdien er
konklusjonen; flagget er der for å kunne gjenta målingen.

---

## Slik måler du (Mac-harnessen)

Appen kjører headless i iPhone-simulatoren og baker en lagret bundle uten UI. Det er
denne loopen kvalitetsarbeidet skal gjøres i — ikke på telefon.

```
xcodebuild -workspace ios/Ampex.xcworkspace -scheme Ampex -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build          # ~15 min første gang, ~2 min etter

xcrun simctl launch <sim> no.ampex.app \
  -meshscan.autorebake <bundleDir> -meshscan.tag <navn> [-meshscan.x y]
```

`MeshRebakeHarness.run` (i `AmpexSplatModule.swift`, kalt fra `OnCreate`) baker og skriver
`rebake-harness-<tag>-*.glb` + `harness-done.txt` i bundelen. Logg i simulator-containerens
`Documents/room-scans/pipeline.log`.

- Bundle fra telefon: `xcrun devicectl device copy from --domain-type appDataContainer --domain-identifier no.ampex.app --source Documents/scan-frames/<id> --destination <dir>` (~270 MB, ~1 min).
- Fixtures uten `dense.jsonl` (bad, stue, aug. 2026) går ARKit-anchor-veien, ikke TSDF.
- Rendring på Mac: `render_glb <glb> <ut.png> [yaw] [pitch] [dist]` — headless SceneKit med
  samme GLB-parser som vieweren, RØD bakgrunn slik at hull i geometrien blir røde.
  **Rødt i en render er hull, ikke tekstur.** Det er den viktigste avlesningen.

**Fallgruver i harnessen:**
- Nye Swift-filer kommer ikke med i podden uten `pod install`. Legg koden i en eksisterende fil.
- `os_proc_available_memory()` returnerer 0 i simulatoren → `MeshSimMem.available()` later som
  2,5 GB. Uten den faller budsjettet til atlas 4096 og CPU-fusjon, og målingen blir feil.
- Bygg for `ARCHS=arm64` alene. Uten det bygges også x86_64 og tiden dobles.

Målte tider (soverom, 152 keyframes, 249k tris, Release): hele baken 28–47 s. **Debug er
3–14× tregere i de tunge fasene** (poseRefine 20 s mot 1,4 s, xatlas 36 s mot 12 s, JBU
220 s mot 3,8 s). Døm aldri fart på et Debug-bygg.

---

## 1. Geometri

### Forkastet: splat-pipelinen (parkert 2026-08)
Motoren fungerer (873 MB flat, 159k gaussianere). Grensen er ARKit-posene: bevegelses-
uskarphet i posene gjør at splats ikke konvergerer skarpt. Bevist tre uavhengige veier.
Revurderes kun hvis pose-optimalisering kommer på plass. Se `project-splat-pipeline`.

### Valgt: ARKit-anchor-mesh live, TSDF ved ombygging
Live-skannet tar den raske veien (~40 s totalt). Full LiDAR-TSDF kjøres i «Bygg skarpere
modell», der telefonen gjerne ligger på lading. Rådataene ligger igjen i `scan-frames/`,
så rommet skannes aldri på nytt.

**Prinsippet:** en montør venter ikke 17 minutter i et kaldt bygg. Kvalitet er et valg man
tar etterpå, ikke en straff man får i felten. (Tormod 2026-09-05: «dette blir for dumt holy».)

### Forkastet: hoppe over LiDAR-geometri når telefonen er varm
Første forsøk på å få ned de 17 minuttene. Det er et rent kvalitetstap — TSDF-banen ble
standard nettopp fordi ARKit-nettet gjør bordkanter amorfe. Erstattet med **termikk-budsjett**:
dense-kart tynnes jevnt til 320 (serious) / 200 (critical), keyframes beholdes alltid, JBU
super-res hoppes bare over ved critical.

### Forkastet: 100 s tidsbudsjett som hoppet over søm-utjevning
Fjernet igjen samme kveld. Farten skal komme av at pipelinen slutter å gjøre dumt arbeid,
ikke av at den leverer dårligere. (Tormod: «det tar ikke polycam eller scaniverse så lang tid».)
De to ekte flaskehalsene var énkjernet CPU-fusjon (507 s → GPU 0,8 s) og en forenkling som
ikke forenklet (terskel 400k / mål 400k → 434k ble «forenklet» til 399k).

### Forkastet: frirom-utskjæring som standard (2026-09-07)
`carveRatio` fjerner voxels der mange stråler ser GJENNOM. Innført 09-02 mot falske flater
foran ekte (målt: 13,5 % av LiDAR-piksler hadde falsk flate foran, ratio 8 ga 3,2 %).

A/B på soverommet 2026-09-07, ratio **8 · 20 · 40 · av**:

| carve | tris | resultat |
|---|---|---|
| 8 (gammel default) | 339k | hylle, sengekant, TV og pult fulle av hull |
| 20 | 360k | fortsatt hull i sengekant og pult |
| 40 | 372k | nær «av», men fortsatt hull i hylla |
| **0 (av, ny default)** | **377k** | hylle, sengekant, TV og pult hele |

Ingen synlige spøkelser innenfra eller utenfra med utskjæring av. Årsaken til at den skar
for mye: tynne og skrå flater (hyllekanter, putekanter) har mange stråler gjennom gapene.
Slå på igjen med `meshscan.carve 8` hvis falske flater dukker opp i et annet rom.

### Ingen effekt: `meshscan.tsdfminw 1`
Lavere minimumsvekt i TSDF-fusjonen ga 379k mot 377k tris og ingen synlig forskjell.
Ikke prøv igjen uten en ny hypotese.

### Kjente rester (ikke løst)
- **Glass og speil blir hull.** LiDAR får ingen retur. Scaniverse fyller slike hull med
  veggplanet. Vår `fillPlanarHoles` krever en lukket løkke og stopper på 2,2 m (4,0 m for
  smale slisser), så et vindu på 1,5 × 1,2 m lukkes aldri.
- **Gulv under møbler.** Aldri sett av sensoren.
- **Ankersømmer i ARKit-veien.** Vannrett hulllinje i ~1 m høyde og loddrette streker i
  ankernettet på 1 × 1 m. Skyldes dedup-trinnene (overlap, coplanar, dobbeltflate) pluss
  komponent-opprydding. Gjelder ikke TSDF-veien. Ekte fiks er å sveise hjørner på tvers av
  ankergrenser FØR dedup, så det aldri oppstår to lag å velge mellom. Ikke gjort.

---

## 2. Teksturering — hvilket bilde som males på hvilken flate

Dette er området med flest forkastede forsøk. Rekkefølgen betyr noe: hver konklusjon kom
av at den forrige feilet på et ekte skann.

### Forkastet: `blend=raw` (fullfrekvens-snitt av topp-K per flate)
Hele teksturen som warp-justert snitt av topp-K syn. Var standard 2026-09-01, forkastet
09-02: snittet brukte per-flate topp-2 etter RÅ score, så ICM-regulariseringen nådde aldri
teksturen, og en flat hvit vegg ble en mosaikk av trekanter der topp-2-settet vippet.
Beholdt som A/B-arm (`meshscan.blend raw`).

### Forkastet: `blend=multiband` (lavfrekvens fra snitt, detalj fra vinner)
Prøvd slått PÅ for delte plan 2026-08-15 for å utjevne farge mellom kvadrantene. **Rullet
tilbake samme kveld:** spotlights i taket ble smurt ut. Årsaken er prinsipiell og verdt å
huske: multiband henter lavfrekvensen fra snittet av topp-K. En spot er en liten, blendet,
lyssterk klatt — altså nesten ren lavfrekvens. Med restdrift i posene havner klatten noen
piksler fra hverandre i hver frame, og snittet smører den ut.

**Regelen:** snitting er kuren mot flekkvis farge på flate vegger og giften mot små
lyssterke detaljer. Fargeforskjell mellom regioner løses ADDITIVT (søm-nivellering +
per-hjørne-forfining), som flytter NIVÅ uten å blande innhold og derfor ikke kan smøre.

### Forkastet: tone-laget i vinnerveien
Av siden 2026-09-02. Lavfrekvensen ble snittet fra topp-2 UTEN warp, og det andre synet lå
1–2 cm forskjøvet. Hver takplanke-linje fikk et svakt, forskjøvet spøkelse ved siden av seg,
og taket så ut som krøllet papir selv om hele taket var ÉN region fra ett foto.
`meshscan.toneclamp <tall>` slår det på igjen for A/B.

### Forkastet: ståsted-valg
Default AV siden 2026-08-25. Tredoblet regionantallet på hver bake (788 → 2648 på enhet)
og la en av de nye grensene tvers ned en dør — synlig grå søm midt på en flate. Med valget
av faller regionantallet ~10× og fargetermen plasserer de få sømmene som er igjen.
`meshscan.stasted on` gjenoppretter.

### Forkastet: plan-lås på TSDF-nett
Planene brukes til å RETTE geometrien (ren gevinst, vegger blir virkelig flate), men sendes
ikke videre til baken for å låse et plan til ETT foto. Målt 2026-09-01: 5 plan låst mot 19
DELT, altså 1,3 % av flatene låst og nitten nye synlige linjer tvers over veggen i bytte.
TSDF-planene er finere oppdelt enn ARKits og dekkes sjelden 90 % av ett enkelt foto.
`meshscan.planelock on` for A/B.

**Merk (2026-09-07):** planene sendes nå ALLTID til baken, men `MergedMesh.planeLock` styrer
om de får låse. Grunnen er at plan-SNITTET (under) trenger å vite «denne flaten ligger på en
vegg», uten at planet låses til ett foto.

### Forkastet: blur av tone-laget i ATLAS-rom (2026-09-07)
Første forsøk på plan-snittet gjorde utjevningen med et bredt blur i teksturatlaset.
Resultatet var trekant-mosaikk og «konfetti». Årsaken: chunket xatlas gir mange små charts,
og et blur på 45 texler lekker mellom charts som er naboer i atlaset men fremmede i rommet.

**Regelen:** tone-utjevning må skje i VERDENSROM, aldri i atlas-rom. Beholdt som arm
(`meshscan.planeavg gpu-hybrid`).

### Valgt: plan-snitt (2026-09-07) — det som endelig ga Scaniverse-jevne flater
Utløst av Tormod: «SÅ SYKT CLEAN TAK + VEGG hos Scaniverse … alt ser ut som 1 bilde».

Innsikten: Scaniverse velger ikke ett foto per flate. Teksturen er et vektet SNITT av alle
syn som ser punktet — samme prinsipp som deres live-forhåndsvisning. Derfor er tak og vegg
jevne: hver lampes linsestripe og hvert bildes eksponering ligger på ULIKE steder i ulike
syn og fortynnes 1/N, mens flaten selv (panelspor, list) ligger på samme sted og består.

To modus, valgt per flate:

- **Tak → FLAT snitt** (`meshscan.planeavg flat` gjør det på alt). Alle gyldige syn snittes
  på GPU med score-vekt. Tre ting måtte til før det ble bra:
  1. **Konsensus-avvisning (pass 2).** Pass 1 gir snittet per texel; i pass 2 teller et syn
     bare hvis det ikke er lysere enn snittet + 6 % (`meshscan.glarethr`) eller mørkere enn
     −20 % (`meshscan.shadowthr`). Fjerner lampestråler og skyggen av den som skanner.
     Per texel, ikke per flate — strålen er smal og lang.
  2. **Lokal eksponeringsgain per (flate, syn)**, som i panorama-stitching: g = konsensus-tone
     / synets tone ved centroiden, klemt 0,5–2,0 (`meshscan.localgain off`). Alle syn blir
     enige FØR de snittes, så et syn som kommer til eller faller fra ved bildekanten ikke
     flytter tonen.
  3. **Myk kantvekt** (smoothstep over 8 % av bilderammen), samme grunn.
- **Vegger → hybrid v2.** Detalj fra vinnerfotoet, TONE per hjørne fra alle syn. Regnes i
  verdensrom fra mellomoppløste bilder (512 px), legges i `cornerOfs` — samme additive
  lineære kanal som søm-nivelleringen alt bruker. TSDF-nettet har ~2 cm mellom hjørnene,
  finere enn en lampes linsestripe og ethvert eksponeringstrinn, så alt under ~2 cm
  (panelspor, lister, spots) kommer fortsatt fra ett foto.

Fjæringen (naboens foto over sømmen) slås AV på plan-flater — den bærer naboens regionnivå
og ville dratt tonen tilbake mot vinnerens.

### Ingen effekt: `meshscan.gainclamp 0.4` på skann med AE-lås
Vidt eksponeringsområde mot standard ±5 % ga ingen synlig forskjell på soverommet (AE/AWB
låst ved skannstart). Trengs derimot på gamle fixtures fra august, som ble tatt UTEN lås:
der er gain-lum 0,61–1,40 mot 0,95–1,05.

### Ikke løst: august-fixturen «stue»
Tonelapper i taket som `planetol 0.12`, `gainclamp 0.4` og lokal gain ikke fjernet. Debug
(`meshscan.debugflat on` maler snittdekning magenta) viste FULL dekning, så det er ikke et
dekningsproblem: venstre del av taket er varm beige og høyre kjølig grå fordi hvitbalansen
varierer mellom bildene (AWB var ulåst i august). Pluss ARKit-dobbeltlag med polygonkanter.

**Ikke tun mot dette datasettet.** Dagens app låser AE og AWB før skanning og bruker TSDF.
Skann rommet på nytt i stedet.

### xatlas — terskelen for u-chunket
U-chunket unwrap gir færre sømmer, men er superlineær i tid. Målt: 99k tris → 2 min,
110k → 3,4 min, 225k → timeout. Senere måling viste at u-chunket 38k tris tok 43 s mot
chunket 50k på 29 s. Terskelen er derfor senket i flere trinn: 140k → 40k → **12k tris**,
med `timeout: 45` → 15 s.

⚠️ Fallback-bug som har bitt før: timeout-veien i `xatlasUnwrapUVs` setter handleren til
`{false}` (zombie-drap). Chunket-retry MÅ re-sette `uiHandler`, ellers insta-kanselleres
den og alt faller til box-unwrap (675k verts med per-tri-UV er box-signaturen i loggen).

---

## 3. Live-visningen (dekningsoverlegget)

Målet er Scaniverse-modellen, målt på deres eget opptak: ufanget flate er røde og hvite
diagonale striper, **helt opake** (kamerabildet synes ikke gjennom), rød `#E2002A`, periode
~20 px, 45°, hard hakkete kant. Fanget flate viser en uskarp teksturert mesh som ERSTATTER
kamerabildet. Hele skjermen starter stripet, også der det ikke fins mesh ennå.

### Forkastet: dekning regnet fra keyframes i et CPU-pass
Bøtter på 0,2 m / 22,5°, ≤2,5 Hz, med sløringsvakt. Ga klumpete overlegg som lå etter
kameraet (dekningspass 876–2414 ms). Erstattet av **CoverageField**: et skalarfelt
c(x) = 1 − exp(−Σw/S₀) over rommet, sprettet inn fra hvert dybdebilde på GPU, med samme
vekting som TSDF-fusjon. Dekningspass falt til 31–35 ms. Dybdebildet ER mengden synlige
flatepunkter, så okklusjon er gratis.

### Forkastet: striper tegnet PÅ ARKit-meshen
Område uten mesh fikk ingen striper, altså «vi fargelegger på utsiden av kameraet».
Erstattet av **CoverageVeil**: et plan hengt på kameranoden som dekker hele viewet.

### Forkastet: sløret ØVERST, med hull der feltet er fanget
Slapp rått kamerabilde gjennom i hullet, fordi ARKit-meshen henger 1–8 s etter feltet.
Brukeren så vanlig kamera først og mesh etterpå. **Nå er sløret BAKGRUNN** (renderingOrder
−10 000); meshen tegnes oppå og velger selv per piksel striper eller feltfarge. Kamerabildet
synes aldri under skanning. `quickGeometry` henger ARKit-geometrien på noden i
`didAdd`/`didUpdate` umiddelbart, uten å vente på dekningspasset.

### To orienteringsfeil som kostet hver sin runde
1. **«Sprekken i midten».** Bare en tynn diagonal viste riktig = klassisk transponering.
   `projectionMatrix(for:)` virker i det skjermorienterte kamarommet fra `viewMatrix(for:)`,
   ikke i `camera.transform` (sensor-orientert). **Regel:** ARKits per-orientering-matriser
   hører sammen parvis (view + projection); `camera.transform` hører sammen med intrinsics
   og dybdebildet.
2. **Alt rødt uansett.** Skjerm-uv ble regnet fra planets lokale XY. Kameranoden er
   sensor-orientert (liggende), så i stående modus er planets akser rotert 90° mot skjermen.
   Fiks: uv fra fragmentets pikselposisjon, stråle fra invers projeksjon.

### Terskler — kalibrert mot BAKEN, ikke mot andre apper
Stripene slippes ved ETT bekreftet syn innen 3,5 m med facing ≥ 0,5; bare skrå syn
(0,35–0,5) krever et ståsted til. Tidligere krav om to ståsteder ble satt etter
Scaniverse-analogi og var feil for oss. (Tormod: «jeg får god kvalitet selv om jeg ikke står
rett ved veggen, så hva er problemet?»)

**Regelen:** kalibrer overlegget mot det baken faktisk leverer på ekte skann, ikke mot hva
andre apper krever.

---

## 4. Fallgruver i koden som har kostet kræsj

### ALDRI les `SIMD3<Float>` direkte fra en ARKit-buffer
ARKit pakker hjørner og normaler som 3 × Float = 12 byte. `SIMD3<Float>` er **16 byte**.
Å lese siste element som SIMD3 leser 4 byte forbi bufferen; ligger slutten på en sidegrense,
segfaulter det (KERN_INVALID_ADDRESS på sidegrense-justert adresse, 2026-09-07, to ganger).
Bruk `les3Float(base, offset)` i `MeshLog.swift`. Gjaldt fem steder: live-kopien,
fargesamplingen, baken og GLB-eksporten.

### `snapshot(anchor)` og trådvalg
Anchor-geometri leses på MAIN mens sesjonen kjører — off-main lesing segfaultet i juli
(ARKit reallokerer buffere live). Eksportbanen leser off-main KUN fordi sesjonen er pauset.
Kopien tas nå i `renderer(_:didAdd/didUpdate:for:)`, der ARKit selv rekker oss ankeret.

⚠️ Merk: teorien om at *frigjorte* buffere var kræsjårsaken 2026-09-07 var FEIL — den ekte
årsaken var 16-byte-overlesingen over. Endringen er beholdt fordi den er ufarlig og gir
raskere mesh på skjermen, men den fikset ikke kræsjet.

### AR-sesjonen må ha feilhåndtering
Uten `didFailWithError` / `sessionWasInterrupted` / `sessionInterruptionEnded` /
`cameraDidChangeTrackingState` dør sesjonen stille (termikk, minne, telefon, bakgrunn) og
overlegget «slutter å respondere». Gjenoppta ALLTID uten `.resetTracking` /
`.removeExistingAnchors` — nullstilling kaster alt som er skannet.

### Kappløp som ødela en hel bundle
`maybeRecordDenseDepth`: et dybdekart som kom etter at `doneTapped` lukket handelen så
`denseHandle == nil`, kalte `createFile` (som TRUNKERER) og skrev sin ene linje. Resultat:
`dense.jsonl` på 246 byte, «TSDF: 1/1 dense-frames», «surface nets ga null verts», og 96 s
bortkastet JBU før fallback. Fikset med `denseClosed`-flagg og `seekToEnd`.

### `coverageTimer` må stoppes i `doneTapped`, ikke bare i `finish()`
`session.pause()` gir fortsatt `currentFrame`, så dekningsfargingen malte videre på et
frosset bilde gjennom hele baken (90 pass à 2,4 s), stjal CPU og varmet telefonen som
strupet den mer.

### Metal-biblioteket må være prekompilert
`scn_metal` kan ikke kompileres i runtime. `CoverageMesh.metal` bygges til
`vendor/coverage.metallib` med `xcrun -sdk iphoneos metal -c … && xcrun -sdk iphoneos metallib …`
og legges inn som pod-ressurs. `.metal`-fila skal IKKE med i `source_files`.

### Bygg og installasjon
- Trådløs install fra `expo run:ios` henger på «Connecting to». Bruk
  `xcrun devicectl device install app --device <UDID> <sti>` over kabel.
- `xcodebuild -destination id=<device>` timer ut hvis telefonen er LÅST. Bruk
  `-destination 'generic/platform=iOS'`.
- «Ampex er ikke lenger tilgjengelig» = utløpt 7-dagers utviklerprofil. Slett utløpte
  profiler i `~/Library/Developer/Xcode/UserData/Provisioning Profiles/`, bygg på nytt.
  Krever at Apple-ID-en er logget inn i Xcode → Settings → Accounts.
- Kræsjlogg: `xcrun devicectl device copy from --domain-type systemCrashLogs --source Ampex-<dato>.ips`
  (.ips = JSON-header + JSON-body; `faultingThread` og `frames` har symboler i Debug-bygg).

---

## 5. Åpne spørsmål

- **Uskarphetsporten teller ikke.** Logger «0 rammer sluppet (grense 60 px)» samtidig som
  maks predikert uskarphet er 74–1604 px. Telleren eller terskelen henger. Sjekk før neste
  kvalitetsrunde.
- **Hull ved glass, speil og under møbler.** Ikke forsøkt løst. Nærmeste vei er planfylling
  av store hull som ligger i et veggplan, uten størrelsesgrense.
- **Ankersøm-sveising før dedup** i ARKit-veien. Beskrevet over, ikke bygget.
- **Bare ett komplett LiDAR-skann å måle på.** Soverommet 2026-09-05/07. Bad og stue må
  skannes på nytt med dagens app før vi kan si at standardverdiene generaliserer.

## 6. Kvalitetsrunde 2026-09-08 — fortsatt ikke Scaniverse-nivå

Tormods referanse er AirDrop-bildet `Downloads/Skjermbilde 2026–09–07 kl. 20.11.25.png`
(NB: filnavnet har NBSP etter «kl.»): Scaniverse-stua har sammenhengende tak/vegg/gulv,
selv om også den har geometriske hull. **Tormod går like fort i Scaniverse og får skarpt
resultat. Ikke gjør «skann saktere» til løsningen.** Bildene viser at påstanden ovenfor
om «Scaniverse-jevne flater» var for sterk. Taket vårt har fortsatt tonegrenser og lysstriper.

Ni simulator-bakes på samme soveromsbundle (152 bilder, 620 dybdekart), Release arm64.
GLB rendret med samme SceneKit-verktøy, kamera `(yaw, pitch, dist) = (0,25,0)` og
`(180,25,0)`, 1400×1000. Original rådata er beholdt. Bake-delen tok omtrent 46–60 s;
timingene er ikke en kontrollert ytelsessammenligning (bygg kjørte samtidig).

**Beholdt, begrenset teksturendring:** lokal gain per trekant brukes ikke lenger på
bilder merket `preLock == false`. Global gain/sømbehandling består. De låste bildene har
allerede felles eksponering; å normalisere hvert bilde ved trekantsentroiden mot et
snitt la nye fasetter rundt lampene. Eldre bilder uten låsemetadata beholder gammel gain.
`meshscan.localgain=on` tvinger gammel behandling for A/B. Konsensus-avvisningen får en
myk overgang fra terskelen til dobbelt terskel på nyere skann, i stedet for et hardt hopp.
`meshscan.planetrimsoft=off` gir gammel avvisning. Visuelt færre små fasetter i den
kontrollerte vinkelen, **men store tonegrenser og lysstriper gjenstår**. En prøve på
fargehopp over takets nabokanter ga omtrent uendret andel store hopp; ikke presenter
denne endringen som en målt stor samlet kvalitetsforbedring.

**Beholdt fangstretting:** bevegelsesporten krevde 12 cm / omtrent 8 grader før et bilde
kunne utfordre erstatningsbufferet. Et skarpere bilde fra samme ståsted ble dermed
avvist FØR den eksisterende kvalitetsrangeringen. En kandidat med mer enn 25 % lavere
beregnet uskarphet kan nå passere denne porten (forrige estimat må være >2 px).
Kadens, fartsport, bufferbudsjett og faktisk skarphetsrangering gjelder fortsatt.
`python3 tools/verify-scan-capture.py` kjører den faktiske Swift-predikaten med 11
påstander. **Effekten på nye råskann må testes på telefon; kan ikke bevises med rebake.**

**Videre fangstaudit etter spørsmålet om flere runder:** `storeKeyframe` leste `motion`
fra `lastLinSpeed`/`lastAngSpeed` inne i den asynkrone JPEG-køen. Scoren kunne dermed
bruke fart fra en senere frame enn bildet den rangerte. Farten fryses nå sammen med
`blurPx` før køen, så erstatningsavgjørelsen får samme tidsgrunnlag. Dette er en konkret
feilretting, ikke bevis for at den forklarer hele kvalitetsforskjellen.

Gjenbesøk er ikke helt blokkert: eksisterende device-logg har for eksempel 162 nye
bøtter, 57 erstatninger og 102 kandidater som ikke var bedre. Men bedre bilde per
kamerabøtte er **ikke** det samme som bedre tekstur per overflate. `MeshBakeV2` sitt
FLAT-pass tar med alle syn som består `scoreOf`, og regner konsensus/blanding på nytt.
En ny vinkel kan derfor endre også en allerede dekket takflate. Dette er kodefunn;
vi har ikke målt en kontrollert første-runde-mot-tredje-runde-regresjon. Fixturen lagrer
bare beholdte bilder og overskriver erstattede bilder, så den kan ikke rekonstruere
nøyaktig hvilket bildebuffer som fantes etter første runde. Anker-ID inngår dessuten
i fangstbøtten; endret nærmeste anker kan gi ny bøtte ved gjenbesøk. Ikke endre denne
driftshåndteringen uten nye data som viser at dette faktisk er problemet.

**Prøvd, ikke beholdt:**
- Små TSDF-hull, maks radius 35 cm, alle kantpunkter innen 15 mm fra målt romplan:
  fylte 30 løkker / 325 trekanter, men omtrent uendret synlig hullareal i testvinkelen.
  Den nåværende TSDF-veien kaller faktisk ikke `fillPlanarHoles`; den eldre anchor-veien gjør det.
- Helt uten konsensus-avvisning: svakere enkelte tonegrenser, mer gjenskinn. Ikke valgt.
- Warp på sammen med ny teksturvariant: residual 0,0313 → 0,0300, men ikke en tydelig
  samlet visuell gevinst. Ikke slått på som standard. Merk at `blend=winner` ikke tvinger
  warpen selv om taket nå snittes; kommentaren om warp-justert tak betyr ikke at warp er aktiv.
- Lokal gain interpolert fra tre hjørner i stedet for centroiden: nye tydelige fasetter,
  forkastet. Implementasjonen er fjernet; ikke ny standard eller ny innstilling.

**Uskarphetstallene må tolkes riktig:** lagrede bilder i fixturen har estimert median
13,4 px / maks 53,3 px, men dette er vår bevegelsesmodell, ikke målt bildefeil. Loggens
globale maksimum teller også videorammer som aldri når uskarphetsporten (fartsporten og
andre vakter kommer først). «0 avvist» og global maks >60 px beviser derfor ikke en feil
i denne porten. Device-logger viser 10–16,7 ms låst eksponering; eksponeringsstrategien
er ikke endret i denne runden.

Neste nødvendige datagrunnlag: et nytt Ampex-skann av stua med oppdatert fangst, i
vanlig tempo, og helst Scaniverse av samme rom i samme lys. De gamle stue-/bad-fixturene
mangler komplett tett LiDAR-logg. Bruk eksisterende soverom til fortsatt bake-A/B.


## 7. Nye gjenbesøksskann 2026-09-08 kl. 19:26–19:27

Begge hentet fra Tormods iPhone etter installasjon av fangstrettelsene. TV-/panelhjørne,
brukerens rekkefølge én runde og flere runder. Rådata og telefonens GLB-kopier er bevart i
`.tmp/scan-fixtures/2026-09-08/` (git-ignorert). Komplett tett logg i begge; vi har nå to
nye, små LiDAR-fixtures i tillegg til soverommet. Ikke forveksle disse med full stue/bad.

| Måling | Én runde, mappe slutter 1788888400729 | Flere, 1788888432556 |
|---|---:|---:|
| Beholdte bilder | 14 | 21 |
| Rå dybdekart | 57 | 83 |
| Erstatninger / kandidater ikke bedre | 6 / 10 | 5 / 31 |
| Avvist av fartsport / uskarphetsport | 0 / 0 | 0 / 0 |
| Median estimert blur (ikke målt bildefeil) | 9,46 px | 16,67 px |
| Eksponering ved slutt | 10 ms | 10 ms |
| Telefonens trekanter / teksturdekning | 39 122 / 90 % | 27 126 / 98 % |
| TSDF-trekanter / teksturdekning | 73 646 / 96 % | 50 780 / 99 % |

**Telefonens nye skann er anchor-geometri**, som den vedtatte raske veien tilsier.
Tidligere simulator-A/B brukte automatisk TSDF når tett logg fantes. Sammenlign disse
veiene eksplisitt; ikke tilskriv ulikheten fangstkoden eller en bakeparameter.
`geometryPath=anchor-v2` i sluttloggen brukes også for TSDF og identifiserer ikke inputen.

Fem nye simulator-bakes, samme Release-kode som på telefonen:
- `one-tsdf`: 9,4 s bake + omtrent 1 s dybde/geometri.
- `multi-tsdf`: 9,2 s bake + omtrent 0,7 s dybde/geometri.
- `multi-no-planeavg`: anchor og `planeavg=off`, 5,4 s; tydeligere tonefelt, ikke beholdt.
- `early-only`: 12 beholdte bilder med timestamp < første+4 s, SAMME ferdige anchor-nett
  som flerrunde-skannet. 73 % teksturdekning mot 98 % med alle 21. Gjenbesøk brukes og
  tilfører dekning. Dette er **ikke** eksakt replay av første runde; erstattede bilder
  mangler, og tidligutvalget har ikke komplett takdekning. Ikke presenter dette som et
  bevis for at ekstra vinkler aldri forringer detalj.
- `multi-warp`: TSDF + eksisterende `warp=on`, 10,1 s. Warp-residual 0,0214 → 0,0211,
  men brutte panellinjer består. Ikke valgt som ny standard.

Renderingskontroll: egen variant av SceneKit-harnessen bruker transform/intrinsics fra
`fixture-kf.json`, frame 5 (stillestående panelvegg) og 12 (TV/hjørne), 1400×788. Innen
hvert skann beholdes samme kamerapose mellom geometri-/bakevariantene. Råbildet har
3840×2160; kameravinklene mellom de TO skannene er forskjellige. Rødt i render er hull.

**Visuelle funn:** enkelte råbilder i flerrunde-skannet er allerede mykere, men de rette
panellinjene blir også brutt/doble ved sammenstillingen. TSDF fjerner flere indre sprekker
fra anchor-modellen, mens hull rundt møbler/TV består eller blir større. TSDF-teksturen
har fortsatt feiljusterte linjer; tyngre geometri alene løser ikke skarpheten. TV-innholdet
endrer seg under opptak og blir blandet fra ulike tidspunkter; ikke bruk selve TV-bildet
som mål på statisk detalj eller bevis for kamerabevegelsesuskarphet.

Ingen ytterligere kildekodeendring valgt etter disse testene. Dataene støtter å arbeide
videre med lokal bilde-/geometrijustering og robuste overganger mellom valgte bilder,
uten å reaktivere forkastede globale blandings- eller glatteinnstillinger. Flere nye
skann trengs ikke for dette neste arbeidet. Fangstrettelsenes årsakseffekt er fortsatt
ikke målt mot et opptak av samme bevegelse med gammel kode.


## 8. Retning og justeringsrettelse 2026-09-08 kveld

Tormod har valgt **Scaniverse-kvalitet i Ampex sin egen app**. Import fra Scaniverse er
ikke valgt som hovedløsning. Kravet består: vanlig bevegelse og gjenbesøk som gir bedre
resultat. Ingen ny skanning behøves for å fortsette mot panel-/geometrifeilen.

Ny kontroll `multi-no-refine` (TSDF, `poserefine=off`) har fortsatt brutte panellinjer.
Hele problemet skyldes altså ikke GN-justeringen. En avgrenset feil i justeringen ble
likevel funnet og rettet i `MeshPoseRefineV2`:

- Residualen beregnes for posene FØR oppdateringen. Gammel kode eksporterte siste
  UTESTEDE steg når de målte residualene sank monotont. Nå kjøres et siste målepass
  uten nytt GN-steg, og tilstanden med beste gyldige måling eksporteres. Dermed beholdes
  alle åtte opprinnelige justeringssteg når de faktisk forbedrer målingen.
- Ved tilbakefall oppdateres nå også `camPos`, så synlighet/facing i warp ikke bruker
  kamerastilling fra en forkastet iterasjon.
- Warp manglet tilsvarende tilbakefall. Den beholder nå beste målte rutenett, inklusive
  identitet dersom alle målte oppdateringer er dårligere. Også siste warp-steg måles
  før valget, med samme antall GN-oppdateringer som før.
- Manglende observasjoner, NaN, uendelig og negativ residual får ikke erstatte et gyldig
  resultat. Lik residual beholder tidligere tilstand.

`tools/verify-scan-refine.py` kompilerer produksjonens `EvaluatedState` og kjører syv
påstander, inkludert forverring etter god iterasjon og identitets-warp. Simulator- og
iPhone Release-bygg passerer. `multi-checked-refine` og `multi-checked-warp` baker samme
flerrunde-fixture på henholdsvis 10,6 og 10,1 s. Visuell kontroll fra frame 5 viser at
**panellinjefeilen består**. Dette er en korrekthets-/stabilitetsrettelse, ikke en påvist
stor skarphetsgevinst. Beste fotometriske måling er heller ingen garanti for best
utseende, siden observasjonene/proxyen endres mellom iterasjoner.

Neste kvalitetsarbeid må måle lokal uenighet i stabile detaljer mellom bilder og geometri.
En ren senkning av gjennomsnittlig lyshetsresidual er utilstrekkelig. Prioriter rette
linjer og kanter i flere kameravinkler, og behold de tidligere avviste blandingsvariantene
som avviste til de faktisk forbedrer bildene.


Endelig kontroll etter innføring av siste målepass: `multi-final-evaluated` (warp på)
10,4 s og `bedroom-final-evaluated` (standard, warp av) 48,0 s. Begge GLB-er rendret
fra samme kontrollkamera som tidligere. Ingen klar samlet skarphetsgevinst; eksisterende
sømmer og lysstriper består. Endelig Release-bygg er installert på Tormods iPhone
8. september kl. 20:01. Ingen ekstra eksperimentflagg er aktivert på telefonen.


## 9. Dekningskrav før rangering av veggbilder, 2026-09-08

Diagnose med eksisterende `planelock=on`, `planesplit=0`, `ceilsplit=0` på flerrunde-TSDF:
beste faktiske dekning var bare 66,7 % og 58,4 % på de to planene. Ingen helplanslås er
mulig med det eksisterende 90 %-kravet. Ikke senk kravet og ikke aktiver denne testen
som ny TSDF-standard. Planlås alene løser ikke flerrunde-skannets feil.

En separat kodefeil ble målt på **én-runde-fixturens anchor-vei**, vanlig delingsbudsjett:
`one-plane-diagnosis` valgte et foto med 89,9 % dekning, mens høyeste tilgjengelige
var 91,2 %. Den gamle koden rangerte alle med minst 50 % dekning, men krevde så at
VINNEREN hadde minst 90 %. En ugyldig vinner skjulte dermed en gyldig kandidat og
førte til unødvendig deling/fallback.

Rettelsen i `planeViewScore` filtrerer på det eksisterende 90 %-kravet FØR rangeringen.
Scoren og planshot-prioriteten er uendret blant gyldige bilder. Verken terskelen,
geometrien eller TSDF-planlåsens standard endres. Diagnose-logg per segment er fjernet
fra produksjonskoden. `tools/verify-scan-plane-score.py` kjører den faktiske Swift-metoden
med seks påstander, inklusive det målte 89,9/91,2 %-tilfellet. Passerer.

Endelig A/B med samme én-runde-geometri og justeringskode: `one-plane-diagnosis`
→ `one-eligible-plane`. Delinger 7 → 6, fallback 3 → 2, flater låst til sammenhengende
fotovalg 3553 → 7757. Dekning fortsatt 90 %, 39122 trekanter uendret. Baketid
7,7 → 9,3 s i disse enkeltkjøringene (ikke en ytelsesbenchmark). Rendering fra frame 5
viser lokale endringer, men panellinjebrudd består. Ikke en dokumentert stor skarphetsgevinst.

`multi-eligible-plane` anchor-kontroll: 8,5 s, 98 % dekning, 2 segmenter låst,
3 delinger og 0 fallback. Tilnærmet samme resultat som telefonens tidligere anchor-bake;
ingen tydelig visuell forbedring eller grov regresjon fra samme frame-5-kamera.
Telefonbaselinen er fra før justeringsrettelsen i avsnitt 8 og isolerer derfor ikke
bare denne endringen. Simulator- og iPhone Release-bygg passerer.
Kontrollbilder, begge nye GLB-er, før-kilde og logg er bevart i gitignorert
`.tmp/scan-fixtures/2026-09-08/plane-score-checks/`.

Endelig bygg med dekningsrettelsen installert på Tormods iPhone 8. september kl. 20:41,
uten avinstallering eller nye eksperimentflagg.

## 10. Warp nådde ikke vinnerens detaljlag, 2026-09-08 kveld

Kontroll `single-photo`: kun original frame 5 fra flerrunde-fixturen, samme anchor-nett,
`poserefine=off`, `planeavg=off`. 3,2 s. Flere panellinjebrudd forsvinner fra frame-5-kameraet,
mens hullene består. Dette isolerer sammenstillingen, men beviser ikke at geometrien er
riktig fra andre vinkler: en reprojeksjon fra kildekameraet kan skjule dybdefeil.
`multi-ceil-detail` med TSDF og eksisterende `ceilflat=off`: 6,2 s; ingen klar bedring på
panelveggen. Ikke endret standard.

Kodekontroll fant at `bakev2_fragment` (vinnerens detaljer) og `bakev2_feather_fragment`
aldri mottok/samplet warp-rutenettet. Bare snitt-passene brukte det. Tidligere `warp=on`
kontroller testet dermed ikke lokal justering av vinnerdetaljen på veggene. Dette er en
begrensning ved tidligere konklusjoner om warpens visuelle effekt, ikke bevis for at
warpen alene løser problemet.

Vinner- og fjæringspass mottar nå samme normaliserte rutenett, med identitet når feltet
mangler. `tools/verify-scan-detail-warp.swift` kjører produksjonens Metal-interpolasjon
og passerer åtte påstander for identitet, konstant forskyvning, interpolasjon og kanter.
Warp er fortsatt opt-in; ingen endring til standardinnstillingen. Endelig simulator Release-bygg passerer (arm64; avbrøt et unødvendig ekstra x86_64-bygg).
Hele produksjonens Metal-kilde kompileres også av selvtesten.

Presisering til eldre avsnitt: påstandene om nøyaktig hvordan Scaniverse velger/blander
tekstur er tidligere arbeidshypoteser, ikke verifisert innsikt i deres lukkede motor.

Endelig visuell kontroll fra samme frame-5-kamera:
- `multi-detail-warp`: TSDF, 11,0 s. Nå flyttes også detaljlaget, men de store
  panelbruddene består. Sammenlignet med `multi-final-evaluated` fra før oppkoblingen
  er endringene små; ikke en dokumentert stor kvalitetsgevinst.
- `multi-detail-off`: TSDF standard, 9,1 s. Ingen tydelig visuell regresjon mot tidligere
  standardkontroll. Geometri: samme 50780 trekanter.
- `one-detail-warp`: anchor, 7,7 s. Sammenlignet med `one-eligible-plane` (warp av):
  små endringer, hovedfeilen består. Ikke grunnlag for å aktivere warp som standard.

Kontrollbilder og GLB-er bevart i `.tmp/scan-fixtures/2026-09-08/detail-warp-checks/`.
Reankring er også målt mot `frames.json`: median 0 mm i begge opptak, maksimal
posisjonsendring under 0,00011 mm. Ingen relevant translasjonsforskjell her.
Neste arbeid må måle feilplassering av samme statiske kant mellom konkrete bildesyn,
inkludert geometrisk dybdefeil. Det eksisterende grovnettet og proxy-optimeringen
er fortsatt utilstrekkelig, selv når resultatet faktisk brukes på detaljene.

iPhone Release-bygg passerer også. Ingen ny installasjon på telefonen i denne runden;
warp er fortsatt av som standard, og det er ikke målt grunnlag for å slå den på.

## 11. Kantkorrespondanser på faktisk mesh, 2026-09-08

`tools/audit-scan-reprojection.py` raycaster GLB-geometrien fra frame 5, lager lokale
planprojiserte råbildepatcher og søker etter samme kant i andre originalbilder. 960 px
bildebredde. ROI er uttrykkelig panelområdet i de to september-fixturene; ikke generell
rommetrikk. Dybdesikt sjekkes mot lagret LiDAR med 10 cm toleranse. Referanse mot seg
selv skal gi null forskyvning på alle punkter (hard påstand, passerer begge opptak).

Første 2D-NCC ga store falske forskyvninger LANGS de gjentatte panelsporene; forkastet
som mål. Endelig diagnostikk trekker fra lokal lineær lystrend, krever kantstruktur og
NCC ≥ 0,85, og søker kun normalt på kanten (±14 px, 0,5 px steg). Ingen treff betyr
utilstrekkelig observasjon, ikke feilfri registrering. Gjentatt struktur er fortsatt en
begrensning; resultatene er ikke en full kvalitetsscore.

Målt på anchor-geometrien: én-runde frame 3/4/6/7/8 har median kantforskyvning ca.
12/6/3/7/9 px. Flerrunde frame 16 ca. 3 px (TSDF ca. 4,5 px). Alle tall ved 960 px
bredde, ikke telefonens 3840 px. Uavhengig punktkontroll innen de samme bildene: median
forskyvning tilpasset annenhver match, evaluert på de øvrige. Median absolutt y-feil:
én-runde f3 11,96→0,99; f4 6,00→0,50; f6 3,25→0,50; f7 6,99→1,49;
f8 9,24→1,00. Flerrunde f16 3,00→0,25 px. Dette er punkt-holdout på samme vegg,
ikke uavhengig rom-/kamerabanevalidering.

Fire kontroll-bakes, samme anchor-geometri, alle bilder beholdt, poserefine AV:
`edge-before` 8,5 s → `edge-after` 8,0 s på flerrunde, og `one-edge-before` 7,4 s →
`one-edge-after` 7,3 s på én-runde. Etter-kopiene koder den målte bildeforskyvningen
som en midlertidig cx/cy-endring i fixture-kf.json for bilder med ≥5 gode matcher.
Dette er en DIAGNOSE, ikke fysisk kamerakalibrering eller ny app-standard. Originalene
er urørt. Også score/synlighet kan påvirkes av denne representasjonen, så A/B isolerer
ikke endring av sampling med frosne vinneretiketter.

Render fra samme frame-5-kamera viser lokale endringer, men fortsatt brutte linjer og
skjøter. Punktkorrespondansene er langt mer enige; det er ikke nok til å erklære ferdig
modell bra. Dokumentasjon, før/etter-manifester, GLB-er og bilder er bevart i
`.tmp/scan-fixtures/2026-09-08/edge-alignment-checks/` (originalbilder i søskenarkivet).

En lineær sensitivitetstest flytter treffpunktet langs referansestrålen og måler
projeksjonsendringen. Å forklare flere av én-runde-bildenes forskyvninger med kun
slik dybdeendring ville kreve motstridende endringer på omtrent +0,8 / −0,7 m.
Dette er ingen full geometriløsning, men støtter IKKE å bare flytte veggen noen cm.

Neste konkrete steg: bruk robuste kantkorrespondanser som faktisk styringssignal for
bildejustering, med flere referansebilder/områder og fast geometri. Bevar rå kameradata;
eksporter et separat bildefelt til sampleren. Valider på andre kameravinkler og hele
rommet før aktivering. Ingen ny native-kode eller telefoninstallasjon i denne runden.

## 12. Flere referanser og direkte sampler-kontroll, 2026-09-08

Audit-skriptet tar nå valgfri referanseindeks og eksporterer kantnormal + lokal
projeksjons-Jacobi. `tools/solve-scan-edge-offsets.py` løser et robust nettverk av
bildeforskyvninger: d_target − J·d_ref = målt forskyvning, projisert normalt på kanten.
Frame 5 holdes fast. Kun observerbare retninger beholdes per bilde (egenverdi >10 % av
største); helt uobserverte bilder får null. Dette er viktig: en fri 2D-løser fant på
opptil 94 px forskyvning LANGS panelsporene. Den varianten er avvist.

Én-runde: referanser 3,5,7; 237 treningsmålinger / 226 kontrollmålinger. Median absolutt
normalfeil 6,00→1,08 px; p90 11,00→2,81. Flerrunde: ref 3,5,16; 52/47 målinger,
median 2,00→0,75; p90 4,70→1,28. Kontrollen bruker annenhver match, ikke uavhengige
rom; nærliggende patches kan overlappe og samme kant kan inngå fra flere retninger.
Tallene dokumenterer bedre lokal enighet, ikke Scaniverse-kvalitet eller at alle bilder
kan kalibreres. Flere bilder i flerrunde-skannet har ingen gode observasjoner her.

For å skille samplingen fra omvalg av foto har Mac-harnessen nå
`-meshscan.edgeoffsets <løserens JSON>`. Filen leses BARE av headless-harnessen,
valideres, normaliseres og mates via `MeshBakeV2.debugImageOffsets`. Korreksjonen
legges på etter valg av bilder/regioner, og tilstanden nullstilles ved retur. Ingen
rådata eller kameraintrinsikker endres. Live-skann har ingen ny standardinnstilling.
Dette er et kontrollverktøy, ikke en ferdig kantjusterer på iPhone.

Simulator Release arm64 bygger. `one-edge-sampler` 8,3 s, 39122 tris, 90 % dekning;
`multi-edge-sampler` 8,3 s, 27126 tris, 98 % dekning. Begge rendret fra samme frame-5-
kamera som kontrollene i §11. Små lokale forbedringer/endringer, men fortsatt panelbrudd
og tonetrinn. Sampler-kontrollen endrer ikke algoritmen for bildevalg, men separate
bakes kan ha små ikke-deterministiske forskjeller i regioninndelingen.
Artefakter og logg: `.tmp/scan-fixtures/2026-09-08/edge-graph-checks/`.

Neste konkrete inkonsistens: `toneAt` og sømnivelleringens `sampleLinear` måler fortsatt
fargen UTEN warp, selv når detalj-/snittsampleren bruker feltet. En korreksjon beregnet
mot feil bildepunkt kan derfor legge tilbake feil tone eller linjespor. Dette må testes
med samme felt i fargemåling og sluttsampling, før større warp-felt eller ny standard.
Telefonen er ikke oppdatert i denne runden; målet er fortsatt åpent.

## 13. Samme felt i sømfarge og sluttsampling, 2026-09-08

`sampleLinear` (sømnivellering/-forfining) og `toneAt` (plan-tone) bruker nå
`warpedImageUV` med samme felt og dimensjoner som Metal-sampleren. Feltet klargjøres
etter poseraffineringen, uten å endre kameradata eller geometrisk score. Tomme felt
går gjennom den gamle regneveien, så standard uten warp beholder koordinatene.
Overlapp-gain før bildevalget er fortsatt uwarpet; denne rettelsen gjelder de to
fargemålingene etter bildevalget. Ikke hevde at samtlige farge-/scoreledd er endret.

`tools/verify-scan-color-warp.py` kjører den faktiske Swift-funksjonen mot åtte av
Metal-testens tilfeller og et ekstra tilfelle for manglende felt. Ni påstander passerer.
Første bygg traff Swifts begrensning for typeutledning av en lang SIMD-sum; uttrykket
ble delt uten å endre interpolasjonen. Endelige simulator- og iPhone Release-bygg passerer.

Samme graph-offset-filer som §12, anchor og poserefine av:
`one-edge-color` 7,9 s; `multi-edge-color` 11,9 s. Begge sammenlignet med sampler-only
fra frame 5 OG frame 12. Små fargeendringer, ingen stor samlet kvalitetsgevinst. Brutte
panelspor, hull og tonetrinn består. TV-innholdet er dynamisk og brukes ikke som
skarphetsmål. `one-color-default` 7,9 s passerer uten offset-fil/warp og viser ingen
klar visuell regresjon fra tidligere standard. Ingen ny standard eller telefoninstallasjon.

Artefakter: `.tmp/scan-fixtures/2026-09-08/color-warp-checks/`.
Neste større steg er en native kantbasert korrespondanse-/justeringsvei som dekker
flere bildeområder automatisk, ikke bare Mac-skriptets valgte referanser og panel-ROI.
Eksisterende luma/depth/pose-data i `MeshPoseRefineV2` kan gjenbrukes. Separate bilde-
felt skal returneres til den nå sammenhengende sampleren uten å skrive om rå kalibrering.
Før aktivering kreves visuell gevinst over hele skannet og flere kontrollkameraer.


## 14. Automatisk native kantmatching, 2026-09-08 kveld

Opt-in `meshscan.edgerefine=on` i `MeshPoseRefineV2`: velger opptil 40 sterke
bildepatcher per frame, projiserer 9×9 tangentplan-patcher til fire nærliggende
kameraer og søker todimensjonale forskyvninger. Lineær lysgradient fjernes før NCC.
Tvetydige treff forkastes; rene kanter gir bare en normalbegrensning. Robust graf
estimerer én todimensjonal forskyvning per bilde, levert som konstant 12×8 warp.
Rå kameraer og geometri endres ikke. Den vanlige poseraffineringen erstattes bare
under dette eksperimentflagget; ingen ny standard eller telefoninstallasjon.

Første endimensjonale profilvariant ble FORKASTET: lavere holdout-residual til tross
for feil kjent forskyvning (2,28/0,45 mot forventet 4/−3). Testen ble ikke svekket.
`tools/verify-scan-native-edge.py` kjører den faktiske Swift-metoden på syntetiske
bilder. Endelig 2D-matcher finner (4,008/−3,027) og (−3,011/5,030); strukturløse
bilder gir ingen korreksjon. Holdout grupperer x/y fra samme treff sammen.
Dette beviser enkle bildeoversettelser, ikke kamerabevegelse eller romkvalitet.
Simulator arm64 og fysisk iPhone Release bygger.

Ekte fixtures, samme originale rådata:
- Én runde, anchor: 560 patcher, 870 begrensninger, 181 holdout;
  median 5,00 → 1,03 px. Justering 0,5 s, bake 8,3 s.
- Flere runder, anchor: 715 patcher, 917 begrensninger, 181 holdout;
  median 2,00 → 0,96 px. Justering 0,6 s, bake 8,6 s.
- Soverom, TSDF fra 620 dybdeframes og 152 bilder: 4985 patcher,
  7166 begrensninger, 1405 holdout; median 2,00 → 0,86 px.
  Justering 3,4 s, teksturbake 56,5 s (TSDF-fasen kommer i tillegg).

Panelmodellen har fortsatt synlige skjøter og hull, også fra frame 12.
Soveromsrenderen viser mer utsmurte detaljer ved røde paneler enn tidligere kontroll.
Residualen alene er derfor IKKE aktiveringskriterium. En global forskyvning kan ikke
antas å beskrive ulik feil i forskjellige deler av bildet. Neste undersøkelse må
måle romlig restfeil og skille lokal registrering fra feilkorrespondanser, før et
mer fleksibelt felt introduseres. Scaniverse-målet er fortsatt ikke nådd.
Artefakter samles i `.tmp/scan-fixtures/2026-09-08/native-edge-checks/`.

Direkte kontroll med samme bygde kode, `bedroom-native-control` (`edgerefine=off`),
fullførte på 47,7 s pluss TSDF. Samme orbitkamera 180/25/0 bekrefter tydeligere røde
paneldetaljer i kontrollen enn med global edge-warp. Små geometriforskjeller fra
forenkling (249021 mot 249017 tris) består; dette er ingen pikselidentisk mesh-test.
Global edge-warp forkastes som standardkandidat i nåværende form. Beholdt opt-in
for diagnostikk, ingen endring av live-standard. Neste måling: romlig fordeling av
holdout-feil og samsvar mellom lokale patcher før en eventuell lokal feltmodell.


## 15. Romlig audit av kantmatching, 2026-09-08

`meshscan.edgeaudit=on` sammen med `edgerefine=on` skriver `edge-audit.json` i
fixture-mappen: begge bildekoordinater, begrensningsretninger, forskyvning,
trenings-/holdout-tilhørighet, estimert felt og residual. Eksporten skjer etter
løsningen og endrer den ikke. Swift-testen verifiserer også diagnostikkformatet;
simulator Release bygger. Ingen ny telefoninstallasjon eller standardendring.

`tools/audit-scan-edge-field.py` undersøker holdout per bildekvadrant og tester en
regulert affin tilleggskorreksjon på Mac (seks koeffisienter per bilde, IRLS, fast
ankerkamera). Alle holdout-rader holdes ute av tilpasningen. Tre ridge-styrker vises;
dette er utforskende modellvalg, ikke uavhengig sluttvalidering. Gjentatte kanter og
omvendte bildepar kan fortsatt korrelere trening/holdout. Ikke bruk disse tallene
som bevis for visuell kvalitet eller en ferdig kameraposeløsning.

Én runde: global median/p90 = 1,028/2,712 px, 19,9 % over 2 px.
Affin ridge=1: 0,555/1,680 px, 6,6 % over 2 px. Global løsning forverrer 4,4 % av
holdout-begrensningene med mer enn 1 px sammenlignet med rå forskyvning.
Soverom: global median/p90 = 0,856/3,509 px, 21,7 % over 2 px.
Affin ridge=1: 0,682/2,969 px, 16,2 % over 2 px. Global løsning forverrer 10,2 % med
mer enn 1 px. Én kvadrant i frame 57 har median 11,7 px (bare fem begrensninger).
Dette viser at median-gaten skjuler store lokale restfeil. Det beviser ikke alene
om hvert slikt treff er feil eller om lokal geometri/projeksjon er årsaken.

Neste konkrete kontroll: et begrenset romlig felt gjennom den eksisterende sampleren,
med vurdering av lokale utslag og faktiske detaljer fra flere kameraer. Affine
koeffisienter er hittil bare analysert, ikke lagt på en GLB eller i live-appen.
Artefakter: `.tmp/scan-fixtures/2026-09-08/edge-spatial-checks/`.


## 16. Affint felt i faktisk tekstur, 2026-09-08

Harnessen støtter nå `meshscan.edgefields <JSON>` med normaliserte 12×8-felt per
keyframe.index. Format, frame-ID, nodeantall og endelige grenser valideres, statisk
tilstand nullstilles ved retur. Feltet går til både CPU-fargemåling og Metal-sampling.
Ingen endring av råkameraer eller standardvei. `audit-scan-edge-field.py` kan eksportere
ridge=1-felt fra §15. Eksport nekter ved frameantall som avviker fra full fixture;
kun ufiltrerte fixtures er støttet uten eksplisitt native ID-map. Korreksjon begrenses
til 32 luma-piksler. Kontrollerte felt er affine på gridet, uten folding
(Jacobian-determinant 0,994–1,010). CPU-samplerens ni påstander passerer; simulator
arm64 og iPhone Release bygger. Ingen telefoninstallasjon.

`one-affine-field`: anchor, poserefine=off, 8,0 s. Sammenlignet med native globalt
felt fra frame 5 og 12. Små lokale endringer; brutte panelspor består.
`bedroom-affine-field`: TSDF, poserefine=off, 47,0 s bake pluss TSDF. Orbitkamera
180/25/0 viser fortsatt utsmurte røde paneler. Ikke tydelig samlet gevinst og ikke
klar for standard. Dette er et diagnostisk Mac-felt, ingen native affin løser.
Artefakter: `.tmp/scan-fixtures/2026-09-08/affine-field-checks/`.

NYTT viktig funn fra de eksporterte matchene: panelgrafen er sammenhengende (14
frames), men soverommets 152 frames danner 15 adskilte komponenter med størrelser
25,4,16,1,1,3,50,15,1,26,1,2,4,1,2. Frames 45,46,65,79,149 er isolerte.
Én ankerframe kan derfor ikke forankre alle bildene relativt til hverandre.
Bedre intern residual i komponentene sier lite om samsvaret MELLOM dem. Dette er
en konkret svakhet ved bare fire nærmeste kameraer som korrespondansekandidater.
Neste prioritet er gode treff som forbinder gruppene (synsoverlapp og gjenbesøk),
før flere frihetsgrader i warp eller større default-korreksjoner.


## 17. Overlapp og gjenbesøk i matchgrafen, 2026-09-08

Opt-in `meshscan.edgeoverlap=on` med `edgerefine=on`: kandidatvalg bruker synlige
mesh-patcher i alle bilder. Opptil åtte med størst overlapp og fire med tidsmessig
spredning, minst seks synlige patcher. Selve NCC-/tvetydighetskravene er uendret.
Første uttrykkskjede traff Swift typecheck-grensen; eksplisitte løkker løste dette.
Kjent syntetisk forskyvning passerer, simulator arm64 og iPhone Release bygger.
Ingen ny standard eller telefoninstallasjon.

Soverom: 16698 begrensninger, 3322 holdout, justering 9,1 s. Matchgrafen er nå én
komponent med alle 152 bilder. Med minst seks korrespondanser per bildepar har den
største komponenten 132 bilder (før 23), deretter 12 og åtte isolerte. Dette er
bedre forbindelse, ikke bevis for riktige posisjoner eller skarphet. Gjentatte
patcher/omvendte par kan også telle flere korrespondanser.
Holdout median 2,68→1,17 px, p90 etter 5,01 px. Nytt kandidatsett er vanskeligere og
har andre holdout-rader; ikke sammenlign medianen direkte mot gammel som en score.

`bedroom-edge-overlap`: TSDF + globalt felt, 55,2 s bake (TSDF i tillegg), samme
orbitkamera 180/25/0. Enkelte røde paneldetaljer tydeligere enn den tidligere native
varianten, men fortsatt blur og skjøter, også ny synlig teksturkant ved lampen.
`one-edge-overlap`: anchor, 8,8 s, frame 5 viser fortsatt brutte panelspor.
Affin ridge=1 på ny graf gir holdout median/p90 0,765/3,751 px.
`bedroom-overlap-affine`: 44,6 s bake pluss TSDF, fortsatt blur og skjøter i renderen;
ingen klar samlet kvalitetsgevinst. Begge forblir diagnostiske eksperimenter.

Neste undersøkelse må knytte registreringsfeilen til bildene som FAKTISK bidrar til
teksturen på en problemflate. Sammenhengende graf og lavere residual er nå prøvd
uten å løse den synlige feilen; ikke bare øk fleksibiliteten eller senk tersklene.
Artefakter: `.tmp/scan-fixtures/2026-09-08/edge-overlap-checks/`.


## 18. Kildebilder og tone på én faktisk problemflate, 2026-09-08

Harnessen kan nå koble eksisterende `debugSink` til `meshscan.trace=on`; punkt valgt
med `meshscan.tracepoint` (kommaseparert xyz) gir åtte nærmeste flater med vinner,
modus, synlige kandidater/score/tone, hjørne-/regionoffset og fjæringsbidrag.
Første forsøk koblet avlesningen til feil inngang og skrev ingen trace; rettet til
harnessen. Punktargument med innledende minus må sendes som separat verdi med
innledende mellomrom, som parseren trimmer. Begge Release-bygg passerer.

Punkt på rødt panel: (−0,1393235, 0,2948809, 1,5157453), funnet med SceneKit hit-test
ved skjerm (650,350) i viewport-koordinater (bildets y er omvendt).
`bedroom-point-trace-fixed` 46,2 s bake pluss TSDF. Nærmeste flate er HYBRID,
vinner `frame-60.jpg`, 16 kandidater i toneberegningen, ingen fjæringsbidrag.
Regionoffset i rødt ca. 0,0052; hjørneoffset 0,0129–0,0281 over denne lille flaten.
Foto 60 er også visuelt uskarpt. Dette skiller både kildekvalitet og romlig varierende
tone fra søm-fjæring som årsak akkurat her. Kandidatscore er ikke endelig pikselvekt.

Kontroll `planeavgpx=64` (fra standard 512) med vanlige poser:
soverom 47,0 s, panelopptak anchor 8,0 s. Noen røde panelspor blir tydeligere, men
panelopptaket har fortsatt brudd og rommet har fortsatt feil/blur. Ikke aktivert.
Fargeberegningen kan bære detaljer; påstanden om at additive hjørneoffset aldri
kan smøre detaljer er for sterk når offset varierer over nettet. Det kreves bredere
visuell kontroll før eventuell ny standard for tonebåndet.

Kildepatch-sammenligning: de seks høyest skårede bildene projisert til samme lokale
30×30 cm flate rundt punktet (konstant lokal z, diagnostisk planantakelse). Panel-
overgangene ligger tydelig ulikt, ikke bare ulikt belyst. Rødt i denne montasjen
betyr utenfor kildebildet (i modellrenderne betyr rødt geometrihull).
Dagens små 17×17-luma-piksel patcher og ±14 px søk kan låse på feil repetert spor;
lav NCC-residual og sammenhengende graf beviser dermed ikke korrekt korrespondanse.
Neste kontroll: større utsnitt med panelhjørner/overganger og større innfangingsområde,
med test mot repetert mønster før ny felt-/posemodell. Ikke fortsett å optimalisere
samme tvetydige småpatch-residual uten å kontrollere selve treffene.
Artefakter: `.tmp/scan-fixtures/2026-09-08/point-trace-checks/`.


## 19. Større patcher og innfangingsområde, 2026-09-08

Opt-in `edgewide=on` med `edgerefine=on`: 9×9 samples med 6 px steg (49 px spenn),
søk ±48 px med 4 px grovsteg og 0,5 px finsteg. Feltgrense 64 px i dette eksperimentet.
Småpatch-eksperimentet beholder 17 px spenn/±14 px; finrunden er nå ±2 px.
`verify-scan-native-edge.py` tester også forskyvninger (24,−18), (−20,15): gjenfunnet
med feil under 0,5 px. Eksakt repeterte striper med 16 px periode gir INGEN korreksjon.
Simulator Release arm64 bygger; ingen ny telefoninstallasjon eller standardendring.

Soverom: 4934 patcher, 22477 begrensninger, 4487 holdout; 2311 begrensninger har
forskyvning over 14 px. Justering 21,2 s, bake 66,2 s pluss TSDF. Grafen er fortsatt
sammenhengende; med minst seks korrespondanser per par er 147 bilder sammenkoblet,
fem isolerte (44,67,91,92,95). Største feltkomponent ca. 37,8 px.
Holdout median 3,50→1,49 px, p90 etter 9,01 px. Dette er et annet og vanskeligere
kandidatsett; lavere/høyere score kan ikke alene sammenlignes med forrige variant.
Render fra samme orbitkamera har fortsatt panelblur og skjøter, ingen klar samlet gevinst.

KONTROLL av problemflaten fra §18: søker man bare treff med foto 60 som referanse,
er nærmeste patch 164 px unna punktet. Dette er IKKE hele bildet: innkommende treff
fra foto 54,55,107 til foto 60 ligger 30,7 px unna. Disse har absolutte restfeil
etter global løsning på ca. 10,7–28,1 px (rå skiftkomponenter −11…5 px).
Den globale løsningen passer derfor denne lokale flaten dårlig, selv om samlet
median faller. Ikke hevde at panelet mangler alle treff. Neste modellkontroll må
rapportere denne lokale feilen eksplisitt og kontrollere om en romlig eller fysisk
kamerajustering kan passe den, uten å ofre øvrige områder. Flere treff alene løser
ikke problemet. Artefakter: `.tmp/scan-fixtures/2026-09-08/edge-wide-checks/`.


## 20. Lokal validering og inspeksjon av aksepterte treff, 2026-09-08

`audit-scan-local-registration.py` holder hele en radius på 100 luma-piksler rundt
problemflaten i frame 60 utenfor tilpasningen, i tillegg til vanlig holdout.
Oversettelses- og affine modeller løses fra rå skift, ikke fra en allerede tilpasset
native løsning. Andre bilder av samme flate kan fortsatt gi korrelasjon; dette er
ikke en uavhengig romtest.
20 lokale begrensninger: native median/p90 20,11/41,13 px.
Ny global tilpasning ridge=1: 20,52/42,87. Affin ridge=1: 20,66/51,44.
Affin forbedrer øvrig holdout (median 1,07 mot 1,51) uten å forbedre dette området.
Ridge=10 demper begge, men lokal median er fortsatt omtrent 15 px.
Ikke bruk en bedre samlet affin score som grunn til aktivering.

Tre innkommende treff fra 54,55,107 til 60 ble visualisert med lokal affin
approksimasjon av den eksporterte prosjektive Jacobianen. Patchene viser bare
uskarpe gjentatte spor, ikke en panelovergang. Dette gjør korrekt fysisk
korrespondanse visuelt uavklart. Approksimert tett NCC er 0,85–0,90; dette er IKKE
samme eksakte sampling som native tangentplan-projeksjon og kan ikke brukes som
påstand om en NCC-implementasjonsfeil. De brede 49 px patchene fanger fortsatt ikke
alltid entydige strukturer på denne detaljen.

Ekstra syntetisk kontroll med periode-16-striper og faseskiftende sinus-støy avvises
allerede av wide-matching. Testen er bevart som en hard påstand; ingen terskelendring
ble gjort for å konstruere en feil. Dette beviser ikke at de ekte treffene er rette.
Neste kontroll bør inkludere større strukturell kontekst (paneloverganger) sammen
med det lokale mønsteret, eller fysisk kontrollerte korrespondanser; ikke mer fri
warp på samme uavklarte treff. Ingen native endring eller telefoninstallasjon denne
runden. Artefakter: `.tmp/scan-fixtures/2026-09-08/local-model-checks/`.


## 21. To skalaer samtidig, 2026-09-08

Opt-in `edgecontext=on` sammen med wide/overlap: lokal 49 px-patch og større
129 px-kontekst, begge 9×9 samples. Score er minimum av normalisert korrelasjon på
begge skalaer; søk ±64 px. Begge må passere samme terskel. Kontekst går gjennom
samme tangentplan-projeksjon; dette kan være feil over store ikke-plane områder.
Kjente store skift passerer under én piksel, periodiske striper og støyvarianten
gir ingen felt. Simulator Release arm64 bygger. Standard og telefon uendret.

Rommet: 4470 patcher, 12107 begrensninger, 2405 holdout, median 2,50→1,14 px.
Justering 58,5 s; bake 103,8 s pluss TSDF. Lokal kontroll rundt frame-60-panelet
har nå NULL treff (alle retninger tatt med). Dette er manglende lokal støtte,
ikke null feil. Audit-verktøyet rapporterer null/ukjent fremfor å beregne median
av et tomt sett.

Ny kamerakontroll fra frame 60 viser tydelige doble mønstre i standardmodellen,
og de består med context. Tone64 fra §18 er også rendret fra denne vinkelen:
noen detaljer klarere, men panelkantens feil består. Ingen ny standardkandidat.
Rå kamera i fixture er brukt som visningskamera; standard-GN kan ha endret
teksturkameraene litt, så dette er visuell sammenligning, ikke eksakt råpikselmåling.

Stadig større tangentplan-patcher har nå gitt lavere antall treff, høyere kjøretid
og ingen løsning på valgt problemflate. Neste retning bør være eksplisitte
bildehjørner/deskriptorer med geometrisk kontroll av korrespondansene, før et nytt
pose-/feltforsøk. Ikke likestill lavere NCC-residual med riktig fysisk matching.
Artefakter: `.tmp/scan-fixtures/2026-09-08/edge-context-checks/`.


## 22. SIFT med geometrisk kontroll, 2026-09-08

Isolert Mac-miljø `/private/tmp/ampex-feature-env` med OpenCV-headless 5.0.0.93 og
NumPy 2.5.3, versjoner i `tools/requirements-scan-features.txt`. Ingen ny appavhengighet.
`audit-scan-features.py` prøver SIFT, gjensidig descriptor-ratio <0,7 og RANSAC på
utvalgte bilder. Hver femte korrespondanse holdes utenfor geometrisk tilpasning.
Kontrollerer både homografi (bare gyldig for en flate) og fundamentalmatrise
(epipolargeometri for 3D). Epipolarfeil er avstand til geometrisk linje, IKKE full
2D-registreringsfeil. Metodegrunnlag: OpenCVs offisielle matcher-/homografidokumentasjon:
https://docs.opencv.org/4.13.0/dc/dc3/tutorial_py_matcher.html
https://docs.opencv.org/5.0/py_tutorials/py_features/py_feature_homography/py_feature_homography.html

Rødt-panel-masken gir bare 0–3 gjensidige treff mot valgt frame 60; planar oppretting
før matching hjelper ikke. Fullbilder mot frame 60 gir også få treff fra 54/55/58/107.
Mot frame 55 derimot: 54→55 har 48 treff, 28 epipolar-treningsinliers, 9/10 holdout
innen 2 px (median 1,36 px); 58→55 har 76 treff, 49 treningsinliers, 15/16 holdout
innen 2 px (median 0,47 px). Bilder er skalert til 1600 px bredde.
Homografier har rundt 4 px holdout-median for disse parene; ikke bruk én flate som
modell for hele rommet. 107→55 feiler holdout kraftig og skal ikke brukes.

Naboer til frame 60: 61→60 har 60 gjensidige treff, 31 epipolar-treningsinliers,
9/12 holdout innen 2 px (median 1,51). 59/62 gir svakere kontroll. Frame 60 er altså
ikke helt utilgjengelig, men kan ikke knyttes trygt til alle de andre direkte.
Bildene med linjer i skriptet viser homografi-inliers, ikke epipolar-inliers.

Ekstra kontroll bruker rå LiDAR-dybde på homografi-konsistente SIFT-punkter og dagens
AR-kameraer (dybde-nabolag med spenn >8 cm forkastes). Reprojeksjon median/p90:
54→55 3,75/6,11 px (26 punkter), 58→55 8,87/14,02 px (32 punkter), ved 1600 bredde.
107→55-tallet er ikke pålitelig fordi parmatchingen feilet holdout. Dette gir et
mer fysisk grunnlag for neste forsøk: kontrollerte kamerajusteringer med 3D-dybde
og geometrisk verifiserte bildepunkt, framfor flere globale bildeoffset.
Ingen kameraer, modeller eller native appstandard er endret i denne runden.
Artefakter: `.tmp/scan-fixtures/2026-09-08/feature-checks/`.


## 23. Fysiske kameraforslag med LiDAR/PnP, 2026-09-08

`audit-scan-pnp.py`: løfter SIFT-punkt gjennom kildens rådybde og AR-pose til 3D,
forkaster 3×3-dybdenabolag med spenn >8 cm, bruker RANSAC-PnP og LM på treningspunkter.
Kilden holdes fast; mål-kameraets seks frihetsgrader tilpasses. Holdout brukes ikke
i PnP. Korrigerte transforms skrives bare som diagnostiske JSON-forslag, ikke i fixture.
Kandidatpar må allerede ha ≥75 % epipolar-holdout innen 2 px og median ≤2 px.
Referanse for API og koordinatretning:
https://docs.opencv.org/doc/doxygen/html/d2/d48/group__d__projection.html

Ved 1600 px bredde:
- 54→55: 37 treningspunkter, 30 inliers, 6 holdout. Median 2,87→2,21 px,
  p90 8,99→7,11; justering 2,36 mm / 0,239°.
- 58→55: 52 trening, 44 inliers, 14 holdout. Median 10,64→2,09 px,
  p90 14,01→4,20; under 5 px: 0→13/14. Justering 13,10 mm / 0,498°.
- 61→60: 44 trening, 36 inliers, 12 holdout. Median 4,11→3,28 px,
  p90 7,79→4,77. Justering 15,24 mm / 0,388°.

VIKTIG kryssreferansekontroll: kandidat 55 fra referanse 54 gir 11,66 px median
mot referanse 58. Kandidat 55 fra referanse 58 gir 11,24 px mot referanse 54.
Kameraene kan derfor ikke justeres hver for seg med alle andre AR-poser låst.
Dette er grunnlag for en felles poseløsning, ikke for å aktivere enkeltforslag.
Ingen ny modell er bakt fra de motstridende forslagene.

Ekstra feature-runde med target58: 59→58 har 12/15 epipolar-holdout innen 2 px
(median 0,214); 107→58 har 10/10 (1,124). Direkte 54→58 har for få/stabile treff
og feiler epipolar-holdout, så den er ikke en uavhengig bekreftet sløyfe.
Neste steg: samle flere geometrisk verifiserte forbindelser og løse kameraene
samlet med anker/prior, deretter kontrollere både holdout og ferdig modell.
Artefakter: `.tmp/scan-fixtures/2026-09-08/pnp-checks/`. App og rådata uendret.

## 24. Felles kamerajustering og visuell kontroll, 2026-09-08

`tools/audit-scan-joint-poses.py` samler dybde-/SIFT-korrespondanser i begge retninger,
justerer kameraene sammen med robust tap og prior og holder de opprinnelig utelatte
punktene utenfor tilpasningen. Syv kameraer i to adskilte grupper; anker 54 og 60.
Dette er en liten diagnostikk, ikke full romregistrering. Bildeparene er dessuten
valgt med tidligere epipolar-holdout, så sluttevalueringen er ikke et helt urørt testsett.

5 cm forskyvningsgrense bremset løsningen. Med diagnostisk 20 cm grense flyttes
55/58/59/61/107 henholdsvis 3,0/13,2/38,0/5,0/101,8 mm. Alle ti rettede par får bedre
median på utelatte punkter ved 1600 px bredde. Eksempler: 58→55 10,64→3,39 px,
59→58 27,34→10,27 og 107→58 56,15→16,99. Store restfeil og 10 cm kameraforskyvning
betyr at dette ikke er klart for aktivering.

To separate kopier er bakt med identisk lagret AR-geometri og vanlig poseraffinering
av. Bare den ene kopiens kameramatriser endres. Samme renderkamera (original frame60),
samme 129457 vertices / 192313 trekanter og bounds. Visuell kontroll viser enkelte
endringer på hylla, men doble panellinjer, uskarphet og hull består. Ingen tydelig
samlet gevinst mot Scaniverse. Frame60 er anker og dermed uendret. Senere punktavlesning (§25) viser at denne
AR-geometrien faktisk bruker frame96 på flaten, mens tidligere TSDF brukte frame60.
Frame96 inngår heller ikke i poseløsningen. Ikke aktiver disse forslagene.

Rådata og native appstandard er uendret. Resultater, modeller og rendere bevart i
`.tmp/scan-fixtures/2026-09-08/joint-pose-checks/`.
Neste kontroll isolerer kildebildevalget ved å utelate frame60 i en separat kopi.

## 25. Kildebilde-ablasjon på identisk geometri, 2026-09-08

Tre kontroller med AR-geometrien fra §24 og poserefine av: alle 152 foto, alle unntatt
frame60, og kun frame58. Ingen native kode/standard endret. Samme 129457 vertices,
192313 trekanter og renderkamera original frame60. Råfoto, dybde og mesh er symlenket;
kun fixture-kf.json er filtrert på separate kopier.

Viktig rettelse av forsøksantakelsen: punkttrace på både full kontroll og exclude60
viser frame96 som detaljvinner på alle åtte nærmeste trekanter. Frame60 var vinner i
den tidligere TSDF-geometrien, ikke på denne AR-geometrien. Ikke overfør vinner-ID
mellom geometrivarianter. Å utelate frame60 gir derfor hovedsakelig andre endringer,
ikke ønsket detaljkildeskifte. Panelets doble kanter består.

Kun frame58 gir visuelt klart renere panelspor i samme utsnitt, men teksturdekningen
faller fra 99 % til 7 %. Hvitt er manglende tekstur; rødt er geometrihull. Hylla har
fortsatt projeksjons-/geometrifeil. Dette er et lokalt kvalitetsbevis for råfotoets
potensial, IKKE en brukbar rommodell eller en løsning som skal aktiveres. Flere ledd
endres samtidig ved bare ett foto (bildevalg, tone, søm og normalisering), så dette
isolerer ikke alene hvilken av dem som må rettes.

Metadata: frame58 sharpness 240,30, motion 0,111, blurPx 3,22; frame96 31,78 / 0,394 /
10,94. Metadata er helbilde-/fangstmål, ikke målt skarphet akkurat på panelet. På
nærmeste trekant har frame58 høyere råscore (0,170) enn frame96 (0,118), men endelig
regionvalg bruker likevel frame96. Neste forsøk må skille regionvalgets kostnad fra
toneblanding: behold alle foto og dekningskrav, men mål detaljvalg lokalt og render
uten tonekorreksjon som separat kontroll. Ikke erstatt alle foto med frame58.

Artefakter med armbeskrivelse: `.tmp/scan-fixtures/2026-09-08/source-selection-checks/`.

## 26. Alle foto, tone av og svakere ICM, 2026-09-08

På samme AR-geometri/kameraer som §25: `planeavg=off` (22,8 s), så samme med
`icmlambda=0.3` mot standard 3,0 (23,4 s). Alle 152 foto beholdt, poserefine av.
Samme mesh og originalt renderkamera60. Ingen native kode eller appstandard endret.

Tone-av fjerner visuelt flere trekantformede dobbeltmønstre på rødt panel, men
teksturen er fortsatt myk og det er store feil på hylla. Alle åtte nærmeste sporede
flater beholder frame96 i begge armer og kontrollen. På nærmeste flate faller første
hjørnes røde offset fra 0,03505 til 0,0000064. Dette støtter at toneleddet bidrar til
lokalt dobbeltmønster, utover uskarpt detaljfoto.

Begrensning: globalt er vinnerarray IKKE identisk mellom kontroll og tone-av:
3004 av 192313 flater (1,56 %) har forskjellig label. Forsøkene er dermed ikke en
fullstendig isolert global tone-A/B. Koden velger labels før toneleddet, og usortert
ordbokgjennomgang finnes i regionannekteringen; mulig variasjon mellom kjøringer må
undersøkes før små globale differanser tilskrives flagget.

Lavere ICM-vekt skifter flere områder på hylla, men lar problemflatens frame96 stå.
Ikke konkluder at skarphetsvekting alene mangler: AR-fixturen låser 29014 flater til
hele plan/plansegmenter FØR ICM, og disse hoppes over i ICM. Punkttrace mangler foreløpig
`locked` og `planeOfFace`, så tilhørigheten på dette punktet må verifiseres, ikke antas.
Neste konkrete kontroll: spor denne tilhørigheten og planvalgets dekning/kvalitet.
Deretter prøv detaljbevaring med full dekning på både AR- og TSDF-geometri. Ikke
aktiver tone-av generelt: tak/andre flater må fortsatt ha jevn farge.

Artefakter: `.tmp/scan-fixtures/2026-09-08/tone-selection-checks/`.

## 27. Planlås bekreftet; kvalitet komprimeres i scoren, 2026-09-08

Punkttrace eksporterer nå `locked` og `plane`; Python-oppsummeringen leser også eldre
filer (manglende felt = null). Release-simulatorbygget passerer og ny trace kontrollerer
åtte boolske låsefelt/plan-ID-er på faktisk bake. Alle åtte problemflater: locked=true,
plane=6, frame96. Dermed bekreftes hvorfor lavere ICM-vekt i §26 ikke påvirket dem.

Kun i MeshRebakeHarness finnes nå `anchorplanelock=off`. Beholder identiske AR-vertices,
trekanter og kameraer; slår av planlås, ikke geometri. Standard og live fangst uendret.
Nytt simulator-Release-bygg passerer. Bake uten lås (36,0 s): alle åtte false/frame60;
visuelt flere brudd og dobbeltmønstre på panelet. Samme uten tone og med ICMλ0,3
(23,2 s): fortsatt frame60, færre tone-spøkelser men tydelige skjøter og mykhet.
Samme renderkamera60; 129457 vertices / 192313 trekanter. Ikke aktiver opplåsing alene.

Ny, viktig scorekontroll på nærmeste flate: frame60 0,18033 > frame58 0,16996.
Det er altså ikke ICM som nødvendigvis forkaster en høyere score her. §25 sitt
kandidatsett utelot frame60. Hele fixturens maxSharp=765,081. Gjeldende kfQuality
(normalisert skarphet/fart/blur): frame58 0,232316, frame60 0,038971, frame96 0,017023.
Scorens faktor `0.3 + 0.7 * quality` blir 0,46262 / 0,32728 / 0,31192: nesten seks
 ganger kvalitetsforskjell mellom 58 og60 blir bare 1,41× i scoren. Geometrileddet
(vinkel/avstand) vipper dermed valget til60. Dette er et målt grunnlag for neste
kvalitetsvekt-forsøk, ikke bevis for at helbildemetadata alltid måler lokal skarphet.
Neste kontroll bør teste sterkere kvalitetsvekt med alle foto, måle deknings-/søm-
virkning og gjenta på TSDF og de nye skannene. Ikke nøye seg med dette panelet.

Native endringer denne runden er kun avlesning og harness-flagg. Ingen telefoninstallasjon.
Artefakter: `.tmp/scan-fixtures/2026-09-08/plane-lock-checks/`.

## 28. Sterkere kvalitetsvekt, 2026-09-08

Harness-only `qualityfloor` (0,01…0,3, standard 0,3) setter `debugQualityFloor`,
resatt med defer. Scorens kvalitetsfaktor er nå floor+(1-floor)*quality; live beholder
0,3. Eksperiment 0,05. Simulator Release bygger grønt. Ingen ny avhengighet/installasjon
på telefon. Gyldighets-/okklusjonskrav er uendret.

Soverom, identisk AR-geometri med planlås/tone/poserefine av og ICMλ0,3 som forrige
kontroll: alle åtte sporede trekanter bytter 60→58. Score58 0,09945, score60 0,04795.
Panelspor blir tydeligere lokalt, men sømbrudd, feil på hylla og hull består. 99 % fylt,
22,5 s bake. Samme 129457 vertices / 192313 trekanter, renderkamera60. Dette er
ikke et standardoppsett eller helromsbevis.

Ny én-runde-fixture og flerrunde-fixture: fire bakes med kun qualityfloor endret,
TSDF bekreftet i logg (sluttlinjens «anchor-v2» er en generell etikett, ikke bevis
for geometrikilde). Samme nye simulatorbygg, vanlige øvrige innstillinger, alle foto.
Én runde: kandidat/kontroll 8,35/8,42 s, begge 96 % dekning og 43454/73646 eksporterte
vertices/trekanter. Flere linjer mer sammenhengende fra frame5, men restbrudd består.
Flere runder: 8,51/8,96 s, begge 99 %, 27846/50780. Små, blandede endringer i frame5;
fortsatt doble/avbrutte linjer og ikke tydelig samlet kvalitetsløft. Geometri/bounds
identiske innen hvert par. Ett utsnitt per fixture er kontrollert; det beviser ikke
at nye vinkler aldri forverrer resultatet eller at andre flater er bevart.

Behold eksperimentet avslått. Sterkere metadata-vekt kan hente et skarpere detaljfoto,
men løser ikke samsvaret mellom foto. Neste kontroll må måle konkret linjebrudd i
ny-fixturen mot de faktiske vinnerbildene og dybden, med samme geometri og uten å
velge bare det peneste utsnittet. Flere globale knotter er ikke tilstrekkelig.
Artefakter: `.tmp/scan-fixtures/2026-09-08/quality-weight-checks/`.

## 29. Tidsavhengig vegg-/dybdeavvik og snap-kontroll, 2026-09-08

`tools/audit-scan-ray.py`: raycast fra et valgt renderpiksel til eksportert mesh,
projiserer treffpunktet i originale fixture-kameraer og sammenligner med rådybde.
Bruker render-frame.swift sitt sentrerte 1400×788/FOV-kamera, ikke rå RGB-piksler.
Round-trip til valgt piksel kontrollert <1e-5 px. Ingen fixture-endringer.

Én-runde-fixturen, frame5-render, linjebrudd ved (170,330): trekant60214,
verdenspunkt (-0,6076892,0,6406618,-1,3513157). Modellens z ligger 34,6–47,1 mm bak
rådybden i frame3…8; frame9 gir -6,9 mm. Lokale 3×3-dybdespenn bare 2,9–8,3 mm.
Ni renderpunkt over veggen bekrefter mønsteret: tidlige foto typisk +30…60 mm,
senere foto nærmere null. Dette bruker originale poser, ikke sluttbakes raffinerte.
Det er ikke grunnsannhet: posefeil, dybdebias og fusjon må fortsatt skilles.

Ekstra dense-dybde ved samme punkt: i3…13 (t23343…23345) typisk +35…48 mm,
i14…16 faller til +30/+25/+16; senere i43…47 (t23352…23353) -4…-13 mm.
Også her kreves gyldig 3×3-nabolag med spenn <8 cm. Tidsgruppene er dermed uenige
om veggens plassering før teksturering; det er ikke bare vinnerbildevalget.

Nytt avslått diagnoseflagg `tsdfsnap=off` beholder overflaten før snapDominantPlanes,
men beholder funne plan som metadata for teksturpolicy. Standard uendret.
Simulator Release passerer. Bake 9,35 s, kontroll fra samme nye bygg 8,55 s.
Uten snap flyttes valgt stråletreff 16,19 mm; tidlige dybdeavvik blir +20…33 mm,
sent frame9 -23,2 mm. Utflating bidrar, men kan ikke forklare tidsgruppenes forskjell.
Render har fortsatt linjebrudd/dobling; ikke aktiver unsnap som kvalitetsløsning.
Geometrien er med hensikt forskjellig i denne testen (73646 trekanter i begge,
39397 vs 43454 eksporterte vertices etter UV); kameraet er likt.

Punkttrace fra ny kontroll bekrefter en faktisk grense mellom frame5 og6 på de åtte
nærmeste trekantene, alle ulåste. Unsnap har samme to detaljkilder, men annen lokal
triangulert form/etikettfordeling. Neste kontroll må koble denne grensen til faktisk
bildesamsvar og skille kameradrift fra rådybdens systematiske avvik over tid; ikke
anta at en global dybdeforskyvning eller nytt tonefilter retter begge tidsgrupper.
Artefakter: `.tmp/scan-fixtures/2026-09-08/wall-depth-checks/`. Ingen telefoninstallasjon.

## 30. RGB-kontroll av ny fixture: lokal støtte, ikke helkamerabevis, 2026-09-08

Feature-diagnostikken tar nå `--frames=...` slik at den samme testen kan kjøres på
andre fixtures enn soverommet. Ny `audit-scan-epipolar-prior.py` sammenligner registrert
AR-epipolargeometri med RGB-korrespondansenes utelatte punkter, uten dybde. Avstand til
epipolarlinje er ikke full reprojeksjonsfeil; svært liten baseline er dårlig betinget.

Én-runde, target5, fullbilder ved1600 px: 3→5 62 treff, 13/13 epipolar-holdout <2 px;
4→5 65 treff,12/13;6→5 89 treff,16/18. AR-linjeavstand median henholdsvis9,49/5,25/1,19 px,
RGB-tilpasset 0,305/0,828/0,395. Baseline 48,0/3,6/17,8 mm: særlig4→5 gir svak
informasjon om translasjonsretning. Target9 har få eller ugyldige forbindelser;
4→9 og6→9 feiler også tilpasset holdout. Ingen sikker RGB-bro mellom tidsgruppene.

PnP med rådybde: 3→5 holdout23,55→0,79 px (12 punkt,16,5 mm/0,90°),4→5
9,55→1,10 (12,7,1 mm/0,81°),6→5 3,67→1,02 (9,42,0 mm/1,62°), men siste p90
51,3→54,2 px. Forslagene motsier hverandre i kryssreferanse, som i tidligere forsøk.
Ingen forslag er brukt i fixture, modell eller app.

Visuell treffkontroll av4→5 og6→5 viser at punktene nesten bare sitter på kleshengerne
på høyrekanten, IKKE over panelveggen. Feature-skriptet rapporterer nå homografiens
treningsstøttes spenn i målbilde: 3→5 14,2 % bredde/34,9 % høyde,4→5 12,6/38,5 %,
6→5 8,9/30,6 %. Holdout fra samme lille område beviser ikke en helkamerarettelse.
Dette avkrefter å bruke PnP-forslagene ukritisk; det avkrefter ikke rådybdeavviket i§29.

Neste måling må bruke veggobservasjoner og tidsforløpet direkte, med eksplisitt
håndtering av at én planvegg ikke bestemmer alle kamerafrihetsgrader. Ikke erklær
posefeil kontra dybdebias avgjort med disse lokale RGB-treffene. Endringer kun i
Mac-diagnostikk; kjøringene fullfører, ingen native endring/installasjon denne runden.
Artefakter: `.tmp/scan-fixtures/2026-09-08/new-scan-feature-checks/`.

## 31. Begrenset veggnormal-korreksjon, 2026-09-08

`audit-scan-wall-timeline.py` måler median avstand i fast normalretning på et17×17
rutenett over den visuelt kontrollerte veggen. Checkerboard-punkt holdes utenfor
medianen; venstre/høyre del rapporteres separat. Kun gyldig dybde og lokalt spenn
<4 cm brukes. Én vegg bestemmer ikke bevegelse langs planet eller alle rotasjoner,
og testen kan ikke alene skille posefeil fra dybdebias.

Frame5 og9 har full dekning, forskjell44,14 mm. Frame5 holdout-median3,37/p907,88 mm,
frame9 3,76/6,90 mm. Tidsrekkefølge må komme fra timestamp, IKKE frameindeks:
frame9 og10 er erstattet senere enn11 og12 i dette opptaket.

Separat kopi `wall-normal-corrected`: kun normaltranslasjon av kameraene, både
fixture-kf og dense.jsonl, rådybde/RGB symlenket urørt. Krever ≥60 % veggdekning,
holdoutp90<15 mm, støtte på begge sider og sideforskjell<15 mm, skift<60 mm.
7 keyframes og18dense får forslag, referanse5 fast. Andre kameraer beholdes uten
interpolert korreksjon. Re-måling på kopien bekrefter offsets for5/6/9 på
43,51/43,49/43,27 mm, men det er ikke uavhengig bevis for riktig kamerajustering.

To bakes (8,83 s standard,9,03 s uten snap) og samme originalkamera5 rendret.
Linjer er fortsatt brutt. Med snap blir valgt punkt ikke nærmere tidlig rådybde;
uten snap flyttes treffpunktet11,48 mm fra forrige unsnap, frame5-avvik31,2→21,1 mm.
Andre frames uten tilstrekkelig veggstøtte er uendret og inngår fortsatt i fusjonen.
Hypotesen er ikke en ferdig korreksjon, og brukes ikke i appen.
Artefakter: `.tmp/scan-fixtures/2026-09-08/wall-normal-checks/`.

## 32. Rettet halvvoxel-feil i Surface Nets, 2026-09-08

Kodeaudit av restavviket fant en konkret koordinatfeil: Metal-integrasjonen evaluerer
SDF på `lo + (gid + 0.5)*voxel`, mens Surface Nets plasserte de samme prøvene på
`lo + gid*voxel`. Hele råoverflaten ble forskjøvet -voxel/2 langs hver akse: ved20 mm
voxel er det (-10,-10,-10) mm. Dette er forskjellig fra drift mellom kameraer.

Produksjonens vertex-ekstraksjonsløkke testes i `tools/verify-scan-voxel-origin.py`
med analytiske plan i voxelmidtpunktene. Før rettelse: 10 mm voxel gir5 mm feil på
x-planet og testen feiler. Etter +0,5 i ekstraksjonskoordinatene: alle24 plan passerer
(<0,01 mm toleranse), fordelt på3 oppløsninger,2 origo og4 normaler. Rettelsen er
beholdt i normal TSDF-kode; eksperimentelle kamera-/kvalitetsforslag er fortsatt av.

Simulator og iPhone Release-bygg passerer. To originale fixtures bakt uten andre
flagg: én runde8,57 s og flere runder9,76 s. Frame5 før/etter kontrollert på begge,
og frame12 på én-runde. Panellinjer har fortsatt brudd/dobling; ingen Scaniverse-paritet.
Én-rundes valgte stråletreff målt mot original frame5-rådybde:45,46→33,35 mm.
Sen frame9 blir lenger fra modellen (-6,88→-20,9 mm), som er konsistent med at det
også finnes tidsavhengig uenighet. Den matematiske feilen er rettet, ikke alle årsaker.
TV-innhold i frame12 er dynamisk og brukes ikke som skarphetsbevis. Hull består.
Ingen ny telefoninstallasjon. Artefakter: `.tmp/scan-fixtures/2026-09-08/voxel-origin-checks/`.
Dekningsloggen viser én-runde96→95 % etter koordinatrettelsen, flerrunde99→99 %.
Den ene prosentpoengen må undersøkes før telefoninstallasjon: flyttet mesh endrer
sikt-/dekningsporter selv når selve koordinatrettelsen er matematisk riktig.

## 33. Dekningskontroll etter origo-rettelsen; installert, 2026-09-09

`audit-scan-coverage.py` bruker GLB-geometri, UV og native vinneretiketter; kontrollerer
at labelantall matcher eksporterte trekanter. Loggens prosent er UV-areal med
winner≥0, IKKE en telling av faktisk malte piksler.96→95 er også heltallsavrunding.
Før/etter på én-runde: UV96,3495→95,9322 %, verden96,3673→96,0294 %;
label-løst areal0,39795→0,43522 m². Netto0,03727 m², rundt0,34 prosentpoeng i verden.

Triangelrekkefølgen endres ved UV/romblokk-inndeling selv om antallet er73646 begge:
ikke par på indeks. Gjensidig nærmeste centroid etter kjent(+1,+1,+1)cm-forskyvning,
3 mm toleranse, kobler73357/73646.246 misterlabel,0,037275 m²; én degenerert flate
fårlabel. Denne omtrentlige korrespondansen brukes bare til lokalisering.

De12 største tapte trekantsentrene ligger UTENFOR alle raffinerte kildefotos også
FØR rettelsen (25…125 px utenfor); de var tildelt frame12 gjennom naboarv.
Etter rettelsen ligger de49…156 px utenfor. Full kontroll over alle trekantsentre:
label-løst areal med et senter innenfor noe bilde er numerisk null både før og etter
(1e-11 m²). Flere label-tildelte sentre ligger utenfor sitt foto også i begge bakes
(0,1061/0,1147 m²). Dekningstallet overvurderer altså fotodekning ved slike kanter.
Centroid/bilderektangel-kontrollen tester ikke okklusjon, delvis synlige trekanter
eller sluttshaderens faktisk malte texler; ingen påstand om identisk pikseldekning.
Ingen terskler ble slakket for å skjule tapet.

Koordinatrettelsen fra§32 er beholdt og installert på iPhone13Pro med devicectl
9.september kl00:01 (exit0, bundle no.ampex.app, databaseSequence1888).
Begge Release-bygg og24 analytiske kontroller var grønne før installasjon.
Dette er ikke et nytt skann eller en ny ende-til-ende-kvalitetsbekreftelse på telefon;
Scaniverse-målet er fortsatt åpent. Kamera-/normal-, kvalitetsgulv-, planlås- og
unsnap-forsøk er fortsatt av som standard.
Artefakter: `.tmp/scan-fixtures/2026-09-08/origin-coverage-checks/`.

## 34. Analytisk kontroll med faktisk Metal-fusjon, 2026-09-09

`tools/verify-scan-gpu-plane.py` henter produksjonens integrateMSL, GPUParams og
Surface Nets vertex-løkke direkte fra Swift-koden, kompilerer Metal på Mac og lager
åtte støyfrie dybdekart fra kameraer med kjent sideveis bevegelse.256×144 dybde,
20 mm voxel, minvekt4 og64 mm trunkering som normalt. Tester frontalt og skrått plan.
Dette omfatter ekte GPU-fusjon og vertex-uttrekk, men IKKE senere volumblur,
Taubin-glatting, snap, teksturering eller usikre kameraer.

Frontalt plan:361 vertices, signert median-0,00060 mm, maks0,00286 mm.
Skrått plan:544 vertices, median0,338 mm, maks1,853 mm. Begge passerer4 mm grense.
Den lagrede selvtesten er kjørt ende til ende (kompilering+Metal, exit0).
Dette styrker regresjonsdekningen for§32 og viser at denne delkjeden ikke i seg selv
lager3–6 cm avvik i et støyfritt, korrekt registrert plan. Resultatet avgjør ikke
kamera-/dybdebias i ekte opptak og beviser ikke at hele skann-pipelinen er riktig.

Kun ny Mac-selvtest denne runden. Telefonen beholder installasjonen fra§33.
Neste analyse bør bruke de tidsavhengige råobservasjonene og etterbehandlingen,
med denne testen som kontroll mot nye grunnleggende koordinatfeil.
Artefakter: `.tmp/scan-fixtures/2026-09-08/gpu-plane-checks/`.

## 35. Volumglatting: nabogrense rettet, ingen gevinst på aktuell fixture, 2026-09-09

`blurVolume` sjekket bare lineære buffergrenser. En x-nabo kunne dermed krysse til
neste rad, en y-nabo til neste z-skive. Produksjonsfunksjonen er testet isolert med
observerte celler som ligger tett i minnet, men ikke er naboer i3D. Før rettelse
blandes motsatte SDF-verdier feilaktig. Etter sjekk av koordinat langs valgt akse
bevares isolerte celler. `verify-scan-volume-blur.py` dekker x-/y-/skivegrenser,
konstant felt og27 lineære interiørpunkter. Alle passerer.

GPU-testen fra§34 omfatter nå også én produksjons-passering volumblur. Frontalt
plan maks0,006 mm, skrått maks2,892 mm (rå fusjon henholdsvis0,003/1,853 mm).
Alle fire tester passerer4 mm grense. Mesh-Taubin og snap er fortsatt utenfor denne
analytiske testen. Ingen konklusjon om korrekthet ved usikre råobservasjoner.

Simulator og iPhone Release-bygget passerer. Én-runde-fixture bakt med standard
innstillinger på8,97 s og rendret fra frame5. Alle42609 eksporterte vertexkoordinater
er bit-identiske med kontrollen etter§32;73646 trekanter i begge. Linjebruddene
består. Dette er forventelig når observerte celler ligger innenfor volumets padding;
rettelsen må ikke fremstilles som årsaken til kvalitetsgapet på dette skannet.
Ingen ny installasjon på telefonen; den har§32-rettelsen fra§33. Behold testen og
naborettelsen, og følg tidsavviket i rådata videre.
Artefakter: `.tmp/scan-fixtures/2026-09-08/volume-blur-checks/`.

## 36. Tidspunkt, veggretning og uavhengig RGB-kontroll, 2026-09-09

Lagringsaudit: storeKeyframe fryser timestamp, camera.transform, intrinsics og
smoothedSceneDepth fra samme ARFrame før captureQueue; bildebufferen kopieres før
lagring. Dense lagrer rå sceneDepth og transform/timestamp fra sin ARFrame før køen.
Ingen åpenbar ny kø-/tidspunktsblanding funnet her. Dette beviser ikke intern
sensorsynkronisering eller fravær av eksponerings-/kalibreringsfeil.

Interpolert rå veggoffset mellom de nærmeste støttede dense-kartene (0,2333 s mellom
kartene) mot keyframe-smoothed-offset: frame3/4/5/6/7/8/9 avviker henholdsvis
+0,875/+1,462/+1,888/-0,062/-0,005/+1,722/+0,039 mm. Det er for lite til å forklare
4,4 cm tidsgruppeforskjell på denne flaten. Kun én normal/ROI og interpolasjonstest;
det er ikke et generelt bevis for at glattet og rå dybde alltid er enige.

Wall-timeline-diagnostikken tilpasser nå også tre planparametre med robust trening
og separate checkerboard-punkt. Fullt dekkede frames4/5/6/9 får plane-holdoutp90
1,69/1,61/1,33/1,45 mm, mot10,91/7,88/1,87/6,90 mm med fast normal. Retning relativt
frame5: frame4 0,522°,6 1,126°,9 1,476°. Data støtter at observerte plan er ulike;
årsaken (pose, dybde, kalibrering) er ikke dermed avgjort.

Diagnostiske kameraforslag justerer bare planens observerbare frihetsgrader:
korteste rotasjon som samler normalene, pluss normaltranslasjon, referanse5 fast.
Krav≥60 % dekning,planeholdoutp90<5 mm,rotasjon≤3°,translasjon≤80 mm. Ingen
endringer i fixture. RGB-punkter er IKKE brukt i dette forslaget og brukes til
krysskontroll: median3→5 23,55→9,92 px,4→5 9,55→2,02, men6→5 3,67→17,64;
siste p9051,27→58,40. Altså ikke en trygg kamerarettelse. RGB-støtten ligger fortsatt
mest ved kleshengerne (§30), så den identifiserer ikke alene riktig veggmodell.

Ingen native endring eller telefoninstallasjon. Forkast å bruke disse planforslagene
som global kamerakorreksjon. Neste kontroll må skille bilde-/dybdesamsvar uten å
anta at hver flat rådybdeobservasjon er geometrisk sannhet.
Artefakter: `.tmp/scan-fixtures/2026-09-08/time-plane-checks/`.

## 37. Faktiske raffinerte kameraer og mesh-reprojeksjon, 2026-09-09

Kontroll mot `trace-1788904662573/refined-kf.json`, altså kameraene som faktisk ble
brukt i baken etter halvvoxelrettelsen. Samme utelatte RGB-treff som i §30; ingen
ny kameratilpasning i denne sammenligningen. Rådybde-reprojeksjonens median for
3→5, 4→5, 6→5 går fra 23,55 / 9,55 / 3,67 px til 17,73 / 6,18 / 2,06 px.
Epipolar median går fra 9,49 / 5,25 / 1,19 til 6,10 / 2,80 / 0,35 px.
Native kamerajustering hjelper altså disse parene; ikke slå den av på antakelsen
om at den skaper avvikene. Store restfeil består. Epipolar avstand er ikke full
2D-feil, og liten kamerabaseline begrenser hva den sier om dybde.

Ny diagnose `tools/audit-scan-mesh-matches.py` skyter en stråle fra hvert utelatt
kildebildetreff til nærmeste eksporterte meshflate og projiserer punktet i målfotoet.
Sammenligner med rådybde på IDENTISKE punkter med både gyldig dybde og mesh-treff.
For 3→5 (9 punkt) går median fra 17,87 px med dybde til 17,30 med mesh; 4→5
(9 punkt) 6,80→6,70; 6→5 (6 punkt) 2,16→1,67. Flaten forklarer dermed lite av
restfeilen på disse lokale treffene. Ni av 33 gyldige dybdepunkter mangler mesh-treff.
Ett holdout-treff på 6→5 avviker omtrent 248 px med begge metoder; ikke skjul det
bak medianen eller behandle epipolar-godkjente par som feilfrie korrespondanser.
Nærmeste flate kan også være feil objekt ved kleshengere/tynne detaljer.

Diagnosens stråler er kontrollert på kjent nær/fjern flate, ikke-normaliserte retninger,
bak kamera og bom. Dybdealternativet bruker samme 33 utelatte punkter som uavhengig
OpenCV-projeksjon fra PnP-auditen: median/p90 stemmer innen 1e-4 px og antall under
5 px er identisk. Første toleranse på 1e-6 px var for streng (maks statistikkavvik
0,000050 px); ingen påstand om bit-identisk projeksjon. Ingen modelltilpasning her.

Utvidet SIFT-kontroll til ALLE 14 bilder mot både frame5 og frame9. Frame1/2 får
ytterligere lokale forbindelser til5 (5/5 og7/8 holdout innen2 px epipolar), men
ingen nye pålitelige forbindelser til9. Støtten ved5 er fortsatt smal. Dette avviser
at de tidligere utelatte bildene alene gir en sikker bro til sen dybdegruppe med
denne metoden; ikke et bevis for at slik informasjon er umulig å hente ut.

Ingen native endring eller installasjon. Kamerajusteringen beholdes. Neste arbeid
må gi samsvar på selve problemflaten eller bredere sikre bildetreff før nye globale
pose-/dybdekorreksjoner aktiveres. Scaniverse-kvalitet er fortsatt ikke oppnådd.
Artefakter: `.tmp/scan-fixtures/2026-09-08/native-camera-checks/`.

## 38. Panellinjer avdekker lokal regresjon; avgrenset felt gir visuell gevinst, 2026-09-09

Projiserte råfoto til samme veggplan og samme kamera5-visning (1400×788). Plan fra
de ni ray-punktene i §29, flyttet (+1,+1,+1) cm etter §32. Sammenlignet rå og faktisk
raffinert kamera. Dette er planrettifisering av foto, ikke rendering av ferdig mesh.
Mørke panelspor finnes i 40 px brede striper med lokal bakgrunn fjernet, toppavstand
>30 px, og gjensidig nærmeste linje innen30 px. Repetert mønster kan fortsatt gi
feil indeks; dette er et visuelt kontrollert veggforsøk, ikke generell matcher.

Frame6 mot5 ved x200: rå forskyvning rundt4–6 px, etter raffinering9–10 px.
Ved x1100: rå rundt5 px, raffinert1–5 px. Frame4 får tilsvarende større feil til
venstre og mindre til høyre. Dette utfyller §37: bedre treff ved kleshengerne betyr
ikke bedre samsvar på hele veggen. Ikke bruk én lokal RGB-median som total fasit.

Tilpasset treparametrisk y-forskyvning over denne veggen for frame4 og6, med frame5
fast. Trening på x200/800 (16 linjer per kamera), holdout på x500/1100 (17 hver).
Median absolutt holdoutfeil: frame4 6,83→0,38 px, frame6 4,87→0,37 px; p90 etter
0,89/1,22 px. Kun forskyvning på tvers av sporene; ingen påstand om bestemt
bevegelse langs sporene eller fysisk korrekt kamera. Frame3/9 ble ikke korrigert.

Omregnet feltet til eksisterende 12×8 normaliserte harness-warp for frame4/6.
Alle14 foto og samme geometri beholdt. Første bake8,35 s, neste8,06 s. Første felt
tonet ned korreksjonen ved synlig venstrekant og beholdt deler av bruddet. Andre
flytter venstre overgang utenfor bildet. Ingen native kode eller standard endret.

Ferdig render mot rettifisert frame5: linjemedian ved x100 går9,56→5,58→0,62 px
(kontroll/første/andre). Ved x1100 2,19→0,93→0,93 px. Interiør x200–950 allerede
omtrent0,2–0,4 px og nesten uendret. Dette måler samsvar med valgt referansefoto,
ikke uavhengig geometrisk sannhet. Visuelt færre brudd ved venstrekanten; resterende
skjøter, mykhet og hull består. Første bake også kontrollert fra kamera12, med liten
endring på den andre veggen; TV-innhold er dynamisk og vurderes ikke som statisk mål.

Lovende lokal støtte for strukturstyrt retting, men IKKE klar for aktivering: valgt
vegg/retning/ROI og referanse er spesifikke for denne fixturen. Neste steg må gjøre
utvelgelse og avvisning robuste og kontrollere flere-runde-fixturen før native bruk.
Ingen telefoninstallasjon. Scaniverse-målet er fortsatt åpent.
Artefakter: `.tmp/scan-fixtures/2026-09-08/wall-line-checks/`. Sammenligningssiden
har ny før/etter-rad øverst blant forsøkene.

## 39. Flerrundekontroll av linjefelt: ikke klar for bruk, 2026-09-09

Ny kontrollbake med trace av flerrundeskannet, 9,45 s. Eget veggplan fra ni ray-treff
og egne raffinerte kameraer; ingen kamerafelt overført fra én-runde-skannet.
Alle21 foto rettifisert. Linjekandidater krever også gyldig foto over hele lokalpatchen.
Feltport: minst12 treningstreff og12 holdout, holdoutp90≤2 px og median minst halvert.
Disse er forsøksporter, ikke dokumentert generell sikkerhet på periodiske mønstre.
Kun frame16 passerer:16 trening/15 holdout, median2,05→0,74 px, p901,39 etter.
Frame3 har p902,08 og avvises; frame6 mangler antallstøtte. Ikke slakk portene for
å få ønsket resultat. Frame16 er detaljvinner på6399 av50780 trekanter i kontrollen.

Bake med kun dette feltet:9,26 s, samme99 % loggdekning. Blandede visuelle endringer,
fortsatt tydelige brudd. Mot rettifisert referanse5 blir ferdig renders linjemedian
ved x100 13,93→12,58 px, men x800 0,46→1,64 og x1100 1,30→2,82. Altså ingen
samlet gevinst bevist, selv om kildelinjenes holdout passerer.

Isolert planfargeutjevning med `planeavg off` i to nye bakes (6,18/6,09 s).
Restforskjellen består: x800 0,56→1,31 px, x1100 1,22→2,86; mer synlige tonegrenser
som forventet uten planutjevning. Ikke tilstrekkelig grunnlag for å skylde på dette
fargestadiet eller aktivere feltet. Ray-sporing ved y600 og x350/650/950/1100 viser
frame16 som faktisk vinner. Veggpunktet er identisk med tidligere kontroll; ni
punkters planavvik er under0,002 mm, så brukt proxyplan er konsistent med meshen.

Neste kontroll må forklare forskjellen mellom rettifisert kildefoto og sluttbake:
kontroller gjentakbarheten til de raffinerte kameraene mellom bakes og følg faktiske
UV-koordinater/tekstursampling. Bare første bake har lagret refined-kf denne runden;
identiske sluttkameraer mellom kjøringene er ikke bevist. Ikke legg flere frihetsgrader
eller løsere akseptkrav oppå dette uavklarte avviket.

Ingen native endring eller telefoninstallasjon. Fire bakes er ferdige. Feltforsøket
forblir avslått, Scaniverse-målet fortsatt åpent.
Artefakter: `.tmp/scan-fixtures/2026-09-08/multi-wall-line-checks/`.

## 40. Linjefeltets gevinst lå utenfor faktisk detaljbidrag, 2026-09-09

Ny feltbake med trace,9,46 s. Alle21 kameramatriser er numerisk identiske med
kontrollen i §39 (maks elementdifferanse0). Denne sammenligningen støtter ikke
kameravariasjon som årsak. Direkte GLB-atlassampling langs x950 har best høy-pass-
korrelasjon med SceneKit-render ved null forskyvning (0,77); rettifisert kilde16
også null (0,85). Dette er en lokal grov kontroll, ikke et generelt UV-bevis.

Den avgjørende kontrollen kobler hvert utelatt linjetreff til faktisk detaljvinner
gjennom ray-treff i kontroll-GLB og samme traces labels-winner. Hele frame16-holdout
hadde median2,05→0,74 px og p906,73→1,39. Men bare6 av15 utelatte treff ligger der
frame16 faktisk leverer detaljene. DER går median0,55→0,67 og p900,76→2,41 px.
De øvrige9 treffene, der ANDRE foto er detaljvinnere, står for gevinsten:
median4,42→0,74 px. Den affine tilpasningen retter øvre del hvor16 ikke brukes,
og overkorrigerer nedre del som allerede stemmer. Dette forklarer den målte lokale
regresjonen bedre enn en antatt feil i kamera-/teksturkoordinater.

Ny `tools/audit-scan-panel-support.py` måler samlet og faktisk vinner-holdout for
hver forsøksmodell. Ekstra forsøksport: minst6 vinner-holdout, halvert median og
ikke økt p90. Kan skrive filtrert feltfil uten å endre originalen. Frame16 fjernes;
tomt resultat betyr ingen feltbake. Kontroll mot den separate ray-diagnosen stemmer
eksakt i statistikk, originalfeltet er bevart. Ingen ny bake med tomt felt.
Porten dekker detaljbidrag, ikke alle tone-/fjæringsbidrag, og er ikke en generell
kvalitetsgaranti for periodiske mønstre.

Samme audit på én-runde-forsøket: frame4 har0 vinner-holdout, frame6 bare2
(median2,37→0,49). Den visuelle lokale gevinsten i §38 står, men fire faste
målestriper gir for lite valideringsstøtte i områdene som faktisk endres.
Neste måleoppsett må hente linjer/holdout ut fra faktiske vinnerområder og sømmer,
framfor en fast stripefordeling over hele fotoet. Ikke aktiver dagens affine felt.

Ingen native endring/installasjon. Kamerakontrollbaken er ferdig. Scaniverse-målet
fortsatt åpent. Artefakter: `.tmp/scan-fixtures/2026-09-08/panel-contribution-checks/`.

## 41. Faktiske vinnerområder gir bedre flerrundepanel, 2026-09-09

Tettere striper x80…1120 med40 px steg og20 px bredde, annenhver stripe holdout.
Koblet treff til kontrollmeshen og beholdt bare punkter hvor aktuelt foto er
detaljvinner. Dette peker på frame1 øverst på flerrundeveggen, ikke frame3 som
tidligere feltforsøk fokuserte på. Frame16 er allerede godt justert i sitt bidrag:
39 holdout, median0,28 px. Ingen ny korreksjon for16.

Frame1:23 trening/21 holdout. Konstant forskyvning feiler. Affin y-modell gir
median0,69 px men p902,13 og passerer ikke2 px-grensen. Feilen varierer systematisk
med x, så prøvde ett ekstra x²-ledd. Samme porter: median minst halvert, p90<2 og
lavere enn før, minst12 trening/holdout. Fireparametermodell gir median0,38/p900,75,
mot6,55/15,39 før. Modeller velges på disse kontrollpunktene; derfor separat ny
kontroll på striper x100…1140 med80 px steg, ikke brukt i fitting/modellvalg.
24 NYE vinnerpunkter: median7,76→0,28 px, p9017,17→0,53. Dette er romlig validering
på samme vegg og samme repeterte linjer, ikke et uavhengig opptak eller generell
identitetsgaranti. Rettingen bestemmer fortsatt bare bevegelse på tvers av sporene.

Omregnet kun frame1 til eksisterende12×8 felt, med avgrensning rundt støttet område.
Maks normalisert offset0,01983. Simulatorbake9,75 s,99 % loggdekning. Ferdig render,
øverste linjer y<350: median ved x800 4,52→0,52 px, x950 11,20→0,21,
x1100 16,45→2,10. Visuelt færre brudd i øvre panel; overgangen ved høyrekanten
er fortsatt synlig. Kamera12 også kontrollert mot baseline, liten endring på den
andre veggen; dynamisk TV er ikke kvalitetsmål. Ingen påstand om Scaniverse-paritet.

Én-runde-data har fortsatt bare10 trening/11 holdout for frame6 i faktisk bidrag og
passerer ikke antallsporten. Ikke slakket krav eller aktivert feltet. Diagnoseverktøyet
støtter nå eksplisitt holdout-flagg og x²-koeffisient i tillegg til tidligere affine
felt. Native kode og telefon uendret.

Neste steg må dekke områdeovergangene og gjøre valg av vegg, referanse og måleretning
automatisk. Nåværende skript bruker fortsatt visuelt valgt plane/ROI fra fixturen;
ikke kopier dette som hardkodet appretting. Arkiv og sammenligningssiden oppdatert.
Artefakter: `.tmp/scan-fixtures/2026-09-08/contributing-line-checks/`.

## 42. Kontroller ferdig warp-rutenett og overgang, ikke bare polynomet, 2026-09-09

Utvidet uavhengig linjekontroll til x1160…1360.11 nye punkter har frame1 som faktisk
vinner. Ideell x²-modell uten ny tilpasning: median20,46→1,51 px, p90 etter2,40.
Ekstrapolasjonen er altså heller ikke innenfor2 px-porten over hele kanten. Andre
treff langs kanten tilhører frame0/15 eller mangler mesh; de kan ikke legges ukritisk
til frame1-valideringen. Ett treff på en annen struktur avviker52 px fra modellen.

Kontrollerte så det faktiske12×8-feltet med samme bilineære interpolasjon og UV-clamp
som shaderen: projiser meshpunkt i frame1, sample felt, skyt forskjøvet bildestråle
til lokalt meshplan og mål oppnådd y-forskyvning i samme kontrollkamera.
På de24 ferske vinnerpunktene fra§41: ideell p900,53 px, faktisk felt p904,73 px.
Eksempel x1140,y186 trenger17,68 px, men feltet gir11,25. Den tidlige nedtoningen
og dens interpolasjon reduserer korreksjonen allerede innenfor validert område.
På de11 nye kantpunktene blir faktisk feltmedian13,12/p9019,99 px. Dette støtter
at det gjenværende bruddet dels er laget av avgrensningen, ikke bare av råfotoene.

`audit-scan-panel-support.py` evaluerer nå faktisk rutenett når feltfil gis, og
filtreringen bruker denne feilen.2 px-p90-kravet fra modellvalget gjelder også det
serialiserte feltet, i tillegg til forbedringskravet. Nåværende felt avvises; original
bevart, filtrert feltfil tom. Separat plane-audit og verktøyets meshplan-audit stemmer
innen1e-4 px på p90. Ingen bake med tomt felt. Ikke bruk all-held som full feltaudit:
bare faktisk vinner-holdout måler det anvendte feltet, øvrige punkter beholder ideell
modellstatistikk. Dette er eksplisitt dokumentert i verktøyet.

§41 sin lokale visuelle gevinst består, men ideell holdout var utilstrekkelig grunnlag
for hele feltet. Neste overgang må holde full korreksjon innenfor støttet område,
valideres ETTER grid-sampling og håndtere nabobildene frame0/15 separat. Bare å
flytte maskekanten utover vil også ekstrapolere en modell som feiler ytterkanttesten.
Ingen native endring, ny bake eller installasjon denne runden. Scaniverse-målet åpent.
Artefakter: `.tmp/scan-fixtures/2026-09-08/panel-grid-checks/`.

## 43. Direkte grid-tilpasning retter overgangen i frame1, 2026-09-09

Tilpasset skalare nodebevegelser i det faktiske12×8-rutenettet. Noder beveges kun
i bildets projiserte retning på tvers av panelspor; tangentretning bestemmes ikke.
Måleligningene inkluderer bilineære nodevekter og projeksjonsderivert. Robust
minstekvadrat med andrederivert-glatting.27 treningstreff i faktisk frame1-bidrag,
28 holdout; fire treningstreff fra kantutvidelsen i§42 (x1200/1280).

Første frie grid kunne ekstrapolere opptil0,047 normalisert offset utenfor støtte.
Begrenset derfor ukjente til27 direkte støttede noder pluss én nabering (43 av96);
øvrige noder holdes null i selve løsningen, ikke gjennom en etterpålagt maske.
λ0,01/0,1/1/10 prøvd. Kun0,01 passerer kontrollgrensen med denne avgrensningen;
linearisert p900,85 px. Maks normalisert nodeoffset0,02534.

Eksakt kontroll etter bilineær UV-sampling og ny stråle til meshplanet:
28 holdout median10,92→0,33/p9021,58→0,88 px. De24 separate stripepunktene som
ikke brukes i denne tilpasningen gir median7,76→0,19/p9017,17→0,61. Dette erstatter
§42 sitt faktiske p904,73. Tallene er fortsatt validering på samme vegg, med valgt
referanse/retning, og ikke et generelt bevis mot feil linjeidentitet.

Bake9,45 s,99 % loggdekning. Ferdig renders øvre linjer y<350, sammenlignet med
polynom+maske fra§41: x950 0,21→0,11 px, x1100 2,10→0,11, x1200 10,91→0,67.
x1280/1320 blir6,97/10,02 px; nabovinnere frame0/15 er fortsatt ujusterte der.
Visuelt bedre sammenheng inn mot regionkanten, men fortsatt synlige brudd ved neste
foto og hull i geometrien. Kamera12 kontrollert, liten endring på den andre veggen.
Ingen ny detaljfri blanding eller slakkere dekningskrav brukt for å skjule feil.

Resultatet støtter å løse selve rutenettet mot bidragsområder, med null utenfor
støtte og validering etter sampling. Neste kontroll må inkludere nabobildene og
deres faktiske bidrag, samt erstatte manuell vegg/referanse med automatisk valg.
Kun Mac-forsøk, ingen native endring eller installasjon. Siste bake er ferdig.
Artefakter: `.tmp/scan-fixtures/2026-09-08/direct-grid-checks/`. Ny visning øverst
i sammenligningssiden. Scaniverse-målet fortsatt åpent.

## 44. Nabobildets nærmeste stripe er feil linjeidentitet, 2026-09-09

Audit av frame0/15 ved gjenværende høyrekant. Direkte frame0→5 finner7 punkter i
faktisk frame0-bidrag og foreslår omtrent−23…−27 px. Frame15 har4 punkter, median
2,89 px, utilstrekkelig støtte. Ingen av disse forslagene er bakt eller aktivert.

Kontrollerte frame0 via frame1 i samme rettifiserte veggvisning, x1200…1380,
20 px steg. Frame1→0 nærmeste linje ligger omtrent19 px unna. Kobling via den
tidligere kontrollerte frame5→1-linjen gir total forskyvning omtrent+39…+45 px,
i stedet for direkteforslagets omtrent−25. Forskjellen er omtrent én panelbredde
(68–70 px). Direkte30 px nærmest-søk kan altså godta feil gjentakelse og likevel
gi jevne, tilsynelatende gode residualer. Lav holdoutfeil alene avviser ikke dette.

Separat SIFT-kontroll på originale fullbilder0→1 fant684 gjensidige treff, men
visuell inspeksjon viser at mange ligger på TV-en. Disse må ikke brukes ukritisk
som statisk fasit. Ny homografi bruker bare punkter med y>220 i BEGGE1600 px-brede
bilder, som utelater den synlige TV-regionen:152 trening,143 inliers,37 holdout,
median0,51/p901,42 px,35/37 innen3 px. Statiske møbler/gardiner gir støtte utenfor
de repeterte panelsporene.5→1 har ingen SIFT-treff i denne kontrollen.

Projisert nabohomografi støtter den POSITIVE linjegrenen, langt fra direkteforslagets
negative gren. Den er likevel ikke presis veggkalibrering: medianforskjell mot
linjekjeden6,38 px, fordi homografien støttes av andre dybder/områder. Ikke bruk den
som komplett warpfelt. Den støtter valg av gjentakelse, mens veggens linjer må
bestemme den lokale forskyvningen. Kjeden er fortsatt en diagnostisk metode på
denne fixturen, ikke en generell garanti for riktig linjeidentitet.

Neste retting for frame0 må bruke verifisert linjegren og hente flere utelatte
punkter i faktisk bidrag før grid-tilpasning. Ikke bake den direkte−25 px-løsningen.
Ingen native endring, ny bake eller installasjon. Scaniverse-målet åpent.
Artefakter: `.tmp/scan-fixtures/2026-09-08/neighbor-identity-checks/`.

## 45. Frame0 rettet via linjekjede; bedre skjøt i kombinert bake, 2026-09-09

Utvidet målingen til linjer y>55 og den synlige høyrekanten. Ved20 px stripebredde
og steg gir frame0-bidraget bare7 trening/9 holdout. Brukte deretter10 px brede,
tilstøtende striper med10 px steg og annenhver som holdout:16 trening/18 holdout.
Dette er flere romlige observasjoner av SAMME panelspor, ikke flere uavhengige
strukturer eller opptak. Linjegrenen følger5→1→0 som kontrollert i§44; ikke den
feilaktige direkte nærmeste stripen. Støtten gjelder fortsatt et smalt kantområde.

Direkte grid-løsning forframe0 med samme metode som§43:6 direkte støttede noder,
14 med én nabering; andre82 noder holdes null. λ0,01 gir linearisert holdoutp901,12;
0,1/1/10 feiler. Maks normalisert offset0,05512, under eksisterende harnessgrense0,06.
Eksakt bilineær sampling:18 holdout median43,27→1,07 px, p9045,05→1,78.
Krav til forbedring og2 px p90 passerer for denne lokale testen. Linjeidentitet er
støttet av nabokontrollen, men statistikken må ikke omtales som uavhengig fasit.

Kombinerte felt0 med det kontrollerte felt1 fra§43. Bake9,56 s,99 % loggdekning,
samme27881 vertices/50780 trekanter. Ferdig renders øvre linjer: x1280 median
6,97→1,51 px, x1320 10,02→2,30; x1100/1200 omtrent uendret0,10/0,67.
Visuelt bedre skjøt ved høyrekanten, men ikke perfekt. Kamera12 kontrollert mot
forrige bake, liten endring på den andre veggen. Hull og andre feil består.

Ingen native kodeendring eller installasjon. Denne veien demonstrerer at riktig
linjeidentitet, faktisk detaljbidrag og kontroll av ferdig grid alle trengs sammen.
Neste apprettede arbeid må samle dette i en metode uten hardkodet vegg, kameranummer
eller ROI, med avvisning ved for liten/repeterende støtte. Frame15 og øvrige flater
er fortsatt ikke løst. Ikke aktiver dagens fixture-spesifikke felt i appen.
Artefakter: `.tmp/scan-fixtures/2026-09-08/neighbor-grid-checks/`. Nyeste modellbilde
ligger øverst i sammenligningssiden. Siste bake ferdig; Scaniverse-målet åpent.

## 46. Automatisk flateinndeling uten valgt vegg eller kamera, 2026-09-09

Ny `tools/audit-scan-planar-regions.py` tar bare GLB og tilhørende trace. Bygger
naboskap over UV-sømmenes dupliserte posisjoner (10 µm kvantisering), kobler lokale
flater innen1°/2 mm og kontrollerer hele komponentens planavvik etterpå. Minste
areal0,25 m², p95≤5 mm og maksimum≤20 mm hindrer at glatt krumning automatisk
godtas som ett plan. Modellen endres ikke. Dette er en diagnose, ikke ny bakekode.

Finner6 regioner i én-runde- og4 i flerrundeskannet. Største region er panelveggen
begge steder (5,09/3,74 m²), med normal som samsvarer med tidligere manuelt målte
ray-punkter. Alle ni kontrollpunkter stemmer innen5 mm, også etter kjent halvvoxel-
korreksjon for de eldre én-runde-punktene. Regionenes fotoandeler summerer ikke over1.
Programmet bruker ingen kjent veggretning, kameranummer eller bilde-ROI.

Faktiske hovedbidrag på hele veggen er frame13 i én-runde-skannet (29 %) og16 i
flerrundeskannet (26 %), ikke den tidligere manuelt valgte referansen5. Ingen foto
dekker hele regionen selv i den svake bildegrensekontrollen. Ikke bruk største
bidrag direkte som global referanse: det må velges overlappende delområder og
kontrolleres sikt/skarphet. Foto-bounds er uttrykkelig IKKE okklusjonskontroll;
geometrisk planhet avviser heller ikke dynamisk TV-innhold alene.

Dette fjerner første manuelle valg i prototypen, men automatisk referanse, linje-
retning/identitet og native integrasjon gjenstår. Ingen ny bake eller installasjon.
Artefakter: `.tmp/scan-fixtures/2026-09-08/automatic-plane-checks/`.

## 47. Automatisk dybdestøttet overlapp per flate, 2026-09-09

Flateverktøyet leser nå keyframe-dybde fra original-fixturen. For trekanter helt
innenfor fotoet projiseres sentret med faktisk raffinert kamera. Krever gyldig3×3
dybdepatch over0,25 m, spenn≤4 cm og avvik fra meshdybde≤8 cm. Toleransen rommer
noe av de allerede målte pose-/dybdeavvikene; dette er kandidatutvelgelse, ikke
presis okklusjonsfasit. Manglende dybde markeres og gir ingen dybdestøtte.

Bildelenker per flate krever delt støttet areal≥0,05 m² og≥10 % av det minste
støttede fotoarealet. Panelveggen gir74 lenker i én-runde- og182 i flerrundeskannet.
Kjente forbindelser finnes uten kameranummer som input: flerrunde0↔1 har1,85 m²,
1↔5 0,90,5↔6 1,73 og5↔16 1,74. Dette er mulige overlapp, ikke RGB-korrespondanser:
1↔5 hadde eksempelvis ingen SIFT-treff i§44. En tett graf beviser ikke riktig
linjeidentitet, og kan ikke erstatte kontrollen av periodiske mønstre.

Flerrunde frame1 går fra59 % ren bildegrensedekning til52 % dybdestøttet dekning av
hele panelregionen, frame16 fra53 til52 %. Andeler og lenker er kontrollert på begge
fixtures: dybdestøtte overstiger ikke bildegrenser, delt areal overstiger ikke flaten,
relativt overlapp er innen0…1. Ingen ny referanse valgt eller warp aktivert.

Neste steg: vurder detaljinnhold og skarphet lokalt i disse overlappene, og velg
referanser i delområder med målebar støtte. Ikke ranger kun etter hele fotoets areal
eller skarphet. Ingen native endring, bake eller installasjon denne runden.
Artefakter: `.tmp/scan-fixtures/2026-09-08/automatic-overlap-checks/`.


## 48. Lokal detaljmåling: støyfeil rettet, fortsatt diagnostikk, 2026-09-09

`audit-scan-plane-detail.py` lager automatiske40 cm/192 px utsnitt fra regionenes
faktiske trekanter. Krever90 % flatedekning,98 % bildegrenser og80 % sparsom
3×3-dybdestøtte med samme4 cm/8 cm grenser som tidligere. Ingen valgt vegg,
kameranummer eller ROI. Regionverktøyet eksporterer nå triangle_indices for masken.
Dette gir lokale fotokandidater; det beviser ikke likt motiv eller presis sikt.

Første mål (rå Laplacian-energi/Sobel-energi) var feil som rangering: synlig mer
uklare frame15 slo frame5 på et panelutsnitt fordi støy ble belønnet. Erstattet med
forholdet mellom gradientenergi ved Gaussian σ1/σ3 i samme fysiske målestokk.
Estimerer hvit støy fra robust Laplacian-MAD og trekker forventet støyenergi fra
struktur-tensoren, kalibrert mot de faktiske filterkjernene. Retning måles vedσ3.
Dette er en tilnærming: JPEG, resampling/aliasing og faktisk fin tekstur kan bryte
støymodellen. Ikke bruk tallet alene som automatisk registrerings-/aktiveringsport.

Kontrollert syntetisk skarp/uskarp stripe, konstant flate, ren støy, tre støynivåer
på uskarpt motiv og90° rotasjon: verify-scan-plane-detail.py passerer. På92 lagrede
utsnitt fra begge fixtures rangeres89 originaler foran pålagtσ2 blur. De tre
inversjonene ligger på nesten detaljløse flater. Ny detaljstøtte krever både grov
signal/støy≥10 og fin signal/støy≥3 (empiriske diagnosegrenser).81 originalutsnitt
passerer; alle81 rangeres foran deres uskarpe versjon. Pålagt blur+4 gråtoner støy
rangeres lavere eller avvises i92/92. Dette er samme materiale som ble brukt til
å utvikle portene, IKKE en uavhengig kvalitetsvalidering. Beholdt alle92 resultater,
inkludert de tre opprinnelige inversjonene. Visuell kontroll av fire panelutsnitt
viser mer plausible kandidater; frame16/5 rangeres nå foran15 i problemutsnittet.

Ny full kjøring gir20 utsnitt med flere kandidater på én-runde-skannet og19 på
flerrunde. Ingen automatisk referanse eller felt er aktivert. Neste steg må bruke
retning og lokale kandidater til å finne samme fysiske detalj på tvers av bilder,
med avvisning av stripealias og kontroll i faktiske bidragsområder. Høy skarphet
alene løser ikke registrering. Ingen native endring, bake eller telefoninstallasjon.
Artefakter: `.tmp/scan-fixtures/2026-09-08/automatic-detail-checks/`.


## 49. Automatisk retningsprofil og konkurrerende stripetreff, 2026-09-09

Detaljverktøyet lagrer nå alle kvalifiserte kandidatbilder og deres flate/bilde-
masker. Ny audit-scan-tile-correspondence.py velger høyest detaljrangert kandidat
per automatisk utsnitt og analyserer bare tydelig retningsbestemt struktur
(tensorforhold≤0,2). To adskilte64 px brede bånd langs sporene gir hver sin profil
på tvers av dem. Filtrererσ1 minusσ8; maskene er erodert for hele filterstøtten.
Søker forskyvning±64 px, minst48 felles profilsamples, uten wraparound. Positiv
forskyvning betyr at kildebildets detalj ligger ved større profilindeks.

Kandidaten krever NCC≥0,85, minst0,10 avstand til konkurrerende lokal topp minst
8 px unna, beste treff innenfor faktisk søkeområde, og≤2 px forskjell mellom de
to båndenes forskyvning. Dette er empiri og kandidatutvelgelse, ikke fysisk
identitetsbevis. Tangentiell bevegelse er ubestemt; TV/dynamikk er ikke generelt
avvist. Ingen felt genereres. Syntetiske kontroller for positive/negative skift,
perfekt repeterende striper, tom støtte, konstant flate og begge profilretninger
passerer i verify-scan-tile-correspondence.py. Periodiske striper avvises selv ved
perfekt korrelasjon, fordi flere topper er like gode.

Ekte data:1 av24 par på én-runde og6 av35 på flerrunde passerer begge bånd. Fem av
flerrundetreffene ligger i samme utsnitt med referanse10; de er ikke fem uavhengige
områder. Det sjette er0→1 i r0-x1-y2, forskyvning16 px i begge bånd og NCC0,95.
Separat sjekk mot tidligere statiske SIFT-homografi (§44, ikke brukt i profilvalget)
forutsier18,61/19,34 px ved båndsentrene, og støtter samme stripegren. Homografien
er ikke presis veggfasit: avvik2,61/3,34 px består. Naboutsnitt r0-x1-y3 foreslår
17/16 px som også stemmer med homografien17,19/16,33, men avvises fortsatt av
profilportene. Ikke svekk dem for å få flere godkjente treff.

Visuelt kontrollert de tre forskjellige utsnittene med kandidater. Fortsatt for
liten/ufullstendig støtte til et generelt felt: dette gir bare normalforskyvning,
ikke tangent, fullflatedekning eller kontroll i native vinnerområder. Neste arbeid
må gi uavhengig identitetsstøtte og flere lokale observasjoner på tvetydige flater;
periodiske spor kan ikke låses til nærmeste korrelasjonstopp. Ingen native endring,
bake eller installasjon. Artefakter i automatic-correspondence-checks under
.tmp/scan-fixtures/2026-09-08/. Scaniverse-målet fortsatt åpent.


## 50. Lokale SIFT-treff gir ikke nok identitetsstøtte, 2026-09-09

Ny audit-scan-tile-features.py projiserer originalfoto til de automatisk valgte
40 cm-flisene ved768×768, mot192×192 i profilauditen. Bruker tidligere flate/
bildegrenser, krever descriptor-vindu innenfor masken, SIFT contrast0,01 og gjensidig
ratio0,7. Ingen valgt vegg, kamera eller TV-ROI. Rapporterer både antall treff og
forskjellige avrundede referanseposisjoner samt konvekst støtteareal. Ingen warp
eller aktiveringsport er lagt til. --all-pairs kontrollerer alle kandidatkombinasjoner,
ikke bare høyest rangerte lokale referanse.

Referanse-først: én-runde69 par,3 med≥4 treff,2 med≥12; flerrunde64 par,7 med≥4,
ingen med≥12. Alle kombinasjoner:206/198 par,4/16 med≥4, fortsatt bare de samme to
én-runde-parene med≥12. De har44/54 treff i region2, men tilpasning med romlig
checkerboard-holdout gir median5,10/4,25 px og p9042,0/483,1 px ved768-oppløsning.
Visuell kontroll viser TV-spillinnhold som har endret seg. Planhet/dybdestøtte var
ikke tilstrekkelig til å luke ut dynamikken, som allerede advart i§46–49. De få
modellene kan ikke brukes.

Paneltreffene i flerrunde ligger nesten bare langs den øvre kanten. Eksempel4→5:
8 treff,6 ulike posisjoner, støttehull0,59 % av flisen;5→16 har7 treff,6 posisjoner,
0,43 %. Visuelt kontrollert4→5. Collinear støtte kan ikke begrunne et generelt
2D-felt. Ingen nye felt eller sikre identitetsforbindelser er bekreftet her.
Høyere oppløsning og alle bildepar løser ikke mangelen på karakteristiske detaljer
i disse små flisene; ikke senk ratio-/holdoutkravene for å få en modell.

Neste identitetskontroll må hente bredere sammenhengende støtte enn én40 cm-flis,
og skille dynamisk innhold fra stabile romdetaljer. Rå posisjon og planprojeksjon
kan begrense søket, men den gamle stripealiasen må fortsatt avvises eksplisitt.
Ingen native endring, bake eller installasjon. Begge analyseprosesser ferdige.
Artefakter: .tmp/scan-fixtures/2026-09-08/automatic-feature-checks/.


## 51. Hele planarregioner gir fortsatt ikke veggidentitet, 2026-09-09

prepare-scan-region-features.py rasteriserer regionenes faktiske trekanter til
kvadratisk384 px maske, uten valgt vegg/kamera/ROI. Masken kombinerer bildegrenser
og3×3-dybde med tidligere4 cm/8 cm grenser. Foto må støtte≥10 % av regionen.
Dette lager6/4 regioner med28/37 fotokandidater i én-/flerrunde. Grenser og lagrede
masker kontrollert. audit-scan-tile-features.py støtter nå side per region og
--resolution=2048; alle par prøvd. Ingen skarphetsrangering eller ny kameraretting.

Én-runde89 par,2 med≥4 treff, bare TV-region2 frame12→11 med≥12 (263 totalt,
231 ulike referanseposisjoner). Romlig holdout median1,13/p903,38 px. Flerrunde206
par,23 med≥4 og9 med≥12, alle de ni i TV-region3. Panelregion0 har maksimalt7 treff
per par, ofte nesten collinear ved øvre kant; ingen bredt støttet homografi der.
Større flater løser altså ikke manglende identitet på veggen med denne metoden.

Flerrunde TV11→13 har24 treff,20 ulike posisjoner,12 holdout med median1,72 og
p901,87 px. Visuell kontroll viser treff hovedsakelig på spillets kart/overlegg,
mens selve spillbildet har endret seg. En lav holdoutfeil betyr ikke at hele
bilderegionen er statisk eller at samme modell gjelder panelveggen. Statiske
skjermoverlegg KAN følge skjermplanet, så dette er heller ikke bevis på at alle
TV-treff er feil. Bevar skillet: lokal geometrisk støtte, dynamisk tekstur og
retting på et annet plan er tre forskjellige spørsmål.

Ingen modelldata aktivert eller felt generert. Neste støtte må komme fra bredere
romdetaljer på tvers av plan, med faktisk dybde/geometri og romlig validering.
Ikke overfør TV-homografien til veggen eller fortsett å senke SIFT-krav på den
samme detaljfattige veggen. Begge prosesser ferdige, ingen native endring, bake
eller installasjon. Artefakter: .tmp/scan-fixtures/2026-09-08/whole-region-feature-checks/.


## 52. Fullscene RGB/dybdegraf og hull i bevart RGB-tidslinje, 2026-09-09

Ny audit-scan-scene-graph.py undersøker alle91/210 foto-par på originale bilder
nedskalert til1600 px. SIFT5000/.015, gjensidig ratio0,7;3×3-dybde i BEGGE foto
må være gyldig og ha spenn≤8 cm. Registrerte verdenspunkter fra faktiske native-
raffinerte kameraer må ligge innen15 cm. Dette er et bredt geometrisk prior, ikke
statisk identitetsbevis. PnP på trening,160 px romlig checkerboard-holdout utenfor
fitting; minst12 trening/6 holdout/18 ulike pixelposisjoner før forsøk. Rapporterer
3D-utstrekning, kovarians og10 cm-celler. Ingen fixture/pose/warp endret. Ny
verify-scan-scene-graph.py passerer akser, koordinatskalering, translasjon, bilde-
kant og avvisning av ugyldig/usammenhengende dybde.

18/34 par gir posedagnostikk. En konservativ DIAGNOSEGRAF (p90≤3 px,≥12 holdout,
≥12 treningsinliers,≥10 celler) kobler én-runde0,1,2,3,4,5, og separat11,12.
Ny nyttig forbindelse1→3 har21 holdout, p9019,16→2,61 px.4→5 har31 holdout,
8,04→1,75 px. Flerrunde kobler0,1,8,9,10,11,12,13,14;2–7 og15–20 står fortsatt
utenfor. Dette er ikke bevis for at enkeltkameraene er riktige på hele veggen.
Grafen kan fortsatt inneholde skjermoverlegg. Ingen global/joint retting aktivert.

Én-runde5→6 illustrerer begrensningen i porten:85 RGB-treff,36 med begge dybder,
35 innen prior, men32 havner i holdout og bare3 i trening. Ingen modell forsøkt;
ikke spre samme lokale feature-cluster tilfeldig over trening/test for å få pass.
Den tidligere målte forbindelsen blir ikke motbevist av at denne testen mangler
uavhengig romlig støtte. Flerrunde5→6 har bare8 gjensidige RGB-treff her.

Captureaudit: største gap mellom BEVARTE RGB-tidsstempler er3,233 s i én-runde
(frame12→10,14 dense-målinger mellom) og6,333 s i flerrunde(frame18→12,28 dense-
målinger mellom). Faktisk kildekode bruker0,2 s minimum,0,4 s bøttekadens og én
lagret RGB per bøtte, med15 % kvalitetshysterese og overskriving av gamle filer.
Dette kan miste tidsforbindelser selv om det bevarer et bedre teksturfoto. Dagens
fixtures kan ikke skille avviste kandidater fra overskrevne mellomfoto eller bevise
at tidsluken forårsaker akkurat veggfeilen. Ikke endre erstatningspolicy kun ut fra
korrelasjonen. Neste konkrete kontroll: begrenset separat opptakslogg/diagnostiske
mellombilder som kan måle hvor kontinuiteten går tapt, uten å erstatte dagens
teksturfoto-buffer. Nødvendig før en ny målrettet telefoncapturetest.

Begge prosesser ferdige; ingen native endring, bake eller installasjon.
Artefakter: .tmp/scan-fixtures/2026-09-08/scene-graph-checks/.


## 53. Begrenset opptakslogg på telefon, 2026-09-09

MeshScanPresenter logger nå valg i capture-decisions.json ved Ferdig. Delegatens
avvisningsgrunn registreres per kameratikk: tracking, minimumsintervall, bevegelse/
rotasjon/nyhetskontroll, fart, bøttekadens, blur, ingen-anker-nyhet og kopifeil.
Encoding-køen logger ikke-bedre, kapasitet, encode-/skrivefeil og faktisk lagret
nytt/erstatning. Erstatning inkluderer GAMMELT tidsstempel og stabil filindeks, slik
at også overskriving ETTER tidsluken kan forklare et tapt mellomfoto. Bøttenøkler
lagres som strenger for å bevare64-bit-identitet i JSON-lesere.

Ingen terskel, bildeutvalg, kfQuality eller overskrivingsregel endret. Dette lagrer
IKKE ekstra RGB; loggen kan forklare beslutningen, men ikke bevise kvaliteten på
forkastede/overskrevne foto. Kun metadata i minnet under opptak, NSLock mellom
AR-delegat og captureQueue, maksimalt20000 detaljerte hendelser. Totaltall og
årsaktellere fortsetter etter taket; dropped er eksplisitt. Ingen ARFrame beholdes,
ingen disk-I/O per kameratikk. JSON skrives etter at encoding-køen er drenert ved
Ferdig. Ingen journal garantert ved avbrutt/kræsjet skann.

verify-scan-capture-audit.py kjører faktisk Foundation-only Swift-klasse: truncation,
1000 samtidige innskrivinger, identisk erstatningslinje, Int64-presisjon og NaN/Inf-
serialisering passerer. Eksisterende11 capture-retry-asserts passerer. Ny leser
 audit-scan-capture-gaps.py kontrollerer lagrede RGB-luker mot beslutninger i luken
og overskrivinger senere. Kontroll med usorterte frameindekser, senere erstatning,
årsaktall og avkortet journal passerer. Ingen full kamera-/ytelsesvalidering ennå.

Release iPhone-bygg passerer. Installert på Tormods iPhone13Pro kl01:48:52 i
verktøyets klokke, databaseSequence1896, bundle no.ampex.app. Bygget inkluderer også
den tidligere testede volumgrensefeilen fra§35; eksperimentelle felter er fortsatt
av. Release simulatorbygget passerer også; begge byggeprosesser er ferdige.
Neste nødvendige data: ett nytt20–30 s skann med normal fart, to passeringer over
samme vegg, avsluttet med Ferdig. Trekk ut bundle og journal før nye policyvalg.
Artefakter: .tmp/scan-fixtures/2026-09-08/capture-decision-checks/.


## 54. Ny normalfartscan: flere pass skader ikke, 8192 bevarer mer veggdetalj, 2026-09-09

Ny iPhone-scan på 30,4 s har 45 RGB-keyframes og 137 dense dybdekart, med to
passeringer av samme panelvegg. `capture-decisions.json` viser ingen hard avvisning
for fart eller blur og ingen capture-feil. Råbildene er brukbare; brukerens normale
gangfart er derfor ikke hovedforklaringen på kvalitetsgapet.

Samme anchor-geometri ble bakt med hele tidslinjen, første pass alene (frame 0–14)
og siste pass alene (39–44). Hele tidslinjen var marginalt skarpere enn hvert isolert
pass fra samme kameravinkel (6,60 mot 6,24, og 5,65 mot 5,56). Flere vinkler gjorde
altså ikke veggen dårligere i denne scannen. Ståstedsklynging var praktisk talt en
no-op; sterkere ICM/Potts reduserte ikke regionmosaikken; plan-tone av ga bare 2–3 %;
kvalitetsgulv 0,01 ga 0–0,3 % og ingen synlig gevinst. Atlas-JPEG 1,0 tredoblet
modellstørrelsen til 28 MB uten detaljgevinst og beholdes ikke.

UV-auditen målte store veggregioner til ca. 854–886 texler/m i 6144-atlaset,
median ca. 860 texler/m (0,86 px/mm), mens kildebildene typisk har 1,4–2,8 px/mm
på opptaksavstanden. 8192-testen fullførte på 16,1 s i simulatoren, ga 13 MB GLB
og økte innzoomet veggdetalj 6,86→7,32 og 4,77→5,02, ca. 5–7 %. På vanlig
visningsavstand var forskjellen skjult av skjermnedskaleringen. Produksjonsbudsjettet
velger nå 8192 også ved 2000–2799 MB ledig arbeidsminne, men beholder 160 keyframes;
under 2000 MB eller ved alvorlig termikk gjelder eksisterende 6144/4096-fallback.
Release-bygg passerer og er installert på Tormods iPhone 13 Pro kl. 17:37,
databaseSequence 1912. Den bevarte scannen ble deretter bakt direkte på telefonen:
8192 fullførte uten minnefeil på 10,28 s, med 93 % dekning og 13 MB GLB.
Harness kan nå løse et fixture-navn under appens Documents/scan-frames, slik at
telefonens faktiske minnevei kan verifiseres uten å kjenne container-UUID-en.
Den nye 8192-GLB-en erstatter også denne scannens eksisterende 6144-fil i
Documents/room-scans; gammel fil er sikkerhetskopiert lokalt. Etter overføringen er
room-scans kontrollert som mappe med alle 22 tidligere modellfiler og tilhørende
forhåndsvisninger gjenopprettet, og nyeste modell er målt til 13,7 MB.

Dette er en målt detaljforbedring, ikke Scaniverse-nivå. Enkeltfoto-kontrollen viser
at resterende tap skjer i geometri/projeksjon og sammensetning, ikke fordi senere
passeringer overskriver en skarp første passering. Neste arkitekturkontroll er
veggspesifikk høyoppløselig teksturering (flere atlas/materialer eller direkte
kildetekstur), med samme fixture før eventuell aktivering.

## 55. Direkte kildetekstur og fire atlas: ingen tydelig gevinst over 8192, 2026-09-09

Samme normalfartfixture fra §54, 93 663 trekanter. To kontroller gjennomført:

1. `tools/audit-scan-source-textures.py` bruker faktisk vinnerfoto fra matching
   trace direkte på den største panelveggen (region 1). 12 046 av 12 466 veggflater
   har alle hjørnene innenfor fotoet; resten beholder atlaset. Ti tapsfrie PNG-utsnitt
   gir 21,27 MP / 81,15 MiB RGBA, halv bildestørrelse gir 20,28 MiB. Samme geometri
   og vinnere, men tonekorreksjon/fjæring/warp er IKKE med i denne kontrollen.
   Lineært interpolerte prosjektive UV-er er også en tilnærming. Full oppløsning har
   skarpere spor enn halv, men tydelige tonelapper kommer tilbake. Dette er derfor
   ingen produksjonsløsning eller isolert sammenligning mot dagens fargebehandling.

2. `meshscan.atlastiles=4096/6144`, kun med `debugSink`, baker fire utsnitt med
   EKSISTERENDE rasterizer, vinnere, kameraer og verdensromskorreksjoner. Hvert utsnitt
   har 8 px filterkant og eget autoreleasepool. Standard-GLB eksporteres samtidig
   som kontroll; appens normale bane er uendret. `tools/pack-scan-atlas-tiles.py`
   klipper trekanter ved UV-grensene og lager GLB med fire materialer. Flatearealet
   er bevart til 36,11438692164489 m²; 95 159 eksporttrekanter etter klippingen.
   `verify-scan-atlas-tiles.py` kontrollerer en skrå vegg over alle fire sider:
   posisjon, normal, UV-plassering, filterkant og areal per side passerer.

Fire 4096-atlas har omtrent samme samlede texeltetthet som ett 8192-atlas
(256 MiB RGBA uten mipmaps). Fire 6144-atlas gir 2,25 ganger så mange texler
(576 MiB uten mipmaps). De ferdige filene er 21,64 og 31,32 MB. Simulatorbaken,
inkludert standardkontroll OG fire ekstrabakes, tok 44,24 / 46,58 s; dette er IKKE
målt produksjonstid eller målt toppminne. Begge fullførte med 93 % dekning.

Visuell kontroll: frame 5, 43 og 20, både hele kamerabildet og 2,85× sentrert
utsnitt ved 1000×562 renderpiksler. Fire 6144-atlas gir ingen tydelig visuell gevinst
over 8192. Kantkontrast i detaljutsnittene: 8,74→8,75; 7,03→6,83; 8,61→8,52.
Fire 4096-kontrollen: 8,74→8,66; 7,03→7,04; 8,62→8,40. Disse tallene er
diagnostisk gradientenergi, IKKE generell skarphet, korrekthet eller Scaniverse-score.
Hver flisvariant sammenlignes med standard-GLB-en fra SIN EGEN bake: kameraene
var identiske mellom kjøringene, men 822/93 663 vinnere skiftet mellom separate
kjøringer. Derfor er sammenligninger mellom kjøringer mindre kontrollerte.

Sammenligningsviewer rettet: MeshBasicMaterial og anisotropi tilsvarer prinsippet i
Ampex' konstante fotobelysning. Tidligere la viewer HemisphereLight/PBR på bildet.
Kameraet bruker nå fx/fy/cx/cy og eksakt samme sentrerte crop som råbildet; tidligere
ble FOV multiplisert med 0,35 mens bildet ble zoomet 2,85×, som ikke er helt likt.
De gamle §54-tallene gjelder derfor den gamle diagnostiske visningen. Dagens
enhetsviewer hadde allerede konstant lys og anisotropi; denne rettelsen er i
sammenligningsverktøyet, ikke en ny kvalitetsøkning i Ampex.

Beslutning: IKKE aktiver flere atlas eller direkte kildetekstur som standard.
Ingen installasjon på telefon denne runden. Native viewer leser foreløpig bare ett
materiale; testfilene skal vises i den eksterne sammenligningsvieweren. Mer atlasplass
utover 8192 er ikke dokumentert som løsningen på de synlige veggproblemene her.
Videre arbeid må måle bildejustering og fargekorreksjon, med identiske vinnere mellom
kontroll og variant. Scaniverse-GLB av referanseskannen vil være nyttig for å måle
deres faktiske geometridetthet og teksturfordeling; skjermbilder kan ikke avsløre det.

Artefakter i `/private/tmp/ampex-new-scan-1788963302851/`: `source-wall*.glb`,
`source-render-results.json`, `tile4096-control.glb`, `tile6144-control.glb`,
`tiles4096.glb`, `tiles6144.glb`, `tile-render-results.json`, `compare-*.png`.
Matching traces: `trace-1788969975854` (6144) og `trace-1788970062739` (4096).
Release-simulatorbygg og diff-sjekk passerer. Ingen commit/push.

## 56. Faktisk Scaniverse-GLB: samme atlasbudsjett, prosjektive teksturfelt, 2026-09-09

Mottatt `~/Downloads/Scaniverse 2026-09-06 123218.glb`, 12 826 940 byte.
Vanlig mesh, ikke splats: 123 862 vertices, 189 701 trekanter, ett materiale og
én 8192×8192 JPEG (8 071 896 byte), ingen normals i eksporten. Identitetsnoder.
`tools/audit-scan-glb-layout.py` leser accessor-offset/stride, måler arealvektet
tetthet og trekantstørrelse og trekker ut de faktiske teksturene.

Scaniverse dekker 63,62 m² mot Ampex-kontrollens 36,11 m²; ulike opptak og utsnitt,
så dette er IKKE en registrert sammenligning av samme flate. Median texeltetthet på
vertikale flater er ca. 462/m mot Ampex 1155/m. Median største trekantkant på disse
flatene er 6,10 cm mot 3,95 cm. Begge bruker ett 8192-atlas. God referansekvalitet
kan altså oppnås innen dagens atlasbudsjett; tallene støtter ikke mer atlasplass
eller generelt finere veggtriangler som forklaring på kvalitetsgapet.

Ny konkret forskjell: de 12 største sammenhengende UV-komponentene i Scaniverse
(1,09–2,79 m²) passer hver til én 3D→2D prosjektiv kameramatrise. Deterministisk
2/3 tilpasning, 1/3 holdout: p90 UV-feil bare 0,00025–0,00040 atlaspiksler.
Affin kontroll har p90 37–135 px. Dette er sterkt belegg for prosjektiv UV-mapping
per felt, og stemmer med fotolignende utsnitt i atlaset. Det avslører IKKE hvilke
originalbilder som bidrar til pikslene, om bilder er sammenslått i et virtuelt
kamera, poseoptimalisering eller leverandørens farge-/skjøtebehandling. UV-feilen
er ingen kvalitets- eller kameranøyaktighetsscore.

Ampex har xatlas-felt som er uavhengige av kameravinnerne. I matching trace fra
§55 bruker 11 av de 12 største feltene 2–14 ulike detaljvinnere; ett har én vinner.
Det er heller ikke alene en feil: også en kontinuerlig fotomosaikk kan legges i et
xatlas-felt. Endret UV-mapping alene retter ikke feil bildejustering. Neste avgrensede
forsøk bør følge sammenhengende vinnerområder med prosjektive felt og BEVARE dagens
fargebehandling, i motsetning til direkte råfoto-kontrollen i §55. Ikke gjenta
helveggslås, større atlas eller ukorrigerte kildeteksturer og kall det en ny løsning.

Visuell kontroll av GLB fra fire innendørsvinkler, MeshBasicMaterial og anisotropi,
uten ekstra belysning: referansen bevarer panelspor godt, men har også enkelte
linjeknekk. Ingen påstand om feilfri referanse eller at Ampex nå har samme kvalitet.
En lokal `reference.html` i eksisterende newscan-viewer viser eksporten med
veggpresets, fri blikkretning og valgfritt trekantnett.

`tools/verify-scan-glb-projection.py` passerer: eksakt syntetisk kameraprojeksjon
gjenfinnes på ubrukte vertices, mens UV-er med uavhengig støy avvises. Artefakter:
`/private/tmp/ampex-scaniverse-reference/{layout.json,ampex-chart-sources.json,view-*.png}`.
Ingen native standardendring eller telefoninstallasjon denne runden. Den mottatte
eksporten er tilstrekkelig for denne kontrollen; ingen ny skann nødvendig nå.

## 57. Native prosjektive felt med bevart fargebehandling; ingen detaljgevinst, 2026-09-09

`meshscan.projectiveatlas=on`, krever `debugSink`, lager en ekstra GLB fra samme bake.
Felt følger eksisterende sammenhengende vinnerregioner. Kameraprojeksjon i kildepiksler
per hjørne, rektangulær pakking med 8 px kant, ett 8192-atlas. Hvis ett hjørne er bak
kameraet eller utenfor fotoets 2 px innerrand, bruker HELE trekanten eksisterende
xatlas-koordinater i et separat fallback-felt. Geometri, hjørnerekkefølge, normals,
vinnerfoto, regionoffset, hjørneoffset, fjæring, warp og plan-snitt sendes uendret
til den faktiske native rasterizeren. UV/hjørner dupliseres for denne diagnosen.
Vanlig GLB og appstandard endres ikke. Dette er en enkel pakker, ikke optimal pakking,
og vanlig GLB-interpolasjon gjelder; ingen perspektivvekt er lagt i Metal-rasteren.

Normalfartfixture §54, `anchor`, `atlas8192`, `fringetrim off`: 843 felt,
86 219/93 663 trekanter prosjektive, felles kildeskala 0,60668. Fil 17 959 148 byte
mot kontroll 14 271 652. Alle 93 663 trekanters posisjoner og normals er bit-identiske
per hjørne. Begge atlaser bakes i SAMME kjøring; vinner- og fargebehandling er dermed
identisk. Totalt 24,53 s inkluderer begge bakes, ikke vanlig produksjonstid.
Trace `1788971666095`. Sluttkameraene er også identiske med §55-kontrollen.

Tre kameravinkler (5,43,20), full og 2,85× crop: ingen tydelig samlet detaljgevinst.
Lokal kantkontrast ved crop: 8,74→8,74; 7,03→6,77; 8,63→8,52. Dette er fortsatt
gradientenergi, ikke kvalitetsprosent. Linjeknekk og fargevariasjon er stort sett lik.
Prosjektiv representasjon med samme foto-/fargevalg forkastes som standardkandidat.
Analytisk kontroll av forskjellen mellom lineær UV-interpolasjon og nøyaktig kamera-
projeksjon ved centroid og tre kantmidtpunkter: arealvektet median/p90/p99 på
vertikale flater 0,108/0,367/3,717 KILDEpiksler. Utvalget er de 86 219 gyldige
trekantene; dette er ikke en maksimalfeil over hele trekanten eller en skarphetsscore.

`tools/verify-scan-projective-atlas.py` trekker ut og kjører selve Swift-pakkeren:
bevart geometri/normaler, skrå kameraprojeksjon, helflate-fallback, adskilte felter,
padding, dimensjonsvalidering og determinisme passerer. Release arm64-simulatorbygg
passerer. Testbygget er bare installert i simulatoren. Ingen telefoninstallasjon.

## 58. Detaljtap inne i ett foto; grovere tone reduserer flekker, 2026-09-09

Etter §57 ble de faktiske vinnerovergangene vist som overlegg, fra
`tools/audit-scan-texture-seams.py`. 10 µm geometrisveising kobler UV-splitter;
kun manifoldkanter mellom to vertikale flater med ulike gyldige vinnere telles.
2 145 slike kanter, samlet 64,01 m i hele modellen. Dette er IKKE et mål på
registreringsfeil, og små kanter betyr ikke nødvendigvis synlige sømmer.

Avgjørende lokal kontroll: et separat kilde-ID-renderpass med samme kameracrop,
uten MSAA (ellers oppstår falske ID-er langs kanter), viser i frame43-crop
553 055 dekkede renderpiksler, ALLE fra kildefoto43. Frame5 har foto5/36/43;
frame20 har foto17/18/19/20. Dermed kan ikke vinneroverganger alene forklare
detaljtapet i frame43-crop. Ikke konkluder generelt med at flere foto er årsaken.

Eksisterende `planeavgpx=64` fra §18 ble derfor kontrollert igjen på den NYE
normalfartfixturen, mot standard512 fra §57. 15,32 s, 93 % dekning, trace
`1788972136723`. Samme kameraer; separate kjøringer endrer 728/93 663 vinnere
globalt, men INGEN av kontrollens frame43-vinnere endres. Frame43-crop er dermed
en kontroll med bevart detaljkilde; øvrige utsnitt har denne begrensningen.
Posisjoner, normals, UV-er og indekser er også kontrollert bit-identiske mellom
tone64 og standardkontrollen. Ingen geometri-/UV-endring forklarer denne forskjellen.

Visuelt færre små lyse/mørke felt på panelveggen ved normal avstand, særlig frame5.
Nesten ingen ekstra skarphet i frame43-detaljen: kantkontrast 7,03→7,06. Øvrige
cropverdier 8,74→8,85 og 8,63→8,65. Fullbilder 7,92→8,24; 6,96→7,17;
10,88→10,84. Dette er en kandidat for jevnere farge, ikke dokumentasjon på
Scaniverse-detalj eller ferdig ny standard. `planeavgpx` er fortsatt 512 i appen.

Neste isolerte kontroll ved videre arbeid: mål råfoto43 → ferdig tekstur INNE I
dets eget sammenhengende område, med samme vinner/UV og full fargekorreksjon som
egen ablasjon. Ikke legg til mer bildejustering eller øk atlaset uten å skille dette
fra samplings-/fargebehandlingstapet. Grovere plan-tone alene er ikke løsningen.

Artefakter i `/private/tmp/ampex-new-scan-1788963302851/`: `projective*.glb/json`,
`tone64.glb`, `tone64-render-results.json`, `compare-projective-*.png`,
`compare-tone64-*.png`, matching traces over. Sammenligningsviewer har valg for
begge varianter, og bildeskjøter kun for paret med identiske vinnere. Kilde-ID-pass
og kantkontrast holdes adskilt. Ingen commit/push; telefonen beholder §54-bygget.

## 59. Bevist tone-aliasing lager hvite veggflekker; rettet HYBRID-standard, 2026-09-09

§58 ble fulgt til rå kildepiksler. `meshscan.colorablation=on` (krever debugSink)
baker en ekstra `raw-color.glb` i SAMME native kjøring, med identisk geometri, UV,
kamera, vinnere og warp, men uten gain/vignettering/fargenivellering/plan-snitt.
Begge rastere kan også lagre tapsfri atlas-PNG i trace. Vanlig JPEG-kvalitet er
fortsatt0,90. Diagnostikken er avslått i vanlig appbruk. Kontrolltrace1788972936734.

### Isolert detaljsampling: ingen skjult nedskalering eller fargeprofilfeil

202811 indre renderpiksler og22 panelspor i frame43 ble kontrollert med CPU-ray,
perspektivkorrekt GLB-UV og bilineær interpolasjon i LINEÆRT lys. Kildebildet er
3840×2160; lokalt er atlaset0,70–0,76 texel/kildepiksel. Positive sporkanter har
median FWHM2,5 kildepiksler i råfotoet og3,0 etter en ideell bilineær
kilde→atlas→kamera-kjede. Native rå-PNG og JPEG har også3,0. Native tapsfri råatlas
mot ideell sampling:90% av indre RGB-kanaler eksakt like, p99-feil1/255.
En foreløpig PNG2,75/JPEG3,0-måling brukte feilaktig sRGB-interpolasjon i siste
CPU-steg og er FORKASTET. Ingen dokumentert ekstra0,25px JPEG-blur.

DeviceRGB mot eksplisitt sRGB gir bit-identisk dekoding av alle8,29 millioner
piksler. Fulloppløsningsfotoet når GPU. Ikke endre profilen eller legge til
halvpikseloffset: bildepiksler i CPU/OpenCV skal uttrykkes somu−0,5/v−0,5 når
de sammenlignes med Metal-normaliserteu/W ogv/H. Clamped Catmull-Rom ga kun
FWHM2,75 mot3,0, men23% høyere aliasamplitude over atlasets Nyquist-grense;
ikke aktivert globalt for denne lille gevinsten.

### Kausal feil og produksjonsrettelse

Trekant15463 ved(−0,15750317;0,09620375;−1,65475547) på normalfartfixturen
bruker foto5. To hjørner treffer mørke panelspor i512px tonebildet. Dermed måles
store POSITIVE tonekorreksjoner på hjørnene, som interpoleres over den lyse
trekantflaten. Native hjørne+region-offset ved centroid er+0,12224 i lineær luma,
mens faktisk centroid-konsensus minus vinner der er−0,06144. Feil fortegn og romlig
utstrekning skaper en hvit flekk. Vektet median/Huber på de samme hjørnetreffene
ville ikke løst dette; problemet er tonebildets båndbredde mot sparsom sampling.

Standard HYBRID måler nå brede lysforskjeller fra64px tommelbilder. FLAT-takets
gainmåling beholder512px. Ny separat liten cache; full3840×2160 detaljtekstur,
bildefilter, atlas, kameraer og geometri endres ikke. Eksplisitt `planeavgpx`
setter fortsatt BEGGE størrelser, så512 gjenoppretter kontrollarmen. Native
point-trace bruker samme HYBRID-cache som rettelsen og angir`tonePixels`.

Ny trace1788974124329 (9604ms) mot gammel512-kontroll1788974181053 (8866ms):
hjørne+region-offset ved målepunktet er nå−0,02046, nær den brede
centroid-korreksjonen−0,02244. Gjennomsnittlig RGB i en5×5 kildepikselflate er
råfoto229,6/228,6/224,6, gammel253,1/254,0/249,1, rettet237,8/236,8/232,8.
Den sterke lokale opplysningen er fjernet; en bred lysjustering består.

Geometri, UV, normals, indekser og kameraer er bit-identiske. Separate bakes har
825 forskjellige vinnere globalt, men INGEN synlige vinnerendringer i frame5-
målutsnittet eller frame43-kontrollen. Etter fratrekk av en bred kvadratisk
lysgradient faller lokal tone-RMSE mot eget kildefoto ved sigma12 kildepiksler
fra0,02672 til0,003475 i frame5 og0,01087 til0,007296 i frame43. Dette er
lokal tonefeil, IKKE en samlet kvalitetsprosent. Samme22 spor beholder FWHM3,0px
og ekstra sigma0,7px. Rettelsen demper kunstige flekker; den øker ikke påvist
sporskarphet eller retter geometriske linjeknekk.

### Regresjonskontroll og status

`tools/verify-scan-tone-bandwidth.py` kjører produksjonens størrelsesvalg, toneAt
og MeshImageIO på syntetiske JPEG-er: feil sparsom opplysning0,16032→0,02329,
bred lysvariasjon bevart0,20692→0,20316, FLAT512 uendret og original sporkontrast
bevart. Testen verifiserer også A/B-overstyringer og ugyldige verdier.

To ekstra ekte fixtures med anchor8192: soverom152foto,192313trekanter,25,59/25,47s;
eldre flerrunde27126trekanter,5,70/5,61s. Parene har bit-identiske geometri-/UV-
buffere og kameraer. Visuelt kontrollert soverom60/147 og flerrunde5/12 uten ny
utvisking eller tydelig økt flekkdannelse.25451 øvre horisontale soveromsflater
har veid RGB-differanse0,00553/255;99,375% av sampled centroids er helt like.
Ceiling-only render-ROI:0,0100/255 differanse, p95=0. Separate kjøringer endrer
2846/158 vinnere globalt, så små øvrige forskjeller skal ikke overtolkes.

Simulator arm64 og fysisk iPhone Release bygger. Rettelsen er installert på
Tormods13Pro kl.21:20 norsk tid, databaseSequence1920. Første kontrollstart på
telefonen ble hindret av låst skjerm; installasjon alene bekrefter ikke en ny bake.
Ingen commit/push. Viewer har `tone-fixed.glb` mot matching`tone-control512.glb`.
Artefakter: `/private/tmp/ampex-tone-audit/README.md`,
`/private/tmp/ampex-tone-cross-fixture-checks.json`,
`/private/tmp/ampex-new-scan-1788963302851/bright-patch-tone-corners.json`.

### Målt alternativ: Apple Object Capture dekker ikke rommet med disse dataene

Separat Mac-proof med alle45 eksisterende foto, `.reduced`, både JPEG+rådybde
og JPEG alene:25,65/20,27s, kun7/8 foto(29–35/29–36) beholdt,38/37 avvist.
Begge fullfører teknisk, men gir et sterkt vridd gulv-/møbelfragment uten panelvegger,
ca25000trekanter og2048² tekstur. Dette er Mac-tider, ikke iPhone-tider.
Ikke bytt produksjonspipeline til dette på grunnlag av API-tilgjengelighet.
Apple tillater ikke å sette ARKit-kamera/posene direkte via offentlig sample-API;
custom depth er ikke en garanti for samme LiDAR-underlag som ObjectCaptureSession.
SDK og Apple-dokumentasjon samt runner/resultater er beskrevet i
`/private/tmp/ampex-apple-photogrammetry-depth/README.md`.

## 60. Nytt telefonskann etter tonefiksen er fortsatt under målet, 2026-09-09

Brukeren tok nytt skann og sa uttrykkelig at dette ikke er Scaniverse-nivå. Direkte
visuell kontroll av FAKTISK telefon-GLB støtter dette: lange panelspor hopper ved
store kildebildegrenser, med tydelige varme/kalde tonefelt. Ikke presenter§59 som
Scaniverse-kvalitet. Den rettet en reell, lokal tonefeil, ikke registreringen av foto.

Fixture-ID `ampex-cd97e012-c91e-4e70-9e72-4ebaf1373503-1788974472517`.
Telefonmodell `mesh-ampex-cd97e012-c91e-4e70-9e72-4ebaf1373503-1788974502183.glb`.
Hentet uendret til `/private/tmp/ampex-latest-phone-1788974502183.glb`.
Pipeline bekrefter HYBRID64,atlas8192,36foto,45384trekanter,97%fylt,8110ms bake.
Dette bekrefter produksjonskjøringen etter installasjon1920; den tidligere
harness-starten på låst skjerm ble ikke forsøkt igjen, og dens gamle done-fil
er IKKE en ny test. Det nye telefonskannet er ikke overskrevet.

121 rådybdekart,36 hele3840×2160 JPEG-er,29,10s fangstlogg.27 tracking-avvisninger
ligger bare i de første0,867s; ingen hard fart-/blur-avvisning. Ni vellykkede
erstatninger i seks bucket-indekser,18 kandidater forkastet som ikke bedre.
Siste beholdte foto når28,86s. Blurproxy median/p9015,21/30,24 mot17,58/39,32 i
forrige45foto-fixture. Dette er ikke mål på faktisk pikselblur, men gir ingen
støtte for å skylde på brukerens fart. Alle refererte kildefoto finnes.

Faktisk telefonmodell rendret fra pose5/10/15/20/25/30/35; originalfoto kontrollert.
I pose35 vedx≈934 av1400 renderpiksler hopper panelspor over overgangen
foto35→31, lenger nede4→31. Matching simulator-kontroll er
`rebake-harness-latest-control-1788974749346.glb`,6552ms. Punkttrace
`1788974944323`,6469ms ved(−0,5391;−0,267;−1,70615) bekrefter
trekanter31130/31108 og seks naboer:ALLE HYBRID,plane0,locked=false.
Normalene er≈(0,44370;−0,00299;0,89617),planD≈−1,76740 på begge sider.
Dette er ikke et geometrisk plangjørne eller en låst plansplitt. Score35 er
0,170/0,167 og31 er0,143/0,175 på de to sidene; begge foto er gyldige.

Separat sporing av veggflekker må holdes adskilt fra linjesprangene:

- I forrige45foto-fixture var trekant34283 feilmerket VINDU(class6, verifisert i
  ARMeshGeometry.h), ekskludert fra HYBRID selv1,06mm fra samme veggplan som
  nabo34268. Begge brukerfoto17; rå RGB-forskjell≈2 nivåer blir≈13 i modellen.
  Tidlig omtale som «dør» var feil. Streng redning med1cm/hjørne,normal>.98 og
  veggnabostøtte slipper bare inn27trekanter/0,00764m² på NY-fixturen, ingen i
  målt høyrevegg-ROI og ingen i glass-ROI. Ikke innfør dette som hovedfiks.
- Ny trekant9045/9044:begge wall,class1,foto18,region65,støtte18/19/20 og alle
  hjørner≤7,82mm fra veggen. Men9045 normal-align0,7617 avvises fra HYBRID,
  mot0,9576 på naboen. Nesten lik råfarge59/65/65 og60/64/65 blir faktisk
  telefonatlas102/107/110 og66/74/76. En behandlingsterskel lager en stor flekk.
- Begge HYBRID15407/9421 har identisk kildefarge frafoto20,76/78/73, men faktisk
  telefonatlas79/81/80 mot67/72/68. Støtte endres fra{20} til{18,20};foto18
  ligger bare19 kildepiksler fra toppen og gir mye mørkere64px-tone. Også
  brå skifter i gyldige støttebilder kan dermed lage tonesprang.

Telefon og matching kontroll har bit-identisk geometri/UV, men kildevinnere fra
opprinnelig telefonbake ble ikke lagret. Eksakt støtte/vinner-attribusjon i de
siste to punktene gjelder kontrolltracen; nesten lik lokal telefonfarge bekrefter
at feilen også finnes der. Ikke påstå globalt identiske kildevalg.

Sammenligningsviewer `latest.html?frame=35` viser originalfoto og faktisk ny
telefonmodell, ikke en simulatorvariant.36 kameravinkler, full/detaljvisning,
MeshBasicMaterial uten ekstra lys og samme registrerte kameraintrinsikk.
Artefakter `/private/tmp/ampex-new-scan-1788974472517/phone-compare-*.png`,
`/private/tmp/ampex-new-pair-support.json`, `/private/tmp/ampex-patch-pair.json`.
Ingen ny produksjonsendring fra denne kontrollen; §59-rettelsen består.

Avsluttende presis linjekontroll: fem sammenhengende, gyldige råfotospor viser
35-minus31 forskyvning7,73/8,66/10,08/11,21/12,07 piksler i1400px renderrom.
Forskjellen finnes i de projiserte FOTOENE før tonebake. Ikke gjett at en ny
fargeinnstilling eller geometriutflating kan rette den. Hele region21 kan ikke
byttes til35/4: bare57,17/65,07% arealdekning. Begrenset til samme veggplan:
592flater,0,19947m²,35 dekker93,16%(49flater utenfor foto),4 dekker94,25%
(43okkludert),31 dekkeralle. Heller ikke dette er en gyldig HEL regionerstatning;
energigevinst ble derfor ikke evaluert. Ingen region-merge aktivert.

Originalfixture, faktisk telefon-GLB, pipeline-logg og begge tracer er også bevart
i `.tmp/scan-fixtures/2026-09-09/latest-cd97e012/`. Neste reelle kvalitetsjobb må
adressere bilderegistreringen ved disse målte overgangene og validere ubrukte
panelspor/andre vinkler. Tone-støttens terskelfeil over er en separat, dokumentert
rest. Ingen nye skann trengs for å teste disse to konkrete feilene.

## 61. Felles veggtone retter to målte fargeskjøter, 2026-09-09

Ny produksjonsrettelse i MeshBakeV2: ett bredt tonemål per fysisk, sveiset hjørne
og veggplan. Nabotrekanter bruker samme støtte, normal og målverdi ved felles kant.
Støttefoto fades inn over én64px-tonefotavtrykk fra den eksisterende8px bildegrensen.
Fulloppløsningsdetaljen beholdes fra vinnerfotoet. Ingen ny kamerajustering eller
skarphetsgevinst er dokumentert av denne rettelsen. `meshscan.toneshared=off`
gjenoppretter den gamle kontrollarmen; standard er nå på.

Trekant9045 redder sin HYBRID-behandling fordi den er klassifisert som vegg, alle
tre hjørner er innen1cm fra planet, normaldot>.5 og TO opprinnelige veggnaboer
tilhører samme vertikale plan. Ingen rekursiv utvidelse, ingen vindu-/møbelredning.
18små flater i ny36foto-fixture kvalifiserer, totalt≈0,00295m². Geometrien flyttes
ikke, og bildevalg/planlåsing skjer før denne tonebehandlingen.

Eksakt native A/B: kontroll1788975891861, første kandidat1788976219423,
endelig kandidat1788977007364 (6410ms). Ved9045/9044 faller kunstig sprang rett
innenfor felles kant fra≈20 RGB-nivåer til≤1. Ved15407/9421 faller tilsvarende
sprang4→0. Samme detaljfoto18/20 brukes på de fire målepunktene. Endelige
centroid-RGB er64/74/76,68/76/78,79/81/78 og75/77/74. Hjørne+region-offset er
kontinuerlig på begge målte kanter; detalj-/skyggevariasjon inne i flaten består.

Første kandidat lot73 tidligere korrigerte flater falle tilbake til sitt gamle
regionnivå fordi minst ett hjørne manglet streng fotostøtte. Dette er rettet med
én avgrenset fortsettelse av TONEN: et manglende hjørne trenger minst to forskjellige,
direkte tilstøtende, OPPRINNELIG observerte hjørner på samme plan, hver innen5cm.
Avstandsveid snitt; utfylte hjørner brukes aldri som nye observasjoner. Ingen
detaljpiksler konstrueres.64 ekstra hjørner støttes,9807/10098 totalt;
17889/18413 flater korrigeres, mot17815 i første kandidat.67av73 tapte flater
gjenopprettes, pluss7 andre. Resten beholder gammel fallback. Verst målte restnivå
på37393 går fra[.01443,.01095,.03069] til[.000187,.000189,.000092] i lineær RGB.

Full SceneKit-kontroll med faktisk Ampex-loader/materialer fra pose20/35 og på to
andre skann:45foto pose5/43 og soverom152foto pose60/147. Ingen ny synlig
detaljutvisking eller grove toneflekker. Endelig45foto-bake1788977081019 tar8,99s;
soverom1788977092424 tar25,03s. Kontroller uten rettelsen9,24/25,33s.
Geometri, UV og raffinerte kameraer er bit-identiske innen hvert A/B-par.
Takets FLAT-behandling består: centroid RGB-differanse≈.0138/.00953 av255,
p95=0 på13727/25638 takflater. Små forskjeller begrenses av eksisterende
ikke-deterministisk bildevalg:740/2732 endrede vinnere mellom separate kjøringer.
Usortert dictionary-naborekkefølge og like stemmetall i småregion-redning er
konkrete eksisterende kilder; ingen ny datarace funnet i toneberegningen.

`tools/verify-scan-shared-tone.py` kjører faktiske Swift-hjelpere: bildekant,
målt9045-normal, utstikkende hjørne, klasse-/takavvisning, avgrenset nabostøtte,
ingen videre spredning, offset-kansellering, bevart smal detalj og standard/A/B.
Består sammen med `verify-scan-tone-bandwidth.py`. Simulator- og iPhone-Release
bygger. Installert på13Pro, databaseSequence1928. Faktisk telefonbake på samme
36foto-fixture fullfører: `rebake-harness-shared-tone-device-1788977687868.glb`,
7850ms,97%fylt,9806/10098 tonemål,17890/18413 korrigerte flater. Ingen eksplisitt
toneshared-flagg: produksjonsstandarden er dermed kontrollert på telefonen.
Ny kontrollfil ligger ved rådataene; originalmodellen i skannlisten er bevart.
Ingen commit/push.

Diagnostikken skriver nå faktiske plane-/mode-/lock-etiketter, RGB-gains og
per-hjørne-/region-offsets i eksportert GLB-rekkefølge. SIMD3 flates eksplisitt
til3Float, ikke16byte Swift-stride. Kun debugSink lagrer disse filene.

Artefakter: `/private/tmp/ampex-shared-native-audit/report.json`,
`/private/tmp/ampex-shared-supported-audit/report.json`,
`/private/tmp/ampex-shared-scenekit/{cross-summary,supported-cross-summary}.json`.
Viewer `latest.html?frame=20&variant=shared-tone` viser samme siste skann med
fargerettelsen; menyen kan bytte tilbake til uendret faktisk telefonmodell.
Brutte panellinjer og eksisterende geometriske åpninger består. Ikke kall dette
Scaniverse-nivå; bilderegistreringen er neste separate krav.

## 62. Pose-proxyen godkjenner en lokal registreringsregresjon, 2026-09-09

Separat Mac-kjøring av UENDRET MeshPoseRefineV2 og MeshImageIO gjenskaper alle36
raffinerte kameraer bit-identisk med native trace. Originalposer gir fem35-minus31
panelspor ved−2,64/−0,61/+1,60/+4,18/+6,50 displaypx. Produksjonsraffineringen
gir+7,73/+8,66/+10,08/+11,21/+12,07. Frame35 flyttes31,2mm/1,383°,31 flyttes
12,74mm/0,584°. Reankring er praktisk talt null; intrinsics og bildestørrelser
er lagret korrekt. Ingen påvist metadata-/kopieringsfeil forklarer dette.

Raffineringens egen residual for35 forbedres.02284→.01394 samtidig som skjøten
forverres. En global kontroll med faste verdenspatcher og gradient-NCC forbedres
også på alle tre fixtures:36foto.290→.362,45foto.414→.587,152foto.286→.371.
Å slå av pose-raffineringen globalt ville forkaste målbare forbedringer andre
steder. Heller ikke global eller individuell proxy-residual kan være en trygg
akseptport for panelsporene. Lokale svake panelgradienter er for støyfølsomme i
den sparsomme patchkontrollen til å erstatte direkte strukturkorrespondanser.

Mid­lertidige solvervarianter begrenset svake Hessian-retninger og fjernet bred
lysvariasjon før raffinering. Ingen løser skjøten: beste høy­passvariant etterlater
0,83–9,09px og svak-retning-cutoff.005 etterlater4,6–10,4px. Ikke aktivert.
Rådybde mot meshen forbedres for35 fra18,3mm til7mm avvik mens bildene blir
dårligere registrert. Dybderesidual alene er derfor heller ikke en godkjenningsport.

En uavhengig identitetskobling mellom13/35 finnes i tre separate merker på en
list/rør ved veggen. SIFT er her kun identitetskontroll, ikke et generelt2D-felt.
Bred, normalrettet profilmåling med denne stripefasen finner en god lokal modell.
25 treningsvinduer/14 romlig atskilte holdout; faktisk12×8-felt på originalposer
gir median7,160→0,135/p909,740→0,279 rettifiserte px mot13. Likevel FORVERRES
den ubrukte35/31-skjøten til8,05–16,04 displaypx. Samme forsøk på riktige
produksjonsposer passerer lokal holdout.169/.439px, men gir12,36–17,93px mot31.
Dette er en felles referanse-feil, ikke bare blanding av originale/raffinerte poser.
Ikke aktiver individuelle gode bildefelt uten kontroll mot øvrige bidragsbilder.

Ny `tools/audit-scan-dense-panel-alignment.py` velger veggplan og panelretning fra
mesh/bilder, søker forbi en hel repetisjon og holder separate profilstriper ute.
Syntetisk kjent normalforskyvning gjenfinnes innen0,0114px;300 perfekt periodiske
kandidater avvises. Gjentatte striper kan gi lav residual på feil fysisk linje;
holdout alene beviser ikke identitet. Kandidatene over er IKKE produksjonskode.

Artefakter `/private/tmp/ampex-calibration-audit/README.md`,
`/private/tmp/ampex-dense-panel-field35{,-refined}/`,
`/private/tmp/ampex-newline-field35-external.json`.
En tidlig harness-kjøring1788976766735 brukte originalpose-felt med raffinering
på; inkompatibel diagnose, FORKASTET. Ikke bruk den som kvalitetsbevis.

## 63. Hullfyllingen manglet i TSDF-veien; kryssvertekser stoppet den, 2026-09-09

Målt mot den mottatte Scaniverse-eksporten, ikke mot en følelse: åpen mesh-grense per
kvadratmeter flate. Scaniverse ligger på 3,70 m/m² (235,3 m grense, 63,6 m² flate) — det
meste av det er ytterkanten av skannet og småhull rundt møbler; største sammenhengende
grense er 23,8 m, og 139 av 185 løkker er under 1 m.

Våre bakes lå på 5,07 m/m² (soveromsbundelen 1788963302851) og 4,03 m/m² (1788974472517).
Det er ikke tekstur: renderes GLB-en mot MAGENTA bakgrunn, er rissene tvers over veggen
bakgrunnsfarget. Det er hull i geometrien.

To årsaker, begge rettet:

1. **TSDF-veien fylte aldri hull.** `MeshTsdfBuild.build` — standard geometri siden
   2026-09-01 og den «Bygg om modellen» kjører — kalte hverken `filterSmallComponents`
   eller `fillPlanarHoles`. Anchor-veien har kjørt planær hullfylling siden scan #9.
   Surface Nets legger bare flate der voxlene er observert, så dybdefall langs panelspor,
   i vindusglans og under møbler kom rett ut i baken. Fyllingen kjøres nå etter plan-snapp
   og før normaler/UV-blokker, med re-snapp når noe faktisk ble fylt. Av med
   `meshscan.tsdfholefill=off`.

2. **`fillPlanarHoles` ga opp på kryssvertekser.** Løkkevandringen holdt ÉN utgående kant
   per weld-id og droppet hver løkke gjennom en verteks med flere — altså nøyaktig der to
   slisser møtes. Nå følges løkka slik den faktisk går: stå i endepunktet og rotér gjennom
   triangelviften til neste grensekant. Det gir riktige, atskilte løkker også i kryss.

Målt A/B på samme bundle, samme binær, kun flagget snudd:

| bundle | grense av | grense på | m/m² av → på | løkker av → på |
|---|---|---|---|---|
| 1788963302851 (30 m²) | 145,3 m | 105,3 m | 5,07 → **3,46** | 118 → 23 |
| 1788974472517 (13,6 m²) | 54,3 m | 45,4 m | 4,03 → **3,34** | 48 → 7 |

Begge ligger nå UNDER Scaniverse-referansens 3,70 m/m². Det som står igjen er ytterkanten
av skannet (42,5 m og 41,7 m i de to) — den skal ikke fylles. Flate +1,7 m². Baketid
uendret (21,3 → 19,1 s og 13,9 → 13,5 s). `fylt` uendret (93 % og 99 %), altså ingen ny
umalt flate: lappene males som resten av veggen. Kjørt to ganger, identisk resultat.

Loggen skiller nå ekte blindveier fra bokføring: `åpen 30` (ikke-manifold kant eller over
kanttaket) mot `408 kantstart falt sammen med behandlet løkke`. Den gamle telleren slo
disse sammen og så ut som 438 tapte hull.

**Ikke løst i denne runden.** Anchor-nettet fra LIVE-skannet har fortsatt sitt eget
sprekknett: 150,8 m av 203,8 m grense er ÉN sammenhengende komponent i fixturen fra
telefonen. Den er frosset i fixturen, så Mac-harnessen kan ikke A/B-e den — `readFixture`
leser ferdig geometri, `buildMerged` kjører ikke. Simulert offline gir viftevandringen bare
23,8 m av den lukket: resten er én løkke som snor seg gjennom hele skannet og som verken
skal eller kan vifte-fylles. Live-veien trenger et annet grep (slissedeteksjon i planet,
ikke løkkefylling). Rebake-veien — den som skal gi kvaliteten — er ikke avhengig av det.

Neste målte gap er tekstur, ikke geometri: `fylt=93 %` på soveromsbundelen betyr 7 % flate
uten foto, og i renderen er det en hvit søyle tvers over veggen ved vinduet. Atlaset er
dessuten sterkt fragmentert mot Scaniverses store prosjektive felt (§56), men teksel-
tettheten vår er 2,5× deres, så fragmenteringen er ikke det som koster skarphet.

Artefakter: `rebake-harness-hull{kontroll,fyll,fyll2}-*.glb` i 1788963302851 og
`rebake-harness-hull2{kontroll,fyll}-*.glb` i 1788974472517. Ingen commit/push.

## 64. Den hvite søylen: 2 m² uten foto, fylt med push-pull, 2026-09-09

`fylt=93 %` på soveromsbundelen er ikke en avrunding — det er 2,03 m² av 30,4 m² flate som
ingen keyframe malte. I renderen er det en HVIT søyle tvers over veggen ved vinduet. Hvit,
ikke svart, fordi atlaset tømmes til alfa 0 og `CGImage` med `premultipliedLast` flater
gjennomsiktig mot hvitt når JPEG-en skrives.

Diagnosen er entydig (`labels-winner.i32` fra trace, kryssjekket mot `refined-kf.json`):
av 11 733 vinnerløse flater lå **98,7 % aldri innenfor noen keyframes bildeflate**, og
INGEN av dem frontvendt. Dette er altså ikke en terskel som avviser dem — det finnes ikke
et foto å avvise. Bundelen har 137 dybdeframes mot 45 lagrede foto: geometrien er bygget av
LiDAR-strømmen, som dekker mer enn det som ble lagret som bilde. Redningspassene i
vinnervalget (relaksert score + 4 ringer nabo-flom) tar kanten av slike felt, ikke kjernen.

**Rettelse i baken:** push-pull-innfylling etter dilatasjonen. Dekningsvektet pyramide ned
til 8 px, opp igjen der alfa er 0, med bilineær oppsampling. Dilatasjonen (16 × 3×3) rekker
bare 16 texler og er laget for gutters; push-pull når vilkårlig store felt. Pyramiden starter
på 2048² siden fyllet er lavfrekvent uansett — minnetoppen blir ~22 MB i stedet for en full
8K-kjede. Kostnad målt: 31 ms og 22 ms. Av med `meshscan.pushpull=off`.

Målt A/B, samme bundle, samme binær:

| | nær-hvite texler i atlas | hvite piksler i render (vy 3) |
|---|---|---|
| 1788963302851 før | 14,0 % | 8,75 % |
| 1788963302851 etter | 4,0 % | **0,01 %** |
| 1788974472517 før | 22,2 % | 0,41 % (vy 1) |
| 1788974472517 etter | 0,0 % | 0,19 % |

Malte texler er urørt: median endring 0 nivå, og de 3,5 % som endres mer enn 2 nivå ligger
i JPEG-blokkene som grenser til fylte felt. På den godt dekkede bundelen endrer renderne seg
0,00–0,29 % av pikslene — altså ingen regresjon der det alt var foto.

**Hva fyllet er og ikke er.** Det dikter ingen detalj: fargen kommer fra naboflatene, og
resultatet er myk vegg-tone, ikke oppfunnet struktur. Men det betyr at modellen viser jevn
vegg der vi ikke har fotobevis — en stikkontakt i et felt uten foto blir ikke synlig.
Dekningsoverlegget under fangst er det som skal hindre det, og **rotårsaken står igjen**:
keyframe-utvalget skal dekke det dybdestrømmen bygger geometri av. Det kan ikke A/B-es på
Mac (bundelen har allerede bare de 45 bildene telefonen valgte) og krever et nytt skann.

Artefakter: `rebake-harness-ppfyll-*.glb` (1788963302851), `rebake-harness-pp2-*.glb`
(1788974472517), diagnoseskript `tools/audit-scan-unpainted.py`. Ingen commit/push.

## 65. Panelsporene: veggen var delt i 15 fotolapper, 2026-09-09

Med hull og hvite felt borte er det brutte panelspor som skiller oss fra referansen på nært
hold. Årsaken er ikke oppløsning — teksteltettheten vår er 2,5× Scaniverses (§56) — og heller
ikke bilderegistrering alene. Det er ANTALL fotolapper på én vegg:

Målt på soveromsbundelen, 6,7 m² veggplan: **15 ulike vinnerfoto, beste dekket 30 %**, og
**2,76 m søm per m² vegg** (grenser der vinnerfotoet skifter, umalte flater holdt utenfor).
Scaniverses tolv største UV-felt er til sammenligning 1,09–2,79 m², hvert av dem tilpasset
ÉN kameramatrise. Hver søm hos oss er et sted der to foto er 8–12 px uenige om hvor sporet
går — altså et hakk i linjen. 45 foto → 15 lapper er selve feilen.

**Hvorfor ICM ikke kan rette det.** Regulariseringen prøver bare labelene til de tre
naboflatene. Den flytter grenser; den slår ikke sammen felt. Målt: λ 3 → 12 ga 2,76 → 2,78
m/m². Potts-gulvet så ikke ut til å virke i det hele tatt — og det stemte: `icmpotts` leste
bare string-veien av flagget, mens A/B-selen sender tall. 0,5 → 2 → 6 ga bit-identiske
labels. Alle tall-knotter går nå gjennom `flaggTall` som leser begge. **Ingen ny knott uten
den parsen** — en knott som stille faller tilbake til standard er verre enn ingen knott.

**To rettelser som virker:**

1. **Annekteringsterskelen var i ANTALL FLATER (30), ikke areal.** Den var kalibrert for
   ARKit-nettets grove trekanter; på et TSDF-nett er 30 flater rundt 5 dm², så alt fra en
   håndflate og oppover overlevde som egen fotolapp. Terskelen er nå `meshscan.minregion`
   i m² (0,25). Og annekteringen går nå BARE oppover i størrelse: uten det byttet to små
   regioner etikett med hverandre runde etter runde, og høyere terskel ga FLERE sømmer
   (0,25 m² → 2,10 m/m², men 1,0 → 2,77 og 3,0 → 3,08 i den gamle, ikke-monotone versjonen).

2. **Kandidatbegrensning per plan.** På hvert plan over 1 m² rangeres fotoene etter hvor mye
   av planet de faktisk ser; flater som har valgt noe utenfor topp-4 flyttes til det beste av
   dem — men BARE når det fotoet ser flaten minst 85 % så godt som flatens eget valg
   (`meshscan.planetopn`, `meshscan.planetopq`). Grunnlaget: topp-2 foto dekker 82 % av
   veggplanet, topp-4 dekker 88 %.

Målt på nærbilde av panelveggen (1,3 m, samme kamera), «brudd» = piksler med vertikalsprang
> 6 nivå på en vegg der sporene er loddrette, «sporkontrast» = snitt |dI/dx|:

| variant | søm m/m² | brudd | sporkontrast |
|---|---|---|---|
| før (30 flater, ingen kandidatgrense) | 2,76 | 0,0339 % | 1,198 |
| kun areal-annektering 0,25 m² | 1,54 | 0,0184 % | 1,225 |
| **+ topp-4, gulv 0,85 (valgt)** | **1,58** | **0,0129 %** | **1,178** |
| + topp-4, gulv 0,60 | 1,62 | 0,0061 % | 1,019 |

Gulv 0,60 kjøper de siste bruddene med synlig mykere spor — 15 % tapt sporkontrast er feil
pris, for detalj er hele grunnen til å velge et vinnerfoto. 0,85 valgt. Andre bundle (13,6 m²)
bekrefter: 4,28 → 2,59 m søm per m². Baketid uendret (18,5 s og 12,5 s).

Visuelt: i nærbildet før løper flere spor med hvite «streker» og stopper midt på veggen; etter
går de sammenhengende fra topp til bunn. Bruddene er redusert 2,6×, ikke fjernet.

**Ikke gjort.** 219 regioner står igjen på veggplanet, men de dekker små flater — de store
feltene dekker nå 40–63 % mot 38 % før. Resten er streifvinkler og okklusjonskanter der bare
ett foto ser flaten, og de kan ikke annekteres uten å male dem med et foto som ikke ser dem.
Neste steg dit Scaniverse er, er ekte prosjektive felt per vegg (§56/§57), ikke flere knotter
på lappevalget.

## 66. Referansen målt på samme vegg, og fangstgapet funnet, 2026-09-09

**Referansetall, ikke følelse.** `tools/…`-harnessen finner nå den største veggflaten i en GLB
automatisk (retningsbøtte × offsetbånd) og setter kameraet 1,3 m rett på den, så to modeller
med ulike koordinatsystem kan sammenlignes. Målt på samme panelvegg:

| | sporkontrast (|dI/dx| i % av lysnivå) | brudd (vertikalsprang > 6 nivå) |
|---|---|---|
| Scaniverse | 0,509 % | 0,0305 % |
| Ampex etter §63–65 | **0,755 %** | 0,0392 % |

Vi har altså **48 % mer detalj i sporene** og litt flere brudd. Referansen er MYKERE på nært
hold — deres spor bølger og fader ut flere steder. Slutt å anta at gapet er oppløsning.

Fullromsfixturene (anchor-veien) er fortsatt vesentlig mer oppdelt enn de to delskannene:
stue 6,54 → 4,52 m søm/m² og bad 5,23 → 3,29 med §65-rettelsene. Kandidatbegrensningen kjører
nå også på plan som IKKE ble låst, og på «veggsoner» (retning × offsetbånd) som fanger flater
uten planetikett — målt på stue-fixturen lå 78 587 av 101 438 veggflater utenfor ethvert plan,
og 226 av 267 m veggsøm gikk mellom nettopp dem. Gevinsten der er liten (−3 %): kvalitetsgulvet
blokkerer de fleste flyttene, fordi et foto som ser en 5 m vegg godt på midten scorer dårlig i
kantene. Det er samme grunn til at Scaniverses felt er 1–2,8 m² og ikke hele vegger.

**Fangstgapet, målt.** Av de 2,03 m² uten foto i soveromsbundelen ble **1,92 m² (88,7 %) sett
av dybdekameraet — median 9 dybdebilder per flate — men av NULL lagrede foto.** Kameraet
pekte altså rett på flaten. Fangstloggen i samme bundle: 480 av 1063 beslutninger avvist av
`minimum_interval` (0,2 s), 249 av dvelevaktens 0,5 s-takt. Under en panorering rekker man
ikke ett bilde per bøtte før flaten er forbi.

Dekningsoverlegget gjør det verre: `CoverageField` splatter DYBDE hver andre ramme, så
stripene forsvinner der telefonen har fått dybde — ikke der den har lagret et bilde. Brukeren
får aldri vite at bildet manglet. Derfor må unntaket ligge i fangsten.

`Capture.shouldOverrideInterval` slipper en ramme forbi minsteintervallet når over 25 % av
synsfeltet er ufotografert, aldri raskere enn 0,08 s, aldri på et bilde forbi uskarphetsporten,
og fartsporten står urørt etterpå. Taktet til 10 Hz (dvelevakten går på 2 Hz, men denne gjelder
mens kameraet er i bevegelse). 11 nye påstander i `npm run verify:scan-capture`-skriptet mot
produksjonskoden. **Ikke verifisert på enhet** — det krever et nytt skann. Release-bygg er
installert på Tormods iPhone 9. september kl. 22:23.

Rebake-veien er upåvirket: samme bundle gir fortsatt 1,57 m søm/m² og 3,46 m rand/m².

## 67. Fullromsmåling av produksjonsveien, 2026-09-09

Alt i §63–66 var målt på to delskann (30 og 13,6 m²). `tools/fixture-til-tsdf.py` lager nå
`dense.jsonl` + `dense-*.f32`-lenker fra en fixtures egne keyframe-dybdekart, så TSDF-veien —
den «Bygg om modellen» kjører — kan kjøres på et HELT ROM uten ny skanning. Tre rom bakt:

| | flate | rand per m² | søm per m² vegg | baketid |
|---|---|---|---|---|
| Scaniverse (referanse) | 63,6 m² | **3,70** | — | — |
| stue (166 dybdekart) | 45,4 m² | 4,98 | 2,40 | 50 s |
| bad (121) | 25,1 m² | 4,66 | 4,13 | 33 s |
| gang (103) | 27,3 m² | 5,77 | 2,31 | 28 s |

**På hele rom er vi 25–56 % mer åpne enn referansen**, ikke bedre slik delskannene var. Formen
på resten skiller også: Scaniverse har 185 randløkker der 139 er under 1 m (møbelsilhuetter) og
den største er 23,8 m. Stue har 47 løkker, og 153 av 224 m ligger i TRE løkker (63, 51, 38 m).
Vår rest er altså få STORE åpninger — dørhull, vinduer, uskannede soner — ikke mange små hull.
Hullfyllingen skal ikke lukke dem, og gjør det heller ikke.

**Forbeholdet er viktig:** disse rommene har 103–166 dybdekart. Et ekte skann leverer dybde på
~5 Hz — delskannet på 30 m² hadde 137 kart alene. Fullromstesten kjører altså på rundt en
fjerdedel av dybdedataene et virkelig skann av samme rom ville hatt, og hulltallet er dermed
PESSIMISTISK. Den sier at pipelinen holder på et helt rom, ikke hvor god geometrien blir.

Brudd-målet (piksler med vertikalsprang > 6 nivå) er IKKE sammenlignbart mellom rom: badets
fliser og gangens dørkarmer har ekte horisontale kanter, og målet teller dem som brudd
(1,2–1,6 % mot referansens 0,03 %). Målet gjelder bare panelvegg mot panelvegg — der står
sammenligningen fra §66: 0,0392 % mot referansens 0,0305 %, med 48 % mer sporkontrast.

`fylt=100 %` i disse tre bakene er et artefakt av metoden: dybden ER keyframene, så hver flate
har per konstruksjon et foto. Fangstgapet fra §66 kan derfor ikke måles her — det krever et
ekte skann.

Nye verktøy: `tools/fixture-til-tsdf.py`, `audit-scan-wall-camera.py` (finner største veggflate
og setter kameraet 1,3 m rett på den, så to modeller med ulike koordinatsystem kan sammenlignes),
`audit-scan-wall-seams.py`, `audit-scan-unpainted.py`, `audit-scan-capture-gap.py`.

## 68. To forsøk på å lukke fullromsgapet — volumveien er den eneste som ikke er verre

Fullromstallene i §67 (4,66–5,77 m rand/m² mot referansens 3,70) kommer av at TSDF-en mangler
flate der dybdestrømmen var tynn. ARKit-nettet fra SAMME økt dekker de områdene. To måter
prøvd, begge målt:

**Forkastet: sy sammen to ferdige flater** (`meshscan.tsdftillegg=on`). ARKit-triangler tas inn
der ingen TSDF-verteks er innen 8 cm (romhash), med volumvakt mot geometri utenfor dybdevolumet.
Legger til mye flate — stue +84 m², gang +76 m² — men randen blir VERRE, ikke bedre:

| | TSDF alene | ARKit alene | Unionen |
|---|---|---|---|
| stue | 4,98 m/m² | 5,17 | **6,64** |
| gang | 5,77 | — | **6,91** |

Årsaken er prinsipiell og verdt å huske: de to flatene møtes uten å henge sammen, så hver skjøt
mellom dem teller DOBBEL rand. En union av to åpne flater er mer åpen enn begge.

**Beholdt som flagg, ikke standard: skrive ARKit-nettet inn i VOLUMET**
(`meshscan.tsdftillegg=volum`). Der fusjonen ikke har målinger i det hele tatt (vekt 0) skrives
triangelet inn som avstandsfelt — fortegn fra retningen mot volumets sentrum, aldri i en voxel
som alt har vekt. Surface Nets trekker da ÉN sammenhengende flate ut av begge kildene.

| | flate før → etter | rand per m² før → etter |
|---|---|---|
| stue (166 dybdekart) | 45,4 → **81,3 m²** | 4,98 → **4,89** |
| gang (103) | 27,3 → 36,6 m² | 5,77 → 6,25 |
| soverom (137 ekte dense) | 30,4 → 31,1 m² | 3,46 → 3,76 |
| vegghjørne (121 ekte dense) | 13,6 → 13,7 m² | 3,34 → 3,41 |

Mønsteret er entydig: jo TYNNERE dybdedata, jo mer hjelper det. På de to bundlene med EKTE
dense-strøm — altså det som ligner et virkelig skann — er det en liten forverring for nesten
ingen ny flate. Derfor er standarden AV. Skru den på når et skann er tynt (stort rom, kald
telefon, rask gjennomgang); da er den målt bedre på begge tellinger.

Standardveien er uendret etter alle forsøkene: 3,46 m rand/m², 1,57 m søm/m² vegg, fangst-
selvtestene grønne.

## 69. Vektterskelen var kalibrert for tette skann — fullromsgapet var den, 2026-09-09

`minWeight` (minste akkumulerte vekt før en voxel regnes som ekte flate) sto på 4. Den ble
hevet fra 3 mot dobbeltflater i tette skann. På et helt rom med tynnere dybdestrøm SPISER den
flate — ingen voxel rekker terskelen, og hullene den lager er hele fullromsgapet i §67:

| bundle | minw 4 | minw 2,5 | minw 1,5 |
|---|---|---|---|
| stue (0,41 kart/m³) | 45,4 m² / 4,98 m rand per m² | 68,0 / 3,87 | **88,0 / 3,71** |
| soverom (2,2 kart/m³) | 30,4 / 3,46 | **31,8 / 3,38** | 33,6 / 3,38 |

Referansen ligger på 3,70. Standarden er nå 2,5, og under 1,0 dybdekart per m³ senkes den til
1,5 (tetthetsregelen i `build`; `meshscan.tsdfminw` overstyrer alt). Prisen er målt: veggens
RMS-avvik fra planet går 2,4 → 2,8 mm på tette skann og 5,2–5,6 mm på de tynne rommene —
Scaniverse-eksporten selv ligger på **30,1 mm**. Areal i biter under 0,05 m² går NED på det
tette skannet (0,39 → 0,27 %) og opp på de tynne (0,52–1,18 %).

Samtidig er kvalitetsgulvet i kandidatbegrensningen senket 0,85 → 0,55. Vi hadde detaljmargin
å bruke: gulv 0,85 ga 0,0395 % brudd og 0,751 % sporkontrast, gulv 0,55 gir **0,0084 % og
0,655 %** — altså 4,7× færre brudd for 13 % kontrast, og under referansen på BEGGE.

### Stillingen mot referansen, alle mål, samme kamera

| | rand/m² | sporkontrast | brudd | vegg-RMS |
|---|---|---|---|---|
| **Scaniverse** | 3,70 | 0,509 % | 0,0305 % | 30,1 mm |
| soverom (137 ekte dense) | **3,38** | **0,655 %** | **0,0084 %** | **2,8 mm** |
| vegghjørne (121 ekte dense) | **3,17** | **1,118 %** | **0,0279 %** | **1,8 mm** |
| stue (166, tynn) | **3,72** | 0,939 % | 3,01 %* | 5,2 mm |
| gang (103, tynn) | **3,73** | 1,206 % | 2,80 %* | 5,6 mm |
| bad (121, tynn) | 4,42 | 1,283 % | 1,69 %* | 3,1 mm |

\* Brudd-målet er bare gyldig mellom panelvegger. Badets fliser, gangens dørkarmer og stuens
møbler har ekte horisontale kanter som målet teller som brudd. Kolonnen står her for
fullstendighet, ikke som sammenligning.

På de to bundlene med EKTE dybdestrøm slår vi referansen på alle fire målene. To av tre tynne
fullrom er nå også på referansenivå i lukkethet. Badet står igjen (4,42) — speil og glass gir
LiDAR-en lite å jobbe med, og der er 5,4 % av veggbildet fortsatt hvitt.

Det som fortsatt ikke er målt: et helt rom med EKTE dybdetetthet. Alle fullromstallene over er
fra fixturer med 0,4–0,6 kart/m³ mot et virkelig skanns 2+. Og fangstfiksen fra §66 er ikke
verifisert på enhet.

## 70. EKTE fullromsskann fra telefonen målt mot referansen, 2026-09-09 kveld

Telefonen hadde et skann fra samme kveld kl. 21:14 som ingen hadde hentet:
**113 foto, 321 dybdekart, 75 sekunder, 6,6 × 5,0 × 8,9 m volum** — altså ekte
opptakstetthet (1,5 kart/m³ mot fixturenes 0,4–0,6), ikke en syntetisk fullromstest.
Hentet med `devicectl copy from` til `/private/tmp/ampex-telefonskann`. Bakt på 40 s.

| mål | Scaniverse | telefonskannet |
|---|---|---|
| åpen rand per m² | 3,70 | **3,26** |
| veggens RMS-avvik fra planet | 30,1 mm | **3,2 mm** |
| flater uten foto (hvitt i render) | 0,00 % | **0,00 %** |
| sporkontrast (median, 3 vegger) | 0,507 % | **0,522 %** |
| brudd i spor (median, 3 vegger) | 0,0264 % | 0,0447 % |

Fire av fem mål er på eller bedre enn referansen på et ekte, komplett rom. Bruddmålet er
1,4–1,7× dårligere og er det eneste som står igjen.

**Fangstloggen bekrefter §66 på et ferskt skann:** 1198 av 2488 beslutninger avvist av
`minimum_interval`, 427 av dvelevaktens takt. Skannet ble tatt FØR fangstfiksen ble installert.

**Knotter prøvd mot bruddmålet på dette skannet, alle målt:**

| variant | sporkontrast | brudd |
|---|---|---|
| standard (gulv 0,55) | 0,530 % | 0,061 % (snitt av tre) |
| **kvalitetsgulv 0,40 (valgt)** | 0,522 % | **0,043 %** |
| søm-fjæring 12 mm (fra 40) | 0,522 % | 0,037 % |
| søm-fjæring av | 0,515 % | 0,044 % |
| minregion 1,0 / 2,5 m² | 0,545 / 0,538 % | 0,045 / 0,045 % |
| prosjektivt atlas (§57) | 0,429 % | **0,033 %** |

Gulvet er satt til 0,40. Det prosjektive atlaset kommer nærmest referansen på brudd — som
ventet, for et felt som er én kameraprojeksjon har ingen indre søm — men det pakker 4339
charts i atlaset og må skalere kildepikslene til 0,44×, så sporkontrasten faller UNDER
referansen. Scaniverse har tolv felt, ikke 4339. Veien dit er færre og større felt, ikke
et annet atlasoppsett; se §65 for hvorfor kvalitetsvakten begrenser hvor store de kan bli.

**Baken var ikke deterministisk.** To identiske kjøringer ga 0,0240 % og 0,0428 % brudd.
Årsaken var Swift-Dictionary-iterasjon i småregion-annekteringen (randomisert per prosess);
begge løkkene går nå i sortert rekkefølge. Rest-spredningen er ±3 % og kommer fra GPU-ens
flyttalls-akkumulering. Kvalitet som spriker mellom to like bakes er ikke bare umulig å måle
— den er en feil i seg selv.

## 71. Baken ga ulikt resultat hver gang — og linjeretning på sømmene hjalp ikke, 2026-09-10

Da bruddmålet skulle presses under referansen, spriket det 0,0382 / 0,0566 / **0,1822** % over
tre IDENTISKE kjøringer av samme skann med samme flagg. Fem gangers spredning. Det gjorde all
A/B i §69–70 upålitelig, og verre: en modell som blir ulik hver gang du trykker «Bygg om
modellen» er en feil i seg selv.

**Årsak: Swift randomiserer Dictionary-iterasjon per prosess.** To steder i vinnervalget gikk
over dictionaries: småregion-annekteringens `bestTarget`/`mergeVotes`, og — den dyre —
naboskapsbyggingen over `edgeFaces`. Naboplassene ble tildelt i ulik rekkefølge hver kjøring,
og siden regulariseringen er Gauss-Seidel (den leser naboenes ferske etiketter) endte to like
bakes i ulike lokale minima. Alle tre løkkene går nå i deterministisk rekkefølge: annekteringen
sortert, naboskapet over trianglene i indeksrekkefølge og kantene i triangelets egen orden.

Etter fiksen: geometrien er stabil innen 0,4 % (195,4 / 195,7 / 196,2 m rand), og bruddmålet
spriker 0,0368–0,0595 % — 1,6× i stedet for 5×. Resten kommer fra GPU-ens flyttalls-
akkumulering i fusjonen og lar seg ikke fjerne uten å gi opp parallelliteten.

**Forkastet: retningsvekt på sømmene.** Ideen var at det ikke er ANTALL sømmer som brekker
panelspor, men retningen: en søm langs sporet flytter ingen linje, en på tvers gir et hakk i
hver linje den krysser. Termen gjør sømmer på tvers dyrere i ICM-energien (kantretning mot
loddrett, projisert i flatens plan). Målt med tre kjøringer per innstilling: vekt 2,5 ga median
**0,0453 %** brudd, av ga **0,0455 %**. Ingen forskjell. Trianglene i et TSDF-nett er små og
retningsløse, så den lokale kantretningen sier lite om sømmen krysser et spor på den skalaen
et brudd synes — og ICM flytter uansett bare grenser noen centimeter. Står igjen bak
`meshscan.linjevekt` (standard 0) for et senere forsøk med grovere sømgeometri.

Stillingen på bruddmålet er dermed uendret: median 0,045 % mot referansens 0,0305 %, altså
1,5× dårligere, med ±25 % spredning mellom kjøringer. Den eneste veien som har vist seg å
lukke det er prosjektive felt (§70: 0,033 %), og der er prisen i dag at 4339 charts må
skalere kildepikslene til 0,44×. Færre og større felt er kravet — ikke et annet atlasoppsett.

## 72. Prosjektive felt: hele avveiningen målt, ingen konfigurasjon slår referansen på begge, 2026-09-10

Bruddmålet var det siste vi lå under på. Prosjektive felt er den eneste veien som har vist seg
å lukke det (§70), så hele feltinndelingen er nå prøvd ut på det ekte fullromsskannet. Alle tall
fra samme veggkamera, sammenlignet mot Scaniverse-eksportens 0,509 % sporkontrast / 0,0305 % brudd:

| variant | charts | kildeskala | sporkontrast | brudd |
|---|---|---|---|---|
| **xatlas (standard i dag)** | — | — | **0,522 %** | 0,0368 % |
| prosjektiv per region | 1443 | 0,43 | 0,412 % | **0,0272 %** |
| prosjektiv per region, tone av | 1443 | 0,43 | 0,436 % | 0,0300 % |
| prosjektiv per FOTO | 388 | 0,33 | — | — |
| prosjektiv per foto × rute 640 px | 1460 | 0,43 | 0,429 % | 0,0930 % |
| prosjektiv kun vegg/tak | 5442 | 0,43 | 0,444 % | 0,0380 % |

**Ingen konfigurasjon slår referansen på begge målene.** Vår standard har best sporkontrast og
1,2× referansens brudd; den prosjektive treffer referansens bruddnivå og taper 17 % kontrast.
Referansen ligger altså litt OVER vår frontkurve — den har vår skarphet og deres sømnivå.

Tre feilslåtte hypoteser, alle målt:
- **«4339 charts er padding-sløsing»** — delvis sant, men å slå sammen felt per FOTO gjorde det
  verre (0,33 mot 0,43 kildeskala): flatene ett foto vinner ligger som øyer over hele bildet, og
  rammeboksen fylles av tomrom. Rutedeling i bildeplanet (640 px) tok igjen regionveien, ikke mer.
- **«Bruk plassen bare på flate flater»** — de resterende flatene faller da tilbake til
  xatlas-charts per sammenhengende komponent, og chart-tallet steg til 5442. Ingen gevinst.
- **«Større atlas løser det»** — 16384² henger rasterizeren (fire teksturer à 1 GB). Den
  produserbare varianten er fire fliser à 4096–6144, og den krever eksport med flere materialer.
  Det er neste konkrete steg hvis noen skal ta dette videre.

Regnestykket bak: rommet har ~1900 kildepiksler per meter vegg. Ett 8192-atlas over 60 m² flate
rommer ~1055 texel/m, altså må kildepikslene skaleres uansett pakkemetode — kildeskala 0,43 er
nær taket for ett atlas. Til sammenligning har Scaniverse-eksporten 462 texel/m og leverer 0,509 %
kontrast, mens vår prosjektive vei har 817 texel/m og leverer 0,436 %. **Deres fortrinn er ikke
teksler — det er at kildebildene deres bærer mer skarphet per piksel på veggen.** Der er
opptaket, ikke atlaset, den neste variabelen.

Tonelaget koster målbart i den prosjektive veien: 0,412 → 0,436 % kontrast med `planeavg=off`.
I standardveien betaler det seg fortsatt (det er kuren mot flekkvis farge), så ingen endring der.

Standarden er uendret etter alt dette: telefonskannet 3,25 m rand/m², soveromsbundelen 3,38,
og de tre selvtestene grønne. Den prosjektive veien er fortsatt kun diagnostikk bak `debugSink`.

## 73. Eksponeringstak: kildebildene var uskarpe før baken fikk dem, 2026-09-10

§72 endte med at referansen leverer sin skarphet på 462 texel/m mens vår prosjektive vei har
817 og leverer mindre — altså at fortrinnet ligger i kildebildene, ikke i atlaset. Nå er det
målt direkte, på det ekte fullromsskannet (113 foto):

| | median | p10 | p90 | maks |
|---|---|---|---|---|
| predikert bevegelsesuskarphet | **14,8 px** | 6,7 | 25,8 | 51,6 |
| kamerafart | 0,42 m/s | 0,22 | 0,66 | 1,11 |

**Halvparten av bildene har over 15 px smøring i et 3840-bilde.** På en vegg som fyller bildet
er det rundt 8 mm — et panelspor er 2 mm bredt. Uskarphetsporten står på 60 px og slipper
alt dette gjennom; den er laget for katastrofer, ikke for kvalitet.

Årsaken er AE/AWB-låsen (scan #5): den fryser det auto-eksponeringen tilfeldigvis hadde landet
på, og innendørs er det gjerne 1/30 s. Ved 0,42 m/s er 15 px smøring da ren fysikk.

**Rettelse:** låsen setter nå `setExposureModeCustom` med et TAK på lukkertiden (8 ms ≈ 1/125 s,
`meshscan.eksponeringstak`), og betaler med ISO. Lysmengden holdes: tiden kortes nøyaktig så
langt ISO-en har takhøyde og ikke lenger, så bildet blir like lyst. Er rommet for mørkt til
hele veien, tas det som er mulig. Faller `.custom` bort på enheten, brukes den gamle låsen.

Avveiningen er bevisst: **støy er høyfrekvent og midles bort** av topp-K-snittet og tonelaget
i baken, mens smøring er borte for alltid. Ved 1/30 → 1/125 firedobles ISO og smøringen faller
fra ~15 til ~4 px.

12 nye påstander i `verify-scan-capture` mot produksjonskoden (ISO-takhøyde, kameraets korteste
lukkertid, ikke-fysiske verdier). Release-bygg installert på Tormods iPhone 10. september.

**Ikke verifisert på enhet.** Neste skann kan måles direkte: `fixture-kf.json` lagrer `blurPx`
per bilde, så `median blurPx` før og etter er hele testen. Målet er under 5 px.

### Etterprøving på eksisterende skann — og en korreksjon av påstanden over

Ti bundles ble rangert på uskarphet. Ett skann er tatt i 0,08 m/s med median 5,8 px, altså nær
det taket sikter mot. Men tallene på tvers av skann kan IKKE sammenlignes: det er ulike rom med
ulike vegger, og sporkontrasten følger veggens innhold mer enn kildebildene (skarpeste skann
ga 0,345 %, det nest uskarpeste 0,655 %).

Kontrollert forsøk i stedet, samme skann og samme vegg: de 113 bildene ble delt i skarpeste og
uskarpeste halvdel (median 9,7 mot 20,7 px) og bakt hver for seg på identisk geometri.

| | kontrast | brudd |
|---|---|---|
| skarp halvdel (9,7 px) | 0,514 % | 0,0521 % |
| uskarp halvdel (20,7 px) | 0,525 % | 0,0508 % |

**Ingen forskjell.** Å FJERNE uskarpe bilder hjelper altså ikke — vinnervalget vekter alt
skarphet, så baken plukker uansett det beste bildet per flate.

Direkte måling av bildene (gradientenergi i midtutsnittet, normalisert for lysnivå, n=113):
predikert `blurPx` korrelerer bare **−0,21** med målt skarphet, kamerafart **−0,13**, mens
det lagrede `sharpness`-feltet korrelerer **+0,74**. Gruppevis er forskjellen likevel reell:
bilder med blurPx ≤ 10 har 0,0188 i målt detalj mot 0,0126 for blurPx ≥ 20 — **33 % mer**.

Dette flytter forventningen til eksponeringstaket, men avliver den ikke: gevinsten ligger ikke
i å heve MEDIANEN (det utnytter vinnervalget allerede), men i å heve TAKET — de beste bildene
per flate blir skarpere enn de beste er i dag. Det kan ikke simuleres offline, for ingen
eksisterende bundle er tatt opp med kortere lukkertid. Forventet gevinst er dermed mindre enn
«33 % mer detalj» og større enn null; hvor mye avgjøres av neste skann.

## 74. Fire teksturfliser: skarpheten kom tilbake, og AVSLØRTE sømmene, 2026-09-10

§72 endte med at prosjektive felt treffer referansens sømnivå men taper skarphet, fordi ett
8192-atlas tvinger kildeskala 0,43. Hypotesen var at mer atlasareal gir begge deler. Nå er den
bygget og målt: `projectiveFixtureUV` pakker felt helt innenfor hver flis, hver flis
rasteriseres for seg, og `ARMeshGlbExporter.writeTiledGlb` skriver én primitiv med eget
materiale per flis. Fire fliser à 8192 → **kildeskala 0,823**, alle 249 088 trekanter plassert,
50 MB GLB, 92 s bake. Skrives som egen diagnosefil; produksjonseksporten er urørt.

| | kildeskala | sporkontrast | brudd |
|---|---|---|---|
| Scaniverse | — | 0,509 % | 0,0305 % |
| xatlas (dagens standard) | — | 0,522 % | 0,0368 % |
| prosjektiv, ett atlas | 0,43 | 0,436 % | **0,0300 %** |
| prosjektiv, hele atlaset til feltene | 0,486 | 0,488 % | 0,0329 % |
| **prosjektiv, fire fliser** | **0,823** | **0,523 %** | 0,0534 % |

Skarpheten kom tilbake nøyaktig som forutsagt — 0,436 → 0,488 → 0,523 % følger kildeskalaen
0,43 → 0,486 → 0,823. **Men bruddene ble VERRE, ikke bedre: 0,0300 → 0,0534 %.**

Det er selve svaret. Ved 0,43× var alt så mykt at feilregistreringen mellom nabofelt ikke synes;
ved 0,82× er feltene skarpe, og de 8–12 pikslene de er uenige om hvor panelsporet går blir
harde hakk. **Uskarpheten skjulte sømmene.** Vi kan altså treffe referansens skarphet (0,523 mot
0,509 %) ELLER referansens sømnivå (0,0300 mot 0,0305 %), men ikke begge samtidig — mens
Scaniverse har begge.

Da er den gjenstående forskjellen ikke atlas, ikke feltinndeling og ikke sømlogikk, men
**registrering**: deres bilder legger seg riktigere på veggen enn våre. Det følger av
posekvalitet, som følger av opptaket (rolig bevegelse, kort lukkertid, skarpe bilder gir
skarpere poseoptimalisering) — eller av en global bunter-justering vi ikke har.

Dermed peker de to siste rundene samme vei: §73s eksponeringstak og et bedre opptak er ikke
bare et skarphets-tiltak, det er forutsetningen for at sømmene skal kunne bli usynlige.
Flis-eksporten står igjen bak `meshscan.projektivfliser 2` som diagnostikk. Den bør ikke
produktsettes før registreringen er bedre: den koster fire teksturer (50 MB), krever at
`AmpexMeshViewerView` leser flere materialer (den leser i dag bare det første), og gir i dag
et DÅRLIGERE samlet resultat enn standardveien.

## 75. Det femte punktet er tatt: foto-felt i fire fliser, 2026-09-10

Brudd i panelsporene var det eneste målet vi lå under referansen på. §74 endte i en klemme:
prosjektive felt traff sømnivået men tapte skarphet, og fire fliser ga skarpheten tilbake men
AVSLØRTE sømmene (0,0534 %). Løsningen var å endre hva et FELT er samtidig som oppløsningen økte.

**Hva som ble prøvd og forkastet underveis, alt målt på det ekte fullromsskannet:**
- *Plan-lås* (én foto per veggplan): brudd 0,1639 % — 4,5× verre. Delingene blir harde linjer.
- *Linseforvrengning som årsak*: uenigheten mellom bildepar er 5,0 px median, men korrelerer
  ikke med radius (+0,18; 5,00 px ved liten radiusforskjell mot 5,10 ved stor). Ikke linsen.
- *Felles bildejustering*: 1595 parmålinger, løst for forskyvning og for affint felt per bilde.
  Median uenighet 3,00 → 3,08 (forskyvning) → 3,16 px (affint). Ingen glatt per-bilde-modell
  forklarer den. Med bare 449 målinger så affint ut til å hjelpe (3,00 → 2,33) — det var
  overtilpasning, og en påminnelse om at denne typen felt må måles på mange nok par.
- Årsaken er heller ikke posestøy alene: 3 px er nøyaktig hva 3 mm relieff gir ved 30° baselinje,
  og panelsporene ER 2 mm nedfelt. Et nedfelt spor projiseres ulikt fra ulike vinkler, og da kan
  ingen bildejustering forene to syn på en FLAT tekstur.

**Det som virket:** felt = (foto × grov rute i bildeplanet), pakket i fire fliser à 8192.
Innenfor ett felt er teksturen én kameraprojeksjon, så relieffet gjengis konsistent — og fire
fliser gir plass til kildepikslene (kildeskala 0,88 mot 0,43 i ett atlas). Tonelag og
søm-fjæring er AV: begge blander innhold fra flere foto og river ned nettopp dette.

| | kontrast | brudd |
|---|---|---|
| **Scaniverse** | **0,507 %** | **0,0264 %** |
| standard (xatlas) | 0,522 % | 0,0368 % |
| region-felt + 4 fliser | 0,523 % | 0,0534 % |
| **kvalitetsmodell (foto-felt + 4 fliser)** | **0,506 %** | **0,0278 %** |

Fem bakes × tre vegger: brudd 0,0120–0,0340 %, median 0,0278 mot referansens 0,0264 — likt
innenfor kjøring-til-kjøring-spredningen, og godt under standardveiens 0,0368. Sporkontrasten
er identisk med referansen. **Det femte punktet er dermed på nivå.**

Prisen er ærlig: 57 MB mot 21, fire teksturer, og 90 s bake mot 40. Derfor er den standard KUN
for «Bygg om modellen» (`ARMeshGlbExporter.isRebake`) — live-skannet er urørt.
`meshscan.kvalitet = "standard"` slår den av, `= "fliser"` tvinger den på.

`AmpexMeshViewerView` leste før bare accessor 0-3 og det FØRSTE bildet; den leser nå én primitiv
per flis med riktig materiale-til-bilde-oppslag, og enkeltatlas-modeller nøyaktig som før.
Tonevariasjonen på veggen er 12,2 % mot referansens 11,1 % og standardveiens 10,6 % — flisene
er altså ikke flekkete, men de er heller ikke jevnere enn før.

## 76. «Veggene er utvasket» — kilden har ikke oppløsning nok, 2026-09-10

Tormod så på det nye skannet og sa rett ut at veggene ikke er på nivå. Han hadde rett, og
målene i §75 fanget det ikke. Her er hva som faktisk er galt, målt på hans skann:

**1. Modellen han så var LIVE-modellen.** Live-baken kjører med 6144-atlas fordi AR-økten
spiser minne: **622 texel per meter vegg**. Rebake gir 887, kvalitetsmodellen 1220.

**2. Kildebildene har ikke oppløsning nok.** Vinnerfotoet gir **median 1013 piksler per meter**
på veggen, og **52 % av veggarealet** males fra bilder under 1000 px/m. Et 2 mm panelspor
trenger minst 1000 px/m for å nå Nyquist. Under det FINNES ikke sporet i kilden, og hverken
atlas, felt eller sømlogikk kan hente det tilbake.

Taket er lavt: beste TILGJENGELIGE foto gir median 1163 px/m, og på 32 % av veggen finnes
det ikke noe foto over 1000. Med fx ≈ 2750 px kreves: 2,75 m for 1000 px/m, 1,83 m for 1500,
1,38 m for 2000 — og skrå vinkel skalerer det ned med cosinus.

**3. Baken velger litt dårligere enn den kunne.** På 21 % av veggarealet var det et foto
tilgjengelig som var over 25 % bedre. Scoren var `cosθ/z²`, men oppløsning på flaten er
`cos²θ/z²` — én potens av vinkelen manglet. Rettet (`meshscan.opplosning=off` gir gammelt).
Effekten er liten (1023 → 1029 px/m median): taket er kilden, ikke valget.

**Målt og forkastet i samme runde:**
- *Mipmaps på kildebildet* (mot aliasing ved 1,5–2× nedskalering): median sporkontrast
  3,14 → 3,23 %, men svakeste femtedel 2,33 → 1,89 % og struktur-dekning tett på 27 → 15 %.
  Ekte arealfiltrering koster mer detalj enn den redder. Av som standard (`meshscan.kildemip=on`).
- *At konsolideringen stjeler oppløsning*: fritt vinnervalg (minregion 0,02, ingen
  kandidatgrense, λ 0,5) ga 1030 px/m mot 1027 bundet. Ingen forskjell.
- *At tone/fjæring/JPEG/mipmaps i rendringen taper detaljen*: rå-farge-ablasjonen gir 2,05 %
  mot standardens 2,02 %. Ikke der.

**Rettelsen som hever taket:** dekningsoverlegget krevde bare SIKT. Vekten var
`cos²θ · klemt(1,5/z)` med gulv 0,25 — et bilde tatt 5 m unna og skrått ga fortsatt en firedel,
og tolv slike gjorde flaten «ferdig». Nå teller et bilde i den grad det faktisk oppløser flaten:
null-effekt under 700 px/m (3,9 m), fullt fra 1600 (1,7 m), med gulv 0,15 så fjerne syn ikke
blir en blindvei. Samme felt driver `doneCells`, som driver dekningstvangen i fangsten — så
telefonen fortsetter å ta bilder til flaten er sett NÆRT NOK. `meshscan.dekningmin/dekningmaal`.

**Konsekvens brukeren vil merke:** prosenten blir lavere for samme skann, og stripene blir
stående til man går nærmere. Det er meningen — de sto tidligere og løy.

**Og en metodisk innrømmelse:** alle sammenligningene mot Scaniverse har vært VÅRT rom mot
DERES rom, med ulik vegg, ulikt lys og ulik avstand. Det eneste rene svaret er å skanne samme
rom med begge appene. Uten det kan jeg si at kilden vår er for grov på halve veggen — ikke at
vi er bedre eller dårligere enn dem der.

## 77. Kan flere bilder erstatte kortere avstand? Nesten ikke, 2026-09-10

Tormods innvending mot §76 var riktig og treffende: han trenger ikke gå nærmere med Scaniverse.
Hvis de får skarpe vegger fra normal avstand, henter de mer ut av SAMME slags bilder enn oss.
Den nærliggende forklaringen er at de fusjonerer flere syn (multiframe super-oppløsning) mens vi
tar detaljen fra ÉTT vinnerfoto. Testet på en 60 × 45 cm veggrute fra hans skann, rektifisert til
veggplanet på et 2400 px/m-rutenett (over kildens ~1300):

| | sporkontrast |
|---|---|
| beste enkeltbilde (1378 px/m) | **1,89 %** |
| 6 syn midlet | 0,60 % |
| 6 syn, blokkvis sub-piksel-justert og midlet | 0,60 % |
| 6 syn, iterativ tilbakeprojeksjon | 1,21 % |
| **2 syn med baselinje under 25 cm, tilbakeprojeksjon** | **1,99 %** |

**Å midle taper**: et skarpt bilde midlet med fem mykere gir mykt, uansett hvor godt de er
justert. Tilbakeprojeksjon (den ekte SR-formuleringen) berger mye av det, men slår ikke det
beste enkeltbildet — FØR baselinjen strammes. Med bare syn tatt innen 25 cm av hverandre gir
den +5 %.

Det er selve mekanismen: panelsporet er 2 mm NEDFELT, så to syn med stor baselinje ser
sporkanten på ulikt sted i planet. Den parallaksen er ekte geometri, ikke registreringsstøy, og
kan ikke justeres bort med en flat modell. Derfor virker fusjon bare mellom nærliggende syn —
og gevinsten der er 5 %, ikke 50 %.

**Konklusjon:** ingen bake-side triks henter inn oppløsningen som mangler i kilden. Taket i
§76 står: median 1013 px/m på veggen, beste tilgjengelige 1163, mens et 2 mm spor trenger
1000 bare for å nå Nyquist. Fusjon flytter ikke det taket.

Da gjenstår to muligheter, og jeg kan ikke skille dem uten nye data: enten står Scaniverse
nærmere/med bedre lys enn Tormod husker, eller de gjør noe i registreringen vi ikke har klart —
sub-piksel-nøyaktig, ikke-rigid, og god nok til at fusjon over større baselinje lønner seg.
**Det avgjøres bare av ett skann av SAMME rom med begge appene.**

## 78. Samme rom, endelig: vi er 2,5× skarpere enn referansen der, 2026-09-10

Tormod opplyste at Scaniverse-eksporten er av SAMME rom som soveromsbundelen
(1788963302851). Da faller hele forbeholdet fra §76–§77 bort, og sammenligningen kan
gjøres direkte: samme rom, samme type panelvegg, samme virtuelle kamera (1,3 m, 45°).

| | struktur-dekning | svakeste 20 % | median sporkontrast |
|---|---|---|---|
| Scaniverse | 91 % | 1,55 % | 2,52 % |
| **vårt soveromsskann** | **100 %** | **2,80 %** | **6,42 %** |
| det utvaskede nye skannet | 99 % | 1,30 % | 1,98 % |

**På det rommet er vi 2,5 ganger skarpere enn referansen.** Og forskjellen mellom våre to
egne skann er ren opptaksavstand:

| | median kildeoppløsning | veggareal under 1000 px/m |
|---|---|---|
| soveromsskannet | 1211 px/m | 23 % |
| det nye skannet | 1022 px/m | 51 % |

Det nye rommet er større (6,6 × 5,0 × 8,9 m mot 5,3 × 2,8 × 5,6), og halve veggflaten ble
fotografert under Nyquist for et 2 mm panelspor. Pipelinen er den samme; kilden er ikke.

Det som fortsatt er DÅRLIGERE hos oss på samme vegg: lavfrekvent tonevariasjon, 14,1 % mot
referansens 6,0 %. Veggen vår er skarpere, men mer ujevnt belyst — flekkvis lysere og mørkere.
Det er sannsynligvis det øyet leser som «rotete» selv når sporene er der, og det er neste
konkrete mål å angripe. Tonelaget (plan-snitt HYBRID) er kuren som finnes i dag; den var AV i
kvalitetsmodellen (§75), noe som kan forklare en del.

Rettelsen fra §76 — dekningsoverlegget som krever oppløsning, ikke bare sikt — er dermed riktig
medisin for nøyaktig det som gikk galt i det nye skannet, og den er installert.

## 79. Toneflekkene er EKTE lys — avskygging mot planets median, 2026-09-10

§78 endte med at vi er 2,5× skarpere enn referansen på samme vegg, men har 14,1 % lavfrekvent
tonevariasjon mot deres 6,0 %. Først måtte årsaken finnes:

- **Ikke eksponeringslapper mellom foto.** `planeavg` off/hybrid/flat gir BIT-IDENTISKE render
  på den veggen (maks 1 gråtone forskjell). Tonelaget har alt gjort jobben sin.
- **Det er ekte lys i rommet.** Kildefotoet rektifisert til samme vegg har **21,9 %** variasjon,
  vår modell 14,1 %, referansen 6,0 %. Vi gjengir rommets lys trofast; Scaniverse normaliserer
  det bort. Det er et VALG, ikke en feil — men det er valget som gjør at veggen deres leses som
  ren og vår som rotete, selv når sporene våre er skarpere.

**Avskygging:** hjørnenes flerbilde-snittede lys midles i 25 cm-ruter per plan, glattes over
tre ruter (~75 cm), og hvert hjørne skyves multiplikativt mot planets median. Under 25 cm røres
ingenting — spor, lister og skygger fra små ting står igjen. Styrken er adaptiv per plan
(trimmet 10–90 % spredning på de glattede rutene) med et tak.

Taket er 0,4, og det er ikke tilfeldig valgt — det er den eneste verdien som forbedret BEGGE
testskannene på BEGGE mål:

| | tonevariasjon | median sporkontrast |
|---|---|---|
| Scaniverse | 5,95 % | 2,52 % |
| soverom uten | 14,06 % | 6,42 % |
| **soverom, tak 0,4** | **11,56 %** | **6,69 %** |
| soverom, tak 0,6 | 10,24 % | 7,30 % |
| soverom, tak 0,85 | 8,92 % | 9,24 % |
| nytt skann uten | 4,51 % | 3,43 % |
| **nytt skann, tak 0,4** | **4,44 %** | **3,97 %** |
| nytt skann, tak 0,6 | 4,44 % | 3,45 % |

Merk at utflating også LØFTER sporkontrasten: grovene i de mørke feltene kommer opp av skyggen.
Over 0,4 fortsetter soverommet å bli bedre, men det nye skannets kontrast faller tilbake — en
vegg som alt er jevn har ingenting å hente, og utflatingen legger bare til støy. Derfor 0,4 som
standard og `meshscan.avskygging` for den som vil lenger (0,85 tar soverommet til 8,9 %).

Vi er dermed fortsatt over referansens 6,0 % på et rom med sterk skygge. Å komme helt ned krever
enten sterkere utflating (som koster på jevne vegger) eller at spredningen måles på REN vegg —
i dag forstyrres den av møbler foran planet, så «adaptiv» styrke treffer taket på 31–45 %
uansett. Det er neste forbedring hvis dette skal presses videre.

### Skala og styrke er målt, ikke antatt (tillegg til §79)

Fire glattingsskalaer og fire styrketak er kjørt mot begge testskann:

| skala (glatting) | soverom tone / kontrast | nytt skann tone / kontrast |
|---|---|---|
| 0,75 m (**valgt**) | **11,56 % / 6,69 %** | **4,44 % / 3,97 %** |
| 1,25 m | 11,92 / 7,68 | 5,44 / 2,74 |
| 2,25 m | 14,25 / 6,92 | 4,80 / 3,67 |
| 3,25 m | 14,33 / 6,44 | 4,32 / 2,13 |
| 4,75 m | 14,09 / 6,37 | 4,37 / 3,31 |

Bredere glatting nærmer seg planets median, og korreksjonen blir null (4,75 m: 14,06 → 14,09 %).
Smalere begynner å spise lokal skygge og koster kontrast på det jevne skannet.

Robust spredningsmål (kvartilbredde i stedet for 10–90 %) endret ingenting: veggplanene har
28–94 % spredning uansett, fordi et rom med vindu i den ene enden HAR 2:1 lysfall. Den adaptive
styrken treffer derfor taket, og taket er det som styrer. 0,4 er målt som den eneste verdien
som forbedrer begge skann på begge mål.

**Stillingen på dette målet:** 11,56 % mot referansens 5,95 %. Å komme dit krever styrke ~0,9,
som tar soverommet til 8,3 % men koster det andre skannet 3,43 → 2,20 % sporkontrast. Det er
ikke en feil å rette, det er et VALG: referansen fjerner rommets lys, vi beholder det.
`meshscan.avskygging 0.85` gir Scaniverse-utseendet for den som vil ha det.

## 80. «For langt unna» var FEIL — det var lyset i rommet, 2026-09-11

Tormod avviste forklaringen fra §76 om at det utvaskede skannet ble tatt for langt unna.
Han hadde rett, og her er tallene som viser det:

| | avstand til vinnerfoto | vinkel | px/m |
|---|---|---|---|
| nytt skann (utvasket) | 2,07 m | 35° | 1029 |
| soverom (skarpt) | 1,87 m | 32° | 1221 |

20 cm og 3 grader. Det forklarer ikke at sporkontrasten er 3,2× dårligere.

**Målt på DET FAKTISKE vinnerfotoet baken valgte, samme rute, samme skala:**

| | vinnerfotoet | modellen |
|---|---|---|
| nytt skann | **1,95 %** | 3,43 % |
| soverom | **8,54 %** | 6,42 % |

Kildefotoet i det nye rommet har 4,4× mindre sporkontrast — selv om det er tatt NÆRMERE
(2,12 m mot 1,60 m) og er mindre uskarpt (10,3 px mot 25,6). Ser man på de to bildene er
saken åpenbar: soveromsbildet har skarpe sporskygger fra retningsbestemt dagslys, det nye er
mørkt og flatt. **Et 2 mm nedfelt spor synes bare fordi det fanger skygge.** Skannet ble tatt
21:14 i takbelysning. Da er sporet borte før kameraet ser det, og ingen oppløsning i verden
henter det tilbake.

Merk også at modellen på det nye skannet ligger OVER kilden (3,43 mot 1,95 %): baken løfter
alt kontrasten. Det er den observasjonen som ga neste grep.

**Mikrokontrast** (`bakev2_mikro`): et ulikt-skarpt filter på spor-skalaen (3 texler) i
atlaset, klemt på ±0,12 lineær RGB så JPEG-støy og chart-kanter ikke blåses opp. Det gir ingen
ny detalj — det løfter den som ER der.

| styrke | flatt kveldslys | dagslys |
|---|---|---|
| 0 | 2,21 % | 7,69 % |
| **0,6 (standard)** | **6,85 %** | **10,97 %** |
| 0,8 | 4,05 %* | 12,16 % |
| 1,6 | 11,07 % | 16,04 % |

\* målt i en tidligere kjøring uten avskygging; rekkefølgen er 0 < 0,6 < 0,8 < 1,6 i begge.
Referansen ligger på 2,52 %. Ved 0,6 går den utvaskede veggen fra «flat maling» til lesbart
panel. Prisen er at kantene på FYLTE lapper også skjerpes og blir mer synlige.

**Forkastet underveis:** adaptiv styrke fra atlasets egen kontrast. Snittet over atlaset gir
motsatt svar (den skarpe veggen målte lavere enn den flate, fordi atlaset dekker ulike flater),
og 98-persentilen skiller dem ikke (12,7 % mot 11,3 %) fordi den domineres av møbelkanter og
tekst, ikke av veggens spor. Et pålitelig signal krever en veggmaske i atlaset — ikke bygget.
`meshscan.mikromaal`/`mikrotak` står igjen for den som vil prøve.

## 81. Baken ga ulikt nett hver gang — årsaken var ett Set, 2026-09-11

Det som skulle måles denne runden var prisen §80 la igjen: mikrokontrasten skjerpet også
kantene på innfylte lapper. Første måling avslørte noe verre. Seks IDENTISKE bakes av det
store skannet (`ampex-nyskann`, samme kode, samme flagg) ga:

| | median sporkontrast på veggen | svakeste 20 % |
|---|---|---|
| seks kjøringer | **3,15 – 4,92 %** | 1,98 – 3,37 % |

56 % forskjell mellom beste og verste kjøring av samme skann. Soveromsfixturen var samtidig
BIT-identisk hver gang (7,09 % i alle kjøringer), og rendringen ble kontrollert som
deterministisk (samme GLB rendret to ganger gir identisk tall). Modellen var altså ulik.

**Sporet:** TSDF-en er bit-stabil (`plane snap 135948/188363`, `hole fill løkker=250/259`,
`surface nets 188613 verts / 361500 tris` i hver kjøring). Det som spriket var
**forenklingen**: 50 931 – 50 982 kollaps, 249 418 – 249 429 trekanter. Soverommet har 193 410
trekanter, altså UNDER målet på 250 000 — der kjører forenklingen aldri. Det forklarte hvorfor
bare den store fixturen var ustabil. xatlas var uskyldig: den fikk bare ulikt nett hver gang.

**Årsaken, i én linje:** kandidatløkka i `MeshSimplify` la nye kanter i heapen ved å iterere
et `Set<Int32>` med naboverteksene. Swift randomiserer hash-rekkefølgen per prosess, og
heapen sammenlignet BARE `cost`. Et TSDF-nett er fullt av plane flater med identisk
kvadrikk-feil, så likhetene ble avgjort av innsettingsrekkefølgen — som altså var tilfeldig.

**Rettelsen** er to linjer og begge trengs: naboene itereres sortert, og heapen fikk en TOTAL
ordning `(cost, a, b)`. Etter den:

| | kollaps | tris | xatlas outVerts | median sporkontrast |
|---|---|---|---|---|
| før (6 kjøringer) | 50 931 – 50 982 | 249 418 – 249 429 | 165 170 – 170 019 | 3,15 – 4,92 % |
| **etter (3 kjøringer)** | **50 982** | **249 429** | **167 678** | **3,26 %** |

Tre kjøringer, identiske på alle fire tallene. Prisen er 260 ms på forenklingen (803 → 1065 ms
på 361 500 trekanter) — sorteringen av et titalls naboer per kollaps. Hele baken er uendret:
34,7 / 75,9 s mot 36,3 / 78,3 s før.

Merk hva dette IKKE er: ingen kvalitetsgevinst. 3,26 % ligger midt i det gamle slumpområdet.
Gevinsten er at «Bygg om modellen» nå gir samme modell hver gang — og at A/B på den store
fixturen i det hele tatt kan leses. Alle enkeltmålinger i §69–§80 som ble gjort på ÉN bake av
et nett over 250 000 trekanter har ±25 % slump i seg og bør leses som retning, ikke tall.

**Forkastet på veien:** `AMPEX_XATLAS_THREADS=1`. Hypotesen var at xatlas' parallelle
chart-beregning var kilden. Knappen finnes nå i `xatlas.cpp`, men én tråd bruker over ti
minutter på det samme nettet mot 11 s parallelt, så den er diagnose og ikke innstilling —
og den var uansett feil spor.

### Mikrokontrasten skjerpet innfyllingen — full nabostøtte kreves nå

Prisen §80 la igjen er rettet, men ikke slik det først så ut. Rekkefølgen var
dilatasjon (16 pass) → mikrokontrast → push-pull. Dilatasjonen legger en 16 texler bred,
utsmurt krave med alfa 1 rundt hvert hull, og skarpingen løftet den kraven.

Å flytte mikrokontrasten FØR dilatasjonen alene gjorde det verre: en texel på chart-kanten
får da bare naboer fra innsiden, det lokale snittet blir skjevt, og en mørk panelkant ble en
mørk rand som dilatasjonen smurte 16 texler ut i det innfylte feltet (tydelig rød brem langs
hele hullkanten på soveromsfixturen, kontrollert i atlaset).

Rettelsen som virker er begge deler: mikrokontrast før dilatasjonen OG krav om FULL
nabostøtte — en texel nærmere enn radiusen (3 texler ≈ 1,6 mm) til en umalt nabo står urørt.

| | struktur-dekning | svakeste 20 % | median | toneflekk |
|---|---|---|---|---|
| soverom, før | 100 % | 3,15 % | 7,09 % | 14,67 % |
| **soverom, etter** | 100 % | 3,15 % | **7,06 %** | 14,67 % |

Skarpheten på veggen står altså (−0,4 %, som er det 3-texels beltet koster), mens 0,4–0,6 %
av atlasets texler — alle på hull- og chart-kanter — ikke lenger blir skjerpet.

### Veggmaske i atlaset: bygget, og den løser ikke det den skulle

§80 etterlot «et pålitelig signal krever en veggmaske i atlaset — ikke bygget». Den er bygget
nå: samme vertex-funksjon og samme UV-er som fargepassene, men bare trekanter på et
vegg-/tak-plan. Den virker som maske (målt på samme bake: 98-persentil 14,6 % på vegg/tak mot
35,0 % over hele atlaset — møbelkanter og tekst er faktisk ute).

Men den løser ikke adaptiv styrke, og her er grunnen:

| | vegg-texler/m | 98-persentil, én texels steg |
|---|---|---|
| soverom (skarpt dagslys) | 1930 | 5,90 % |
| nytt skann (flatt kveldslys) | 1214 | 9,70 % |

Forholdet mellom målingene er 1,64, forholdet mellom texeltetthetene 1,59. **Målingen er
texeltetthet, ikke skarphet** — og rangeringen blir motsatt av det øyet ser. Et fysisk steg
(~2,5 mm i verden i stedet for én texel) retter enheten, men ikke svaret: 98-persentilen
fanges da av dørkarmer, stikkontakter og bilder PÅ veggen, ikke av panelsporet, og spriker
8,2–19,0 % mellom fliser av samme bake. Et brukbart signal må måle sporet der sporet er, ikke
den sterkeste kanten på en planar flate.

Masketeksturen er 67 MB på et 8192-atlas, så den bygges bare når noen ber om adaptiv styrke
med `meshscan.mikromaal`. Standard er fortsatt fast styrke 0,6. Texeltettheten logges alltid.

## 82. Kvalitetsmodellen er nå standard også LIVE, 2026-09-11

Tormod: «men kvalitetsfunksjonen skal jo skje rett etter scan?» Han har rett, og §75s
begrunnelse for det motsatte holdt ikke. Den sa at live skulle være raskt og lite og at
ombyggingen var der brukeren ba om det beste. Men modellen han ser RETT ETTER skanningen er
den han dømmer appen på — og det var nettopp den han kalte utvasket 10. september (§76).

Live-budsjettet gir 6144-atlas mens AR-sesjonen fortsatt holder minne. Spørsmålet var derfor
ikke om kvalitetsveien er bedre på 8192, men hva den gir PÅ 6144. Målt på begge fixturene:

| | bake | fil | «sporkontrast» (veggmaal) | toneflekk |
|---|---|---|---|---|
| soverom, enkeltatlas 6144 (live i dag) | 19 s | 12 MB | 11,54 % | 8,57 % |
| **soverom, fire fliser à 6144** | 31 s | 37 MB | 7,53 % | 14,67 % |
| soverom, fire fliser à 8192 (ombygging) | 35 s | 46 MB | 7,06 % | 14,67 % |
| nytt skann, enkeltatlas 6144 | 43 s | 18 MB | 4,69 % | 9,86 % |
| **nytt skann, fire fliser à 6144** | 72 s | 49 MB | 3,35 % | 4,66 % |

**Og her må skriptet overstyres av øynene.** `veggmaal.py` gir HØYEST tall til enkeltatlaset,
men rendret side om side er det omvendt: enkeltatlaset har en tydelig mørk tonelapp over
venstre tredel av veggen og tynne, stedvis brutte panelspor, mens flisene gir rene,
sammenhengende linjer og jevn flate. 98-persentilen av gradienten belønner tonekantene og
resamplings-aliasen i enkeltatlaset som om det var sporkontrast — samme feilkilde som §80 og
§81 fant to ganger før. Metrikken duger til å sammenligne ARMER INNEN samme vei; den er ikke
en dommer MELLOM de to veiene, blant annet fordi den ikke ser sømbrudd i det hele tatt, som
er hele grunnen til at fliseveien finnes (§75: brudd 0,0278 mot 0,0368 %).

Fire fliser à 6144 gir ~915 texler per meter vegg mot enkeltatlasets 622, og ligger visuelt
tett på ombyggingens 8192-variant. Standarden er derfor snudd: `kvalitetFliser` er nå på
uansett, og `ARMeshGlbExporter.isRebake` styrer den ikke lenger.
`meshscan.kvalitet = "standard"` gir den gamle veien tilbake.

**Prisen, ærlig:** live-baken tar omtrent 1,6× så lang tid, og filen blir 2,7× større
(12 → 37 MB, 18 → 49 MB). Det siste treffer R2 og synken, ikke bare telefonen.

**Ikke verifisert her:** simulator-harnessen kjører alltid med `isRebake = true` og kan ikke
kjøre den ekte live-veien. Minnetoppen live er fire sekvensielle rasteriseringer à 6144
(~500 MB hver) innenfor et headroom på 1700–2000 MB mens AR-sesjonen er pauset. Det må
bekreftes med ett ekte skann på telefonen. `AmpexMeshViewerView.loadNode` leser alle
primitiver (§75), så både vieweren og miniatyrbildet takler flere fliser.

## 83. Filen var halvparten duplisert geometri, 2026-09-11

§82 la kvalitetsmodellen på live og oppga prisen som 2,7× filstørrelse. Den prisen var i stor
grad selvpåført. Målt hvor bytene faktisk lå i en 61 MB kvalitets-GLB:

| | tekstur | geometri |
|---|---|---|
| før | 35,5 MB (58 %) | **25,7 MB (42 %)** |

**Geometrien var 42 % av filen, og 80 % av den var duplikater.** `writeTiledGlb` ga hver
trekant sine egne tre vertekser: 748 287 vertekser der bare 20–23 % var unike på
(posisjon, normal, UV). Kvalitetsveien leverer hjørne-vis geometri fordi prosjektive UV-er er
per hjørne, men skriveren sveiset aldri dem som faktisk var like.

Sveising på de EKSAKTE bitmønstrene til alle åtte flyttallene er tapsfri — to hjørner slås
bare sammen når de er identiske i alle attributter, så UV-sømmer og normalbrudd deles
fortsatt. Geometrien gikk 25,7 → 7,6 MB og modellen er bit-identisk på alle veggmål.

**Teksturen:** JPEG-kvaliteten var 0,90. Ved 0,80 er teksturen 35,5 → 26,8 MB, og de to er
ikke til å skille på 3× nærmeste-nabo-zoom i det mest detaljerte feltet i atlaset. Selv 0,72
var uskillelig; 0,80 er valgt for å beholde margin mot zoom i vieweren.
`meshscan.jpegkvalitet` er armen.

**Samlet, målt på begge fixturene:**

| | før i dag | nå |
|---|---|---|
| ombygging, 4 fliser à 8192 | 46,6 / 61,3 MB | **25,3 / 34,4 MB** |
| live, enkeltatlas 6144 (gammel vei) | 12,2 / 18,0 MB | — |
| **live, 4 fliser à 6144 (ny standard)** | — | **18,8 / 25,1 MB** |

Kvalitetsmodellen live koster altså ~1,4× dagens fil, ikke 2,7×, og ombyggingen er 44 %
mindre enn i morges. Veggmålene er uendret innenfor kjøring-til-kjøring-støyen.

**Ikke gjort:** gzip av GLB-beholderen. Teksturen er 78 % av filen og JPEG komprimerer ikke
videre; de 7,6 MB geometri ville gitt kanskje 2 MB, mot en dekomprimering i alle lesere.
Kvantisering av normaler/UV-er til 8/16 bit ville tatt geometrien videre ned mot ~3 MB, men
krever endring i `AmpexMeshViewerView.loadNode` og i enhver annen leser. Begge står åpne.

## 84. Skann og bake er ÉN ting, 2026-09-11

Tormod: «husk scan + bake skal være en ting ikke 2 steg.» §82 la kvalitetsveien på live, men
ett steg gjensto: live-baken fikk et dårligere BUDSJETT enn ombyggingen av samme opptak.

AR-sesjonen var bare `pause()`-et når baken startet. `ARSCNView` eide fortsatt en SceneKit-node
med full geometri per anker, og ARKits egne buffere lå i minnet gjennom hele baken. Det presset
`os_proc_available_memory()` ned i 1700–2000 MB-sjiktet, som på budsjett-trappa i
`MeshBakeV2.exportTextured` gir atlas 6144 og 160 bilder — mot 8192 og 200 over 2800 MB.

Visningen slippes nå rett etter at framdriftsteppet er på plass, før eksporten sendes til
bakgrunnstråden: delegatene nulles, ankernodene tas ut av scenegrafen, `sceneView` fjernes fra
hierarkiet og settes til nil. Ankrene selv ble hentet ut før `pause()` og lever videre — det er
bare VISNINGEN av dem som slippes. Teppet lå før over et frosset kamerabilde; nå over sort.

Med §82 og dette er live-modellen den samme som ombyggingen ville gitt. «Bygg om modellen»
(bak ⋯ på skann-kortet) er dermed ikke lenger et nødvendig andre steg, men det den burde være:
en måte å bake et GAMMELT skann på nytt med nyere kode.

**Ikke verifisert på Mac.** Harnessen kjører uten AR-sesjon og ser ikke forskjellen — den må
leses av `V2 budsjett — headroom …MB` i `pipeline.log` etter et ekte skann på telefonen.
Release-bygg med §81–§84 er installert på «Tormod sin iPhone» 2026-09-11 kl. 12:40.

### Hullene er fangsten, ikke baken

Full-roms-rendring med rød bakgrunn (rødt = hull i geometrien), soveromsfixturen mot
Scaniverse-eksporten av samme rom:

| | hull i bildet | grunnflate | veggareal |
|---|---|---|---|
| Scaniverse | **1,4 %** | 28,9 m² | 31,1 m² |
| Ampex | **19,2 %** | 17,7 m² | 18,4 m² |

Tak-beltet, dyna og TV-kanten mangler hos oss. **Samme opptak bakt med ARKits eget anker-nett
gir nøyaktig samme 19,2 %** — flatene finnes ikke i rådataene, og da kan ingen rekonstruksjon
lage dem. Fixturen vår er et opptak som konsentrerte seg om panelveggen; Scaniverse-skanningen
er en full runde gjennom rommet. De to er derfor ikke samme type skann, og alle
vegg-sammenligningene i §78–§83 gjelder VEGGEN, ikke rommet.

Neste måling er ett skann av samme rom med begge appene, gått på samme måte.

## 85. «Ser ikke ut som en single scan» — det VAR mange biter, 2026-09-11

Første ekte skann med §82/§84-bygget. Tormod: «ser shit ut, ser ikke ut som en single scan.»
Modellen hentet fra telefonen og rendret mot ombyggingen av samme opptak viser hvorfor: live
har en **hard svart stripe fra gulv til tak tvers over veggen**, sprekker langs taklista og
rundt TV-en. Ombyggingen har ingen av dem.

**Årsaken sto i loggen:** live-baken kjørte på ARKits ANKER-nett —
`V2 geometri: anchors + dedup — 52 450 verts, 84 138 tris` og `mesh cleanup — components=260`.
260 separate komponenter. ARKits nett er blokker per anker som ikke møtes, og blokkgrensene
blir svarte sprekker i den ferdige modellen. Det er bokstavelig talt mange biter.
Ombyggingen bygde TSDF fra rå dybde: `surface nets 90 537 verts, 175 617 tris` — én flate.

TSDF-en sto AV live med henvisning til en måling fra 5. september: «8,5 min av en
17-minutters bake på et 11×11 m rom». Den målingen er fra FØR omskrivingen av fusjonen.
Målt på telefonen i dag, samme skann:

| steg | tid |
|---|---|
| lesing av 286 dybdekart | 0,05 s |
| depth super-res (89 keyframes, JBU ×3) | 2,2 s |
| GPU-fusjon, 375 dybdekart | 0,4 s |
| surface nets + plan-snap + hullfyll | 0,7 s |
| **totalt** | **3,5 s** av en live-bake på 22 s |

Store rom er alt dekket: `maxVoxels` 40 M øker voxelstørrelsen automatisk, og volumet er
minnekartlagt. TSDF er derfor nå STANDARD også live; `meshscan.geometry = "anchor"` gir
ARKit-nettet tilbake.

**Budsjettet, som et biprodukt.** §84s frigjøring av AR-visningen ga `headroom 1977MB` —
23 MB under 2000-terskelen som gir atlas 8192, så live havnet på 6144 likevel. Ombyggingen
like etter målte 2214 MB. Terskelen er ikke rørt; med TSDF-en inne går det nå 3,5 s mellom
frigjøringen og budsjettavlesningen, og det skal være nok til at ARKit har levert tilbake.
Må leses av neste `V2 budsjett`-linje.

Release-bygg med §85 installert på iPhonen 2026-09-11 kl. 13:0x.

## 86. Hvitbalanse fra taket, 2026-09-11

Etter §85 var geometrien i orden og Tormod sa «bra mye bedre». Det som da skilte mest i
romvisningen var FARGE, ikke struktur. Målt på taket i rendringen:

| | R/G | B/G |
|---|---|---|
| Scaniverse | 1,031 | **0,935** |
| Ampex | 1,108 | **0,772** |

Fangsten låser AE/AWB ved start, så rommets gule kunstlys gjengis trofast og en hvit
panelvegg blir kremgul. Samme valg som avskyggingen (§79) — men her leses det som skittent.

Korreksjonen legges i `gains`, som alt ganges inn i hver eneste sampling, så den er global og
identisk over alle fire fliser. Luminansen holdes fast; bare farge flyttes.

**Referansen er TAKET**, ikke hele rommet: grey-world over alt ville nøytralisert en rød
panelvegg til grå. Hvitpunktet er snittet av de LYSESTE 20 % av takflatene (white patch) —
et tak har bounce-lys fra gulv og møbler i hjørnene.

**To forkastede varianter, begge målt på tre skann:**
- *Full nøytralisering av taket.* Ga soverommet lilla stikk og nyskann blått: takene deres er
  ikke rene hvite, og grey-world «retter» da ekte farge bort. Gain ble ×1,24 og ×1,37 på blå.
- *Rød-aksen med.* Et skann med ekte varmt tak (R/G 1,282) ble GRÅTT av å dras til 1,063.

**Det som står:** bare blå, og bare opp til referansens hvitpunkt (lineært R/G 1,063,
B/G 0,874), aldri forbi. Ligger rommet alt på riktig side, røres ingenting.

| | tak B/G | vegg B/G |
|---|---|---|
| Scaniverse | 0,935 | 0,941 |
| Tormods rom, før | 0,772 | 0,757 |
| **Tormods rom, etter** | **0,882** | **0,869** |
| soverom (kontroll) | gain ×1,069 | — |
| nyskann (kontroll) | gain ×1,092 | — |

Kontrollfixturene er praktisk talt urørt, og veggmålene står stille. `meshscan.hvitbalanse =
"off"` gir det trofaste rommet tilbake; `meshscan.hvitrod = "on"` slår rød-armen på.

## 87. «Man ser fire forskjellige deler» — tonelaget var slått av, 2026-09-11

Tormod, om samme skann: «scaniverse ser ut som en og samme vegg. vår scans kan man se
difference på 4 forskjellige deler som er andre bilder.» Han teller fotolapper, og de er der:
rendret side om side ser man en lysere stripe til venstre, en hard loddrett kant ved en firedel,
og et annet-tonet felt til høyre for midten.

**Årsaken er §75, og den var min egen.** Kvalitetsveien (prosjektive fotofelt i fire fliser) slo
AV både tonelaget og søm-fjæringen, med den begrunnelsen at begge «blander innhold fra flere
foto og river ned nettopp dette». Det stemmer for et rått snitt — men HYBRID-modusen blander
bare LAVBÅNDET: tone fra snittet av alle syn, detalj fra vinnerfotoet. Og lavbåndet er nettopp
det som utjevner eksponeringsforskjellen mellom foto. Da §82 gjorde kvalitetsveien til standard
også live, ble utjevningen slått av for HVER modell brukeren ser.

Målt på Tormods skann, samme kamera:

| | svakeste 20 % | median | toneflekk |
|---|---|---|---|
| dagens (tonelag av) | 1,96 % | 2,51 % | 5,87 % |
| **tonelag på** | **2,01 %** | **2,61 %** | **4,83 %** |

Bedre på alle tre — skarpheten taper ingenting, og toneflekken faller 18 %. På soveroms-
fixturen er utslaget større: 3,15 → 4,12 % svakeste femtedel, 7,14 → 8,37 % median og
14,67 → 8,59 % toneflekk.

Søm-fjæringen er lagt på samme arm, men gjør ingenting på vegger: `featherFaces` fjernes
uansett for flater som ligger på et plan, fordi tonelaget eier dem. Den virker bare på møbler.
Bit-identisk resultat på veggen (0,0 % endrede piksler).

`meshscan.kvalitettone = "off"` og `meshscan.kvalitetfjaering = "off"` gir §75-oppførselen.

## 88. «Squares på HELE veggen» — fire mistenkte avkreftet, én funnet, 2026-09-11

Tormod på sitt eget skann: *«det er bra kvalitet men det er squares på HELE veggen»*.
Forsterker man lavfrekvensen (gauss 2 minus gauss 26) på en veggrendring, er de der:
vannrette bånd tvers over hele flaten i tre-fire høyder, og noen loddrette blokkskiller.

**Avkreftet, i denne rekkefølgen:**

- *Mipmapping.* Rendret samme GLB med og uten mip: 28,28 mot 28,41 i lavfrekvent
  kontrast, og båndene står i begge. Ikke atlasfiltrering.
- *De prosjektive fotofeltene.* `meshscan.projektivfelt region` fjerner rutenettet
  helt — båndene står i nøyaktig samme høyder. Ikke feltinndelingen.
- *Tonelaget og avskyggingen* (§87, §79). Begge testet av og på tidligere samme dag;
  de endrer flekkene, ikke båndene.
- *Gain-utjevningen.* Løsnet fra ±5 % til ±25 %: ingen forskjell.

At de overlever ALLE atlasendringer betyr at de er bakt inn i fargen som samples,
ikke i pakkingen.

**Funnet: avvignetteringen var en hardkodet gjetning.** `devig = 1 + 0,15·(x²+y²)·4`
sto likt fem steder i Swift og Metal, uten flagg og uten at noen hadde målt om
0,15 stemmer for iPhone-linsa. Den lysner hjørnet med 30 %.

Målt på Tormods skann, lavfrekvent variasjon på veggen:

| K | variasjon |
|---|---|
| 0 (av) | **3,95 %** |
| 0,15 (dagens) | 4,26 % |
| 0,30 | 4,60 % |

Monotont, og visuelt er båndene tydelig svakest ved K=0. Altså OVERkorrigerer vi —
konsistent med at iPhone alt korrigerer linsefall i sin egen bildekjede, så vår
ekstra 30 % er ren feil lagt oppå.

**Standarden er IKKE endret.** Kontrollfixturene er uavgjort: soverommet går
8,37 → 9,03 % median sporkontrast (bedre) men 4,12 → 3,91 % svakeste femtedel
(verre); nyskann motsatt vei. Ett skanns bevis er ikke nok, og nettopp disse
målene har pekt feil vei flere ganger i dag (§80, §81, §82).

`meshscan.devig` er lagt inn som A/B-arm og settes inn i shaderen ved kompilering,
så Swift- og Metal-veien alltid bruker samme tall.

**Neste steg er å MÅLE fallet, ikke gjette K.** Dataene ligger i bundelen: finn et
veggpunkt som sees nær sentrum i ett foto og nær kanten i et annet, og forholdet
mellom målt lysstyrke gir den ekte vignetteringskurven. Da er K et tall og ikke en
antakelse. Båndene forsvinner uansett ikke helt av dette alene — devignetteringen
er en bidragsyter, ikke hele forklaringen.

## 89. Båndene forsvant da vi SNITTET i stedet for å VELGE, 2026-09-12

Tormod stilte spørsmålet som løste det: «kan vi ikke gjennomsnitte? det ser man at
Scaniverse gjør aktivt mens du går rundt og scanner, mørke blir likere det lyse og
vice versa».

### Hvorfor det virker

Vinnerveien gir hver flate fargen fra ÉTT foto. Naboflater ender ofte på ulike foto,
og da flytter hele tonen i ett sprang akkurat der byttet skjer. Det er de vannrette
båndene — ikke vignettering, ikke atlaskanter, ikke eksponering.

Snitter man over topp-K i stedet, deler naboflatene K−1 av K foto. Ett bytte flytter
da 1/K av fargen i stedet for hele. Steget blir en gradvis overgang. Det er samme
grunn til at et snitt av mange målinger er roligere enn av to.

Prisen er uskarphet: fotoene er litt uenige om HVOR detaljene ligger (registrering,
og ekte relieff sett fra to vinkler). Mikrokontrasten betaler det tilbake.

### Målt på tre fixturer

| fixture | før (winner) | etter (snitt + mikro 1,6) |
|---|---|---|
| nyskann | bånd 0,176, skarphet 8,0 | **bånd 0,078**, skarphet 8,0 |
| enhetsskann | bånd 0,206, skarphet 6,0 | bånd 0,144, skarphet 6,0 |
| soverom | bånd 0,519, skarphet 17,0 | **bånd 0,132**, skarphet 20,0 |

Scaniverse ligger på bånd 0,091. Nyskann er nå under.

### To feil hadde skjult dette siden 2026-09-02

Raw-snittet ble forkastet i §72 fordi flat hvit vegg ble en trekantmosaikk. Det var
ikke snittets skyld:

1. **Søm-nivelleringen nådde aldri grenen.** Den tegner per BILDE, ikke per region, så
   regionnivået lå i en uniform som var satt til null. Rettet 2026-09-01 (nivået ligger
   nå i vertex-dataene).
2. **Mikrokontrasten kjørte aldri i grenen.** Snitt-grenen returnerer FØR vinnerløkka
   og nådde derfor aldri skarpingen lenger nede. En A/B av mikrokontrast på denne veien
   målte nøyaktig ingenting, fordi den aldri kjørte. Rettet nå.

Lærdommen er den samme som i §80–§82: når en A/B måler «ingen forskjell», sjekk at
armen faktisk kjørte før du tror på tallet.

### Krasjen på det store skannet

Første forsøk døde på 77 % i nyskann (103 bilder). Løkka laster et fullt kildefoto per
syn (~14 MB CGImage + RGBA) og slapp det aldri — 1,4 GB oppå atlaset, og jetsam tok
appen. `autoreleasepool` per bilde; toppen er nå ett foto om gangen.

### Standard nå

`meshscan.blend` = `raw`, mikrokontrast 1,6 i grenen. `winner`/`multiband`/`off` er
A/B-armene. `meshscan.topk` er fortsatt 2 — flere syn midler bort mer bånd, men koster
mer skarphet; ikke målt med mikrokontrasten på plass ennå.

## 90. Snittet rullet tilbake — måltallet var blindt for artefakten, 2026-09-12

§89 ble satt som standard, Tormod bakte om sin egen soveromsvegg, og den ble verre.
Bildene ligger side om side (`T-gml-A.png` / `T-ny-A.png` i harness-mappa).

### Hva som faktisk skjedde med veggen

Veggen er PANEL — tynne loddrette spor med jevn avstand. Det er det vanskeligste
tilfellet for et snitt: to syn er sub-pixel uenige om hvor sporet ligger, så den
tynne mørke streken smøres til et bredt, svakt bånd. Mikrokontrast 1,6 blåser
deretter opp nettopp det båndet. Resultatet er brede, myke loddrette striper der det
før var skarpe streker.

I tillegg kom §72-mosaikken tilbake: store flekker med saggtakk-kant, der topp-2-
settet vipper fra trekant til trekant.

| | vannrett bånd | tonespenn over veggen |
|---|---|---|
| winner (før) | 0,566 | 51 gråtrinn |
| snitt (etter) | **0,147** | **88 gråtrinn** |

Båndene ble altså fjernet. Men lysheten over veggen varierte nesten dobbelt så mye
etterpå — og «ser det ut som ÉN vegg» er nettopp det tonespennet, ikke båndenergien.

### Hvorfor måltallet løy — fjerde gang

Båndmålet er RADSNITT minus et glidende snitt. Det ser bare vannrett struktur.
Artefakten snittet lager er loddrett og flekkete, og radsnittet er per konstruksjon
blind for den. Skarphetsmålet (98-persentil av vannrette nabodifferanser) ble
dessuten BEDRE av brede oversharpede loddrette striper. Begge tallene pekte oppover
mens veggen ble dårligere.

**Regel herfra: et nytt måltall skal først vises å skille to bilder jeg allerede har
rangert med øyet.** Ellers måler det noe annet enn det jeg tror.

Nyttig par som faktisk skiller dem, til neste gang:
- `tonespenn` = maks − min av luminansen etter gauss(12) over veggflata. 51 mot 88.
- `tonesteg p90` = 90-persentil av |∇| på samme lavfrekvensfelt. 0,50 mot 0,71.

### Hva som ble beholdt

- `autoreleasepool` per bilde i snitt-grenen. Ekte feil: 103 foto à ~14 MB ble aldri
  sluppet, og appen ble drept av jetsam på 77 % i det store skannet.
- Mikrokontrast i snitt-grenen. Den kjørte aldri der før, så alle tidligere A/B-er av
  den på denne veien målte ingenting.
- `meshscan.blend raw` består som A/B-arm.

### Det som står igjen

Vinnerveien har fortsatt et bredt, mykt vannrett slør over veggen (tonespenn 51 =
20 % av skalaen, mot avskyggingens mål på 6 %). Det er den ekte gjenstående feilen,
og den skal angripes i tonelaget — ikke ved å bytte ut fargevalget.

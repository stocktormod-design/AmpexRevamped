# Prompt til Fable: LiDAR-skanneren i Ampex — videreutvikle eller starte på nytt?

Du er arkitekt og senior iOS/Metal/3D-rekonstruksjonsingeniør på LiDAR-skanneren i Ampex.
Ampex er en norsk app for elektrikere, bygd med Expo og React Native. Skanneren er en egen
Swift- og Metal-modul i `modules/ampex-splat/ios/`. Repoet ligger i
`/Users/tormodholand/Documents/AmpexRevamp`. Eieren heter Tormod. Han tester på en iPhone 13
Pro og dømmer på det han ser på telefonen, ikke på tall.

**Utgangspunktet: Tormod er ikke fornøyd med NOE av skanneren ennå. Ingenting er godt nok —
ikke ett rom, ikke geometrien, ikke teksturen, ikke overlegget.** Tidligere notater som kaller
noe «ferdig nok» eller «bedre enn Scaniverse» gjelder ikke lenger. Ikke behandle noen del som
løst eller hellig når du vurderer hva som skal beholdes; alt må forsvare plassen sin.

**Oppgaven din er å vurdere, ikke å kode.** Les koden og dokumentene, og svar på om vi skal
videreutvikle dagens kjede, skrive om deler av den, eller starte på nytt. Lever en anbefaling
med begrunnelse og en plan. Ikke skriv Swift før Tormod har sagt ja til planen. For store grep
i skann-arkitekturen gjelder regelen research, så idémyldring, så ja.

---

## Hvor vi skal (harde krav fra Tormod)

1. **Samme kvalitet uansett størrelse.** Et skann kan være ett rom eller et helt hus i flere
   etasjer. Kvaliteten per rom skal aldri synke fordi skannet er stort. Bare ventetid og
   lagring får vokse. Rådata på 10–20 GB er greit, de slettes når 3D-fila er laget.
2. **Aldri krasj.** Ikke på grunn av minne (jetsam), varme eller lange opptak. Minnebruken må
   være begrenset uavhengig av husets størrelse.
3. **Aldri kvalitetstap og ingen struping.** Varme og minne skal gi pauser, mindre batcher og
   lengre kjøretid. De skal aldri gi færre bilder, færre dybdekart, mindre atlas eller kutt i
   regioner. Ethvert tak som er laget for ett rom, skal skalere med skannet.
4. **Det du ser under skanning er det du får.** Wireframe og dekningsoverlegg skal stemme med
   den ferdige modellen. Viser overlegget at et område er dekket, skal det finnes i
   resultatet. Overlegget skal ikke tegne på nytt når du snur deg eller går tilbake. I dag
   stemmer det ikke, og Tormod regner det som et av de største problemene.
5. **Ingen gjennomsiktige vegger og ingen hull** på vegg, gulv og tak. Disse flatene skal se
   ut som ett sammenhengende bilde, uten lappeteppe, sømmer, toneskift eller svarte sprekker.
   Møbler er bevisst mindre viktige.
6. **Geometrien stemmer over hele huset.** Etasjene skal ligge riktig oppå hverandre. Den
   ekte bruken er at elektrikeren finner borevinkelen gjennom gulvet ut fra skannet. Drift og
   loop closure er altså funksjonalitet, ikke kosmetikk.
7. **Skann og bake er ett steg.** Modellen brukeren ser rett etter «Ferdig» er den beste vi
   kan lage. Kvaliteten skal aldri ligge bak en «bygg om»-knapp. Ventetiden etter Ferdig kan
   være opptil 5 minutter for et hus, men målet er rundt 1 minutt. Baken kan gjerne skje
   bak deg mens du skanner neste rom.
8. **Alt kjører på telefonen.** Ingen server eller PC, og det skal virke i en kjeller uten
   dekning. Eneste tillatte driftsutgifter i prosjektet er Supabase og Cloudflare R2.
9. **AR-linjer på ±1 cm.** Brukeren tegner en kabelføring på modellen. Senere holder hen opp
   telefonen og ser linjen på riktig sted i rommet.
10. **Bedre enn Polycam og Scaniverse** — på alt, ikke bare på enkelte bilder. Polycam har ikke loop closure og ber brukeren skanne i ett pass. Vi skal
    tåle at du går i sirkler og tilbake, og resultatet skal bli bedre av det, ikke verre.

---

## Hvor vi er

### Det som finnes (ingenting av det er godt nok)
- **Ett rom:** vegger, vinduer og store flater er gode. TSDF fra rå LiDAR-dybde ga oss et
  sammenhengende nett, og bake på enheten tar rundt 25 s. Men Tormod mener det IKKE er godt
  nok. Siste ettromsskann (0daef323, tatt i september og bygget om 18.10) har store svarte
  hull rundt stol, pult og skjerm, utsmurt pult og tynne sprekker og hull i taket. Det finnes
  ikke noe ettromsskann med dagens kode. Ikke regn ett rom som løst.
- **Bildebindingen** (virker teknisk): GPU-SIFT pluss bundle adjustment mellom passeringer, med linsemodell og
  dybdeskala. Etter kryss er den epipolare feilen median 0,7 px.
- **Driftretting:** posekorreksjon forankret i plan, inne i TSDF-byggingen.
- **AR-relokalisering:** kart og lokalisator er bygget, men ikke ferdig testet på telefon.

### Det som ikke virker (målt 26.10 på to flerromsskann)
- **Fixturer:** `~/AmpexFixtures/ampex-f97d682a-…` (3 min, 390 bilder) og
  `~/AmpexFixtures/ampex-f92f1be0-…` (847 dybdekart, 10 × 8 m). Begge finnes også på
  telefonen.
- **Gjennomsiktig skillevegg.** LiDAR så aldri 36–39 % av hver side, på grunn av dør, møbler
  og steder brukeren ikke gikk nær. Da står bare den andre sidens enkeltsidige flate igjen,
  og den er usynlig bakfra. I tillegg tapes 13 % av det LiDAR faktisk så. Årsaken til det er
  ikke funnet.
- **Retningsdelt TSDF prøvd (§114).** Den ga ingen gevinst og er slått av. Veggsidene var
  ikke i ferd med å nulle hverandre. Etter å ha fjernet strupingen gikk B-siden fra 43 til
  51 % dekning.
- **Overlegget stemmer ikke med resultatet.** Dekningsfeltet (`CoverageField`) er et
  ringbuffer i verdensrommet som males av LiDAR-splats med ARKits live-poser. Den ferdige
  meshen bygges etterpå fra andre poser, rettet med driftretting og binding. Når ARKit
  korrigerer seg selv med 8–12 cm, ligger feltet feil og stripene kommer tilbake. Dette er to
  forskjellige modeller av verden, med hvert sitt sett poser. Mitt beste forslag så langt er å
  forankre feltblokkene til ARAnchors, men det er ikke prøvd.
- **Det skalerer ikke:**
  - Bindingen hoppes over ved mer enn 450 bilder (`meshscan.bbmaks`), fordi den holder alle
    trekk i minnet. Store skann mister da både binding og AR.
  - Det tette TSDF-volumet var 217 MB for 10 × 8 m. Et hus i flere etasjer får ikke plass. Et
    sparsomt blokkvolum finnes, men er opt-in (`meshscan.sparse`).
  - Baken velger bilder for hele skannet, ikke per rom. Taket på antall regioner er fjernet
    26.10 (`selectCoverageAware`), men budsjettet er fortsatt globalt.
- **Ingen loop closure i appen.** Den finnes bare som Python-prototype
  (`tools/scan-loop-closure.py`). Driftrettingen flyttet bilder opptil 208 mm, og ARKit hadde
  40 brudd i poserekka på ett skann.
- **Fortsatt ukjent:** trapper og flere etasjer. Første test er planlagt.

### Nøkkelkomponenter (les disse)

| Fil | Linjer | Hva den gjør |
|---|---|---|
| `MeshScanPresenter.swift` | 2 600 | Opptak, keyframes, dense depth, lagringsvakt, live-visning og overlegg |
| `CoverageField.swift`, `CoverageMesh.metal` | | Dekningsfelt og overleggsshader. Prekompileres til `vendor/coverage.metallib` |
| `MeshTsdfBuild.swift` | 2 300 | Driftretting, GPU-fusjon (`ampex_fuse`), sparsomt volum, frirom-utskjæring, Surface Nets, plansnapp og hullfylling |
| `MeshBildebinding.swift`, `MeshSift.swift` | | SIFT og bundle adjustment |
| `MeshRelok.swift`, `MeshArPresenter.swift` | | Relokalisering og «Se i rommet» |
| `MeshBakeV2.swift` | 6 000 | Tekstur: bildevalg, gain-solve, plan-snitt, texel-blend og multiband |
| `ARMeshGlbExporter.swift` | 1 500 | Budsjett, dekningsbevisst utvalg og GLB-eksport |
| `MeshPoseRefineV2.swift` | 1 750 | Eldre poseforfining |
| `xatlas.cpp` | | UV-utbretting |
| `AmpexMeshViewerView.swift` | | Visning av ferdig modell |

Hele modulen er rundt 30 000 linjer. Den er bygget lag på lag gjennom 114 dokumenterte
beslutninger siden august.

### Les først
- `docs/SKANN_BESLUTNINGER.md` er beslutningsloggen. Les særlig §82–84 (ett steg),
  §102–103 (sparsomt volum, ARKit-tillegg rullet tilbake), §106–114.
- `docs/SKANN_HELT_HUS.md` er planen for hele hus fra 22.10, takene som stopper oss og
  funnene fra flerromsskannene 26.10.
- `docs/SKANN_POLYCAM.md` og `docs/HANDOFF_SKANN_AR_2026-10-22.md`.
- `docs/ON_DEVICE_SCAN_PLAN.md` og `docs/SUBPIXEL_ALIGN_PLAN.md` er eldre planer, og noe er
  forkastet.

---

## Det du skal vurdere

1. **Fra bunnen eller videre?** Vurder ærlig om dagens kjede kan bære kravene, eller om den
   er en ettroms-arkitektur med hus-lapper på. Tre muligheter: behold og utvid, skriv om
   kjernen (representasjon, poser, minne) og behold deler som binding og tekstur, eller start
   på nytt. Si hva som bør overleve en omskriving og hvorfor. Kostnaden av å kaste ting er
   reell. Tekstur-baken alene inneholder flere måneders lærdom om toner, sømmer og
   hvitbalanse.
2. **Én sannhet for overlegg og resultat.** Hvordan får vi live-visningen og den ferdige
   modellen til å komme fra samme representasjon og samme poser? Aktuelle grep er en
   inkrementell TSDF eller blokkvolum forankret til delkart, delkart som flyttes stivt når
   posegrafen løses, eller ARKit-ankere. Brukeren skal aldri se noe som er «dekket» og som
   så forsvinner.
3. **Delkart og posegraf på enheten.** Hvordan deler vi huset i stive blokker med lokal
   binding, loop closure og global løsning, slik at minnet er begrenset og etasjene stemmer?
   Hvordan håndteres trapper og overgangen mellom etasjer?
4. **Minne og krasj.** Hvordan blir minnebruken uavhengig av husets størrelse? Strømming til
   disk, ett delkart i minnet om gangen og baking bak brukeren er stikkord. Vis hvor dagens
   kode kan krasje på et stort hus.
5. **Hull og enkeltsidige vegger.** Hva gjør vi med flater som bare er sett fra én side? Her
   hører veiledning under opptak hjemme, i tillegg til hva rekonstruksjonen kan gjøre selv.
   Finn også hvorfor 13 % av det LiDAR så forsvinner.
6. **Målemetode.** Måleskriptene våre har pekt feil vei flere ganger, senest 26.10 da en
   låst veggvinkel overdrev tapet. Foreslå et regresjonssett med faste fixturer og mål som
   først er vist å skille bilder Tormod allerede har rangert med øyet. Ingen endring er
   ferdig før den er sett på telefonen.

## Lever
- **Anbefaling:** videreutvikle, delvis omskriving eller fra bunnen, med begrunnelse og hva
  som beholdes.
- **Målarkitektur:** representasjon, poser, minne, live og bake.
- **Plan i milepæler.** Hver milepæl skal kunne testes på telefonen med en konkret test
  Tormod selv kan gjøre, for eksempel «skann tre rom og gå tilbake: ingen striper kommer
  tilbake». Trapp og to etasjer skal tidlig inn i planen.
- **Risikoer og åpne spørsmål**, særlig rundt hva iPhone 13 Pro tåler: GPU i bakgrunnen,
  varme og lagring.

## Praktisk
- **Bygg til telefon:**
  `xcodebuild -workspace ios/Ampex.xcworkspace -scheme Ampex -configuration Release
  -destination 'generic/platform=iOS' -allowProvisioningUpdates -derivedDataPath
  ~/Library/Developer/Xcode/DerivedData/Ampex-device build`
- **Installer:** `xcrun devicectl device install app --device <UDID> …/Release-iphoneos/Ampex.app`
- **Ombygging av gammelt skann på telefonen:** `xcrun devicectl device process launch --device
  <UDID> --terminate-existing no.ampex.app -- -meshscan.autorebake <bundle>`. Telefonen må
  være låst opp. Resultatet ligger i `Documents/scan-frames/<bundle>/rebake-harness-*.glb`, og
  loggen i `Documents/room-scans/pipeline.log`.
- **Ikke simulator,** og spør før tunge Xcode-bygg. Viftene går amok.
- **Commit bare når Tormod ber om det.** Mye skannkode er ukommittert, så sjekk `git status`.
- **Skriv til Tormod på vanlig norsk,** i hele setninger, ikke tabeller og punktlister i hver
  melding. Han vil ha ærlige svar, også når svaret er at noe ikke virket.

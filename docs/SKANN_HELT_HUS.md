# Skann: helt hus (plan, 22. oktober 2026)

**Status:** plan, ikke kodet. Idemyldret med Tormod 22.10. Ingen Swift-endring før vi er
enige om rekkefølgen.

## Hvorfor

Glenn (Aqila) skanner hele hus i Polycam og bruker det til å finne borevinkelen gjennom
gulvet. Det ser ikke bra ut, men det går. Hos oss går det ikke: skannet 22.10 av ett rom på
6,8 × 7,8 m traff allerede tre av takene våre. For borevinkelen er det ikke skarpheten som
teller, men at etasjene ligger riktig oppå hverandre.

Krav fra Tormod:
- Et helt hus skal kunne skannes, i god kvalitet uansett størrelse.
- Rådata kan godt være 10–20 GB. De er stillas, og slettes når 3D-fila er laget.
- Opptaket skal ikke strupes.
- Ventetid etter Ferdig: 5 minutter er grensen for et hus. Målet er rundt 1 minutt.

### Hard regel (Tormod, 25.10)

**Et skann kan være så stort og langt du vil, og kvaliteten per rom skal aldri synke med
størrelsen.** Bare ventetid og lagring får vokse, og ventetiden helst ikke heller (baken går
bak deg). Ved varme pauses baken; opptaket blir aldri dårligere.

Steder der kvaliteten synker med størrelsen i dag, også etter steg 1:
- Bindingen hoppes over over 450 bilder (`meshscan.bbmaks`) → ingen binding og ingen
  AR-relokalisering for nettopp de store skannene. Løses med binding per delkart (steg 2).
- Baken velger 120–160 bilder for HELE skannet → må bli budsjett per delkart/rom.
- Opptaket stopper ved 20 GB (`meshscan.rabudsjett`) → bør følge ledig plass, med varsel
  i god tid, ikke et fast tak.

## Hva som stopper oss i dag (målt på skannet 22.10)

1. **Dybdeopptaket tynnes.** `denseMax = 600`, og frekvensen halveres når taket nås, ned til
   1/16. Et kvarters husskann får nesten ingen dybde fra de siste rommene.
2. **Bildetaket.** `maxKeyframes = 600`. I minnet koster et bilde bare ~12 kB (`KFCam`), så
   minnet er ikke grunnen.
3. **Baken velger 120–160 bilder for HELE skannet.** Det holder for ett rom, men i et hus
   blir det 15 per rom.
4. **Dekningsfeltet står fast der du startet.** Det var 9,6 × 9,6 m rundt startpunktet; den
   fjerne veggen i rommet lå utenfor, og stripene der kunne aldri forsvinne. Utvidet til
   12 × 12 m (ukommittert), men et hus trenger et felt som følger med deg.
5. **Tak som aldri er skannet varsles ikke.** «Pek mot taket» ser bare på tak som finnes i
   meshen. 22.10 manglet rundt 60 % av taket i geometrien, og appen sa ingenting.
6. **Ingen loop closure i appen.** Den finnes bare som prototyp (`tools/scan-loop-closure.py`).
   Driftrettingen 22.10 flyttet bilder opptil 14 cm, med 26 hopp fra ARKit.
7. **Uskarpe bilder.** Median skarphet var 133 mot 259 i det gode skannet. Bildene velges
   i sanntid, og en dårlig ramme kan ikke byttes ut etterpå.

## Prinsipp: skann nå, tenk etterpå, og bygg verden bak deg

Som spill med for svak maskinvare (GTA): ingen del av kjeden har hele huset i minnet.
Opptaket strømmer til disk, rommene du har forlatt bakes mens du skanner neste, og visningen
laster rommet du står i i full kvalitet og resten grovt.

## Pipelinen

### 1. Opptak: nesten ingen regning
- **4K-video med HEVC-koderen** (egen brikke, nesten ingen strøm eller varme) i stedet for
  JPEG-nøkkelbilder valgt i sanntid. Baken velger de beste bildene etterpå blant 30 per
  sekund. Det er den største enkeltgevinsten i kvalitet.
- **All LiDAR-dybde** (256 × 192, 60 Hz) komprimert til disk, med konfidens og ARKit-pose.
- **Lagringsvakt i stedet for tellertak:** stopp når et budsjett (standard 20 GB) er brukt
  eller ledig plass går under 3 GB. (Påbegynt i `MeshScanPresenter.swift`, se nederst.)
- **ARKits flateklassifisering** (vegg/gulv/tak/dør/vindu) brukes alt i baken. Den kan også
  brukes under skanning, til veiledningen.
- **HDR-video** (`videoHDRAllowed`) er verdt en A/B mot de utbrente lampene i taket.

### 2. Forhåndsvisning som strømmer
- Dekningsfeltet blir et vindu som følger kameraet (ringbuffer: når du går, skrives raden
  som forsvinner bak til disk, og den foran lastes inn). Sampling med `address::repeat` gir
  ringadressering nesten gratis i shaderen.
- CPU-dekningen sjekker i dag hver ny celle mot ALLE kameraer. Med tusenvis av bilder må
  kameraene bøttes etter sted, så en celle bare testes mot kameraer innen 3,5 m.
- **Veiledning for det som ikke finnes:** sammenlign gulvflaten du har gått på med takflaten
  over den. Tak som mangler over gulv er et hull, og appen sier «pek mot taket her».

### 3. Delkart (stive blokker)
- Opptaket deles i delkart: ett per rom, eller per ~30 sekunder. Hvert delkart har sin egen
  lokale modell.
- Delkart bindes sammen der du har vært to ganger: SIFT-matching (har vi), deretter
  flate-mot-flate-tilpasning, og en samlet løsning til slutt. Trappa binder etasjene.
- **Loop closure flytter hele delkart, aldri innholdet.** En bakt blokk som flyttes er en
  matrise, ikke en ny bake. Bare skjøtene mellom blokkene må pusses.
- Forbilder: InfiniTAM v3 (delkart og loop closure), RTAB-Map (kjører på iPhone).

### 4. Baken går bak deg
- Når du forlater et rom, bakes delkartet i bakgrunnen mens du skanner det neste: geometri,
  bildevalg og maling. Pause ved `thermalState` serious.
- Ved Ferdig gjenstår bare: siste rom (~30 s), loop closure for hele huset (10–20 s), skjøter
  og husfila (~20 s). **Rundt 1–1,5 min uansett husets størrelse** (anslag fra målingene 22.10
  på iPhone 13 Pro).
- Hvis ventetiden blir lang uansett: `BGContinuedProcessingTask` (iOS 26) lar jobben gå
  videre med fremdrift på låseskjermen. Det er rapportert at den går 4–5× tregere i
  bakgrunnen, muligens uten GPU, så den er nødutgang og ikke plan A.

### 5. Raskere bake per rom
Målt 22.10, ett rom, 45 s: binding 11 s, geometri 7 s, poseRefine 3,5 s, xatlas 8 s,
vinnervalg og sømmer 6 s, maling 25 s.
- **Vegger trenger ikke xatlas.** De er plan; teksturen kan legges ortografisk rett på
  planet. Bare møbler og rot trenger generell utbretting. Det sparer det meste av 8 s.
- **Vegger som noen få store trekanter.** Detalj bare der geometrien har detalj. Alt
  nedstrøms (UV, vinnervalg, maling) går fortere.
- **Færre, bedre bilder.** Malingen skalerer med antall syn. Med video: 30–40 av de
  skarpeste og mest rett-på-bildene per rom i stedet for 160 middels.
- **Hele brikka samtidig.** GPU maler rom N mens CPU bygger geometri for rom N+1 og Neural
  Engine jobber med dybde og trekk.

### 6. Neural Engine: helt ubrukt i dag
- **Prompt Depth Anything** (CVPR 2025) bruker nettopp iPhone-LiDAR som «hint» for å gi
  metrisk dybde i full bildeoppløsning, langt bedre enn ARKits 256 × 192. Det kan erstatte
  dagens dybdeforbedring (JBU ×3) og gi skarpere kanter på lister, karmer og bokser. Må
  måles: kjøretid på telefonen, og om den gjør det bedre enn JBU på fixturene våre.
- **Lærte trekk og matching** (SuperPoint/LightGlue-klassen) som erstatning eller tillegg
  til SIFT i bindingen og relokaliseringen. Usikkert hva det gir mot SIFT på GPU; måles
  først.
- **Fjerning av glans og lampegjenskinn** før blanding (det finnes iPhone-implementasjoner
  på Metal). Lampestjernene i taket 22.10 er det synlige symptomet.
- Metal 4 kan kjøre små nett direkte i shaderne (Shader ML), uten egen ANE-runde.

### 7. Resultatet: én husfil med detaljnivå
- Grov versjon av hele huset alltid lastet (mål ~30 MB), rommene i full oppløsning som egne
  fliser som lastes når du står i dem. Standard glTF med meshopt-komprimering og
  KTX2/ASTC-teksturer (samme oppskrift som 3D Tiles bruker for byer).
- Rådata slettes når fila er laget og åpnet uten feil.

## Rekkefølge

Hvert steg skal kunne vises på telefonen før neste begynner.

1. **Opptak uten tak + strømmende dekning + tak-veiledning.** Etter dette kan et helt hus
   skannes og vises, selv om det er mykt. Mål: skann en leilighet uten at opptaket stopper.
2. **Delkart og bake bak deg.** Mål: ventetid etter Ferdig under 2 min for 5+ rom.
3. **Loop closure mellom delkart** (port av prototypen). Mål: to etasjer, mål gjennom
   gulvet mot tommestokk. Det er Glenns bruk.
4. **Video i stedet for nøkkelbilder.** Mål: median skarphet over 250 på samme rom.
5. **Plane vegger uten xatlas + færre trekanter.** Mål: bake per rom under 25 s.
6. **Neural Engine:** Prompt Depth Anything først, mot JBU på de tre fixturene.
7. **Husfil med detaljnivå** og sletting av rådata.

Rekkefølgen 1–3 kommer først fordi det er det Glenn trenger. Kvalitet (4–6) kommer etter.

## Åpne spørsmål
- Får `BGContinuedProcessingTask` bruke GPU-en på iPhone 13 Pro? Testes før vi stoler på den.
- Hvor stor blir én etasje i rådata i praksis? Mål på første leilighetsskann.
- Glenns telefon: hvilken modell? Det avgjør hva «rask nok» betyr.

## Steg 1: kodet 22.10 kveld, IKKE testet på telefon

Typesjekket mot iOS-SDK-en (swiftc -typecheck), begge Metal-kildene kompilerer.
- **Lagringsvakt** (`MeshScanPresenter.swift`): `maxKeyframes` 20 000, `denseMax` 100 000,
  full 5 Hz dybde hele veien. Stopper ved 20 GB skrevet (`meshscan.rabudsjett`, GB) eller
  under 3 GB ledig. Logger `lagringsvakt — …` når den slår inn.
- **Dekningsfeltet følger kameraet** (`CoverageField.swift`, `CoverageMesh.metal` →
  `vendor/coverage.metallib`): ringbuffer 12 × 5 × 12 m på 5 cm, flyttes i blokker à 1 m
  (slakk 1 m vannrett, 0,3 m loddrett). Blokker som går ut skrives til
  `tmp/dekningsfelt/<økt>/x_y_z.bin` (bare de med innhold), og leses inn igjen når du går
  tilbake. Utenfor vinduet viser meshen striper. Logg: `dekningsfelt — vinduet flyttet N
  ganger`.
- **CPU-dekningen** hopper over kameraer lenger unna enn 3,5 m før projeksjonen.
- **Tak som mangler:** gulvruter (0,5 m) innen 5 m uten takruter over gir «pek mot
  taket» når hullet er ≥ 2 m².
- **Bindingen hoppes over over 450 bilder** (`meshscan.bbmaks`); den holder alle trekk i
  minnet og ville krasjet på et hus. Uten binding: ingen AR-relokalisering for det skannet.
  Riktig løsning er binding per delkart (steg 2).
- **Rådata:** forrige skann beholdes bare hvis det er under 3 GB.

**Test på telefonen:** skann to–tre rom i ett opptak og gå tilbake til der du startet.
Stripene skal forsvinne på alle vegger, og de skal ikke komme tilbake når du returnerer. Pek
bort fra taket i et rom: appen skal be om taket. Se i `pipeline.log` etter `lagringsvakt`,
`dekningsfelt` og `bildebinding: … hoppet over`.

## Ukommittert fra samme dag
- Alt i steg 1 over, pluss EFObasen-flagget (`lib/pricefile/varekort.ts`).

## Kilder
- Prompt Depth Anything, CVPR 2025: https://openaccess.thecvf.com/content/CVPR2025/html/Lin_Prompting_Depth_Anything_for_4K_Resolution_Accurate_Metric_Depth_Estimation_CVPR_2025_paper.html
- InfiniTAM v3: https://arxiv.org/pdf/1708.00783
- RTAB-Map på iPhone: https://apps.apple.com/us/app/rtab-map-3d-lidar-scanner/id1564774365
- BGContinuedProcessingTask tregere i bakgrunnen: https://developer.apple.com/forums/thread/807957
- Metal 4 og maskinlæring i shadere (WWDC25 262): https://nonstrict.eu/wwdcindex/wwdc2025/262/
- Glans- og skyggedeling på iPhone (Metal): https://diglib.eg.org/items/044f8560-b23d-47d4-9da1-147e7a577146/full
- ARKit videoformater (4K, HDR): https://developer.apple.com/documentation/arkit/arconfiguration.md
- ARMeshClassification: https://developer.apple.com/documentation/arkit/armeshclassification.md
- 3D Tiles: https://github.com/CesiumGS/3d-tiles/blob/main/specification
- RoomPlan-grense ved mange rom: https://developer.apple.com/forums/tags/arkit?page=3

## Første flerromsskann (26.10, f97d682a, 3 min, 390 bilder)
- **Bindingen holdt:** kryss-par 7,6 → 0,71 px, flytt median 24 mm, maks 66 mm. Posene er
  ikke problemet.
- **«Se gjennom veggen»:** overlegget er heldekkende og dobbeltsidig, så før ARKit hadde
  mesh på din side ble det malte rommet bak tegnet. I tillegg nådde normal-tappene ±10 cm
  og hentet malingen fra andre siden av en 10–15 cm innervegg. Rettet samme kveld i
  `CoverageMesh.metal`: fragment > 15 cm bak LiDAR-dybden i samme piksel blir striper
  (`meshscan.okkmargin`, 0 = av), og tappene vendes mot kameraet med bare ett steg bakover.
  Ikke testet på telefon ennå.
- **Stripene kommer tilbake når du snur deg:** `audit-scan-drift.py` viser at samme vegg
  ligger 8–12 cm annerledes ved andre besøk (4009 → 4125 mm ved 140 s). Feltet er malt i
  verdensrammen fra første besøk og følger ikke ARKits retting. Uløst; riktig grep er å
  forankre feltblokkene til ARKit-ankere som ARKit selv flytter.
- **Kvaliteten falt utover:** termikk 2 (serious) fra ~65 s, dekningspasset 5 → 29 ms,
  median skarphet 153 (godt skann 259), ti autofokus-dytt. Og baken brukte 120 bilder
  for alle rommene (punkt 3 over).

## Andre flerromsskann (26.10, f92f1be0) — hvorfor veggen blir gjennomsiktig
- **Skilleveggen har hull på begge sider.** I GLB-en dekker A-siden 51 % og B-siden 35 %
  av veggens 10 cm-ruter, og bare 25 % har begge. Der én side mangler ser man inn i rommet bak.
- **LiDAR SÅ mer enn nettet har:** B-siden ble sett i 61 % av rutene, men 33 % av veggen er
  sett og mangler likevel i nettet (A-siden 11 %). Det er geometrien som taper den.
- **Årsak (målt på rå poser):** veggens posisjon vandrer ±5 cm mellom besøk (B 1,28–1,38 m,
  A 1,43–1,52 m langs normalen). TSDF-trunkeringen er 6,4 cm foran OG bak, så B-sidens
  «bak flaten» når inn til A-flaten når posene spriker. Sidene sletter hverandre, og vekten
  splittes under minWeight → hull. Klassisk tynn-vegg-feil i TSDF.
- **Plan (ikke kodet):** retningsdelt TSDF (DTSDF, Splietker & Behnke 2019): fusjonen kjøres
  én gang per normalretning (±X, ±Y, ±Z), og bare dybdepiksler med normal i den retningen
  integreres. Motsatte sider av en vegg havner i hver sin fusjon og kan aldri slette
  hverandre. Samme minne (ett volum om gangen), ~6× fusjonstid (1,7 s → ~10 s).
- **Rettet samme kveld:** baken kuttet 50 av 170 regioner (tak 120 bilder) — nå beholdes
  alle; termikk tynner ikke lenger dybdekart (559 → 320), dropper ikke super-res og senker
  ikke budsjettet. Tormod: «aldri kvalitetstap … ingen throttling, bare mer tid».

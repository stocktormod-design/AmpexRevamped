# Scaniverse-eksporten under lupa — utdata-forensikk, 2026-10-27

Dette er en analyse av det som faktisk står i Scaniverse-eksporten
(`~/Downloads/Scaniverse 2026-09-06 123218.glb`, ett rom, iPhone LiDAR-modus), målt med de
samme verktøyene mot våre egne baker. Ingen dekompilering, bare fila. Tidligere funn står i
`SKANN_BESLUTNINGER.md` (§56 prosjektive felt, §69/§70 rand per m² og vegg-RMS, §72 sporkontrast,
§78/§79 samme rom og tonevariasjon 6,0 % mot 14,1 %). De gjentas ikke her, men bygges videre på.

Tre filer er målt:

- **SV** — Scaniverse-eksporten, soverommet (samme rom som soveromsbundelen 1788963302851, §78).
- **m0** — vår bake av et treromsskann, `AmpexFixtures/ampex-8f3b8017-…-1793056154058/m0-bake.glb`
  (TSDF 931k trekanter forenklet globalt til 248k, fire fliser à 4096).
- **bb6** — vår enkeltromsbake `AmpexFixtures/bb-ampex-0daef323-…-1789325852609/rebake-harness-bb6-1792443366915.glb`
  (ni fliser à 6144, uforenklet TSDF-nett).

Viktig forbehold gjennom hele dokumentet: ingen av våre to filer er av samme rom som SV.
Alt som handler om innhold (støy, toner) er derfor rom-mot-rom, ikke en ren A/B.

## Verktøy og kommandoer

Systempythonen har ikke cv2, så jeg brukte en venv i scratchpad (ingen systeminstallasjon):

```
python3 -m venv $S/venv && $S/venv/bin/pip install numpy opencv-python-headless
$S/venv/bin/python tools/audit-scan-scaniverse-forensikk.py <utmappe> <fil.glb>
$S/venv/bin/python tools/audit-scan-scaniverse-gitter-stoy.py <a.glb> [b.glb …]
```

`tools/audit-scan-scaniverse-forensikk.py` skriver `<navn>-forensikk.json` med glTF-skjelett,
JPEG-hoder, geometri (sveiset på 10 µm), trekantstørrelse mot dihedralvinkel, gitter-test,
doble flater, texel per meter per klasse (vegg/gulv/tak/annet), chart-statistikk, prosjektiv
tilpasning av opptil 400 største charts med kameradekomponering (K, R, kamerasenter), sømlengde,
fargesprang over sømmer mot en kontroll, og okkupasjon/padding per atlas. Den lagrer også
forhåndsvisning og okkupasjonsmaske per atlas, og `<navn>-kamera.json` med de gjenfunne kameraene.
`tools/audit-scan-scaniverse-gitter-stoy.py` måler flatfelt-støy på veggtekslene (i egen
oppløsning og nedskalert til felles 480 texel/m) og et kantbasert gittersøk. Kantsøket viste seg
upålitelig (R stiger mot største s for korte kanter) og er ikke brukt i konklusjonene; gittertallene
kommer fra posisjonssøket i `lattice()` med 0,05 mm steg. Andelen hjørner med 0/1/2/3 koordinater
på gitteret ble regnet med et kort skript inline med samme logikk.

## 1. glTF-JSON og koordinater

Hele JSON-delen av SV (uten binær) er så liten at den kan gjengis:

```json
{"asset": {"version": "2.0", "generator": "Scaniverse (https://scaniverse.com)"},
 "accessors": [
  {"bufferView": 1, "byteOffset": 0, "componentType": 5126, "count": 123862, "type": "VEC3",
   "min": [-2.5292, -0.0874, -3.0261], "max": [2.3962, 2.4732, 4.2523]},
  {"bufferView": 2, "byteOffset": 0, "componentType": 5126, "count": 123862, "type": "VEC2",
   "min": [0.00207, 0.00207], "max": [0.99784, 0.99778]},
  {"bufferView": 3, "byteOffset": 0, "componentType": 5125, "count": 569103, "type": "SCALAR",
   "min": [0], "max": [123861]}],
 "buffers": [{"byteLength": 12825548}],
 "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 8071896},
  {"buffer": 0, "byteOffset": 8071896, "byteLength": 1486344, "target": 34962},
  {"buffer": 0, "byteOffset": 9558240, "byteLength": 990896, "target": 34962},
  {"buffer": 0, "byteOffset": 10549136, "byteLength": 2276412, "target": 34963}],
 "images": [{"name": "texture.jpg", "bufferView": 0, "mimeType": "image/jpeg"}],
 "materials": [{"name": "main", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0}}],
 "meshes": [{"name": "mesh", "primitives": [{"mode": 4, "material": 0, "indices": 2,
   "attributes": {"POSITION": 0, "TEXCOORD_0": 1}}]}],
 "nodes": [{"name": "root", "children": [1]}, {"name": "mesh", "mesh": 0}],
 "samplers": [{}], "scenes": [{"nodes": [0]}], "textures": [{"source": 0, "sampler": 0}], "scene": 0}
```

Det er ingen `extensions`, `extensionsUsed`, `extras` eller egne felt — ingenting om kamera,
skala, georeferanse eller pipelineversjon. Ingen normaler (bevisst: rendereren regner dem
selv), én primitiv, ett materiale, `samplers: [{}]` (rendererens standardfilter), og
nodetransformene er identitet. Bildet heter `texture.jpg`.

Rammen er meter, Y opp. Det dominerende gulvplanet ligger på y = 0,018 m og taket på 2,388 m,
altså 2,37 m takhøyde — samme takhøyde som vi måler i våre filer (2,37 og 2,39 m), så skala og
enhet stemmer. Gulvnormalen avviker 0,13° fra +Y og taknormalen 0,19°: modellen er
gravitasjonsjustert, som ARKit-rammen alltid er. **Origo er flyttet ned til gulvet**: ARKit
legger origo der telefonen var ved start (våre gulv ligger på −1,46 og −1,56 m), mens SV har
gulvet i y ≈ 0. Horisontalt er rommet ikke sentrert og ikke vridd etter veggene — veggenes
asimut ligger på 36,5° modulo 90°, og bare 2,4 % av veggarealet står innenfor 2° av aksene.
Konklusjon: SV gjør en ren vertikal forskyvning til gulvnivå, ingen rotasjon. (At gitteret i
avsnitt 2 ligger langs eksportaksene, støtter at det ikke er rotert etter fusjonen.)

Våre filer har generator `Ampex ARMesh Tiled GLB Exporter`, normaler, ett materiale per flis,
sampler clamp + trilineær mip, og origo i ARKits startpunkt.

## 2. Geometri

| | SV | m0 (3 rom) | bb6 (1 rom) |
|---|---|---|---|
| trekanter / unike posisjoner | 189 701 / 103 404 | 248 394 / 133 290 | 248 872 / 127 025 |
| areal | 63,6 m² | 174,5 m² | 55,1 m² |
| grense m/m² | 3,70 | 3,50 | 3,21 |
| ikke-manifold kanter | 48 | 4 511 | 1 752 |
| areal med parallell flate 5–60 mm unna | 1,1 % | 4,2 % | 1,3 % |
| største komponent | 99,6 % | 95,7 % | 95,8 % |
| valens 6 | 30 % | 49 % | 80 % |

**Gitter: SV er bygget på et 16,4 mm voxelgitter.** Grovsøket (0,5 mm steg) bommet først fordi
toppen er smal; med 0,05 mm steg gir hjørneposisjonene en tydelig periodisitet på 16,40 mm langs
alle tre eksportaksene (konsentrasjon R = 0,51 / 0,43 / 0,51 mot ~0,003 for tilfeldige punkt).
54 % av hjørnene har minst én koordinat innenfor ±0,3 mm av et gitterplan, mot ~11 % ved
tilfeldighet. Positiv kontroll: våre filer gir 20,0 mm, som er nøyaktig `voxel = 0.020` i
`MeshTsdfBuild.swift` — testen finner altså riktig voxel når den er kjent. Mønsteret i SV er for
det meste ÉN koordinat på gitteret (42 %) og sjeldnere to (11,5 %); klassisk marching cubes
ville gitt to. Hvilken flateekstraksjon de bruker kan derfor ikke slås fast, bare at
voxelstørrelsen er 16,4 mm, at gitteret er akselinjert med eksportrammen, og — slutning — at
forenklingen beholder opprinnelige hjørneposisjoner (halvkant-kollaps eller tilsvarende), for en
QEM med optimal plassering ville vasket gitteret bort.

**Krumningsstyrt forenkling: ja, men moderat.** I SV krymper trekantene der flaten bøyer seg.
Trekanter der største dihedralvinkel mot naboene er under 1° har median 4,3 cm² (lengste kant
5,5 cm); 5–20° gir 1,5 cm² og over 60° gir 1,0 cm². På de store planene (vegg/gulv/tak) er
arealvektet median lengste kant 10,9 cm, resten 3,4 cm. Et 16,4 mm-gitter gir omtrent 1–1,3 cm²
per trekant før forenkling, så kantene står nær full oppløsning mens flatene er forenklet
grovt regnet tre-fire ganger (slutning fra tallene, ikke målt direkte). Veggene er IKKE
plan-snappet: RMS-avvik fra planet i de åtte største veggbinnene er 5–28 mm (jf. 30,1 mm i §70).
Valensfordelingen (30 % sekser, bredt rundt) er typisk for et forenklet nett.

Våre to står i hver sin ende. m0 har kollapset planene til store trekanter (lengste kant median
28,7 cm på plan, 8,7 cm ellers) mens alt som bøyer seg står på rå 2 cm-oppløsning (2,8 cm
lengste kant i alle dihedralbinner). bb6 er uforenklet (80 % valens 6, 2,9 cm kant overalt) og
plan-snappet (RMS 0,0–6,4 mm). Våre nett har 35–90 ganger så mange ikke-manifolde kanter som SV,
og m0 har fire ganger så mye areal med en nesten parallell flate 5–60 mm unna (4,2 % mot 1,1 %),
halvparten med motsatt normal — tegn på doble skall fra fletting av flere rom.

## 3. Tekstur

**Atlas og format.** SV har ett 8192² JPEG (8,07 MB), baseline, 4:2:0, estimert IJG-kvalitet 96
(DC-kvantisering 1). Markørrekkefølgen JFIF → Exif → «Photoshop 3.0» → DQT → DRI er identisk med
våre filer, som skrives med Apples ImageIO; slutning: SV koder også med ImageIO. Våre ligger på
kvalitet ~94. Formatet er ikke forskjellen.

**SV er per-flate-visningsvalg med prosjektive felt — og hver chart er et utsnitt av ett
kamerabilde.** Prosjektiv tilpasning ble kjørt på de 400 største chartene (95 % av arealet):
99,96 % av det testede arealet passer én 3×4-kameramatrise med p90-feil under 0,5 atlaspiksel
(median p90 0,0003 px), mens affin tilpasning bare klarer 1,9 %. Dette utvider §56 fra 12 til 400
charts. Det nye er dekomponeringen av matrisene i K·[R|t]:

- Fokallengden i atlaspiksler er den SAMME for alle charts: fx = 1112 / 1116 / 1125 (p10/p50/p90),
  fx/fy = 1,000, skjevhet ~0. Hver chart er altså et uniformt skalert pinhole-bilde, med én global
  skala for hele atlaset.
- Chartenes piksler ligger, uttrykt i normaliserte bildekoordinater, innenfor
  x ∈ [−0,673; 0,666] og y ∈ [−0,502; 0,500]. Det er en 4:3-ramme med hovedpunkt i midten —
  nøyaktig iPhonens vidvinkel i ARKits 4:3-format. Ingen chart har en eneste piksel utenfor
  rammen. Bildeaksen x står loddrett (telefonen holdt stående).
- 348 charts lar seg dekomponere stabilt; de faller på 139 distinkte kamerastillinger (5 cm, 2°),
  i snitt 2,5 charts per kamera. Kamerasentrene ligger 0,95–1,73 m over gulvet (p10–p90), median
  avstand til flaten 2,2 m.
- Teksteltettheten er dermed ikke et mål de styrer mot, men fx delt på avstand: 1115/2,2 m ≈ 500,
  målt median 472 texel/m (vegg 480, gulv 564, tak 452).

Om pikslene inne i en chart er ett rått foto eller en blanding som er resamplet inn i det fotoets
geometri, kan ikke avgjøres fra fila. Visuelt ser chartene ut som enkeltfoto (en myk lampeglans
ligger igjen midt i en veggchart, se `crop1.png` i analysemappa), men det er ikke bevis.

Våre baker gjør det samme. m0: 95 % av testarealet er prosjektivt, fx 752 for alle charts, 144
distinkte kameraer; bb6: fx 2798, men bare 48 % av testarealet passer innen 0,5 px (median p90
0,46 px) — slutning: bb6 har en ikke-rigid korreksjon oppå projeksjonen. Rammen vår er en annen:
x ∈ [−0,70; 0,70] og y ∈ [−0,40; 0,40], altså 16:9. Med telefonen stående gir det 70° loddrett
og 44° vannrett synsfelt, mot SVs 67° og 53°. Hvert av våre bilder dekker rundt 16 % mindre
romvinkel, og 25 % smalere vannrett.

**Charts og sømmer.** Her er den største strukturforskjellen:

| | SV | m0 | bb6 |
|---|---|---|---|
| charts / per m² | 2 902 / 45,6 | 5 446 / 31,2 | 2 563 / 46,6 |
| arealvektet median chartstørrelse | **0,45 m²** | 0,15 m² | 0,12 m² |
| charts som dekker 50 % av arealet, per m² | **0,53** | 1,96 | 2,52 |
| største chart | 2,79 m² | 0,97 m² | 0,50 m² |
| sømlengde, vegg | **3,8 m/m²** | 6,2 | 8,7 |
| sømlengde, tak | **2,6 m/m²** | 8,5 | 13,2 |
| sømlengde, gulv | 4,5 m/m² | 7,5 | 9,6 |

Antall charts per m² er det samme (SV har mange bittesmå charts på møbler — median chart er tre
trekanter), men arealet SV dekker med hver chart på de store flatene er tre-fire ganger større, og
taket har tre til fem ganger kortere sømmer.

**Fargesprang over sømmer.** Målt som |ln(L_a/L_b)| i gråtone, med ett punkt to texler inn i hver
av de to trekantene på hver side av en kant, og det samme på kanter som IKKE er søm som kontroll:

| median \|ln\| (p90) | SV | m0 | bb6 |
|---|---|---|---|
| vegg, søm | 0,0088 (0,064) | 0,027 (0,25) | 0,021 (0,13) |
| vegg, kontroll | 0,0071 (0,045) | 0,024 (0,23) | 0,021 (0,11) |
| tak, søm | 0,0073 (0,035) | 0,014 (0,050) | 0,013 (0,040) |
| tak, kontroll | 0,0065 (0,031) | 0,015 (0,047) | 0,015 (0,044) |
| snitt per chartpar (alle flater) | 0,017 | 0,035 | 0,007 |

Ingen av de tre har nevneverdig sprang i sømmen ut over kontrollen (forhold søm/kontroll 1,2 hos
SV, 1,1 og 1,0 hos oss), og forholdet endrer seg ikke systematisk når innrykket økes fra 1 til 32
texler. Det finnes altså ingen smal Poisson-stripe å se hos SV; tonene er avstemt chart mot chart,
og bb6 er like godt avstemt som SV. Sømmene er ikke det som skiller. Det som skiller, er at
KONTROLLEN — variasjonen mellom to nabopunkt inne i samme bilde — er tre ganger høyere hos oss.

**Støy i flatfelt.** Residual mot gaussglattet bilde (σ = 2 px) i de 25 % roligste
veggtekslene, robust standardavvik i gråverdier:

| | texel/m vegg | egen oppløsning | ved 480 texel/m |
|---|---|---|---|
| SV | 462 | **0,74** | 0,74 |
| bb6 | 1088–1747 | 1,7–2,3 | **1,1–1,5** |
| m0 | 261–414 | 2,5–3,0 | 2,5–3,0 |

Selv etter nedskalering til samme tetthet bærer bb6 1,5–2 ganger SVs flatfeltstøy, og m0 3,5–4
ganger. Forbehold: ulike rom og ulike flater (m0 har trepanel), så dette er ikke en ren A/B. Mulige
årsaker vi selv har valgt: eksponeringstaket fra §73 (8 ms lukker, betalt med ISO) og at m0 er
nedskalert ~3,6× fra kilden (fx 752 mot kildens ~2740). Bakekoden har mipmaps på kildebildet
(`trengerMip` i `MeshBakeV2.swift`), men om de var aktive i m0 er ikke sjekket. SVs atlas er bare
~0,77× av et 1920×1440-bilde hvis det er kilden (slutning: fx_kilde ≈ 960/0,667 ≈ 1440).

**Atlasutnyttelse og padding.** SV bruker bare 30,6 % av atlaset. Pakkingen er hyllepakking
(rader sortert etter høyde, store charts øverst, enkelttrekanter i rutenett nederst) og de nederste
~16 % av atlaset står tomme. Kombinert med den faste fx er dette et sterkt tegn på at skalaen er
fast og ikke tilpasset for å fylle atlaset (slutning). Bakgrunnen er grå (76,76,76). Chartene er
utvidet med kantfarger 16 px ut (94 % fargede piksler i ring 1–12 px, 81 % ved 16 px, 0,2 % ved 24
px); minste avstand mellom charts er p1 19 px, p10 39 px. Våre fliser har samme ~16 px utfylling
på hvit bakgrunn og 19–57 % okkupasjon per flis.

## 4. Det samme på våre filer, kort oppsummert

m0 og bb6 er bygget etter samme hovedoppskrift som SV — TSDF-gitter, per-flate-valg av ett
kamera, prosjektive charts med fast skala, ~16 px utfylling, ImageIO-JPEG. Forskjellene ligger i
detaljene: 2,0 cm mot 1,64 cm voxel, plan-snapping og planforenkling mot krumningsstyrt forenkling
uten snapping, 16:9 mot 4:3 kilderamme, tre-fire ganger mindre charts på store flater, og mer
høyfrekvent variasjon i tekslene. Treromsbaken har i tillegg 334 texel/m på vegg (lavere enn SVs
480, fordi 174 m² deler 67 M texler) og fire ganger SVs andel doble flater.

## 5. Rangerte forskjeller som kan forklare at SV ser jevnere ut

1. **Mindre høyfrekvent støy i tekslene.** Flatfeltstøy 0,74 gråverdier mot 1,1–1,5 (bb6 ved
   samme tetthet) og 2,5–3,0 (m0), og nabopunktvariasjonen inne i bilder er tre ganger høyere hos
   oss. Øyet leser dette som kornete/«rotete» flate. Forbehold: ulike rom. For oss betyr det:
   mål støyen på flatfelt i kildebildene før og etter §73-taket, og sjekk at nedskaleringen i m0
   faktisk går via mip. Hvis ISO er hovedkilden, er flerbildesnitt på plane flater (som vi har
   for toner) det naturlige motgrepet for detaljlaget også.
2. **Større charts på store flater, dermed færre bildebytter.** Arealvektet median 0,45 m² mot
   0,12–0,15 m², og takets sømlengde 2,6 mot 8,5–13,2 m/m². Hver bytte er et sted der to bilder
   med ulik skarphet, støy og lys møtes, selv når middeltonen er avstemt. Implikasjon: vinnervalget
   bør belønne å beholde samme kamera over store plan sterkere (lavere bytteenergi på plan).
3. **4:3-kilderamme mot vår 16:9.** SV får 53° vannrett synsfelt mot våre 44°, og 16 % mer
   romvinkel per bilde. Det gjør det lettere å dekke en hel vegg- eller takflate fra ett bilde
   og bidrar sannsynligvis til punkt 2 (slutning). Implikasjon: vurder 4:3-formatet for fotoene
   når det er mulig, eller se om 16:9 er et bevisst valg som koster mer enn det gir.
4. **Rommets lys normaliseres bort** (§79: 6,0 % mot 14,1 % lavfrekvent tonevariasjon på samme
   vegg). Ikke målt på nytt her; står fortsatt som det største kjente toneavviket.
5. **Ren geometri uten doble skall.** SV har 48 ikke-manifolde kanter og 1,1 % parallelle flater;
   m0 har 4 511 og 4,2 %. Doble skall kan gi flimmer og feil chart på flater som skal være én
   (slutning). Gjelder særlig treromsflettingen.

Det som IKKE forklarer forskjellen, målt: sømmenes tonesprang (vi er på SVs nivå, bb6 bedre),
teksteltetthet (enkeltrom 1438 mot 472 texel/m), JPEG-kvalitet, padding, og plan-snapping (SV har
bølgete vegger og ser likevel jevn ut). Det som ikke kan avgjøres fra fila: om pikslene i en
chart er ett rått foto eller en blanding, hvilken flateekstraksjon som brukes (ikke ren marching
cubes-signatur), og hva kildeoppløsningen deres faktisk er.

Analysemappe med JSON, atlasforhåndsvisninger, okkupasjonsmasker og kamerafiler:
`/private/tmp/claude-501/-Users-tormodholand-Documents-AmpexRevamp/57804c3f-5b25-4b09-9ffd-082293568713/scratchpad/{sv,m0,bb6}/`
(midlertidig; kjør skriptene på nytt for å gjenskape).

# Skann: videre, omskriving eller fra bunnen? (vurdering 26. oktober 2026)

**Status:** vurdering, ikke kode. Skrevet etter å ha lest hele `modules/ampex-splat/ios/`,
beslutningsloggen §1–§114, `SKANN_HELT_HUS.md`, `SKANN_POLYCAM.md`, de eldre planene og
målingene fra 26.10. Ingen Swift er endret. Det eneste som er laget er ett måleskript
(`tools/audit-scan-sett-tapt.py`), fordi spørsmålet «hvor blir 13 % av det LiDAR så av?»
lot seg svare med data i stedet for gjetning.

Premisset står: ingenting er godt nok ennå, heller ikke ett rom. Vurderingen under handler om
hva som må til for at kravene i `PROMPT_FABLE_SKANN.md` skal kunne nås i det hele tatt, og
hva som bør overleve veien dit.

---

## Dommen

**Skriv om kjernen, behold organene.** Dagens kjede er en ettroms-batch: alt samles under
skanning, og ved «Ferdig» kjøres én global binding, én TSDF over hele boksen, én
driftretting over hele tidsrekka og én bake med ett atlasbudsjett. Hus-arbeidet siden 22.10
har fjernet tak (600 bilder, 600 dybdekart, 120 regioner, dekningsfeltet som sto fast), og
hvert tak som er fjernet har gitt et nytt sted der kvaliteten synker med størrelsen. Det
konvergerer ikke, fordi problemet ikke er takene, men at alle budsjetter og alle poser er
globale. Samtidig er delene som gjør selve arbeidet gode og tar avgrensede innganger:
fusjonskjernen, surface nets, bindingen, SIFT, texel-blandingen, relokaliseringen og
opptaksdisiplinen antar ikke ett rom; det gjør bare orkestreringen rundt dem. Å kaste dem
ville betydd å betale §59–§106 en gang til.

Det som skrives om er representasjonen (ett volum → delkart), posene (én global løsning →
lokal løsning per delkart og posegraf mellom dem), minnet (alt ved Ferdig → ett delkart om
gangen), og forholdet mellom live-visning og resultat (to modeller → én). Det er anslagsvis
tre–fire tusen nye linjer og fire–fem tusen som kan slettes. Ikke en ny app.

Ærlig forbehold: dette løser **ikke** i seg selv det Tormod misliker ved ett rom (svarte hull
rundt stol og pult, sprekker i taket, utvasket detalj). Det er opptaksdekning og fusjon av
tynne ting, ikke arkitektur. Men med delkart koster hver slik forbedring det samme uansett
husets størrelse, og det er grunnen til at arkitekturen må først.

---

## Hvorfor ikke «behold og utvid»

Konkrete steder i koden der kvaliteten per rom synker fordi skannet er stort. Alle er
strukturelle, ikke knotter:

1. **Forenklingen er global.** `MeshBakeV2.bake` setter `simplify = 250 000` for alt over
   300 000 trekanter. Ett rom gir 291 000 ved 20 mm. Et hus på 1,5 millioner kuttes til
   250 000, altså seks ganger grovere per rom enn ett rom alene.
2. **Atlaset er globalt.** Maks 4×4 fliser à maks 8192 for hele skannet. Ett rom (~50 m²
   flate) får ~2300 texler per meter; fem rom får ~1000, som er grensen overlegget selv
   bruker for «godt nok» (1000 px/m for et 2 mm panelspor).
3. **Volumet er globalt.** Tett TSDF: 40 M voxler over hele boksen, voxelen vokser 1,25×
   til det passer. Sparsomt (`meshscan.sparse`, opt-in): 64 M plasser, samme mekanisme.
   Et hus bakes grovere enn et rom.
4. **Bindingen hoppes over** over 450 bilder (`meshscan.bbmaks`): akkurat de store skannene
   mister binding og AR.
5. **Driftrettingen er global.** Maks 20 cm korreksjon per kart (over det = «feil plan»),
   og planklynging over hele huset med 12–15 cm terskel: parallelle vegger i andre rom
   havner i samme klynge. Den virker i ett rom og vil feile i et hus.
6. **Minnet skalerer med huset**, ikke med rommet:
   - `loadKeyframesJBU` holder alle oppskalerte dybdekart i minnet: 768×576×4 B ≈ 1,8 MB
     per nøkkelbilde. 450 bilder er 0,8 GB; 2000 er 3,5 GB. Krasj.
   - `MeshPoseRefineV2.refine` laster luma på 960 px som Float for alle bilder i baken
     (~2 MB hver). Med `selectCoverageAware` som nå beholder alle regioner er antallet
     ubegrenset. Krasj.
   - texel-blandingen går gjennom alle trekanter for hvert bilde (`members`) og dekoder alle
     4K-bilder på nytt for hver flis. Med 16 fliser og 800 bilder er det minutter bare i
     dekoding, og trekantløkka er 10⁹ per flis.
   - vieweren laster alle fliser som fulle teksturer: 4 × 8192² RGBA er 1 GB GPU-minne,
     16 er 4 GB. Huset vises aldri.
7. **Overlegget og resultatet er to modeller av verden.** Dekningsfeltet males i
   verdensrommet med ARKits live-poser. Resultatet bygges etterpå av andre poser
   (driftretting + binding) og med en annen vektregel. Normal-tappene (±10 cm), okklusjonen
   mot LiDAR og ringbufferet på disk (22.10, utestet) er symptombehandling av at de to
   aldri kan bli enige.

## Hvorfor ikke fra bunnen

Disse tar avgrensede innganger og gir avgrensede utganger, og de er målt:

- `ampex_fuse` + `Blokkvolum` + `surfaceNetsRå` + `etterbehandle` (geometri): samme kjerne
  tett og sparsomt, verifisert mot numpy-referanse, Surface Nets med halvvoxel-feilen rettet.
- `driftrett` (plan-RANSAC, dempet translasjon, glatting langs tida): riktig for et vindu på
  30–60 s, som er et delkart.
- `MeshSift` + `MeshBildebinding`: identisk med OpenCV, 0,5–0,7 px holdt ute, 3–9 s per rom.
- `MeshBakeV2.texelBlend` + gain-solve + tone-bånd + stripevis lesing: måneder med tone,
  sømmer og hvitbalanse. Det eneste som må ut er budsjettstigen, som blir en konstant per
  delkart.
- `MeshRelok` + `MeshArPresenter`: kart per modell, blir kart per delkart.
- Opptaket: AE/AWB-lås, eksponeringstak, erstatningsbuffer per bøtte, luma til disk, SIFT
  under skanning, lagringsvakt. Alt dette strømmer allerede til disk og er husklart.

---

## Funn i dag: hvor går de 13 % «sett, men tapt»?

`tools/audit-scan-sett-tapt.py` replikerer filtrene i `MeshTsdfBuild` (fart-tillit,
kantfilter, z-grenser, vektterskel) på rådybden i `f92f1be0`, finner skilleveggen selv (to
motsatte plan 9 cm fra hverandre) og teller per 10 cm-rute hva som er sett og hva som
ville fått nok vekt. Modellen lander på samme nivå som §114 (26 % av sette ruter tapt på
A-siden, 38 % på B-siden; per 2 cm-undercelle 8 % og 18 %, mot §114s 15 % og 21 %).

Det avgjørende er hva som **ikke** flytter tallet:

| arm | A | B |
|---|---|---|
| som i baken (fart + kant, terskel 2,5) | 26 % | 38 % |
| uten fartsfilter | 25 % | 34 % |
| uten kantfilter | 25 % | 37 % |
| uten begge | 23 % | 33 % |
| terskel 1,5 i stedet for 2,5 | 25 % | 34 % |

Filtrene og terskelen er verdt 1–5 prosentpoeng. Det som skiller tapte ruter fra
overlevende er hvor mye de ble sett: tapte ruter har median **33–70 rå piksler** gjennom
hele skannet, overlevende har **1200–1600**. Begge fra ~2 m. «Sett» i §114s målestokk betyr
altså «streifet av LiDAR i én–to rammer mens du gikk forbi». Ingen rimelig TSDF lager flate
av det, og §69 viste hva som skjer når terskelen senkes nok til at den gjør det (driftskall
foran ekte flater).

Konklusjonen er todelt. For det første: de 13 % er ikke en fusjonsfeil som kan fikses i
`MeshTsdfBuild`; det er opptak, og veiledningen må be om det. For det andre, og viktigere
for krav 4: overlegget må bruke **fusjonens** vektregel som sin dekningsregel. I dag teller
dekningsfeltet q·cos²·oppløsning mot S₀ = 12 og terskel 0,40, mens fusjonen teller
1,5/z·tillit mot 2,5. To regler kan ikke være enige. Med delkart blir de én regel av
konstruksjon (under).

Forbehold: modellen bruker rå poser, ±6 cm bånd om planet og «halve ruta må ha W ≥ terskel»
som proxy for at Surface Nets gir flate. Tallene er en grense, ikke et fasitsvar, men
rangeringen mellom armene er robust (den holdt med og uten nøkkelbildenes dybdekart).

---

## Målarkitektur

### Representasjon: delkart

Et **delkart** er et sparsomt 8³-blokk-TSDF (dagens `Blokkvolum` og `ampex_fuse`) på 1–2 cm
i sitt eget koordinatsystem, med en utstrekning på maks ~12 × 5 × 12 m. Det lukkes når det
første av dette skjer: kameraet går ut av utstrekningen, 45 s, 120 nøkkelbilder eller 600
dybdekart. Et stort rom blir to–tre delkart; det er greit. Minnet per delkart er dermed
begrenset (100–250 MB på GPU) uavhengig av huset, og det bor **ett** delkart i minnet om
gangen (pluss det forrige i en kort nådeperiode etter bytte).

Fusjonen skjer **live**, per ramme, på GPU, inn i det aktive delkartet. Blokkindeksen er
tett per delkart (60 × 25 × 60 Int32 = 360 kB), så ingen hash. Dette er samme kjerne som
baken bruker, ikke en forhåndsvisning.

Hvert delkart er forankret til en **ARAnchor** i sitt origo. ARKit flytter egne ankere når
den retter verdenskartet (det er slik virtuelt innhold står stille). Da flytter hele
delkartet som én blokk, og overlegget følger med. Dette er prompten sitt forslag om å
forankre feltblokkene, bare med delkart som blokk. **Uverifisert** på telefon; derfor er det
milepæl 0.

### Én sannhet for overlegg og resultat

Dekning **er** TSDF-vekten W. En konverteringskjerne (som dagens `convert`) skriver W til en
5 cm-tekstur per delkart, og shaderen sampler aktivt delkart pluss de lukkede via
delkartenes transformer. Terskelen er fusjonens `minWeight`. Da gjelder: viser overlegget
«dekket», finnes voxelen med nok vekt i volumet som baken trekker flate fra. Snur du deg
eller går tilbake, leses de lukkede delkartenes vekt, som aldri nullstilles, så stripene
kommer ikke tilbake.

Visningen: ARKit-meshen beholdes som bærer for det aktive delkartet (den er gratis og
umiddelbar; shaderen slår opp W i stedet for feltet). For lukkede delkart vises **den bakte,
teksturerte modellen** fra bakgrunnsbaken. Du går tilbake inn i et rom og ser det ferdige
resultatet der du står. Det er både «det du ser er det du får» og den wow-følelsen som
mangler i dag.

Gjenbesøk: målet er at et lukket delkart **gjenåpnes** når du står inne i det med intakt
sporing (blokkene leses fra disk, baken for det delkartet kjøres på nytt). Flere runder
gir da mer vekt i samme volum, som §112 viste er ønskelig. Første versjon kan nøye seg med
et nytt, overlappende delkart og sveising av dobbeltflater ved Ferdig (`dropDoubleSurfaces`
finnes).

### Poser

Inne i delkartet: ARKits odometri live. Ved lukking: `driftrett` på delkartets egne kart
(driften over 45 s er centimeter, ikke desimeter, så dagens 20 cm-grense og plan-terskler
passer), `MeshBildebinding` på delkartets ≤ 120 bilder (≤ 10 s, ≤ 600 MB, kjent størrelse),
og så **re-fusjon** av delkartet fra rådybden med rettede poser (GPU, under ett sekund).
Det re-fusjonerte volumet er det som bakes. Forskjellen fra live-volumet er centimeter, og
vektregelen er den samme, så dekningen flipper ikke.

Mellom delkart: en **posegraf** med ≤ ~50 noder, løst med samme LM-maskineri som
bindingen. Bånd: ARKits kontinuitet ved byttet (sterkt, kort), SIFT-landemerker matchet
mellom nabo- og overlappende delkart (dagens matcher, parvis, begrenset), **gulvplanet per
etasje** (det tar den loddrette glidningen på 11 cm/80 s rett ut), og veggplan-par. Løses
ved Ferdig og hver gang et kryss mot et eldre delkart oppdages. Loop closure flytter
delkart rigid: en ny matrise i manifestet, ingen ny bake. Trapp: gulvplanene er ulike per
etasje, så etasjene bindes av odometrien gjennom trappa, bindingen på reposet og
tak/gulv-konsistensen. §112 sier at de første båndene teller mest, så én ekstra runde på
trappa er verdt å be om i veiledningen.

### Minne

Bare det aktive delkartet på GPU. Lukkede delkart skrives til disk (blokker, kartliste,
SIFT-filer) og tas én om gangen av bake-arbeideren. Rå JPEG og luma for et delkart slettes
når delkartets GLB er skrevet; SIFT, poser og dybdeplan beholdes til Ferdig (posegrafen
trenger dem). Vieweren laster én GLB per delkart fra et hus-manifest, med mipmap og full
oppløsning bare for de nærmeste ett–to delkartene. Opptaket er alt strømmende.

### Live og bake: bake bak deg

En bake-arbeider tar lukkede delkart i kø: binding → driftretting → re-fusjon → surface nets
→ forenkling til et **fast mål per delkart** (det samme som ett rom får i dag) → xatlas →
texel-blanding med 1–2 fliser à 6144/8192 **per delkart** → GLB + relok-kart per delkart.
Ved termikk serious pauser køen; den endrer aldri parametre. Ved Ferdig gjenstår siste
delkart, posegrafen, sveising av overlapp og manifestet. Kvaliteten per rom er konstant av
konstruksjon, fordi alle budsjetter er per delkart.

### Hva som beholdes, skrives om og slettes

Beholdes nesten uendret: `MeshSift`, `MeshBildebinding` (per delkart), `MeshRelok`,
`MeshBakeV2` (texel-veien, rasterize, gains, tone; budsjettstigen ut), `ARMeshGlbExporter`
(writeTiledGlb, fillPlanarHoles, snapDominantPlanes, dropDoubleSurfaces),
`MeshTsdfBuild` (`ampex_fuse`, `Blokkvolum`, `surfaceNetsRå`, `etterbehandle`, `driftrett`,
JBU), opptaksdelen av `MeshScanPresenter`.

Skrives om: orkestreringen (nye typer for delkart og hus, bake-arbeider, posegraf),
`CoverageField` (→ W-konvertering per delkart), bindingene i `CoverageMesh.metal`
(flere delkart), `MeshTsdfBuild.build` (→ delkart-skop), `exportTextured`, vieweren.

Slettes: CPU-dekningspasset (`coverageGeometry`, `CellCache`, `doneCells`, `kfCams`,
`frameNovelty`, bortsett fra det veiledningen trenger), ringbufferet på disk i
`CoverageField`, `TSDFFusion.swift` (gammel batch-vei bak `meshscan.geometry=fusion`),
`MeshSplatBuild` (parkert), DTSDF (eller behold som flagg). `MeshPoseRefineV2` beholdes for
den rigide, linserettede refinen (bb6r var beste arm), planAlign-veien kan gå.

---

## Plan i milepæler

Hver milepæl har en test Tormod gjør selv på telefonen. Ingen milepæl er ferdig før den er
sett der.

**M0 — to målinger, ingen endring i oppførsel (dager).**
(a) Legg en ARAnchor hvert 30. sekund under skanning og logg hvordan transformene deres
endrer seg. Test: skann tre rom og gå tilbake; loggen skal vise at ankrene flytter seg
omtrent de 8–12 cm `audit-scan-drift.py` måler på veggen. Flytter de seg ikke, er
ARAnchor-forankringen død, og delkartene må i stedet flyttes av posegrafen alene.
(b) Et «overlegg-sannhet»-mål: dump cellene overlegget viste som dekket ved Ferdig, og
sammenlign med den ferdige meshen. Tallet for dagens app på f97d682a og f92f1be0 er
referansen alt senere måles mot.

**M1 — delkart-TSDF live og overlegg fra W.** Baken er uendret (global, som i dag).
Test: tre rom og tilbake: ingen striper kommer tilbake, overlegget tegner ikke på nytt når
du snur deg, og overlegg-sannhet ≥ 95 %. Ta samtidig **første trappeskann** (opp én etasje,
ett rom der oppe) som fixture til M3.

**M2 — bake bak deg per delkart, flere GLB-er, budsjett per delkart.**
Test: fem rom; ventetid etter Ferdig under 2 minutter; samme rom skannet alene og som del
av de fem ser likt ut (render side om side og på telefonen). Det er krav 1.

**M3 — posegraf, sveising av overlapp, gjenåpning ved gjenbesøk.**
Test: to etasjer via trapp. Merk et punkt i taket og det tilsvarende punktet på gulvet
over (lodd og tommestokk); avviket i modellen ≤ 3 cm. Skillevegger er én vegg, ikke to.
Det er Glenns borevinkel.

**M4 — vegger sett fra én side.** Veiledning ved lukking av delkart («vegg mangler her»:
gulvet slutter uten vegg over), planfylling av vegg mellom gulv og tak, og veggpar på tvers
av delkart (motsatte plan 8–15 cm fra hverandre fyller hverandres hull).
Test: et f92f1be0-skann; ingen gjennomsyn fra noen av rommene.

**M5 — kvalitet per rom, nå til konstant pris.** 1 cm voxel per delkart, Prompt Depth
Anything mot JBU på fixturene, hull rundt møbler, sprekker i taket. Det er her
«ikke ett rom er godt nok» angripes, og det kan først gjøres ordentlig når hvert grep
koster det samme uansett hus.

**M6 — AR mot huset.** Relok-kart per delkart, grov-til-fin, synk av linjer.

M1–M3 er uker, ikke dager. Rekkefølgen er valgt fordi M1 gir det Tormod kaller et av de
største problemene (overlegget), M2 gir krav 1 og 7, og M3 gir Glenn.

---

## Risikoer og åpne spørsmål

- **GPU mens ARKit kjører.** Live-fusjon per ramme er 1–2 ms og ufarlig. Bake-arbeideren
  i bakgrunnen konkurrerer med kamerabildet; den må jobbe i små kommandobuffere og gi fra
  seg GPU-en mellom dem. Må måles på 13 Pro; det finnes ingen prioritet i Metal.
- **Varme.** Telefonen nådde serious etter 65 s på flerromsskannet uten bakgrunnsbake.
  Med bake bak deg kommer det før. Køen pauser, og ventetiden ved Ferdig vokser. Ett minutt
  for et hus er ikke realistisk på 13 Pro; tre–fem er det.
- **ARAnchor-forankringen er ikke verifisert** (M0). Feiler den, bærer posegrafen alt, og
  overlegget for lukkede delkart kan ligge noen cm feil til Ferdig.
- **Sporing i trapp.** Ensfargede vegger og lite struktur gir tap av sporing; da deles
  delkartene, og posegrafen må feste etasjen igjen via bindingen på reposet. Klarer den
  ikke det, flyter etasjen. Nødutgang: be brukeren skanne reposet en gang til.
- **Sømmer mellom delkart** i tone og geometri. Første versjon godtar dem; tonen kan
  nivelleres som konstant per delkart senere (samme mekanisme som søm-nivelleringen).
- **Vieweren** på telefonen: mange delkart × fliser; mipmap og nærhetsstyrt oppløsning er
  nødvendig, ikke et tillegg.
- **Dybdefrekvens.** Live kan fusjonere 30 Hz, baken re-fusjonerer fra disken på 5 Hz; da
  blir W ulik og dekningen kan flippe. Enten logg alt (6 MB/s, 5 GB per kvarter, innenfor
  budsjettet) eller fusjoner live på 5 Hz. Anbefaler 5 Hz begge steder først, så måle.
- **Gjenåpning** av delkart er den mest kompliserte delen av M3; nytt overlappende delkart
  er en akseptabel første versjon.
- `BGContinuedProcessingTask` (iOS 26) er fortsatt nødutgang, ikke plan.

---

## Målemetode

Regresjonssettet er de fem fixturene som finnes (tre ettroms, to flerroms), trappeskannet
fra M1, og det samme rommet skannet alene og som del av et hus (M2). Et måltall får
brukes først når det reproduserer en rangering Tormod har gjort med øyet på minst tre
fixturer; det er §88/§90-regelen, og den har vært brutt fem ganger. Kandidater som alt
finnes eller er billige: hullandel per plan (rød render), sett-men-tapt
(`audit-scan-sett-tapt.py`), gulv/tak-tykkelse (`audit-scan-shell.py`), overlegg-sannhet
(M0b), holdt-ute epipolar (`bbcli --holdute`), gjennom-gulvet-feil (tommestokk), baketid,
toppminne og antall termiske pauser. Tekstur dømmes med øyet på renders fra faste
kameraer (`glb-veggflat.py`, hjørne-render), ikke med tall.

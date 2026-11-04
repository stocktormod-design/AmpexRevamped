# Polycam — LiDAR-skanning på enheten (research 2026-10-18)

Hvorfor: Tormod vil ha «Polycam-nivå». Dette er alt som er offentlig om hva Polycam gjør med
LiDAR på iPhone/iPad, og hva det betyr for vår pipeline. **Dokumentert** = står i Polycams egne
kilder. **Utledet** = vår slutning.

Kilder: alle 158 artikler i hjelpesenteret hentet via Zendesk-APIet
(`learn.poly.cam/api/v2/help_center/en-us/articles.json` — siden selv svarer 403), App
Store-versjonshistorikken (id1532482376), Polycams blogg og pressemeldinger, J.S. Held/SAE 2022,
AEC Magazine 2025, SkyeBrowse (konkurrent, partisk). Reddit var blokkert.

## Det viktigste for oss

1. **Polycam løser ikke gjentatte passeringer — de forbyr dem.** Hjelpesenteret: å skanne samme
   område to ganger «skaper motstridende data»; anbefalingen er ETT pass per område, «hold
   venstre vegg». Loop closure, pose graph og bundle adjustment nevnes ingen steder.
   ([Improving Scan Accuracy](https://learn.poly.cam/hc/en-us/articles/34295265957140-Improving-Scan-Accuracy-Best-Practices-for-Interior-Spaces),
   [How Accurate](https://learn.poly.cam/hc/en-us/articles/50434745985556-How-Accurate-Are-Polycam-Scans))
   Feilen vi så 13.09 (§103: ny dybde lander ~5 cm fra gammel flate etter 30 s) har de også;
   de styrer brukeren unna den.
2. **Driftretting finnes bare i plantegningen** («wall straightening» mot dominerende akse),
   ikke i meshet. ([plan-pipelinen](https://poly.cam/blog/how-we-turn-raw-spatial-data-into-a-floor-plan-you-can-build-from-inside-polycams-floor-plan-pipeline))
3. **LiDAR-teksturen deres er myk, og de sier det selv:** Object Mode (fotogrammetri i skyen)
   anbefales for «higher-fidelity interior meshes than Space Mode». Rådataeksemplet har
   keyframes i 1024×768; sky-presetet «bruker høyoppløselige bilder» → utledet: tekstur på
   enheten bakes fra nedskalerte bilder.
   ([High-Fidelity Interior](https://learn.poly.cam/hc/en-us/articles/48339214285844-How-to-Capture-High-Fidelity-Interior-Scans-in-Object-Mode))
4. **Ingen dokumentert eksponerings-/hvitbalansekompensasjon i LiDAR-teksturen.** Colors-verktøyet
   er «visual only on Polycam web», påvirker ikke eksport.
5. **Pipeline = samme type som vår** (utledet): presets med voxelstørrelse, dybdetak (maks 5 m)
   og forenkling før teksturering → TSDF/voxel-fusjon → marching cubes → desimering → bake.
6. **«Polycam-nivå» er altså i stor grad OPPTAKSDISIPLIN + VEILEDNING**, ikke en hemmelig
   algoritme: ett pass, 1–2 m avstand, «sakte ned»-varsel, dekningsrutenett, haptikk.

## Moduser (etter Vision 25, feb. 2025)

Space, Object, Floorplan, AI Capture, 360. Gamle «LiDAR» og «Room» = Space; «Photo» = Object.
([Which Capture Mode](https://learn.poly.cam/hc/en-us/articles/48565771018772-Which-Capture-Mode-Should-I-Use))

- **Space med LiDAR:** én økt → teksturert mesh + 3D-planmodell + 2D-plantegning med mål og
  romnavn. iPhone 12 Pro+/iPad Pro. Gratis på alle planer. Lukker Auto (kontinuerlig, haptisk
  tikk) eller Manual (≥20 bilder, 70 % overlapp). Flere etasjer i én økt, etasjebytte oppdages
  automatisk. Prosesseres lokalt uten nett.
  ([Space LiDAR](https://learn.poly.cam/hc/en-us/articles/36655587097620-How-to-Use-Space-Mode-with-LiDAR-enabled-devices))
- **Floorplan:** kun plan i sanntid, kan reprosesseres til mesh senere hvis rådata ligger lokalt.
- **Plan = Apple RoomPlan** + seks egne etterbehandlingssteg (vinkelretting, romdeling/romtyper,
  gulv-/takhøyde per rom, objektopprydding, GPS+kompass til nord). 6.0.19 (aug. 2026) erstattet
  RoomPlans fletting av etasjer med egen.
- **Space uten LiDAR** (14.01.2026, iPhone 13+): ML-dybde fra video, enhet eller sky, bare mesh.
- **Splats:** kun Object Mode, kun sky. Ingen LiDAR→splat på enheten; omvei via rådataeksport.
- **Sky-preset for Space:** høyoppløselige bilder, anbefalt over ~465 m².

## Drift, posisjon, veiledning

- Egen forklaring på drift: for rask bevegelse, for nær flater («drift artifacts at wall-floor
  corners»), feil hoper seg opp med størrelse (<9 m² «svært konsistent», >465 m² «wider margin»).
- **Extend:** fortsett lagret Space-skanning, også en annen dag, samme enhet, rådata lokalt.
  Gammel dekning som grønt rutenett, melding ved vellykket relokalisering, gammelt/nytt
  fargekodet ved prosessering. Hver utvidelse gir «a small amount of error at the segment
  boundary»; etter 3–4 utvidelser anbefales separate skann. Feiler ved endret lys/flyttede
  møbler. Retting er manuell: «recapture the transition area». Utledet: ARWorldMap.
  ([Extend](https://learn.poly.cam/hc/en-us/articles/36635635851924-How-to-Use-the-Extend-Tool-in-Space-Mode))
- **Ingen pauseknapp** funnet; eneste vei er Done → Extend.
- **Scenes (web):** manuell sammenstilling av rom med gizmo + magnetisk snapping, ingen
  automatisk registrering.
- **Veiledning under opptak:** blått rutenett = ikke dekket, hvitt mesh = dekket; hvite
  konturlinjer når en vegg er oppdaget; lilla felt i as-built-flyten; «sakte ned»-varsel;
  haptisk tikk; lommelykt; varsel om lite lagring (7.0.6); LiDAR-helsesjekk i innstillinger.
  Råd: 1–2 m avstand, maks 5 m, ~2 min per 9 m², økter under 30 min (minnekrasj), Ikke forstyrr
  (varsler kan gi tapt sporing), 10–15 GB ledig.
  ([Preparing to Scan](https://learn.poly.cam/hc/en-us/articles/48538689020692-Preparing-to-Scan))

## Prosessering

- Presets: Default (stor voxel, mye forenkling), Dense (liten voxel, lite forenkling), Custom
  (Depth Range ≤5 m, Voxel Size, Simplification %), Cloud. «FAST» = 80 % forenkling.
- Rådata har `blur_score` per bilde → utledet: uskarpe bilder siles ved keyframe-valg.
- **Remesh** (Basic+): polygonantall, uniform/adaptiv, atlas 1K–8K, lagres som kopi.
- **Developer Mode** (må slås på før skanning): zip med keyframe-JPEG, per-bilde-JSON
  (intrinsics, 3×4-pose, blur_score, angular_velocity, center_depth, manual_keyframe), dybde +
  konfidens, mesh-info med georeferanse og tyngdekraftrotasjon.
  ([Raw data](https://learn.poly.cam/hc/en-us/articles/38276871185044-How-to-Extract-Raw-Data-and-What-Is-Included))

## Måling og nøyaktighet

- Påstand: ±½" (±1,27 cm) innendørs; vegg-til-vegg 1,3–5 cm avvik; takhøyde «within a few
  millimeters»; referanse laseravstandsmåler. Skannemetode betyr mer enn maskinvare. Svarte/mørke
  flater → «near-complete mesh failure»; ensfarget gulv → bølger.
- J.S. Held/SAE 2022 (iPhone 13 Pro Max mot FARO): 38 % innen 0,64 cm, 30 % utenfor 1,9 cm,
  halvparten av skannene måtte skaleres 97,7–104,6 %. På nivå med 3D Scanner App og Scaniverse.
- Verktøy: linjal med vinkel (alle), penn/areal (betalt), AI-automåling av vegger (Basic+),
  lagrede mål (Business+), Rescale med to punkter (alle), volum, clipping planes, Spatial Report
  (veggareal med/uten åpninger, volum, omkrets, takhøyde per rom; Business+). Yttermål med
  10 cm standard veggtykkelse.
- Georeferanse: GPS+kompass per keyframe i én optimalisering; georeferert LAS (Business+); ingen
  GCP/RTK.

## Redigering og eksport

- Crop (boks/sylinder), Reset, Duplicate, reprosessering fra lokale rådata, Remesh, Colors,
  clipping planes, Floorplan Editor (Business+), Virtual Walkthrough (kildebilder langs
  kamerabanen med kommentarer). **Ikke funnet:** hullfylling, ny teksturbake uten full
  reprosessering.
- Eksport: OBJ, DAE, FBX, GLTF/GLB, STL, USDZ; plan som DXF/PDF/SVG/PNG/CSV; punktsky
  LAS/PLY/PTS/XYZ/DXF (Business+); rådata-zip; Xactimate ESX. Free = bare GLTF. Ingen E57/IFC.

## Priser (poly.cam/pricing, okt. 2026)

Free 0 · Basic $150/år · Business $400/bruker/år (plan, rapporter, punktsky, editor) ·
Enterprise $1200/bruker/år (min. 3). Selve LiDAR-skanningen, Extend og Rescale er gratis.

## Svakheter

Egne: drift i store rom og over Extend-grenser, speil/glass/mørke flater, bølgete gulv, tynne
objekter forsvinner, minnekrasj (>30 min), fast 5 m dybdetak, dobbeltskanning gir artefakter,
rådata låst til én enhet. Brukere: «geometrical shift mid scan», upålitelig Extend, blå skjerm
med tapte data. SkyeBrowse: «compounding registration drift … texture inconsistencies».

## Nytt 2025–2026

Vision 25 (Space, Scenes, Spatial Report) · Space uten LiDAR (jan. 2026) · Floorplan Editor +
automåling (mars 2026) · 6.0.x (romsegmentering, Remesh, «improved texture rendering», egen
etasjefletting) · 7.0.x (stabilitet, iPhone 18 Pro). Stillingsannonser peker mot ML-dybde og
-tekstur, ikke klassisk SLAM.

## Hva vi kan ta

**Kan bygges rett fra beskrivelsen (ingen skann trengs for å verifisere logikken):**
- Veiledning under opptak: dekningsrutenett, «sakte ned», «for nær», haptisk tikk, lommelykt.
- Lagringsvarsel før opptak; øktlengde-tak.
- Presets / reprosessering fra lagret bundle (vi har rebake-veien allerede).
- Måleverktøy og eksportformater.
- Extend over økter (ARWorldMap) — men grensefeilen de innrømmer gjelder oss også.

**Trenger ekte skann å teste mot:**
- Gjentatte passeringer uten krangel (loop closure) — her er Polycam IKKE foran; de unngår det.
- Teksturskarphet — vi baker allerede fra fulloppløste bilder med eksponerings-/WB-retting, som
  Polycam ikke dokumenterer.

Beslektet: `docs/SKANN_BESLUTNINGER.md` §94 (Scaniverse blander), §97 (posedrift), §103
(retur-feilen, ikke løst).

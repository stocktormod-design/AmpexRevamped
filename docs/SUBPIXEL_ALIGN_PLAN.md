# Sub-piksel-justering på enheten — «se ut som ett foto»

Mål: en skann-tekstur som ser ut som **ett** foto, ikke et lappeteppe av
enkeltfotos med utjevnet lysstyrke mellom lappene. Kjøres **på enheten**
(iPhone 13 Pro). Ingen PC-bake, ingen Open3D — den ruten er forkastet.

Skrevet 2026-08-25 som overlevering til en fokusert økt. Dette er en PLAN, ikke
kode. Delikat fotometrisk optimering — filen har bitt før (se «Feller»). Ta det
rolig og mål hvert steg på fixture.

## Diagnosen som gjør dette til riktig spor

Poserefinen (`MeshPoseRefineV2.swift`) er RIGID: 6-DoF per frame. På
bad-skannet 2026-08-25 flatet residualen ut på ~0,044 (0,0484 → 0,0440 over 8
iter, steg 13/10/7/5/3/3/3 ×10⁻⁴). Det er RIGID-GULVET. Restfeilen er
linseforvrengning, rullelukker og dybdefeil — retningsavhengig forvrengning som
en stiv flytting ikke kan fjerne.

Konsekvens i baken i dag: fotoene er cm-uenige om HVOR grout-linjer/kanter er.
Gitt uenigheten har baken to valg — KUTTE mellom fotos (søm) eller BLANDE dem
(smør). Alt som er prøvd (ståsted, plan-lås, ICM, søm-nivellering, fargetermen
fra 0c3bb06) er strategier for HVOR kuttet skal ligge. Ingen fjerner uenigheten.

Sub-piksel-justering fjerner uenigheten. Da blir blanding TRYGT, og N fotos gir
MER detalj enn ett — «flere synsvinkler = skarpere» i stedet for «= verre».

## To halvdeler — BEGGE trengs

Justering alene gir ikke «ett foto». Baken plukker fortsatt ÉN vinner per
trekant. Full effekt = begge:

1. **Warp i refinen** (`MeshPoseRefineV2.swift`) — bøy hvert foto sub-piksel så
   de blir enige. Zhou-Koltuns ikke-rigide halvdel; den rigide halvdelen er
   allerede portet i denne filen.
2. **Blande-vei i baken** (`MeshBakeV2.swift`) — snitt ALLE syn per texel i
   stedet for vinner-tar-alt. Trygt KUN etter (1). Dagens design tar detalj fra
   én vinner NETTOPP fordi snitting smører ujusterte fotos (se kommentarene ved
   multiband/topp-K). Justering snur den avveiingen.

## Del 1 — warp i refinen

Gjenbruk alt som finnes: `sample` (bilineær luma + gradient), `project`
(synlighet + dybdetest), GN-løkka, proxy-alterneringen, sikkerhetsnettet som
ruller tilbake hvis et steg gjør det verre. Endringen er hva som optimeres.

- **Parametrisering:** per frame et grovt rutenett av kontrollpunkter i
  bilderom (Zhou-Koltun bruker ~20×16 — START GROVERE, f.eks. 8×6, og øk).
  Hvert kontrollpunkt har en 2D-forskyvning (du, dv). Sampling i frame f ved
  (u,v) bruker (u,v) + bilineær_interp(warp-rutenett, u, v).
- **Jacobi er ENKLERE enn den rigide:** ∂I/∂(kontrollpunkt-offset) = ∇I ·
  (bilineær vekt for det kontrollpunktet ved den projiserte pikselen). Bare de 4
  omkringliggende kontrollpunktene har vekt ≠ 0 per sample → glissent per-frame-
  system (2 × antall kontrollpunkter ukjente). Ingen rotasjonsledd.
- **Regularisering er OBLIGATORISK:** λ·Σ‖offset_i − offset_nabo‖². Uten den
  driver kontrollpunkter i tekstur-fattige felt (blank vegg) fritt og river
  warpen. For lav = wobble/riving; for høy = kollapser til rigid (ingen warp).
  Dette er den viktigste knotten å tune.
- **Rekkefølge:** kjør rigid som i dag FØRST (det finnes), deretter warp på
  toppen — eller alterner. Behold sikkerhetsnettet: warp skal ALDRI gjøre
  residualen verre enn rigid-resultatet.
- **Kostnad:** warp-rutenett er bittelite (8×6×2 float × 160 frames = ingenting).
  Fortsatt per-frame-parallelt. Desktop-eksperimentet (30 iter, 121 frames, CPU)
  brukte ~30–45 s; telefonen gjør 8 rigide iter på 1,5 s. Sekunder, ikke
  minutter — men MÅL det på device mot `thermalState` (regel 10).

## Del 2 — blande-vei i baken

To ting, begge bak flagg:

- **Warp-bevisst sampling:** baken må bruke hver frames warp-felt når den
  projiserer en flate inn i den framen. Warp-feltet må altså TRÅDES fra refinen
  inn i baken. I dag skriver refinen bare `keyframes[].transform` tilbake. Warp-
  feltet må også persisteres (i `Keyframe`? sidecar?) OG skrives inn i fixturen
  (`writeFixture` v4), ellers kan ikke rebake-A/B gjenskape det. Uten dette er
  del 1 verdiløs — dette er selve «halvdel to»-fella.
- **Snitt alle syn:** erstatt/utvid vinner-tar-alt med fullt fler-syns-snitt nå
  som justering gjør det trygt. RISIKABELT — det bryter dagens designbegrunnelse.
  Behold `winner`-veien som fallback-flagg. Håndter eksponering (gains er
  allerede løst) og okklusjon (dybdetest) i snittet.

## Flagg og A/B

- `meshscan.warp = "off" | "on"` — warpen i refinen.
- `meshscan.blend = "winner" | "all"` — blande-veien i baken.
- Matrise på fixture: (warp av/på) × (winner/all).

**A/B kan kjøres UTEN nytt skann.** Bekreftet: `MeshPoseRefineV2.refine` kalles
INNE i `MeshBakeV2.bake` (linje 287), som kjører på HVER rebake. Fixturen lagrer
PRE-refine-poser; refine kjøres på nytt hver bake. Dev-panelet `RebakeAB` i
`app/(app)/skann.tsx` rebaker en bundle med valgte flagg. Tre fixturer ligger på
telefonen (mørkt rom, bad, +1) og som backup i `~/Documents/ampex-scan-fixtures/`.
Se [[scan-ab-harness]].

Målestokk: `poseRefine ferdig — residual X → Y` (warpen skal senke Y under det
rigide gulvet ~0,044) og `V2 ICM-fargeterm`/sømenergi-linjene + VISUELL dom
(brukerens øye er metrikken — «looks like one photo»).

## Feller (les før du skriver)

1. **Jacobi-fortegn.** Den rigide versjonen hadde et flippet fortegn som ØKTE
   residualen (0,039 → 0,046) — se kommentaren ved `pc × gpc` i filen. Valider
   warp-Jacobiens retning på SAMME måte: residualen MÅ synke monotont på fixture.
   Ikke stol på at fortegnet er rett før tallet beviser det.
2. **Warp må brukes ALLE steder framen samples:** proxy-passet, GN-residualen OG
   baken. Warper refinen men baken ikke, er alt bortkastet (halvdel to).
3. **Regulariseringsvekt** — se over. Start høyt (nær rigid), senk til warpen
   begynner å hjelpe uten å wobble.
4. **Kontrollrutenett-oppløsning** — for grovt fikser ikke lokal forvrengning,
   for fint overfitter og er tregt. Start 8×6, øk mot 20×16 kun hvis nødvendig.
5. **Uverifisert premiss:** vi så ALDRI justering produsere et bedre BILDE —
   desktop-tekstursteget krasjet hver gang (x86-only + Rosetta-minne). Vi
   bekreftet bare at justeringen KJØRER og er rask. Første device-A/B er den
   ekte proof-of-value. Ikke bygg del 2 tungt før del 1 viser lavere residual.

## Startpunkt

Ren, committet tilstand: `e09b5b8`. Filene: `MeshPoseRefineV2.swift` (281
linjer, del 1) og `MeshBakeV2.swift` (del 2, rundt vinnervalg/multiband ~linje
615 og søm-nivellering ~1150). Bygg + installer: se `git`-historikk for
`xcodebuild -workspace ios/Ampex.xcworkspace -scheme Ampex -configuration Release
-destination id=<device> -allowProvisioningUpdates` og `devicectl device install`.
Relatert: [[scan-pipeline-tuning]], [[scan-stasted-fragmentering]].

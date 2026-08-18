# On-device skann — mange runder, ett resultat

Status: **plan, ikke implementert.**
Søsterdokument til `docs/GPU_BAKE_PLAN.md` (pool-baken).

## Målet

Fem runder rundt et rom skal se ut som **én ren skanning**. Å gå tilbake skal alltid
være trygt: i verste fall ingen endring, aldri verre.

Kvalitetsmålet er **Scaniverse-klasse uniformitet**, ikke maksimal skarphet.
Brukerdom 2026-08-15: jevn og myk slår skarp og flekkvis.

**Men «myk» er ikke «smurt».** Det er den bindende betingelsen i hele dokumentet.
Et snitt av bilder som ikke ligger på hverandre gir dobbeltkonturer, ikke mykhet.
Skillet er ett tall: **posefeil vs. texel-størrelse.** Ligger bidragene innenfor en
texel blir snittet mykt og rent; ligger de utenfor blir det spøkelser. Vi vet ikke
i dag hvilken side vi er på — derfor er ubetinget snitting **ikke** anbefalt bane
under, men en opsjon bak en måling.

## Kjerneinnsikten: redundans må bli gjennomsnitt, ikke konkurranse

Fra Scaniverse-researchen (2026-08-13):

> Offline batch-fusjon gjør redundante synsvinkler til kvalitet (flere samples å
> snitte); vår anker-mesh-as-is + view-competition-teksturering gjør redundans
> korrosiv.

Pipelinen har **to delsystemer som oppfører seg stikk motsatt** når du går en runde
til:

| Delsystem | Ekstra runder gir | Hvorfor |
|-----------|-------------------|---------|
| **Geometri** (TSDF) | **Bedre** — støy snittes ned som √N | Løpende vektet snitt, `TSDFFusion.swift:108-109` |
| **Tekstur** (bake) | **Verre** — lappeteppe | Vinneren tar alt per flate; flere kandidater = flere sømmer |

Én-skann-doktrinen (2026-08-13) var derfor et **riktig svar på tekstursiden som ble
påtvunget geometrisiden også.** Planen skiller de to.

## Tre tak i dag

**Tak 1 — fangstporten.** `MeshScanPresenter.swift:618-628`: under 12 % nytt i
synsfeltet → framen forkastes. Etter runde 1 bidrar runde 2-5 med ingenting.
Celle-nøkkelen (`:686-690`) bøttes på **overflatenormal** — blind for hvor du står,
så samme vegg fra ny vinkel er «samme celle».

**Tak 2 — bufferet er først-til-mølla.** `maxKeyframes = 600` (`:86`, håndhevet
`:591`), opptil 5 frames/s. Runde 1-2 fyller det, runde 3-5 avvises.

> **Å bare åpne porten gjør resultatet verre.** Du bytter et bevisst utvalg mot en
> vilkårlig tidlig delmengde. Port og buffer må endres sammen.

**Tak 3 — snitte-geometrien er av.** `MeshBakeV2.swift:255-259`: anker-mesh er
default, batch-TSDF er opt-in og tapte første device-runde.

## Det som allerede er riktig

| Mekanisme | Sted | Gir |
|-----------|------|-----|
| Løpende vektet TSDF-snitt | `TSDFFusion.swift:102-109` | Redundans → kvalitet, cos²- og avstandsvektet |
| Drift-reforankring | `MeshScanPresenter.swift:993-1016` | Keyframe-poser regnes om fra ankerets endelige, loop-closure-korrigerte transform |
| Synsvinkel-bøtter | `ARMeshGlbExporter.swift:52-63` | Posisjon 0,6 m × yaw 30° × pitch 30° |
| Beste-per-bøtte | `ARMeshGlbExporter.swift:71-91` | `selectCoverageAware` — best-of-N, bare for sent |
| Skarphet + bevegelse | `MeshScanPresenter.swift:793-794` | Måles **ved fangst** |
| MRF/ICM + annektering | `MeshBakeV2.swift:710-818` | Naboenighet, konfetti-fjerning |
| Multiband topp-3 | `MeshBakeV2.swift:568, 1205-1207` | `final = vinner + blur(snitt) − blur(vinner)` |
| Søm-nivellering | `MeshBakeV2.swift:930-985` | Globalt Jacobi-oppsett over region-nabograf, arealvektet forankring, klamping ±0,08 |
| Kvadrikk-forenkling | `MeshSimplify.swift`, kalt `:321` | Garland-Heckbert QEM før xatlas — **opt-in**, `meshscan.simplify` |
| Fotometrisk residual | `MeshPoseRefineV2.swift:260,278` | A/B-tall, med sikkerhetsnett `:160` |

**Loop closure finnes allerede.** ARKit korrigerer verdenskartet; reforankringen
propagerer det til keyframe-posene. Påstanden i `GPU_BAKE_PLAN.md` om at loop
closure er «det reelle hullet» stemmer ikke — hullet er *fotometrisk* global bundle
adjustment.

**Batch sparer oss for det vanskeligste.** BundleFusion
([arXiv 1604.01093](https://arxiv.org/abs/1604.01093)) de-integrerer og
re-integrerer frames når poser korrigeres, fordi den fuserer online. Vi integrerer
én gang mot ferdig korrigerte poser. Det maskineriet skriver vi aldri.

## Løsningen

### Lag 1 — Fangst: dybde akkumuleres, RGB erstattes

De to delsystemene vil ha motsatte ting, og kostnadene peker samme vei.
Dybdekartet er lite (~256×192 float32 ≈ 196 kB); JPEG-en er dyr i lagring,
encode-varme og opplasting.

```
per frame som passerer bevegelses-/sporingsvaktene:
  ├─ dybdekart  → ALLTID lagret (mater TSDF-snittet — vil ha alt)
  └─ RGB-JPEG   → kun hvis den slår nåværende beste i sin synsvinkel-bøtte
```

Erstatningsregelen: tom bøtte → lagre; opptatt bøtte → sammenlign
`sharpness / (1 + 2·motion)`, klart bedre → overskriv, ellers forkast RGB-en
(dybden beholdes uansett).

Lagring avgrenses da av **antall distinkte ståsteder**, ikke av hvor langt du går.
Fem runder koster omtrent samme RGB-plass som én, men hver plass holder det beste
av fem forsøk. 600-taket slutter å være et kappløp, «grønn men dårlig» selvheler,
og gjenbesøk er alltid trygt.

**Bøtt på anker-lokal pose, ikke verdenspose.** Avgjørende og lett å overse: ved
runde 5 har verdensposen drevet, så samme fysiske ståsted hasher til en *nabobøtte*
— du får to halvfylte plasser i stedet for én erstatning, og lappeteppet er tilbake.
Reforankringen kjører først ved eksport. Bøtt på `relTransform` relativt `anchorID`
(begge lagres allerede) — anker-lokale koordinater er driftsinvariante.

### Lag 2 — Geometri: la TSDF gjøre jobben

Med alle dybdebilder på disk blir batch-fusjonen banen som belønner runder. Åpne
punkter:

- **Anker-mesh vs. fusjon.** Fusjonen tapte første device-runde, men den A/B-en må
  kjøres på nytt *med fem-runders-data* — et helt annet regime.
- **Vektmetning.** `maxW: 64` (`TSDFFusion.swift:297`). Over det blir snittet et
  eksponentielt glidende snitt der ferske frames dominerer. Trolig ønskelig, men
  det er en antakelse som bør måles.
- **Trunkering vs. drift.** `TRUNC = 4 * voxel` = 40 mm ved 10 mm voxel. Restdrift
  godt under 40 mm gir forsterkning; over gir doble overflater.

### Lag 3 — Tekstur: bred lavfrekvent snitting

Dette er den egentlige endringen, og den er valgt fordi den **ikke kan gi smør.**

Multiband er allerede snitting gjort trygt:

```
final = vinner + blur(snitt av topp-K) − blur(vinner)
```

Den snitter **kun lavfrekvensen** — som er nøyaktig der fargelappeteppet bor
(eksponering, gjenskinn, skygge) — og henter **all detalj fra én vinner**.
Feiljustering kan derfor ikke gi dobbeltkonturer: detalj snittes aldri.

Tre additive grep, ingen ny algoritme:

1. **Utvid topp-3 → topp-K.** Flere bidrag i lavfrekvenssnittet gir jevnere farge.
   Rett på ekstra synsvinkler: flere runder mater denne direkte.
2. **Per-verteks søm-nivellering i stedet for per-region konstant.** Presisering
   etter kodelesing: dagens nivellering er allerede et **globalt** Jacobi-oppsett
   over region-nabograf med arealvektet forankring og klamping (`:930-985`) — ikke
   en naiv lokal utjevning. Begrensningen er at `ofs` er ÉN konstant per region:
   det kansellerer et jevnt sprang, men ikke en gradient, så store regioner kan
   fortsatt bånde. Waechter 2014 (mvs-texturing, BSD-3) løser per-**verteks**
   offset og interpolerer jevnt gjennom regionen — korreksjonen toner ut i stedet
   for å stoppe ved grensen. Rent additiv lavfrekvens; detalj røres ikke.
3. ~~Desimer før teksturering~~ — **finnes allerede** (`MeshSimplify.swift`,
   kalt `MeshBakeV2.swift:321`, Garland-Heckbert QEM med link-test og
   normal-flip-vern). Står som opt-in bak `meshscan.simplify = "on"` i påvente av
   fixture-A/B, med mål `max(20k, min(60k, tris/5))`. Gjenstående arbeid er å
   **kjøre den A/B-en**, ikke å implementere noe.

### Opsjon bak måling: ubetinget per-texel snitting

Per-texel median/robust snitt over alle syn er **view-uavhengig av konstruksjon** —
sømmer finnes ikke. Det er den reneste løsningen, og den Scaniverse ikke trenger
fordi de allerede har god trajektorie.

Den er **ikke** anbefalt bane nå, fordi den snitter detalj og dermed kan gi smør.
Den låses opp av én måling, ikke av en vurdering:

> **Gate:** medianavvik mellom bidragende syn, projisert til atlas-rom, målt i
> texels. Under ~1 texel → ubetinget snitting er trygt. Over → hold på multiband.

Residualen i `MeshPoseRefineV2` (`:260,278`) er i intensitetsenheter, ikke piksler,
så den svarer **ikke** på dette som den står. Målingen må skrives.

## Hvorfor dette ikke kan gi smør

Det bindende kravet, eksplisitt:

- All detalj (høyfrekvens) kommer fra **ett** bilde per flate. Aldri snittet.
- Alt som snittes er lavfrekvens: farge, eksponering, gjenskinn, skygge.
  Feiljustering på texel-nivå er usynlig i lavfrekvens.
- Søm-nivellering er rent **additiv** i lineært rom (`:1311`) — den flytter nivå,
  aldri innhold.
- Desimering fjerner sømsteder; den mykner ikke tekstur.

Bane som *kan* gi smør (ubetinget snitting) er isolert bak gaten over.

## Akseptansetest

Metodikken finnes: kvalitet itereres på **fixtures**, ikke knotter.

1. Skann samme rom med **1 runde** og med **5 runder**, samme økt.
2. Kjør begge `framesDir` gjennom samme bake.
3. Krav:
   - **Uniformitet:** fargesprang over regiongrenser (Δ i lineært rom) skal falle
     med flere runder. Dette er hovedmålet — ikke `filledFraction`.
   - **Ingen smør:** høyfrekvent energi per flate skal **ikke** falle mot
     1-runders-baselinen. Faller den, snittes detalj et sted den ikke skal.
   - **Monotoni:** 5 runder skal aldri score dårligere enn 1 på noe mål.

Punkt to er kontrakten mot «myk, ikke smurt» — den fanger regresjonen automatisk i
stedet for å stole på øyet.

## Faser

0. ~~Budsjett-inversjonen~~ — **implementert 2026-08-15.** `maxKF` og `atlasSize`
   skaleres nå samme vei, drevet av `os_proc_available_memory()` + `thermalState`
   i stedet for statisk `physicalMemory`. 13 Pro faller fra 8192/96 til
   6144/160-stigen. `meshscan.budget = "legacy"` gjenoppretter gammel gren for A/B.
1. **Kjør desimerings-A/B-en.** Koden finnes (se Lag 3 punkt 3); flagget står av.
   Billigste gjenstående forbedring, og den eneste som krever null ny kode.
2. ~~Topp-K + per-hjørne søm-forfining~~ — **implementert 2026-08-15.** K = 6 på
   13 Pro-stigen (3 i legacy). Søm-forfiningen måler restspranget etter
   region-konstantene, deler det likt på begge sider og diffunderer det innover med
   demping 0,92 over 24 Jacobi-pass. Verteksbufferet er nå per HJØRNE (8 floats,
   `[x,y,z,u,v,ox,oy,oz]`) fordi en verteks på en regiongrense må bære ulik
   korreksjon på hver side. `meshscan.seamlevel = "region"` slår av for A/B.
3. ~~Erstatningsbuffer~~ — **implementert 2026-08-15.** Fangsten holder én plass per
   synsvinkel-bøtte (`bucketSlot`), nøkkelen er **anker-lokal** så den overlever drift.
   Ny bøtte → ny plass (taket teller nå LAGREDE frames, ikke forsøk); opptatt bøtte →
   bytt kun ved 15 % klar forbedring, og overskriv samme filnavn så lagringen ikke
   vokser av gjenbesøk. Avgjørelsen tas før JPEG-encodingen, så en taper koster ingen
   varme. Indeksallokeringen er flyttet til `captureQueue`.
   **Avvik fra planen:** dybde følger fortsatt RGB — en forkastet kandidat lagrer ikke
   dybde alene. «Dybde alltid» krever at `Keyframe.file` blir valgfri og at alle
   `.file`-konsumenter håndterer nil; det er skilt ut som eget arbeid. Konsekvens:
   TSDF-snittet får ikke ekstra samples fra runde 2-5, bare bedre poser og bedre RGB.
4. ~~Kvalitetsbevisst port~~ — **implementert 2026-08-15, men annerledes enn planlagt.**
   `doneCells` gater ikke lenger fangst i det hele tatt (den styrer bare wireframe-fargen);
   nyhetsporten står igjen kun som fallback før første mesh-anker. Kvalitetsvalget skjer
   i stedet ved erstatning, der `sharpness / (1 + 2·motion)` — samme mål som
   `selectCoverageAware` — avgjør hvem som beholder plassen. Det gjør den planlagte
   «billige tvillingen» av `scoreOf` unødvendig: porten trenger ikke dømme kvalitet når
   erstatningen gjør det med det ekte tallet. Kadensen er begrenset til én kandidat per
   bøtte per 1,5 s, som hindrer at 4K-kopier hoper seg opp på `captureQueue`.
5. ~~Pre-AE-lås-celler åpnes~~ — **implementert 2026-08-15.**
   `doneCells` nullstilles når AE/AWB-låsen slår inn (`MeshScanPresenter.swift:229`).
   Trygt alene: låsen kommer 1,5 s ut i skannet, så settet er tomt eller nær tomt,
   og det er den ene fangst-endringen som ikke presser 600-taket.
6. **A/B geometri på nytt** med fem-runders-data.

Fase 0-2 hever uniformiteten uten å røre fangst — de kan måles på dagens fixtures.

### Testtilstand

Alt over typechecker mot iOS-SDK-en, og bake-shaderen kompilerer (`metal -c`).
**Ingenting er kjørt på enhet.** Fase 0-2 kan verifiseres uten å skanne, via
`rebakeMeshScan` på et eksisterende `framesDir`. Fase 3-5 endrer fangsten og kan
bare bedømmes på nye skann.

Fase 3 er den eneste endringen som kan feile *under* skanning i stedet for i baken.
Verd å se etter på første device-kjøring:

- `keyframes.count` ved eksport skal flate ut over runder i stedet for å vokse
  lineært — det er beviset på at erstatningen faktisk treffer samme bøtter.
- Ingen vekst i JPEG-encode-frekvens på runde 2-5 (hysteresen holder).
- Filnavn-indeksene skal ikke ha hull som ikke tilsvarer en lagret frame.

## Åpne beslutninger

1. **Dybdelagringstak.** ~196 kB/frame × 5/s × 5 min ≈ **290 MB**. float16, sjeldnere
   dybde, eller tak? Henger sammen med R2-opplasting i `GPU_BAKE_PLAN.md` fase 1.
2. **Hysterese-margin for erstatning.** For lav → JPEG-encode-slitasje og termikk
   (regel 8); for høy → runder slutter å hjelpe.
3. **K i topp-K.** Flere bidrag = jevnere, men mer bake-tid og RAM.
4. **Bøttestørrelse.** 0,6 m / 30° arvet fra `regionBucket`.
5. **`maxW`-metning.** Er EMA over 64 ønsket, eller skal taket heves?

## Forholdet til én-skann-doktrinen

Dette opphever doktrinen fra 2026-08-13 **bevisst**. Den var riktig gitt premissene:
et påfyllings-buffer og en 96-frames bake, der gjenbesøk faktisk bare kunne
fortynne. Erstatning + lavfrekvenssnitting endrer premisset — gjenbesøk kan ikke
lenger konkurrere med seg selv, bare forbedre.

## Hva som fortsatt tilhører poolen

Fotometrisk global bundle adjustment, ikke-rigid warp, alle keyframes, stor atlas.
Poolen er også der ubetinget per-texel snitting blir trygg, fordi det er der posene
blir gode nok.

## Kilder

- [BundleFusion (arXiv 1604.01093)](https://arxiv.org/abs/1604.01093) — de-/re-integrering; unødvendig i batch
- [Scaniverse: dybde-superoppløsning](https://medium.com/scaniverse/paying-attention-to-detail-353d5f42de6b), [mesh-forenkling](https://medium.com/scaniverse/mesh-simplification-in-scaniverse-981ca6564340)
- Waechter et al. 2014, «Let There Be Color!» — per-verteks søm-nivellering (nmoehrle/mvs-texturing, BSD-3)
- Intern research: `scaniverse-pipeline-findings`, `scan-texture-research-2026-08`

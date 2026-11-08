# Siste arbeid: skann-AR og raskere binding (21.–22. oktober)

Si «les siste arbeid» eller pek på denne fila. Detaljer og målinger ligger i
`docs/SKANN_BESLUTNINGER.md` §110, §110b og §111.

**Ingenting er committet.** Siste build er installert på iPhone 13 Pro
(enhet `4391C307-A938-5F1C-B00F-C0F6336EF918`).

## Hva som er bygget

### 1. AR «Se i rommet» (§110)
Du tegner en linje på skannet, åpner AR, og linja ligger på veggen i rommet.

- Når skannet bakes, lagres et kart ved siden av modellen (`<glb>.relok`). Kartet er
  punktene fra bildebindingen med SIFT-beskrivelser, flyttet inn i modellens verden.
- I AR tar telefonen et bilde, matcher det mot kartet, bruker LiDAR-dybden til å regne
  ut hvor kameraet står, og legger tegningene oppå. Den viser ikke modellen, bare
  tegningene, og de vises gjennom vegger (x-ray).
- LiDAR er på bare til første treff. Etter det sjekkes posisjonen på nytt hvert
  2. sekund mot de kartpunktene som er i synsfeltet.
- Nøyaktighet på Mac, med bilder skjult fra bindingen: rundt 0,8 cm på to av skannene og
  2,2 cm på det store. Innenfor samme passering er det rundt 2 mm. Grensen for ±1 cm
  er hvor godt passeringene henger sammen, altså hvor god bindingen er.
- Filer: `MeshRelok.swift` (kart + lokalisator), `MeshArPresenter.swift` (AR-skjermen),
  `MeshSift.swift` (`sift_match_lm`), et `defer` i `MeshBakeV2.bake` som skriver kartet,
  og `presentMeshAr`/`hasRelocMap` i modulen.
- Prototyp og måleverktøy: `tools/scan-relokalisering.py`.

### 2. Vis / Rediger i skann-skjermen (§110b)
- **Vis** (standard): se deg rundt i modellen som i Google Maps. Knappene er «AR» og
  «Skann på nytt».
- **Rediger** (blyant øverst): verktøy for punkt og linje, Angre og Ferdig linje.
  «Ferdig» øverst går tilbake til Vis.
- Linjer lagres lokalt i `<glb>.linjer.json` og synkes **ikke** ennå.
- Fil: `app/(app)/skann.tsx`. Linjene tegnes i `AmpexMeshViewerView.swift` (oransje rør).

### 3. Første test på telefonen
AR lagget og fant aldri posisjonen. Årsaken var 4K-video, full SIFT og ett stort
GPU-kall for matchingen. Rettet: vanlig videoformat, halv oppløsning, ikke noe
oppskalert bilde, matching i biter, og LiDAR av etter første treff.
**Ikke testet på telefon etter rettingen.**

### 4. Raskere, kaldere og bedre binding (§111)
- **SIFT mens du skanner:** punktene finnes i bakgrunnen for hvert bilde
  (`sift-<i>.bin`). Blir telefonen varm, venter jobben til «Ferdig». Før dette brukte
  telefonen 24 av 38 sekunder på SIFT.
- **Ikke noe oppskalert bilde, men et andre trinn:** bildene matches på nytt med de
  bundne posisjonene. Det gir både raskere og bedre binding.
- **Dybdeskala per nøkkelbilde:** LiDAR-dybden rettes mot bildene (±0,5 % per bilde) i
  TSDF-en og før JBU. Dybde og bilder blir 4–14 % mer enige.
- **Refleksjonskart av under skanning** (`environmentTexturing = .none`). De ga bare
  varme.
- **Resultat på Mac:**
  - stort skann: fra 0,66 til 0,53 px og fra 17 til 9 s
  - de to små: fra 8 og 7 s til under 4 s, med samme kvalitet
- Alle tre fixturer er bakt i simulatoren, og veggene er like eller litt skarpere.

**Flagg for A/B:**
- `meshscan.bbopp=on` slår på det oppskalerte bildet igjen.
- `meshscan.bbtrinn=1` gir ett trinn.
- `meshscan.dybdeskala=off` slår av dybdeskalaen.
- `meshscan.bildebinding=off` slår av hele bindingen.

## Neste steg
1. **Test på telefon:** ta et NYTT skann (gamle skann har gammel binding og mangler
   kart, og trenger «Bygg skarpere modell»), og prøv AR. Hent så `pipeline.log`
   (telefonen må være låst opp, se minnet *scan-device-forensics*). Se etter:
   - hvor lang tid bindingen tar, mot 38 s før
   - linja «x/N bilder hadde trekk fra skanningen»
   - «relok: låst» og hvor mange ms hvert forsøk tar
2. Synk linjene. I dag er de bare lokale.
3. Kanskje senere: modellere rolling shutter.
4. **Før TestFlight til eksterne:**
   - skjul EFObasen-skjermen (vilkårene forbyr innbygging uten avtale)
   - commit
   - opprett appen i App Store Connect (`no.ampex.app`)
   - logg inn med betalt konto i Xcode
   - arkiver og last opp

## Også gjort i samme økt
- Sendt oppsigelse av akvadata.no til Domene AS.
- Diskutert en egen bestillingspipeline mot grossist (bare råd). Retningen står i
  `docs/NAA.md` under 4. oktober.

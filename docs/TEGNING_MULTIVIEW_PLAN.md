# Tegning multiview — grundig plan

Skrevet 2026-08-26 etter to research-løp: full kodebase-inventar + domene-research
(Bluebeam/Dalux-UX, NS 3960/FG-750/NS 3924-dokumentasjonspraksis, RN-PDF-ytelse).
Dette er en PLAN, ikke kode.

## Målet (Tormods ord, presisert)

1. Flere tegninger per prosjekt med LETT navigasjon — kjapp swap under visning.
2. **Multiview**: opptil 4 tegninger samtidig (iPad; 2 på iPhone), panorer/zoom
   hver for seg ELLER lås dem sammen så alle følger med. Inaktive ruter skal
   ikke live-rendre under gesten (ytelse).
3. **Oppgaver** i prosjektet: pin på tegning, tildelt et prosjektmedlem, med
   frist og avsender. Pinnen vises KUN for den tildelte, og er IKKE permanent —
   ferdig = borte fra tegningen (soft delete under panseret).
4. LiDAR-skann per rom (finnes — skal henge naturlig sammen med tegningsverdenen).
5. Tegne lokalt, publisere eksplisitt (finnes som kladd/publisert — skal herdes).
6. **Brannvarsler-laget**: symboler som er lette å plassere og REDIGERE, linjer
   mellom detektorer (sløyfer), og KUN branndetektorer bærer registerdata
   (tag + serienummer m.m.). Autogenerert detektorliste per prosjekt.

## Hva som allerede finnes (inventar-fasit)

- `drawings` (plan, discipline, name, file_path, page_count-ubrukt), én PDF per
  tegning på R2 (`drawings/<id>.pdf`), offline-cache i `lib/drawings-storage.ts`.
- Editor `tegning-edit.tsx`: react-native-pdf (låst scale=1) + Skia-canvas over,
  moduser draw/pan/room/loop. Loop-modus finnes ALLEREDE: tap legger noder med
  symbol fra `lib/symbols.ts` (15 symboler, bl.a. røyk/varme/melder/klokke).
  Ingen select/flytt/slett av enkeltnoder, ingen sletting av publiserte strøk.
- Markup: to-lags (lokal kladd-fil + ÉN synket blob-rad per tegning).
  Publisering = konkatenering; samtidig publisering MISTER strøk (last-writer-wins).
- `tasks`: finnes (kind general/lidar_scan, assigned_to, status) men mangler
  frist, drawing_id og koordinat. Vises kun i prosjektdetaljen.
- `rooms` med rect-shape + scan_path; skann-flyt per rom virker; 3D-markører
  (`mesh_markers`) er LOKALE — synker ikke.
- Sync er generisk (`watermelon_pull/push` leser kolonner fra information_schema):
  ny kolonne = gratis når den finnes server-side; ny tabell = én rad i
  `sync_tables`. OBS [[sync-scope-gap]]: repo-migrasjoner ligger bak liva-DB-en —
  ALL skjemaendring skal verifiseres mot liva-DB-en (Supabase MCP), aldri mot
  repo-filene.
- Ingen iPad-/split-håndtering noe sted; app.json er portrait-only.

## Research-fasit som styrer valgene

- **Ingen på touch gjør mer enn 2 ruter.** Bluebeam MultiView (16 splitter,
  global sync-toggle, dokument- vs side-sync) er desktop-only; Revu for iPad er
  lagt ned. Dalux mobil: side-ved-side ×2 med synk PÅ som default og lås-toggle
  nederst. 4-up på iPad er altså FORBI det som shippes — mulig, men vi bygger
  2-up-mønsteret først og lar 4-up være samme komponent × 4.
- **4 × react-native-pdf er en felle** (minnelekkasjer, ingen pause-API, zoom
  via UIScrollView). Riktig mønster (PlanGrid/Fieldwire-klassen): rasterér siden,
  EI transformen selv (gesture-handler + Reanimated shared values), Skia-overlay
  deler samme matrise. Inaktive ruter = statisk bitmap; kun aktiv rute har live
  gest; re-raster ved gestslutt.
- **Brannpraksis (Norge):** adresserbare anlegg = sløyfer med individuelle
  adresser; tag-format på tegning er `sløyfe.adresse` (01.023). Det montører
  faktisk fører per enhet: tag/adresse, type/modell (f.eks. OP720), plassering/
  romtekst, montasjedato; serienummer bor oftest i sentralens logg — men Tormod
  vil ha det per enhet, og det er et pluss ved reklamasjon/bytte. Detektorlista
  følger O-planen (NS 3960 pkt 8.5 krever «tegninger som bygget» + dokumentasjon;
  TBRT: detektornummer på tegning MÅ matche sentralens display). Symbolnorm:
  NS 3924:2025 (branntegninger, med digitalt symbolbibliotek), NEK 144 for
  el-tegninger. Ingen norsk felt-app tilbyr sløyfetegning med per-enhet tag —
  dette er åpent terreng.

## Arkitektur

### A. Rendering-fundament (fase 1 — alt annet hviler på dette)

Bytt editorens/viewerens rendering til: **side-raster + eid transform + Skia**.

- Raster: `react-native-pdf-renderer` (PDFKit/PdfRenderer → bitmap, `singlePage`,
  `maxPageResolution`-vern) eller en liten egen PDFKit-modul (vi har allerede
  native-modul-løypa). Render ved 2–3 oppløsningstrinn; re-raster ved gestslutt
  hvis zoom > trinnets dekning. `page_count` fylles endelig ut.
- Transform: én `{scale, tx, ty}` i Reanimated shared values per rute. PDF-bildet
  og Skia-overlayet konsumerer SAMME matrise → symboler/linjer/pins sitter
  bom fast på tegningen i alle zoom-nivåer (dagens editor har dette kun fordi
  scale er låst til 1 + ytre transform; nå blir det ekte).
- Overlay-lag i én Canvas, i rekkefølge: publisert markup → kladd → sløyfer/
  symboler → oppgave-pins (kun egne) → live-strøk.
- Gevinst: viewer og editor blir SAMME komponent (`DrawingPane`) med
  `editable`-flagg — multiview gjenbruker den direkte.

### B. Multiview (fase 2)

- `DrawingPane` × N i et grid: iPhone 2 (stablet i portrett, side-ved-side i
  landskap), iPad 2×2 (opptil 4). Layout via `useWindowDimensions` (reaktiv —
  dagens `Dimensions.get` er det ikke). app.json: åpne for landscape på iPad.
- **Kun aktiv rute er "live"**: aktiv = den som sist fikk touch. Inaktive ruter
  fryser til sist rasterte bilde (de re-rendres først ved gestslutt hvis synk er
  på). Dette er Tormods «they don't preview the moving» — og det som gjør 4-up
  mulig i det hele tatt.
- **Synk-lås** (Dalux-mønsteret): én global toggle nederst. På = aktiv rutes
  delta (dScale, dTx, dTy) kopieres inn i de andre rutenes shared values ved
  gestslutt (og ved lås-på: ingen re-hjemsøking, de fortsetter fra der de står).
  Av = ruter helt uavhengige. Sync per delta, ikke absolutt posisjon — to
  tegninger i ulik målestokk skal kunne låses uten å hoppe.
- **Rutevelger**: tap på tom rute → tegningsvelger (gruppert per plan, samme
  data som dagens swap-bar). Langtrykk på fylt rute → bytt/lukk. Swap-baren i
  enkeltvisning består og får «Del skjerm»-inngang.
- Fremtid (IKKE nå): overlay-compare med fargetinting (Bluebeam rød=gammel /
  grønn=ny) når tegninger får revisjoner.

### C. Skjema (fase 0 — én migrasjon, WatermelonDB v31 → v32)

Verifiser liva-DB først (Supabase MCP `list_tables`), så:

1. `tasks` + kolonner: `due_at` (epoch ms), `drawing_id` (nullable),
   `x`, `y` (normalisert 0..1, nullable), `note` (nullable).
   - Pin-synlighet: klientregel — pin tegnes KUN når `assigned_to == meg`;
     oppretteren ser sine utsendte i en liste (ikke som pin). Ferdig
     (`status='done'`) → pinnen forsvinner; raden soft-deletes IKKE ved done
     (historikk/statistikk), men vises aldri igjen på tegning.
2. `drawing_markup` fra blob til RADER: + `created_by` (server-side satt),
   `kind` ('stroke' først), `visibility` ('publisert' — kladd forblir lokal fil).
   Én rad per publiseringsøkt (ikke per strøk — små nok, og angre-enhet).
   Fikser samtidig-publisering-taper-strøk og gir «slett publisert» (soft delete
   på raden) + forfatter-visning senere. Lesevei må tåle BEGGE former (gamle
   blob-rader finnes i liva-DB).
3. NY tabell `fire_devices` (KUN branndetektorer/brannkomponenter bærer register):
   `project_id, drawing_id, room_id?, loop_id?, x, y, kind`
   ('royk'|'varme'|'multi'|'melder'|'klokke'|'sirene'|'sentral'|'annet'),
   `tag` (format `sløyfe.adresse`, f.eks. 01.023), `serial?`, `model?`,
   `placed_at?`, `note?`, timestamps. Sync: én rad i `sync_tables`.
   - `drawing_loops` består som sløyfe-linjene; en node kan peke på en
     `fire_device` via `deviceId` i node-JSON (ingen skjemaendring — nodes er
     allerede JSON). Andre symboler (stikk, bryter …) forblir rene loop-noder
     uten register.
4. (Billig nå, verdifullt senere) `drawings.source` ('lokal'|'ekstern') med
   default 'lokal' — koster én kolonne, låser opp ekstern-grunnlag-prinsippet.

Revisjoner på `drawings` utsettes (egen fase når behovet er ekte).

### D. Editor-løftet (fase 4, brann først)

- **Select-modus** (mangler i dag): tap nær node/strøk/symbol → valgt; dra for
  flytt; slett-knapp; dobbelt-tap på device → detalj-ark. Uten select er
  «easy edit» umulig — dette er editorens viktigste enkeltløft.
- **Symbolpalett**: dagens 15 symboler + brannsett iht. NS 3924-ånden (multi-
  kriterie, sirene, sentral, brannmannspanel). Ett symbolbibliotek
  (`lib/symbols.ts`) med `kind`-mapping til `fire_devices.kind`.
- **Sløyfelinjer**: dagens loop-tap består, pluss: tap på eksisterende device
  KOBLER linja til den (snap-radius ~24px) i stedet for å lage ny node —
  «lines between fire detectors». Sløyfefarge per loop som i dag.
- **Device-ark** (bunark, gjenbruk `PromptSheet`-familien): tag (autoforslag =
  neste ledige adresse på valgt sløyfe: 01.001 → 01.002 …), serienummer med
  **strekkodeskanner** (expo-camera barcode — detektorer har strekkode på
  esken/sokkelen; tastatur-fallback), modell, rom (velger fra `rooms`),
  montasjedato (default i dag), notat.
- **Detektorliste**: skjerm per prosjekt (gruppert sløyfe → adresse) + deling
  som CSV via share-sheet nå (appen har ingen PDF-generering — bevisst; PDF/
  FDV-eksport kommer når arkivpakken trenger den). Kolonner = det montører
  faktisk fører: tag, type/modell, serienr, rom/plassering, dato, tegning.
- Angre publisert: nyeste egne publiserings-rad kan trekkes tilbake (soft delete).

### E. Oppgave-pins (fase 3)

- Opprett: langtrykk på tegningen (i pan-modus) → «Ny oppgave her» → ark med
  tittel, medlem-velger (fra `project_members`), frist, notat.
- Vis: pin-symbol på tegningen KUN for tildelt bruker; badge i prosjektdetaljen;
  «Mine oppgaver»-seksjon på Hjem (finnes ikke i dag — liten liste, frist-sortert,
  tap → åpner riktig tegning sentrert på pinnen).
- Ferdig: tap pin → ark → «Ferdig» → pin borte, `done_at` satt. Purring/varsel
  utsettes (ingen push-infra å bygge på nå).
- LiDAR-oppgaven (`kind='lidar_scan'`) består og får frist + rom-lenke gratis.

### F. Rom + skann-integrasjon (fase 5, liten)

- Rom-rektene på tegningen (finnes) får skann-chip: har rommet `scan_path`,
  vis 3D-ikon → tap åpner skann-vieweren. Motsatt vei finnes alt.
- (Senere, utenfor denne planen: mesh_markers-sync + R2-opplasting av GLB —
  begge er kjente lokale-only-hull.)

## Romdeteksjon på PDF (fase 6)

Rom tegnes manuelt i dag (dra rekt + navn). Automatikk er mulig, og den riktige
veien er en TRAPP der hvert trinn er nyttig alene — alt på enheten (null-kost-
regelen, offline-først):

1. **Tekst-etiketter (trinn 1, billig og treffsikkert):** arkitekt-PDF-er er
   som regel VEKTOR, og romnavnene («Stue», «Sov 2», «Bad», «12,5 m²») ligger
   som tekstobjekter med posisjon. Hvert romnavn-treff → foreslått rom-seed med
   NAVN ferdig utfylt. Filtrer på ordliste (norske romnavn) + fontstørrelse.
   Brukeren tapper forslagene han vil ha → rommene oppstår navngitt. Dette
   alene fjerner 80 % av manuelt arbeid.
   **Kryssplattform-uttrekk:** PDFKit gir tekst+bounds kun på iOS. Velg
   **pdf.js** (Apache-2.0, ren JS) for uttrekket — kjører i Hermes uten
   rendering, samme kodevei på iOS/Android/web. (Alternativ hvis pdf.js i
   Hermes skuffer: PDFium-bindinger (BSD) i en liten native-modul — FPDFText-
   API-ene finnes på begge plattformer.) Rasteringen (fase 1) er uansett
   native per plattform: PDFKit på iOS, android.graphics.pdf.PdfRenderer på
   Android; flood-fillet i trinn 2 jobber på rasteret og er plattformnøytralt.
2. **Flood-fill for form (trinn 2):** fra seed-punktene, fyll på det rasterte
   sidebildet (vegger = mørke streker stopper fyllet) → region → forenklet
   polygon som `rooms.shape`. Rom er IKKE lukkede bokser (døråpninger!), så
   tre forsvar i lag:
   - **Morfologisk lukking:** fortykk veggstrekene før fyll — dørblad +
     slagbue-strek halvlukker åpningen allerede, dilatasjonen tar resten.
     Med målestokk (fase 7) settes radiusen i ekte cm (~40–50) i stedet for
     gjettede piksler.
   - **Fler-seed-konkurranse (watershed):** fyll fra ALLE rom-etiketter
     samtidig — hver piksel tilhører nærmeste seed. En lekk døråpning deler
     seg da mellom «Stue» og «Gang» i stedet for at det ene rommet sluker
     det andre. Dette er hovedforsvaret.
   - **Arealvakter:** region-eksplosjon (over terskel, eller over «12,5 m²»-
     teksten når målestokk finnes) → kjør igjen med sterkere lukking → ellers
     manuell rekt-fallback (navnet fra trinn 1 består uansett).
3. **(Senere, hvis behov) ML-segmentering:** «floor plan recognition»-feltet
   (CubiCasa5k-klassen modeller) kan segmentere rom+vegger fra raster og kjøre
   som CoreML. Tyngre, og trinn 1+2 må bevises utilstrekkelige først —
   skannede/rotete PDF-er er caset som ev. krever det.

NB: `rooms.shape` er i dag en RECT — flood-fill gir polygon. Utvid shape-JSON
til `{poly: [[x,y],…]}` med rect-lesevei beholdt (kolonnen er allerede JSON —
ingen migrasjon).

## Andre hull vurdert (kort)

- **Målestokk-kalibrering + måling:** tap to punkter + skriv avstanden («denne
  veggen er 4,0 m») → `drawings.scale_m_per_unit` (én kolonne, JSON-frivillig).
  Låser opp: lengde på sløyfelinjer = KABELLENGDE-estimat, romareal fra polygon,
  avstandsmåling. Dette er broen til tilbud («tegning → tilbud»-gevinsten fra
  konkurranseanalysen) og bør inn som fase 7 — liten kode, stor verdi.
- **Tekstsøk i tegninger:** PDFKit-tekstuttrekk (samme som romdeteksjon trinn 1)
  gir gratis søk («hvor står 01.023 / kurs 15?») — lav prioritet, men gratis
  når trinn 1 er bygget.
- **Miniatyrer i tegningslista:** første side rasteres uansett i fase 1 —
  cache den som thumb i prosjektdetaljen.

## Byggerekkefølge og estimat

| Fase | Hva | Estimat | Risiko |
|---|---|---|---|
| 0 | Migrasjon v32 (tasks-kolonner, markup-rader, fire_devices, source) + server-SQL + sync_tables | 1 økt | Liva-DB-drift — verifiser før og etter; markup-lesevei må tåle blob OG rader |
| 1 | DrawingPane: raster + eid transform + Skia; porter viewer og editor | 2–3 økter | Størst teknisk risiko; mål zoomkvalitet mot dagens react-native-pdf før sletting |
| 2 | Multiview-grid + synk-lås + rutevelger; iPad-landskap | 1–2 økter | Minne ved 4 raster — cap oppløsning per rute |
| 3 | Oppgave-pins + Mine oppgaver | 1 økt | Lav |
| 4 | Select-modus, brannsymboler, device-ark m/ strekkode, detektorliste + CSV | 2 økter | Snap/select-følelse krever tuning på enhet |
| 5 | Rom-chip på tegning | ½ økt | Lav |
| 6 | Romdeteksjon trinn 1+2 (tekst-seeds + flood-fill) | 1–2 økter | PDF-kvalitet varierer — manuell rekt er alltid fallback |
| 7 | Målestokk-kalibrering + kabellengde fra sløyfer | 1 økt | Lav — broen mot tilbud |

Fase 1 kan A/B-es trygt: ny `DrawingPane` bak flagg, gamle skjermer består til
den vinner på enhet (samme mønster som meshscan-flaggene).

## Anbefalinger (mine, utover bestillingen)

1. **Ta fase 1 før noe annet synlig.** Alt (multiview, pins, symboler) blir
   dobbeltarbeid hvis det bygges på react-native-pdf-transformen først.
2. **Strekkode for serienummer** er den største hverdagsgevinsten i brannlaget —
   å taste 12-sifrede serienumre på en stige er nøyaktig det appen skal slippe
   folk for.
3. **Tag-autoinkrement per sløyfe** (neste ledige adresse) gjør at montøren kan
   plassere 40 detektorer uten å skrive ett tall.
4. Detektorliste-CSV er nok NÅ; PDF-eksport hører til arkiv/FDV-sporet og bør
   deles med kontrollrapport-behovet (FG-790-kontrollen er en naturlig fremtidig
   modul — kontrollseddel-feltene er kartlagt i researchen).
5. 4-up er iPad-flaggskipet, men 2-up med synk-lås er 90 % av nytten — ship den
   først også på iPad, og slå på 2×2 når raster-minnet er målt.

Relatert: docs/ROADMAP_2026-08.md (Tegningssamhandling-spec — markup-rader og
«fag er lag» herfra er innbakt over; revisjoner derfra er bevisst utsatt),
docs/DB_DRIFT.md (migrasjonsdisiplin).

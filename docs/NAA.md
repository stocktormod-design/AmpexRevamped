# Hvor vi står nå

**Sist oppdatert: 2026-09-08, natt til mandag.**

Kort nå-bilde. `docs/STATUS.md` er fra august og tar feil om flere ting (se
`docs/GJENNOMGANG_2026-09-08.md`), så les denne først.

---

## Tilstand i repoet

- **Gren:** `grossist-og-pool`.
- **147 ukommitterte filer**, 63 av dem nye. Siste commit er `efdb7d2` fra 2026-09-01.
  En uke med arbeid ligger usikret. Dette er det første som bør ryddes.
- `npm run typecheck` er grønn.
- 12 rene selvtester grønne. `verify:tripletex` grønn mot sandkasse.
- Ingenting er pushet.

## Det som ble gjort natt til 8. september

**Tripletex-integrasjonen er ferdig og verifisert ende til ende** mot sandkassen:
økt → hvem er jeg → kunde → prosjekt → varer → timer → ordre → faktura → betalt.
Alle synk-steg er idempotente. `lib/accounting/tripletex.ts` + `npm run verify:tripletex`.
Tokens i `.env.local`, testkontoen utløper mars 2027. Se `docs/REGNSKAPSINTEGRASJON.md`.

**Skann-pipelinen fikk jevnere flater, men er fortsatt ikke på Scaniverse-nivå.** Tak bakes nå som snitt av alle syn med
konsensus-avvisning og lokal eksponering; vegger beholder detalj fra vinnerfoto med tone
per hjørne. Frirom-utskjæringen er slått av, som ga vesentlig færre hull. Alle forkastede
alternativer med målinger står i `docs/SKANN_BESLUTNINGER.md`.

Kvalitetsrunden 8. september (avsnitt 6 i beslutningsloggen) sammenlignet ni bakes og
Tormods Scaniverse-skjermbilde. Mindre teksturretting og rettet fangstport er beholdt;
store tonegrenser/lysstriper gjenstår. Ny fangst må verifiseres med et nytt skann i vanlig tempo.
Videre audit rettet også kamerafart lest fra feil tidspunkt i bakgrunnskøen. Release-bygg
med begge fangstrettelsene er installert på Tormods iPhone 13 Pro 8. september; bygg,
typecheck og 11 fangstpåstander passerer. Flere godkjente vinkler kan fortsatt endre
takets teksturblanding; «flere runder skal aldri bli verre» er ennå ikke verifisert.
To nye korte skann av TV-/panelhjørnet er nå hentet og testet (beslutningsloggen avsnitt 7).
Senere bilder brukes: 73 → 98 % teksturdekning på samme geometri. Brutte/doble panellinjer
gjenstår etter sammenstilling, også med TSDF og ekstra warp. Rådata er bevart lokalt;
flere opptak trengs ikke for neste runde med bilde-/geometrijustering.
Retningen er nå uttrykkelig kvalitet inne i Ampex, ikke Scaniverse-import som løsning.
Justeringskoden velger nå beste faktisk målte poser/warp og kontrollerer også siste steg
(avsnitt 8). Syv nye selvtestpåstander passerer; panellinjefeilen er fortsatt åpen.
Endelig rettelse er testet med og uten warp, kontrollert mot soveromsskannet og
installert på iPhonen 8. september kl. 20:01. Ingen stor skarphetsgevinst er påvist ennå.
Bildeseleksjonen filtrerer nå på eksisterende dekningskrav før rangering (avsnitt 9).
En målt ugyldig vinner skjulte et brukbart veggbilde: rettelsen reduserer unødvendige
delinger/fallback i én-runde-fixturen. Seks Swift-påstander og begge Release-bygg passerer;
flerrunde-kontrollen viser ingen tydelig samlet kvalitetsendring. Panellinjefeilen består. Oppdatert bygg installert på iPhonen kl. 20:41.
Videre kontroll fant at lokal warp ikke nådde vinnerbildets detaljer eller sømfjæringen
(avsnitt 10). Oppkoblingen er rettet og testet med produksjons-Metal og tre bakes på de
to nye skannene. Standard er fortsatt warp av; ingen stor kvalitetsgevinst er påvist.
Simulator- og iPhone Release-bygg passerer. Denne siste runden er visuelt kontrollert
i simulatoren, ikke installert på telefonen.

**Mac-harness for baken virker.** Appen kjører headless i iOS-simulatoren og baker en
lagret bundle på 30 til 50 sekunder, med automatisk rendering. Kvalitetsarbeid på skann
skal gjøres der, ikke på telefon. Oppskrift i `docs/SKANN_BESLUTNINGER.md`.

**Full gjennomgang av hele prosjektet** er gjort. Rapport i `docs/GJENNOMGANG_2026-09-08.md`.

## Det som haster mest

1. **Fler-firma-isolasjonen er brutt.** Policyen for oppdatering av `profiles` binder bare
   `id`, ikke `role` og `company_id`. En innlogget bruker kan flytte seg selv inn i et
   annet firma og få full tilgang. Fiks skrevet, **ikke kjørt**:
   `supabase/migrations/20260908090000_profile_privilege_guard.sql`.
2. **13 tabeller synkes aldri, men merkes som synket.** Signaturer, godkjenninger, tilbud
   og arkivpakker lever kun i SQLite på én telefon og tapes ved reinstall.
3. ~~**`r2-sign` mangler firmascoping.**~~ **Lukket 12. september.** Funksjonen krever nå
   innlogget bruker (anon-nøkkelen avvises med 401), leser firmaet fra `current_company_id`
   og legger alle objekter under `firma/<company_id>/…` i R2. Klientnøklene er uendret.
   Verifisert live: anon 401, testbruker får eget prefiks, `..` og fremmed prefiks avvises,
   PUT/GET gjennom signert URL går rundt. De fire seed-tegningene fra 4. juli lå uten
   prefiks og må lastes opp på nytt. Deployet som versjon 14.
4. **Commit.** Se punkt om ukommittert arbeid over.

## Skann 12. september (kveld)

Hele kjeden gjennomgått (§95) og panelhakket funnet: det er posefeil på noen få uskarpe
bilder (7–12 mm), ikke geometri og ikke snitt-metoden. Ny `planeAlign` i
`MeshPoseRefineV2.swift` måler bilde mot bilde på dominantplanene og løser warp-rutenettet
per bilde; kalles fra baken etter den rigide refinen, `meshscan.planalign = "off"` for A/B.
Toppraden på panelveggen er nå nesten på linje. Snitt-veien er fortsatt myk, og §96 sier
hvorfor (lik vekting av ulik skarphet). Senere på kvelden ble målingen PARVIS med felles
løsning over alle bilder (§96, «Kveld»), etter at Tormods nye skann viste en søm som den
første varianten ikke tok. Release-bygg fra kl. 20:34 er installert på iPhonen, med tre
runder som standard. Bygg fra kl. 21:40 legger til luma-til-disk i fangsten og celler på disk i justeringen
(§96 «Sent på kvelden»), pluss fokusvakt v2 (innholdsbasert, dytter autofokus). Samme bygg har en FOKUSVAKT i fangsten (`MeshScanPresenter`): rammer
tatt mens linsen stiller seg holdes igjen, hintet sier «Hold stille et øyeblikk — kameraet
fokuserer», og loggen skriver median skarphet på keyframes ved slutt (skannet 20:23 var
mykt: 35 mot 259 — fokus/lys, ikke fart). Ingen regresjon på soverom/nyskann. UKOMMITTERT sammen med r2-sign,
eas.json og docs.

## Åpne tråder

- **Skann:** bad og stue må skannes på nytt med dagens app. Bare ett komplett LiDAR-skann
  (soverommet) finnes å måle på, så standardverdiene er ikke bekreftet på andre rom.
  Hull ved glass, speil og under møbler er uløst.
- **Boligmappa:** søknad sendt 7. september, venter på oppstartsmøte og sandkassenøkler.
- **Fiken-adapteren** ville feilet ved første ekte kall og har ingen test. Tripletex er
  veien som virker i dag.
- **PDF-laget er bygget og testet, men ingen skjerm importerer det.** «Del» på faktura
  sender tabseparert tekst.
- **Utviklerprofilen på telefonen utløper 14. september kl. 19:59.** Da må appen bygges og
  installeres på nytt. Profilen er fra et *gratis* personlig Apple-team («Tormod Holand»,
  Z4ZUZRL65Q, kun «Apple Development»-sertifikat, 7 dagers levetid). TestFlight og EAS-
  distribusjon krever betalt Apple Developer Program (999 kr/år) og innlogging i Expo
  (`npx eas-cli login`, deretter `npx eas-cli init` som skriver `extra.eas.projectId`).
  `eas.json` med development/preview/production-profiler ligger klar i rota (12. september).
  Inntil kontoen er betalt er eneste vei å bygge om med xcodebuild hver sjuende dag.
  Opprinnelig punkt:
  installeres på nytt.

## Miljø

- Telefon: iPhone 13 Pro, «Tormod sin iPhone». Siste Release-bygg er installert.
- Bygg og installer: `xcodebuild -workspace ios/Ampex.xcworkspace -scheme Ampex
  -configuration Release -destination 'generic/platform=iOS' -allowProvisioningUpdates build`
  etterfulgt av `xcrun devicectl device install app --device <UDID> <sti til Ampex.app>`.
  Ikke bruk `expo run:ios` trådløst, den henger på «Connecting to».
- Codex CLI er installert og innlogget som stocktormod@gmail.com, men på gratisplan.


### Skannarbeid, videre kveld 8. september
Kantmålinger (beslutningsloggen §11) viser konkrete bildeavvik på panelveggen, også
med annen geometri. Punkt-holdout viser at målte forskyvninger kan redusere kantfeil
kraftig, men fire før/etter-bakes har fortsatt synlige skjøter. Kun diagnostikk og
separate fixture-kopier endret denne runden. Neste steg er robust justering mot
kantkorrespondanser over flere bildeområder; Scaniverse-målet er fortsatt ikke nådd.

Kantjusteringen er videre testet som et nettverk med tre referansebilder per skann (§12).
Bedre lokal enighet, men sampler-kontrollene har fortsatt skjøter. CPU-fargemålingene
bruker ennå ikke samme warp som sluttsampling; dette er neste konkrete kontroll.
Simulatorbygget passerer. Ingen ny telefoninstallasjon eller standardendring.

CPU-fargemålingene etter bildevalget bruker nå samme warp som teksturen (§13).
Ni nye påstander, begge Release-bygg og tre bakes passerer. Kontroll fra to vinkler
viser bare små fargeendringer; hovedgapet mot Scaniverse består. Neste steg må dekke
korrespondanser/justering over hele skannet i native-koden, utover panelprototypen.

Native kantmatching er implementert som avslått eksperiment (§14). Kjent syntetisk
forskyvning og begge Release-bygg passerer. Testet på de to nye skannene og hele
soverommet: bedre punktresidual, men soverommets røde paneler blir mer utsmurt enn
kontroll fra samme kode. Ikke aktivert eller installert. Neste steg er å undersøke
romlig restfeil/feiltreff før lokal justering; global forskyvning er ikke tilstrekkelig
kvalitetsbevis. Alle resultater i `native-edge-checks` under fixture-arkivet.

Romlig audit (§15) bekrefter at global median skjuler lokale feil: 10,2 % av
soverommets holdout blir >1 px verre. Affin Mac-modell reduserer p90 noe, mest på
panelopptaket. Neste steg er visuell feltkontroll; ingen affine felt er ennå lagt på
modeller. Ny diagnostikk er opt-in og testet i simulator; målet står åpent.

Affint felt er prøvd i ferdige modeller (§16), med små endringer og fortsatt blur;
ikke aktivert. Begge Release-bygg passerer. Viktigere funn: soverommets matchgraf
har 15 adskilte grupper og fem isolerte bilder. Neste steg er å koble gruppene med
pålitelige treff fra overlapp/gjenbesøk, før mer fleksibel warp. Felt-/bakeartefakter
ligger i `affine-field-checks` under fixture-arkivet.

Overlappbasert kandidatvalg (§17) kobler alle 152 bilder, 132 med strengere støtte
(før største gruppe 23). Både globalt og affint felt er bakt og sett på; fortsatt
ikke klar visuell kvalitetsgevinst. Ingen standardendring/installasjon. Neste steg:
spore hvilke kildebilder som bidrar til en konkret uskarp flate og måle deres
innbyrdes samsvar, fremfor å optimalisere samlet residual videre.

Punktavlesning (§18) identifiserer frame-60 som detaljkilde, 16 tonekandidater og ingen
søm-fjæring på valgt rødt panel. Grovere tone (64 px) hjelper enkelte detaljer, men er
ikke aktivert. Projiserte kildepatcher viser store ulike plasseringer av panelmønsteret.
Neste steg er entydig matching med større utsnitt/innfangingsområde og test på repetert
mønster; småpatch-NCC kan finne feil spor. Begge Release-bygg passerer, ingen installasjon.

Større patch/søk (§19) finner store kjente skift og avviser periodiske striper i test.
Rommet får 147 sterkt sammenkoblede bilder, men fortsatt ingen klar visuell gevinst.
Nær problemflaten finnes innkommende treff; global justering etterlater 11–28 px feil
akkurat der. Neste kontroll må måle denne lokale feilen under bedre justeringsmodell,
ikke bare samlet median. Simulatorbygget passerer, eksperimentet er avslått i appen.

Lokal utelatt validering (§20) avkrefter at affin modell alene løser problemflaten:
lokal median fortsatt ~20 px, selv om øvrig holdout bedres. Aksepterte lokale
matcher viser bare repeterte spor; korrekt strukturtreff er fortsatt uavklart.
Neste kontroll må inkludere større entydig kontekst. Ekstra støy/stripe-test
avvises allerede korrekt. Ingen native standardendring eller installasjon.

To-skala-kontekst (§21) har også blitt prøvd og rendret fra detaljfotoets kamera.
Ingen lokal støtte ved problemflaten, fortsatt doble mønstre, 58,5 s justering.
Ikke aktivert. Neste retning: eksplisitte bildehjørner/deskriptorer og geometrisk
verifisering; større tangentplan-NCC har ikke løst problemet. Simulatorbygget passerer.

SIFT/epipolarkontroll på Mac (§22) finner verifiserbare forbindelser 54→55,58→55 og
61→60. Røde panel alene er for tvetydige; fullbilder gir brukbare punkter. Rådybde+
AR-kameraer viser flere pikslers reprojeksjonsfeil på gode par. Neste steg er fysisk
kamerajustering med dybde og holdout, ikke mer NCC-offset. OpenCV ligger kun i et
isolert midlertidig miljø; appen er uendret, målet fortsatt åpent.

PnP med LiDAR (§23) gir stor lokal gevinst på 58→55 (holdout 10,64→2,09 px), men
kamera-55-forslagene fra referansene 54 og 58 motsier hverandre i krysskontroll.
Ingen forslag er lagt i app eller modell. Neste steg er felles poseløsning over
flere verifiserte bildepar, med anker/prior og holdout, framfor enkeltkameraendringer.

Felles kamerajustering (§24) forbedrer målte korrespondanser på syv kameraer, men
visuell A/B med identisk geometri har fortsatt doble panelkanter og hull. Ikke
aktivert; rådata bevart. Neste kontroll isolerer bidraget fra uskarpt detaljfoto60
ved å utelate det i en separat bake. Scaniverse-kvalitet er fortsatt ikke oppnådd.

Kildebilde-ablasjon (§25) viser renere panelspor med kun frame58 på samme AR-geometri,
men bare 7 % teksturdekning. Fullmodellens faktiske vinner her er frame96; tidligere
frame60-sporing gjaldt TSDF og kan ikke overføres. Neste kontroll må skille regionvalg
fra tonekorreksjon med alle foto beholdt. Nytt bevis for bedre detalj i rådata, fortsatt
ingen løsning eller aktivering i appen. Resultater arkivert i source-selection-checks.

Fullmodell med tone av (§26) får færre trekantformede dobbeltmønstre på panelet,
men er fortsatt myk; svakere ICM endrer ikke detaljvinner96 der. Neste kontroll er
om planet er låst før ICM, og hvorfor planvalget foretrekker dette bildet. Global
labelvariasjon på 1,56 % mellom kjøringer begrenser A/B-tolkningen; lokale sporede
vinnere er like. Ingen standardendring/installasjon, Scaniverse-målet fortsatt åpent.

Planlåsen er nå målt direkte (§27): problemflater på AR-geometrien låses til96.
Harness-opplåsing bytter til60 og gir flere brudd. Scorekontroll viser at60 faktisk
slår58 etter at kvalitetsforskjellen komprimeres av et 0,3-gulv. Neste konkrete
forsøk er sterkere kvalitetsvekt, med dekning/sømmer kontrollert på flere fixtures.
Begge simulatorbygg passerer; kun diagnose/harness endret, ingen telefoninstallasjon.

Kvalitetsvekting (§28) er implementert som avslått harness-forsøk. Henter skarpere
frame58 på soveromspanelet, men søm-/geometrifeil består. Kontrollert på begge nye
TSDF-fixtures med like dekningstall (96/99 %); små, blandede visuelle endringer og
fortsatt linjebrudd. Ingen aktivering/installasjon. Neste steg er konkret lokal
vinner-/dybdesporing av linjebruddet på ny-fixturen, ikke mer global tuning.

Vegg-/dybdekontroll (§29) finner flere centimeters tidsavhengig uenighet i både
RGB-keyframe-dybde og dense-rådybde på den nye fixturen. Snap-kontroll flytter flaten
1,6 cm, men løser ikke forskjellen eller linjebruddet. Nær bruddet bruker modellen
frame5 og6 på nabotrekanter. Neste kontroll må skille kameradrift/dybdebias og måle
bildesamsvar der. Ny ray-diagnostikk og avslått unsnap-flagg; simulatorbygg passerer,
standard og telefon uendret. Fortsatt ikke Scaniverse-nivå.

RGB-kontroll på ny fixture (§30) finner gode lokale treff, men nesten bare på
kleshengerne ved høyrekanten. Kameraforslag motsier hverandre og brukes ikke.
Ingen sikker RGB-bro mellom tidlige/sene dybdegrupper ennå. Neste steg må bruke
selve veggens tidsavhengige dybdeobservasjoner og holde ubestemte frihetsgrader
låst. Kun Mac-diagnostikk endret; rådybdeavviket i§29 består, målet fortsatt åpent.

Begrenset normaltranslasjon av veggobservasjoner (§31) er prøvd på separat kopi;
fortsatt linjebrudd, ikke aktivert. Videre kodeaudit fant og rettet en reell halvvoxel-
feil (§32): SDF ble målt i voxelmidtpunkter men meshen plassert fra hjørner. Nå samme
koordinatkonvensjon.24 analytiske produksjonsløkketester og begge Release-bygg passerer.
Begge nye fixtures visuelt kontrollert; fortsatt langt fra Scaniverse-kvalitet.
Dette er en beholdt TSDF-rettelse, mens øvrige forsøk er av. Ikke installert på telefon.

9.september kl00:01: koordinatrettelsen fra§32 er installert på iPhone13Pro etter
dekningskontroll (§33).96→95-loggtallet tilsvarer0,34 prosentpoeng labelareal; ingen
nye label-løse trekantsentre innenfor bildene ble funnet. Grenseflater uten foto
hadde tidligere arvet bildenummer og blitt telt med. Ingen dekningsporter svekket.
24 kontroller og begge bygg passerer. Scaniverse-kvalitet fortsatt ikke oppnådd;
øvrige eksperimenter er fortsatt av, ingen nye råskann trengs for neste analyse.

GPU-regresjonskontroll (§34) kjører produksjonens Metal-fusjon og vertex-uttrekk med
kjente multiview-plan. Maks0,003 mm frontalt og1,853 mm skrått; testen passerer.
Dette avgrenser årsaken til restavviket, men inkluderer ikke etterglatting/snap eller
råopptakets usikre poser. Ingen ny native endring/installasjon; Scaniverse-målet består.

Volumglatting (§35) har fått korrekt3D-nabogrense og regresjonstest. GPU+blur-testene
passerer, begge Release-bygg passerer. Geometrien på én-runde-fixturen er bit-identisk
med forrige kontroll; denne kantfeilen forklarer ikke linjebruddene. Ingen ny
telefoninstallasjon. Tidsavviket i råobservasjonene er fortsatt hovedsporet.

Tid-/planaudit (§36): ingen åpenbar ny køfeil i fangsten, rå/glattet veggdybde rundt
samme tid skiller under2 mm i testen. Observerte veggnormaler varierer opptil1,5°,
men kamerarettelse fra dem forverrer uavhengige RGB-treff på6→5. Forslagene brukes
ikke. Kun diagnostikk endret; kamera-/dybde-/kalibreringsårsak fortsatt uavklart.

Kontroll av faktiske native kameraer (§37) viser bedre RGB-samsvar på alle tre
testede par, men store restfeil. Mesh-stråler forklarer lite av restfeilen ved
kleshengerne; diagnosen er kontrollert mot analytiske stråler og OpenCV-projeksjon.
Alle14 foto er prøvd mot tidlig/sent referansebilde uten sikker ny forbindelse til
sen dybdegruppe. Kamerajusteringen beholdes; ingen native endring/installasjon.
Neste arbeid må måle samsvar på problemflaten eller hente bredere sikre bildetreff.

Panellinjekontroll (§38) viser at native kamerajustering bedrer høyrekanten men
forverrer venstre del av veggen. Et avgrenset målefelt for frame4/6 gir færre brudd
i to simulatorbakes; ferdig render ved venstrekanten går9,56→0,62 px mot valgt
referansefoto. Fortsatt hull og skjøter. Dette er et manuelt avgrenset veggforsøk,
ikke en generell apprettelse. Neste: robust utvelgelse og kontroll på flerrundeskann.
Ingen native endring/installasjon. Før/etter-bilder er lagt i sammenligningssiden.

Flerrundekontroll (§39): bare frame16 passerer linjefeltportene, men ferdig modell
får blandede/negative linjeendringer. Fire bakes, også med planfargeutjevning av,
avklarer ikke forskjellen mellom kildeholdout og sluttbilde. Feltet forblir av.
Neste kontroll: gjentakbarhet i faktiske raffinerte kameraer og deres teksturkoordinater.
Ingen native endring/installasjon; alle testbakes er ferdige.

Bidragskontroll (§40) forklarer feltregresjonen: kameraene er identiske mellom
kontroll/feltbake. Linjefeltets største gevinst ligger der andre foto er vinnere;
der frame16 faktisk leverer detaljene, øker p90-feilen0,76→2,41 px. Ny diagnose
filtrerer ut dette feltet. Én-runde-forsøket har for få utelatte treff i egne
vinnerområder til aktivering. Neste: målepunkter og holdout ved faktiske vinnerflater
og sømmer. Ingen native endring/installasjon; siste bake er ferdig.

Bidragsstyrt linjeforsøk (§41) finner frame1 som kilde til bruddene øverst i
flerrundeskannet. Begrenset krum modell passerer ferske, utelatte striper:
median7,76→0,28 px. Ferdig bake får bedre øvre panel (x950:11,20→0,21 px), men
fortsatt brudd ved områdekanten og hull. To kameravinkler kontrollert. Frame16
korrigeres ikke. Ingen native endring/installasjon. Neste: områdeoverganger og
automatisk valg av vegg/referanse/retning; manuell fixturetilpasning er ikke appklar.

Rutenettkontroll (§42) finner at feltets nedtoning reduserer korreksjon inne i validert
område: faktisk p904,73 px mot ideell0,53. Verktøyet validerer nå bilineært felt,
og dagens felt avvises. Ekstrapolasjon ytterst feiler også2 px-porten; nabobilder
frame0/15 må håndteres separat. Neste overgang må testes etter faktisk grid-sampling.
Ingen native endring, bake eller installasjon denne runden.

Direkte tilpasset rutenett (§43) passerer faktisk sampling på frame1-veggen:
separate stripepunkter p900,61 px. Ny bake gir bedre overgang (x1200:10,91→0,67 px),
men nabovinnere frame0/15 og hull gjenstår.43 noder nær treningstreff kan endres,
andre holdes null. To kameravinkler kontrollert. Neste: nabobidrag og automatisk
område-/referansevalg. Ingen native endring/installasjon; bake ferdig.

Naboaudit (§44) finner stripealias i frame0: direkte nærmest-søk foreslår−25 px,
kjeden via frame1 omtrent+40. SIFT på statiske detaljer (TV utelatt) støtter den
positive grenen, men homografien er ikke presis nok som veggwarp. Neste: flere
verifiserte frame0-linjer i faktisk bidrag før feltløsing. Ingen bake/native endring
eller installasjon denne runden; ikke bruk det negative direkteforslaget.

Nabofelt (§45): linjekjeden gir16 trening/18 holdout i frame0-bidraget. Faktisk
grid-sampling p901,78 px; kombinert felt0/1 gir bedre høyreskjøt i testmodellen
(x1320:10,02→2,30 px). Fortsatt feil og hull. To vinkler kontrollert, bake ferdig.
Neste apprettede steg: samle metoden uten hardkodet vegg/kamera/ROI og kontrollere
avvisning ved utilstrekkelig støtte. Ingen native endring eller installasjon.

Automatisk flateaudit (§46) finner panelveggen i begge fixtures uten valgt kamera,
veggretning eller ROI.6/4 planarregioner funnet. Hele veggen har flere bidragsbilder;
ingen foto dekker alt. Neste: overlappende delområder og referansevalg med faktisk
sikt/skarphet. Kun diagnostikk; ingen bake/native endring/installasjon.

Automatisk overlapp (§47): dybdestøttede trekantsentre gir74/182 mulige bildelenker
på panelveggen i de to skannene. Kjente naboforbindelser finnes uten valgte kameraer.
Dette er kandidater, ikke bekreftede RGB-treff; periodiske spor er fortsatt tvetydige.
Neste: lokal skarphet/detaljstøtte for referansevalg. Ingen native endring/bake/installasjon.

Lokal detaljaudit (§48): rettet måling som belønnet støy i uklare foto. Automatisk
flateinndeling gir nå20/19 delområder med flere detaljstøttede fotokandidater.
Syntetiske kontroller passerer;81/81 støttede ekte utsnitt rangeres over pålagt
uskarphet, men portene ble utviklet på samme materiale og er ikke uavhengig validert.
Neste: kontroller samme fysiske panelspor mellom lokale kandidater før feltløsing.
Ingen ny referanse/warp aktivert, native endring, bake eller telefoninstallasjon.

Automatisk profilsamsvar (§49):1/24 og6/35 lokale bildepar gir entydige kandidater
i to separate bånd. Ett flerrundetreff0→1 støttes av tidligere statiske bildetreff,
men har fortsatt2,6–3,3 px avvik mot den omtrentlige homografien. Repetisjoner
avvises i syntetisk kontroll. Ikke nok støtte til generell retting; tangentbevegelse,
identitet på øvrige flater og native bidragskontroll gjenstår. Ingen bake/installasjon.

Lokal detaljidentitet (§50):768 px originalfoto-projeksjon og alle kandidatpar gir
fortsatt for få spredte paneltreff. De eneste to modellene med mange treff er TV-
innhold som feiler romlig holdout kraftig. Ikke bruk disse modellene. Neste kontroll
må hente større sammenhengende støtte og avvise dynamikk; små40 cm-fliser alene
løser ikke identiteten. Ingen native endring/bake/installasjon, analyser ferdige.

Hele planarregioner (§51) er prøvd ved2048 px, alle bildepar. Panelveggen har fortsatt
for få spredte karakteristiske treff; alle store treffsett ligger på TV-flaten.
TV-overlegg kan gi lav holdoutfeil selv om annet skjerminnhold endres. Ikke bruk
skjermens modell på veggen. Neste: bredere romdetaljer på tvers av plan med faktisk
3D-støtte. Ingen native endring/bake/installasjon; analyseprosessene ferdige.

Fullscene/dybdeaudit (§52) finner ny forbindelse1→3 i én-runde, men flerrundens
panelbilder2–7/15–20 mangler fortsatt sikre grafkoblinger i testen. Største gap i
bevart RGB er6,333 s mens28 dybdemålinger finnes i samme tidsrom. Erstatningsbufferen
bevarer ikke nødvendigvis tidskontinuitet. Årsak til gapet og effekt på veggen er
ikke bevist. Neste: separat begrenset diagnostikk av mellomfoto/avvisningsgrunner
før ny telefoncapturetest. Ingen native endring/bake/installasjon; prosesser ferdige.

Opptakslogg (§53) lagt inn uten endrede capture-regler. capture-decisions.json viser
avvisningsgrunn og faktisk overskriving med gammelt tidsstempel; tak20000 hendelser
med eksplisitt truncation. Native journaltest og11 retry-kontroller passerer,
iPhone Release passerer og er installert på13Pro (databaseSequence1896). Trenger
nå ett nytt20–30 s skann med to passeringer i normal fart og Ferdig for å forklare
RGB-tidslukene. Ingen ekstra RGB er lagret av loggen; forkastede bilders kvalitet
kan ikke måles fra journal alene. Release simulatorbygget passerer også; begge
byggeprosesser er ferdige.

### Skann, 9. september – siste kontroll (§54–58)

Normalfartskannet er mottatt og kontrollert; ny skann trengs ikke nå. 8192-atlas er
aktivert og verifisert på iPhone 13 Pro (§54), siste telefoninstallasjon kl.17:37.
Større atlaspakker og direkte råteksturer ga ikke en samlet videre gevinst (§55).
Mottatt Scaniverse-GLB bruker også ett8192-atlas; prosjektive UV-felt er målt direkte
i eksporten (§56). Native test med tilsvarende felt og uendret bilde-/fargebehandling
ga nesten samme detaljer som dagens Ampex (§57), og er bare en avslått test.

Viktig korrigering av årsaksbildet: hele frame43-detaljutsnittet kommer fra foto43;
detaljtapet der kan ikke skyldes overganger mellom vinnerbilder. Grovere plan-tone
(64 mot512) gir mindre flekkete lys, men nesten ingen ekstra lokal skarphet (§58).
Ingen standardendring eller ny telefoninstallasjon fra disse testene. Simulatorbygg,
native pakkertest og geometriidentitet passerer. Neste isolerte kontroll er tapet
fra råfoto til tekstur inne i ett fotoområde, før mer generell bildejustering.

### Skann, 9. september kveld – rettet tonefeil; nytt skann fortsatt utilstrekkelig (§59–60)

HYBRID-tonen måles nå ved64px, mens FLAT-tak beholder512px og detaljen fortsatt
kommer fra original3840×2160 foto. Målt feil: mørke panelspor i512px-hjørnesampling
ga+0,122 lineær opplysning over en lys trekant som skulle dempes. Rettelsen gir
−0,020 og fjerner den sterke lokale hvite flekken. Native regresjon passerer;
tre ekte fixtures visuelt kontrollert, tak i soverom uendret, panelsporbredde
uendret. Simulator og iPhone Release bygger. Installert13Pro, databaseSequence1920.

Brukeren tok deretter NYTT skann `ampex-cd97e012-c91e-4e70-9e72-4ebaf1373503-1788974472517`
og påpekte at det ikke er Scaniverse-nivå. Det stemmer med direkte kontroll av
telefonens GLB `mesh-ampex-cd97e012-c91e-4e70-9e72-4ebaf1373503-1788974502183.glb`:
store panel-linjesprang og fargegrenser står igjen. Pipeline bekrefter faktisk
HYBRID64, atlas8192,36 fulloppløsningsfoto,97% teksturdekning og8,110s bake.
Ingen hard fart-/blur-avvisning. Ni erstatninger underveis; siste foto er beholdt.
Ikke be om ny skann eller skyld på brukerens fart på dette grunnlaget.

Pose35 viser en stor overgang mellom foto35/31, lenger ned4/31. Begge sider ligger
på SAMME geometriske veggplan og er HYBRID, locked=false. Korreksjon av tone eller
mer atlasoppløsning løser ikke disse linjesprangene. Ekte telefonmodell og originale
kamerafoto sammenlignes i eksisterende viewer `latest.html?frame=35` (nytt datasett;
ikke forveksle med `index.html` som fortsatt viser den forrige45foto-fixturen).
Fixture `/private/tmp/ampex-new-scan-1788974472517`, kontrolltrace1788974749346 og
punkttrace1788974944323. Den nye telefonskannen er ikke overskrevet.

Apple Object Capture ble faktisk prøvd på45foto-fixturen med og uten rådybde.
Kun7/8 foto beholdt og ingen panelvegger rekonstruert: forkastet for disse dataene.
Ikke presenter denne API-en som en ferdig alternativ pipeline.

### Skann, 9. september – felles veggtone installert (§61)

Nabotrekanter på samme vegg bruker nå ett felles bredt tonemål ved sine delte
hjørner. Støttebilder får gradvis innflytelse ved bildekanten, og små feilklassifiserte
normaler på ellers støttede veggflater lager ikke lenger en annen tonebehandling.
Manglende tonestøtte kan videreføres én gang fra to observerte veggnaboer innen5cm.
Dette retter to konkrete fargeskjøter i det siste36foto-skannet:≈20→≤1 og4→0
RGB-nivåer langs de målte kantene. Fulloppløsningsdetalj, geometri og kamerajustering
består. Standard på; `meshscan.toneshared=off` er kontroll.

Tre ekte skann visuelt kontrollert i SceneKit, inkludert hele soverommet og taket,
uten ny synlig forringelse. Native regresjon og begge Release-bygg passerer.
Installert på13Pro, databaseSequence1928. Kontrollbake på telefonen med standarden
fullfører på7,850s og97%dekning (1788977687868). Den opprinnelige siste telefonmodellen
er bevart. Viewer `latest.html?frame=20&variant=shared-tone` kan bytte mellom den
og rettet bake av de samme rådataene. Panellinjer hopper fortsatt: dette er en
verifisert tonefiks, ikke Scaniverse-nivå. Ingen nye skann trengs for videre kontroll.

### Hull i geometrien, 9. september (Claude)
Målestokken er nå Scaniverse-eksportens åpne mesh-grense per m² (3,70 m/m²). Våre bakes lå
på 5,07 og 4,03. Årsak: TSDF-veien — standard geometri og den «Bygg om modellen» bruker —
kalte aldri hullfyllingen, og fyllingen ga i tillegg opp på kryssvertekser (der to slisser
møtes). Begge rettet; A/B på to bundles gir 3,46 og 3,34 m/m², altså under referansen, med
uendret baketid og uendret `fylt`. Detaljer og tall i `docs/SKANN_BESLUTNINGER.md` §63.
Live-skannets anchor-nett har fortsatt sitt eget sprekknett (150,8 m i én komponent) — det
er frosset i fixturen og må løses på enheten. Neste målte gap er tekstur: 7 % av flaten på
soveromsbundelen har ikke foto (hvit søyle på veggen ved vinduet).

Den hvite søylen på veggen er også borte (§64). Den var 2,03 m² flate som ingen keyframe
malte — 98,7 % av de vinnerløse flatene lå aldri innenfor noe kamerabilde — og JPEG-en
flatet alfa 0 mot hvitt. Baken fyller nå slike felt med push-pull fra naboflatenes tone
(31 ms). Hvite piksler i renderen: 8,75 % → 0,01 %. Malte texler er urørt. Rotårsaken —
at keyframe-utvalget ikke dekker det dybdestrømmen bygger geometri av — står igjen og
krever et nytt skann for å testes.

Panelsporene er også bedre (§65): veggen var delt i 15 fotolapper fordi annekteringsterskelen
sto i ANTALL FLATER (30) og var kalibrert for ARKit-nettets grove trekanter — på TSDF er det
5 dm². Terskelen er nå areal (0,25 m²), annekteringen går bare oppover i størrelse, og hvert
plan begrenser kandidatene til topp-4 foto med et kvalitetsgulv. Søm per m² vegg: 2,76 → 1,58
(og 4,28 → 2,59 på andre bundle). Brudd i sporene i nærbilde: 0,0339 % → 0,0129 % av pikslene,
med 1,7 % tapt sporkontrast. Underveis ble det funnet at `meshscan.icmpotts` aldri virket —
flagget leste bare string-veien mens A/B-selen sender tall. Alle tall-flagg går nå gjennom
samme parse.

Referansen er nå MÅLT på samme vegg (§66): vi har 48 % mer sporkontrast enn Scaniverse-
eksporten og litt flere brudd (0,039 % mot 0,031 %). Gapet er ikke detalj. Det som gjenstår er
DEKNING: 1,92 av de 2,03 m² uten foto ble sett av dybdekameraet med median 9 bilder, men av
null lagrede foto — 480 av 1063 fangstbeslutninger i det skannet ble avvist av minsteintervallet
på 0,2 s. Fangsten slipper nå en ramme forbi intervallet når over 25 % av synsfeltet er
ufotografert. Release-bygg installert på iPhonen 9. september kl. 22:23. **Neste steg krever
deg: skann et helt rom med dagens app**, så måles hele kjeden mot referansen for første gang
på et komplett rom.

Fullromsmåling er nå gjort på tre rom gjennom produksjonens TSDF-vei (§67, ny
`tools/fixture-til-tsdf.py` gjør gamle fixtures TSDF-kjørbare). Der er vi 25–56 % mer åpne enn
referansen (4,66–5,77 mot 3,70 m rand/m²) — men rommene har bare 103–166 dybdekart mot et ekte
skanns ~5 Hz, så tallet er pessimistisk. Resten av randen vår ligger i få STORE åpninger, ikke
mange små hull som hos Scaniverse. Fangstgapet kan ikke måles på disse (dybden ER keyframene,
så fylt=100 % per konstruksjon).

To forsøk på å lukke fullromsgapet er målt (§68). Å sy sammen TSDF- og ARKit-flaten gjør randen
verre (6,64 mot 4,98 på stue) fordi to åpne flater som møtes uten å henge sammen teller dobbel
rand. Å skrive ARKit-nettet inn i tomme voxels virker der dybdedata er TYNNE (stue 45,4 → 81,3 m²
flate med litt bedre rand), men er en liten forverring der dense-strømmen er ekte. Standard er
derfor av; `meshscan.tsdftillegg=volum` slår den på for tynne skann.

Fullromsgapet var vektterskelen i TSDF-en (§69). `minWeight` sto på 4, kalibrert for tette
skann; på et rom med tynn dybdestrøm spiser den flate. Ny standard 2,5, og under 1,0 dybdekart
per m³ senkes den til 1,5. Stue 4,98 → 3,72 m rand/m², gang 5,77 → 3,73 — referansen er 3,70.
Kvalitetsgulvet er samtidig senket til 0,55, som gir 4,7× færre brudd i sporene for 13 % mindre
kontrast. På de to bundlene med ekte dybdestrøm slår vi nå referansen på ALLE fire målene
(rand/m², sporkontrast, brudd, veggens planhet). Badet står igjen på lukkethet (4,42, speil og
glass). Uverifisert: et helt rom med ekte dybdetetthet, og fangstfiksen på enhet.

**Ekte fullromsskann er nå målt (§70).** Telefonen hadde et skann fra 9. september kl. 21:14
— 113 foto, 321 dybdekart, 75 s — som ble hentet med devicectl. Mot Scaniverse-eksporten:
rand 3,26 mot 3,70 m/m², veggplanhet 3,2 mot 30,1 mm, hvite flater 0,00 mot 0,00 %,
sporkontrast 0,522 mot 0,507 %. Fire av fem mål på eller bedre enn referansen. Brudd i
sporene er 0,0447 mot 0,0264 % — det eneste som står igjen. Fangstloggen i det skannet:
1198 av 2488 beslutninger avvist av minsteintervallet, altså nøyaktig feilen fangstfiksen
retter (skannet ble tatt før fiksen var installert). Baken var heller ikke deterministisk;
Dictionary-iterasjonen i annekteringen er nå sortert.

Prosjektive felt er nå prøvd ut til bunns på det ekte fullromsskannet (§72). Ingen konfigurasjon
slår referansen på BEGGE mål: vår standard har best sporkontrast (0,522 % mot 0,509 %) og 1,2×
referansens brudd; den prosjektive treffer bruddnivået (0,0300 mot 0,0305 %) og taper 17 %
kontrast. Feltnøkkel per foto, rutedeling og «kun vegg» er alle målt og forkastet. Regnestykket:
ett 8192-atlas rommer ~1055 texel/m over 60 m², så kildepikslene må skaleres uansett. Neste
konkrete steg for den veien er eksport med fire teksturfliser (flere materialer); 16384² henger
rasterizeren. Men referansen leverer sin kontrast på 462 texel/m mot vår prosjektive vei på 817
— fortrinnet deres ligger i opptaket, ikke i atlaset.

**Kildebildene var uskarpe før baken fikk dem (§73).** Målt på det ekte fullromsskannet: median
bevegelsesuskarphet 14,8 px i et 3840-bilde, halvparten over 15 px — rundt 8 mm smøring på
veggen, mot et panelspor på 2 mm. Årsaken er at AE-låsen fryser det auto-eksponeringen landet
på (innendørs ofte 1/30 s). Låsen setter nå et TAK på lukkertiden (8 ms) og betaler med ISO,
med samme lysmengde. Støy midles bort i baken; smøring gjør det ikke. Installert på telefonen.
Neste skann måler seg selv: `median blurPx` i fixture-kf.json skal under 5.

Korreksjon til §73: et kontrollert forsøk (samme skann, samme vegg, skarpeste mot uskarpeste
halvdel av bildene) viste INGEN forskjell i veggkvalitet — vinnervalget vekter alt skarphet, så
å fjerne uskarpe bilder hjelper ikke. Direkte måling av bildene viser likevel 33 % mer detalj i
de skarpeste mot de uskarpeste. Eksponeringstakets gevinst ligger derfor i å heve TAKET (de
beste bildene per flate), ikke medianen — og den kan ikke måles uten et nytt opptak.

**Fire teksturfliser er bygget og målt (§74).** Kildeskala 0,43 → 0,823 ga skarpheten tilbake
(0,436 → 0,523 %, referansen 0,509), men bruddene ble VERRE (0,0300 → 0,0534 %): uskarpheten
hadde skjult feilregistreringen mellom nabofelt. Vi kan treffe referansens skarphet ELLER dens
sømnivå, ikke begge — de har begge. Det gjenstående gapet er dermed REGISTRERING, ikke atlas
eller sømlogikk, og registrering følger av opptaket. Flis-eksporten står som diagnostikk bak
meshscan.projektivfliser 2 og bør ikke produktsettes før registreringen er bedre.

**Det femte punktet er tatt (§75).** Prosjektive felt per FOTO (grovrutet i bildeplanet) pakket i
fire teksturfliser gir brudd 0,0278 % mot referansens 0,0264 og kontrast 0,506 mot 0,507 — likt
på begge. Standardveien ligger på 0,522/0,0368. Kvalitetsmodellen er nå standard for «Bygg om
modellen» (57 MB, 90 s); live-skannet er urørt. `meshscan.kvalitet=standard` slår den av.
Fremviseren i appen leser nå flere teksturfliser. Forkastet underveis, alt målt: plan-lås
(0,164 % brudd), linseforvrengning som årsak (ingen radiell korrelasjon), og felles
bildejustering (affint felt per bilde gjorde det verre med nok målinger — 449 målinger så
lovende ut, det var overtilpasning).

**«Veggene er utvasket» (§76).** Tormod hadde rett, og §75-målene fanget det ikke. Tre funn på
hans nye skann: modellen han så var LIVE-modellen (622 texel/m mot rebakens 887–1220);
vinnerfotoet gir median 1013 px/m på veggen og 52 % av veggen males fra bilder under 1000 px/m
(et 2 mm spor trenger 1000 for å nå Nyquist); og scoren manglet én potens av vinkelen
(`cosθ/z²` i stedet for `cos²θ/z²`). Rettet, men taket er kilden: beste tilgjengelige foto gir
bare 1163 px/m. Derfor krever dekningsoverlegget nå OPPLØSNING, ikke bare sikt — null under
700 px/m, fullt fra 1600 (1,7 m fra veggen). Samme felt driver fangsten, så telefonen fortsetter
å fotografere til flaten er sett nært nok. Prosenten blir lavere enn før; det er meningen.
Installert. **Neste skann: gå nærmere veggene enn du tror er nødvendig.**

**Kan fusjon erstatte kortere avstand? Nesten ikke (§77).** Testet multiframe-SR på en veggrute:
midling av 6 syn gir 0,60 % sporkontrast mot beste enkeltbildes 1,89; iterativ tilbakeprojeksjon
1,21; og først med baselinje under 25 cm slår den enkeltbildet — med 5 %. Årsaken er at
panelsporet er 2 mm NEDFELT, så syn med stor baselinje ser sporkanten på ulikt sted. Ingen
bake-side triks henter inn oppløsningen som mangler i kilden. Enten står Scaniverse nærmere enn
Tormod husker, eller de har en registrering vi ikke har klart. Ett skann av SAMME rom med begge
appene avgjør det.

**Samme rom, endelig avklart (§78).** Scaniverse-eksporten er av SAMME rom som
soveromsbundelen. Målt på samme veggtype med samme kamera: median sporkontrast 6,42 % hos oss
mot 2,52 % hos dem — vi er 2,5× skarpere der. Det utvaskede nye skannet ligger på 1,98 %, og
forskjellen mot vårt eget soveromsskann er ren opptaksavstand: median kildeoppløsning 1211 mot
1022 px/m, og 23 % mot 51 % av veggen under 1000 px/m. Pipelinen er den samme; kilden er ikke.
Det vi fortsatt er dårligere på: lavfrekvent tonevariasjon, 14,1 % mot deres 6,0 % — veggen vår
er skarpere, men mer ujevnt belyst. Det er neste mål.

**Toneflekkene er ekte lys (§79).** Ikke eksponeringslapper — tonelaget gir bit-identiske render
med av/hybrid/flat. Kildefotoet har 21,9 % lavfrekvent variasjon på veggen, vår modell 14,1 %,
Scaniverse 6,0 %: vi gjengir rommets lys trofast, de normaliserer det bort. Ny avskygging skyver
hvert hjørne mot planets median (25 cm-ruter, glattet over 75 cm, adaptiv styrke per plan, tak
0,4). Tak 0,4 er den eneste verdien som forbedret BEGGE testskannene på BEGGE mål: soverommet
14,06 → 11,56 % tone og 6,42 → 6,69 % kontrast, nytt skann 4,51 → 4,44 % og 3,43 → 3,97 %.
Utflating løfter også sporkontrasten, siden grovene i skyggen kommer fram. Installert.

**Avskygging satt til referansenivå (0,85), Tormods valg 10.09.** Soveromsveggen: tonevariasjon
14,06 → 8,59 % (referansen 5,95) og sporkontrast 6,42 → 7,69 % (referansen 2,52). Prisen er målt
og akseptert: et allerede jevnt skann mister sporkontrast (3,43 → 2,21 %). Valget er prinsipielt
— referansen fjerner rommets lys, nå gjør vi det samme. `meshscan.avskygging 0.4` gir den
trofaste varianten tilbake. Geometri og selvtester uendret.

**«For langt unna» var feil (§80).** Avstanden skilte bare 2,07 mot 1,87 m og vinkelen 35 mot
32° — det forklarer ikke 3,2× forskjell. Målt på det faktiske vinnerfotoet: kildebildet i det
utvaskede rommet har 1,95 % sporkontrast mot soveromsbildets 8,54 %, selv om det er tatt
NÆRMERE og er mindre uskarpt. Årsaken er lyset: et 2 mm nedfelt spor synes bare fordi det
fanger skygge, og skannet ble tatt 21:14 i flat takbelysning. Ny mikrokontrast (ulikt-skarpt på
spor-skalaen i atlaset, klemt) løfter det som er der: flatt kveldslys 2,21 → 6,85 %, dagslys
7,69 → 10,97 %, referansen 2,52 %. Standard 0,6. Prisen er at kantene på fylte lapper skjerpes.


### Skann, 11. september: baken var ikke reproduserbar
Prisen fra 10. september — mikrokontrast som skjerpet kantene på fylte lapper — skulle måles,
og målingen avdekket noe større: **seks identiske bakes av det store skannet ga 3,15–4,92 %
median sporkontrast på samme vegg**. Årsaken var ett `Set` i `MeshSimplify`: nye kandidater ble
lagt i heapen i Swifts hash-rekkefølge (randomisert per prosess), og heapen sammenlignet bare
`cost`, så plane flater med identisk kvadrikk-feil ble avgjort av slump. Sortert iterasjon +
total ordning `(cost, a, b)` gir nå bit-identisk nett over tre kjøringer (50 982 kollaps,
249 429 tris, xatlas 167 678 vertekser), for 260 ms. Soverommet var alltid stabilt fordi det
ligger under forenklingsmålet på 250 000 trekanter.

**Konsekvens for eldre tall:** enkeltmålinger i §69–§80 gjort på ÉN bake av et nett over
250 000 trekanter har ±25 % slump i seg. Les dem som retning, ikke som tall.

Mikrokontrasten er rettet: den kjører nå før dilatasjonen OG krever full nabostøtte, så
hull- og chart-kanter ikke skjerpes (å bare flytte den var verre — det ga en mørk rand som
dilatasjonen smurte ut i innfyllingen). Veggen står uendret (7,06 mot 7,09 %).

Veggmasken i atlaset er bygget (§81) og virker som maske, men den gir ikke adaptiv styrke:
98-persentilen måler texeltetthet, ikke skarphet (1,64 mot tetthetsforholdet 1,59). Bygges
bare på `meshscan.mikromaal`, siden teksturen er 67 MB.

Begge Release-bygg passerer, `npm run typecheck` er grønn, og fem av seks Swift-selvtester som
rører MeshBakeV2 passerer. `tools/verify-scan-tone-bandwidth.py` feiler på `warpEnabled` —
det er en eldre, ukommittert signaturendring i `toneAt`, ikke fra denne runden.

**Kvalitetsmodellen er snudd til standard også live** (§82). Den var før bare på for «Bygg om
modellen». Live-budsjettets 6144-atlas gir fire fliser à 6144 = ~915 texler/m vegg mot
enkeltatlasets 622, og rendret side om side har enkeltatlaset tonelapper og brutte panelspor
der flisene har rene linjer. Prisen er 1,6× baketid og 2,7× filstørrelse (12 → 37 MB,
18 → 49 MB) — det siste treffer R2 og synken. Merk at `veggmaal.py` gir HØYEST tall til den
gamle veien; metrikken belønner tonekanter og alias, og ser ikke sømbrudd. Øynene avgjorde.

**Må bekreftes på telefonen:** simulator-harnessen kjører alltid `isRebake = true` og kan ikke
kjøre den ekte live-veien. Minnetoppen live blir fire sekvensielle rasteriseringer à 6144
(~500 MB hver) med AR-sesjonen pauset. Ett skann på iPhonen avgjør.

**GLB-ene er halvert** (§83). `writeTiledGlb` ga hver trekant egne vertekser — 748 287 der
bare 20–23 % var unike. Tapsfri sveising på eksakte bitmønstre: geometri 25,7 → 7,6 MB.
JPEG-kvalitet 0,90 → 0,80 (uskillelig på 3× zoom i atlaset): tekstur 35,5 → 26,8 MB.
Ombygging 46,6 / 61,3 → **25,3 / 34,4 MB**; live med kvalitetsveien **18,8 / 25,1 MB** mot
gammel live-vei på 12,2 / 18,0. Kvalitetsmodellen live koster altså ~1,4× fil, ikke 2,7×.

**Åpent spørsmål til Tormod:** han sa skannene kan bli liggende lokalt i stedet for å speiles
til R2. `lib/scan-storage.ts` laster dem opp i dag, og kommentaren øverst i fila oppgir
grunnen han selv ga: «mistet telefon = mistet dokumentasjon». Arkivpakken
(`lib/archive/freeze.ts`) lister også `scanPath` som vedlegg, og en kollega som åpner et skann
henter det via `ensureScanLocal`. Med de nye filstørrelsene er kostnadsargumentet mye svakere.
Ikke endret.

**Skann + bake er nå ett steg** (§84). AR-visningen slippes før baken, så live får samme
minnebudsjett (atlas 8192, 200 bilder) som «Bygg om modellen» i stedet for 6144/160. Må leses
av `V2 budsjett — headroom …MB` i pipeline.log etter et ekte skann. Release-bygg med §81–§84
installert på iPhonen 11.09 kl. 12:40.

**Hullene i romvisningen er fangsten, ikke baken:** samme opptak bakt med ARKits eget nett gir
nøyaktig samme 19,2 % hull som vår TSDF. Soveromsfixturen dekker 17,7 m² grunnflate mot
Scaniverse-eksportens 28,9 — det er to ulike runder i rommet, ikke to pipelines. Neste måling
er ett skann av samme rom med begge appene.

**Første ekte skann avslørte hovedfeilen** (§85): live-baken brukte ARKits anker-nett — 260
separate komponenter — og blokkgrensene sto som harde svarte sprekker tvers over veggen.
TSDF-en, som smelter rå dybde til ÉN flate, sto av live med henvisning til en foreldet måling
(8,5 min fra 5. sept, før omskrivingen). Målt i dag: **3,5 s** av en 22 s live-bake. Den er nå
standard også live. `meshscan.geometry = "anchor"` gir det gamle tilbake. Nytt bygg installert.

**Hvitbalanse fra taket** (§86): fangsten låser AWB, så gult kunstlys ble gjengitt trofast og
hvite vegger ble kremgule (tak B/G 0,772 mot referansens 0,935). Rettet globalt via `gains`,
bare blå-aksen, bare opp til referansens hvitpunkt. Full nøytralisering og rød-aksen er PRØVD
og forkastet — de ga henholdsvis lilla og grått på kontrollskannene.

**Tonelaget var slått av i kvalitetsveien** (§87) — min egen feil fra §82. §75 slo av tonelag
og søm-fjæring for de prosjektive feltene; da kvalitetsveien ble standard live, mistet HVER
modell eksponeringsutjevningen mellom foto. Det er «fire forskjellige deler» Tormod ser.
HYBRID blander bare lavbåndet og koster ingen skarphet: soverommet går 7,14 → 8,37 % median
sporkontrast og 14,67 → 8,59 % toneflekk. Nå på igjen.

**Dommen 11. september:** Tormod om skannet fra telefonen etter §85–§87: «holy det er jo bedre
en scaniverse». Fire grep lukket gapet — TSDF-geometri live, tonelaget tilbake i kvalitetsveien,
hvitbalanse fra taket, og kvalitetsvei + fullt minnebudsjett i ett steg. Ingen av dem ble funnet
av måleskriptene; alle ble funnet ved å rendre side om side og se.

**Alt dette er fortsatt ukommittert.** Det er nå den viktigste oppgaven.

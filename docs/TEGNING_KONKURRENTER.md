# Tegninger og prosjektoversikt — konkurrenter (2026-09-24)

To research-løp (norsk/nordisk + internasjonalt) pluss en gjennomgang av våre egne
flater. Målet er Tormods: UI som er «insanely easy», intuitivt, med stor wow-faktor.
Les denne før prosjektdetaljen eller tegningsvisningen røres igjen.

## Konklusjonen i tre setninger

Ingen har et tegnings-UI som er både veldig enkelt OG har wow: de enkle (Dalux Field
Basic, Fieldwire, CompanyCam) er kjedelige å se på men elsket i felt, wow-demoene
(OpenSpace, Bluebeam Max, Togal, Matterport) bor på kontor-PC-en og er dyre. Ingen
norsk aktør leser INNHOLDET i tegningen — alle behandler PDF-en som et dumt bilde —
og ingen lar et punkt på planen bære ordre, timer, materiell og skjema. Det er
nøyaktig der Ampex allerede står (symbolforklaring → 39/39 brannkomponenter,
romdeling, LiDAR per rom), så jobben er å iscenesette det vi har, ikke bygge mer.

## Norge / Norden

**Håndverkerappene** (Cordel, SpeedyCraft, Tripletex, Svenn, Gripr, Duett, Bygglet,
Fieldly, Moment, Aceve, Integrator): tegning = PDF-vedlegg i en mappe. Ingen pins,
ingen revisjoner, ingen sammenligning. Prosjektoversikten er ØKONOMISK (timer/forbruk
mot fakturagrunnlag), aldri romlig. Svenns eneste markering er «Snapchat»-tegning på foto.

App Store-klagene (norsk butikk, hentet via RSS — ekte sitater):
- Cordel UTE 2,4/5: «Masse trykking for lite», «trykka gjennom 8 [skjermer]», sjekklister
  havner på feil ordre, «må installere appen på nytt hver 3. dag» (synk).
- SpeedyCraft 2,3/5: batteri og varme år etter år — «1 prosent i minuttet», «lommevarmer»;
  «hvorfor står det ikke hva grønn, gul, rød betyr».
- SmartDok ny app 1,8/5: opprør mot redesign — «3–4 ganger mer trykking», «treig og
  overkomplisert», varsel om endrede timer som ikke kan finnes igjen.
- Svenn 4,7/5: «superlett å bruke» (men «29 varsler hver gang»).

**Dalux** (dansk, standarden norske montører måler oss mot): Locations bygg → etasje →
tegning; trykk på planen → velg type → fyll ut. Revisjonssammenligning grønt (ny) /
oransje (gammel), umerket = uendret, lås for å frikoble (mobil fra 2026.2). Auto-
hyperlenker mellom ark, QR på tegningen sier om versjonen er gjeldende, kjedet måling
med segment + total (2026.1), 2D over 3D, TwinBIM (AR), SiteWalk (360 på hjelm).
Field Basic gratis. 4,4/5: rask på store tegninger, lite strøm. Klager: offline brutt,
hvit skjerm etter låst telefon, ingen favoritter, søket finner bare synlige mapper,
«hvorfor blir oppgaver usynlige fra tegningen?».

**Congrid** (SmartCraft, som Cordel): markør på plan, status fullført/inspisert/avvist/
godkjent, offline, auto-epost. «Creating the note in the app means that you have
already made the report.» Gratis LITE for UE.

**StreamBIM** (norsk): sjekkliste koblet til objekter — åpne lista, objektene farges
grønt/gult/rødt. Planen ER fremdriftsoversikten. 2,7/5.

**Catenda** (norsk): åpner du en sak fra lista, sentreres planen på markøren; sak i 3D
får synsvinkelen som bilde automatisk; flere etasjer slått sammen i 2D.

**EG Holte** (avvik koblet til tegning, 3,0–3,6/5, krasj), **PlanRadar** (pins med
foto/tale, offline; klager: treg synk, uker å lære, tungt oppsett; 107–159 USD/mnd).

Priser: Svenn 519 kr/mnd + 309–359/bruker, HoltePortalen 949–2 399 kr/mnd, Gripr
gratis ≤ 5 prosjekter, Total 399 + 199/bruker.

## Internasjonalt

**Fieldwire (Hilti)** — malen for tegning + oppgave i felt. OCR leser tittelfeltet og
navngir ark ved opplasting; callouts blir hyperlenker (virker bare når arknavnene er
riktige — vanlig supportsak). Ny versjon erstatter gammel og FLYTTER pins/markup.
Pin = oppgave på et sted, diamant = oppgave for hele arket; farge = status; øye-ikonet
er ett lagfilter. Nytt: ett trykk 2D→3D, oppgaver i 3D, tale → oppgave/mangelliste,
naturlig-språk-søk på tvers. Basic gratis (5 brukere/3 prosjekter), Pro 39–89 $/bruker.
Klager: rapporter og nummerering, «UI kan være forvirrende».

**Autodesk Build/Forma** (tidl. PlanGrid, som ble elsket fordi den var mobil-først og
nå står stille): tittelfelt-maler, auto-lenker, sammenligning som rød/blå overlegg ELLER
glider side om side. AU 2026: «Drawing Change Analysis» (endringer som betyr noe, ikke
piksler), «Compliance Review», assistent som hopper til riktig ark.

**Procore** — dypest og mest hatet i felt: treg opplasting, hver side må klassifiseres,
unøyaktig sammenligning, offline svikter, «batteri- og lagringssluk». Alt de hates for
er regler vi allerede har (offline-først, batteri, ingen polling).

**Bluebeam Max** (kontor): Smart Review finner manglende ark/tagger; Smart Overlay på
tvers av fag og målestokk; Revu har MCP mot Claude. 590 $/år.

**OpenSpace**: 360/telefon, bildene plasseres selv på planen; tidsglider, «Reveal» legger
gammelt opptak over nytt — «hva ligger bak veggen». Det ekte wow-øyeblikket i bransjen,
og gull for elektrikere (hvor gikk kabelen?).

**CompanyCam**: ta bilde → «Legg til [Prosjekt]?» før telefonen er nede (GPS). Prosjektet
er en tidslinje; kan deles som levende lenke til kunden.

**Togal / Beam / Kreo** (AI-mengdeuttak): boks rundt ett symbol → finner alle like i hele
settet; Beam leser tegnforklaringen og ser mengdeendring mellom revisjoner; Kreo skiller
tegningsflate/forklaring/tittelfelt. = det vi gjør med brann, men deres er kalkulatør-
verktøy på kontor. Vi gir det til montøren og knytter det til FDV og skjema.

**Polycam Space / Magicplan / RoomPlan**: skannet skal gi en 2D-plan med mål og romnavn,
ikke bare et pent 3D-nett. RoomPlan anbefalt maks ~186 m².

**Fergus, Tradify, simPRO, Jobber, ServiceTitan, Buildertrend**: sterke på ordre/faktura,
tegning nesten fraværende. Ingen kombinerer ordre og tegning.

Utenfor bransjen (inspirasjon, ikke kildebelagt): Linear (Cmd-K, optimistisk UI), Things 3
(dra pluss dit tingen skal ligge), Freeform/Figma (pinch fra oversikt til detalj, minikart).

## Wow vs. hype 2025–26

Ekte: symboltelling med menneske som godkjenner (tegnforklaringen som fasit = vår vei),
revisjonsdiff som sier HVA som endret seg, reality capture bundet til plan og tid, tale
til strukturert data, automatisk sortering av foto.

Hype for oss: chat over «alle prosjektdata» for montører, generativ omtegning av rom,
«99 %»-BIM fra skann, RFI-agenter (amerikansk entreprise).

Fella alle går i: wow oppå en treg app. Brukerne hater tregheten mer enn de elsker AI-en.
Dalux og Fieldwire vinner på fart og få trykk.

## Våre egne flater — ærlig status (lest i koden 24.09)

Det vi HAR, som ingen andre i segmentet har: mappetre bygg → fag med fliser, rasterert
visning med egen transform, delt skjerm 1/2/4 med lås, brannkomponenter fra
symbolforklaringen med auto-tag (sløyfe.adresse), sløyfer, romdeling fra PDF, LiDAR
per rom (hold på rommet), oppgave-pins, detektorliste, kladd/publiser, og stemmespørsmål
om prosjektstatus.

Det som trekker ned «insanely easy»:
1. **Prosjektdetaljen har ikke ett svar øverst.** Navn + footnote + «Detektorliste»-rad,
   så mappene. DESIGN.md sier én skjerm = ett stort tall; her finnes ikke noe «hvor langt
   har vi kommet». Konkurrentene som vinner (StreamBIM, Fieldwire) viser status PÅ planen.
2. **Skjulte gester bærer viktige ting.** Trykk på en person gjør dem LiDAR-ansvarlig,
   langtrykk FJERNER dem fra prosjektet uten bekreftelse; rommet er en usynlig knapp
   med 1 s hold. Ingenting på skjermen forteller at det finnes.
3. **Pins synes bare for den tildelte.** Bevisst valg (plan 26.08), men bas/PL ser da
   aldri prosjektet på planen — nettopp det Dalux-brukere klager over.
4. **Kun side 1 av en PDF** i vieweren.
5. **Ingen revisjoner**: ny tegning = ny tegning; pins og brannkomponenter følger ikke med.
6. **Kontoret har ingen tegninger** — Prosjekter på PC er en liste med rom/oppgaver.
7. **Symbolsøket er en knapp**, ikke et øyeblikk. Den største wow-en vi har skjer i en
   tynn stripe som forsvinner.

## Tormods korreksjon samme dag

«Det er ikke så mye tegning viewing som er important — det er hovedsaklig at det skal
være kjempe oversiktlig og lett å finne fram tegninger.» Punkt 1 under («planen ER
prosjektet» på telefonen) ble derfor bygget og tatt bort igjen. Det som ble bygget:
telefonens prosjektskjerm leder med søk i alle tegningene, «Sist åpnet», fag-chips med
antall og mappetreet under; kontoret fikk tre + dokument (søk, fag, sammenleggbart
tre med montert/alle per tegning, ↑/↓ og «/» på tastaturet) med tegningen til høyre.

## Anbefalt rekkefølge (min vurdering)

1. **Planen ER prosjektet.** Åpne prosjektet → siste tegning fyller skjermen, med
   prosentring (montert/kontrollert av brannkomponenter + åpne oppgaver) og pins farget
   etter status. Alle med rolle bas+ ser alle pins; montøren får «mine» som filter,
   ikke som eneste visning. Lista (mapper, folk) ligger i et ark som dras opp.
   (StreamBIM + Fieldwire. Mest wow for minst ny kode.)
2. **«Fant 39 brannkomponenter»-øyeblikket.** Ved opplasting: symbolene lander på planen
   med en kort stagger, gruppert etter forklaringen, antall i filterchips, ett trykk per
   type for å godkjenne. Reversibelt. (Togal/Beam har det på kontor; ingen i felt.)
3. **Hold på planen → oppgave / avvik / foto / skann her.** Rom, tegning, revisjon, person
   og tid fylles ut selv. Maks tre trykk til lagret avvik. Gjør de skjulte gestene
   synlige eller fjern dem (LiDAR-ansvarlig og fjern-medlem til et ark med bekreftelse).
4. **Lista og planen peker på hverandre.** Trykk en oppgave i lista → planen sentreres på
   pinnen (Catenda); trykk pinnen → kortet som ark. Husk siste tegning og utsnitt;
   aldri hvit skjerm etter låst telefon (Dalux-klagen).
5. **Revisjoner.** «Rev C · gjeldende»-merke; ny revisjon flytter pins og brannkomponenter
   og viser grønt/oransje-overlegg + lista over hva som havnet i endret område — og den
   semantiske varianten ingen el-app har: «2 nye røykdetektorer, 1 fjernet».
6. **Tittelfelt → navn, nummer, fag, rev og foreslått mappe** ved opplasting (vi har
   vektortekst fra PDF-en). Deretter auto-hyperlenker «se E-102».
7. **Kjedet måling på skalert plan** → kabellengde fra tavle via punktene → materiell/tilbud.
8. **Bak veggen**: skann/foto før gips festet til punktet på planen, med før/nå-glider.
   Salgsargument mot FDV og Boligmappa.

Grunnmuren under alt dette er fart: tegningen som bilde først, ingen hvit skjerm, ingen
spinner (se åpen sak om UI-respons). Konkurrentene tapte på det, ikke på funksjoner.

## Runde 2 (2026-10-04): Autodesk Forma i dybden, og hvem som gjør telefonen bedre

Tormod ville «kopiere Autodesk Forma litt», men mistenkte at noe bedre fantes. To
research-løp. Konklusjon: **Forma er feil forbilde, Fieldwire er grunnmodellen — og ingen
har gjort «visning ER redigering».** Alle har fortsatt et eget velg-verktøy og en
verktøylinje du må velge fra før noe skjer. Der kan Ampex være først.

### Autodesk Forma Build (ACC omdøpt 24.03.2026, ex-PlanGrid)

Opplasting er en veiviser i fire steg: fil → samling + versjonssett → gjennomgå
tegningsnumre (tittelfeltet forstørret ved siden av OCR-forslaget, rett enkeltvis eller i
bulk) → titler/tagger → publiser. Flersides PDF splittes til ark. Lenker mellom ark lages
etter publisering, tar «minutter til timer», og leser bare sirkel-henvisninger.
Sammenligning: web har overlegg rød/blå OG side-om-side med glider; iPad/iPhone har bare
overlegg (side-om-side på iPad er et åpent ønske). Mobilsøk har to faner: nummer/tittel og
innhold (tekst i tegningen), med trefframmer i arket. Favoritter øverst, «nylig sett».
Mobilverktøy: Select (velg ELLER panorér), penn, merkepenn, pil, linje, firkant, sirkel,
kryss, tekst, sky-callout, pluss sak/foto-markering; stilpanel med kant/fyll/opasitet.
Alle markeringer er private til noen med rett publiserer dem.

Mest påklaget: et versjonssett tar ikke imot samme arknummer to ganger — hver revisjon
krever nytt sett. «Gå til ark» fra oppgave svikter på iPhone, ingen bakgrunnsnedlasting
med låst skjerm, tapte bilder/markeringer i synk, og fotorapporten med nøkkelkart fra
PlanGrid er borte og etterspurt. PlanGrid står i vedlikeholdsmodus siden ~2020; brukerne
savner enkelheten. Det PlanGrid hadde: lasso øverst i verktøylinja, **dobbelttrykk på et
verktøy låser det** (ellers ett bruk), øye-ikon som skjuler alt krom, filter på
type/farge/forfatter, autolenker allerede i 2013.

AI: OCR av nummer/tittel, autolenker og «Automated Drawing Extraction» (tittelfeltmal →
attributter → mappe med navnestandard) leverer. Drawing Change Analysis, Assistant-søk i
tegninger og Compliance Review er ANNONSERT på AU2026 — «previewed, not generally
available», utrulling 2027.

### De andre

**Fieldwire** (4,8/5, ~14 000 vurderinger; «easier to use than the desktop version»):
OCR navngir ark ved opplasting, henvisninger blir røde lenker (krever tekst i PDF-en),
samling → mappe per fag → ark + tagger, søk på arknummer og «#tag», hver rad viser
oppgaveantall og versjonskonflikt, markeringer følger med til ny versjon, lilla = private,
overlegg på mobil også mellom fag (himling mot lys), nåler, offline, egen oppsettguide for
elektrikere. Verktøylinje nede til høyre; langtrykk på markering → rediger/flytt/
dupliser/farge. Gratis ≤ 5 brukere, Pro 39 $, Business 64 $/bruker/mnd. Klager: pris per
bruker.

**Dalux Field**: Locations = bygg → etasje, ikke mapper; åpner siste tegning; bytt
bygg/etasje ved å trykke navnet nederst; trykk på planen viser det som er registrert der;
QR på stedet åpner riktig sone; ny versjon kjennes på filnavnet; grønn/oransje
sammenligning også på mobil. «Virtually foolproof», «always works fast … opening large
drawings».

**Procore**: nål/sky lenket til RFI, bilde, mangel; sammenligning blå/rød på mobil. Men
side-for-side-godkjenning ved opplasting er «wonky», laster samme detaljer på nytt, «battery
and storage hog».

**Bluebeam**: Revu for iPad lagt ned 31.12.2025; erstatteren har ~1,5/5. «Selecting the
markups is hard because the selection boundary is so far outside of the markup», «I can't
edit my own mark-ups». Advarsel: presis markering og faste symbolsett er det fagfolk savner.

**Drawboard** (beste blekk, «pen feels natural», men treg på store PDF-er og ingen
register), **PlanRadar** (nålelogg, vanskelig å finne én sak blant hundrevis),
**STACK/SmartUse** (faner/bokmerker mellom ark). UX utenfor bransjen: Concepts
(verktøyhjul), Morpholio Trace (kalkerpapir-lag), GoodNotes/PDF Expert (lasso, kruss over
for å slette, penn tegner mens finger panorerer), Freeform (ingen modus).
AI-oppstarter (Articulate, Structured AI, Helonic, Bidflow, Quotr) leser tegninger på
KONTORET — ingen bygger feltvisning. Bidflow (teller el-symboler) er nærmest vår
symbolforklaring.

### Hva vi tar

1. **Fieldwire som grunnmodell:** OCR av tittelfeltet ved import (nummer, tittel, rev),
   autolenker på ALLE treff på kjente arknumre (ikke bare sirkler), søk på arknummer,
   markeringer og komponenter som følger med til ny revisjon, antall åpne ting per ark i
   lista.
2. **Revisjon som automatisk kjede:** samme arknummer = ny versjon av samme ark, nyeste er
   gjeldende. Aldri versjonssett (Builds verste friksjon). Overlegg grønn/oransje på
   telefon, side-om-side med glider i delt visning (har vi allerede).
3. **Dalux sin finne-fram:** åpne siste tegning; bygg/etasje/fag som én bryter nederst.
   Mappetreet fra OneDrive er importformatet; montøren leter med søk og arknummer.
4. **Ingen modus — det ingen har:** uten verktøy panorerer én finger og trykk på en
   markering/komponent VELGER den (stramme treffgrenser, Bluebeam-klagen). Langtrykk på tomt
   område → «Oppgave her / Foto her / Brannkomponent her». Penn (Apple Pencil) tegner alltid
   mens fingeren panorerer. Kruss over for å slette. PlanGrids låsing: ett trykk = én bruk,
   dobbelttrykk = låst (stempling av 40 detektorer).
5. **Tegningen er stedet ting henger på** (Procore): nål → avvik, bilde, ordre, skjema.
   Foto med plassering og fotorapport med nøkkelkart (savnet fra PlanGrid).
6. **Søk med to faner** (nummer/tittel, innhold) og trefframmer — vi har vektorteksten.

Unngå: privat/publisert-skille på markeringer for montøren, stilpanel med
kant/fyll/opasitet (tre farger holder), lenkegenerering som tar timer, godkjenning side
for side ved opplasting (kontoret ser forhåndsvisningen ÉN gang, resten går av seg selv).

Kilder runde 2: help.autodesk.com (Upload_And_Publish_Sheets, Review_Edit_Sheet_Numbers,
Version-Sets, Link-Sheets-Markups, Automated_Drawing_Extraction, Compare_Sheets,
View_Manage_Sheets_Mobile, Markups_Mobile, Issues_Create, Measure_2D_Files_Mobile) ·
autodesk.com/support (Sheet-number-version-error) · forums.autodesk.com (side-by-side
iPad, photo reports from sheets) · help.plangrid.com (224133567, 224144127) ·
techcrunch.com/2013/06/03/plangrids-blueprint-app-adds-automatic-hyperlinking ·
architosh.com/2026/09/au2026-autodesk-expands-forma-and-leverages-ai ·
planops.ai/insights/weekly-roundup/2026-09-18-weekly-roundup ·
help.fieldwire.com (360000488886, 360049713811, 115004752483, 4406931599131,
360061902452) · apps.apple.com/us/app/780165517 · dalux.zendesk.com/360010386193 ·
support.dalux.com (10022982079004, 14101695854364) · capterra.com/p/154695 ·
support.procore.com (compare-drawings-android) · support.bluebeam.com (revu-for-ipad-eos) ·
apps.apple.com/us/app/bluebeam/id1479484276 · g2.com/products/drawboard-projects ·
planradar.com/us/planradar-reviews · concepts.app · morpholioapps.com/trace ·
ycombinator.com/companies/helonic · stru.ai-bloggen (svak kilde, konkurrent).
Ikke verifisert: YouTube-gjennomganger (transkripsjoner utilgjengelige); flere Autodesk-
sider ga 403 og er lest som søkeutdrag.

## Kilder

Norsk: support.smartdok.no/knowledge/tegne/skisse-i-app · smartdok.no/ny-app ·
cordel.no/funksjoner/dokumentasjon · devinco.com/en/speedycraft-mobilt-ordresystem ·
support.dalux.com (Compare-versions, How-to-create-and-view-Tasks, Build release notes
2026-1 og 2026-2, TwinBIM) · dalux.com/products/dalux-field-basic · capterra.com/p/154695 ·
congrid.com/congrid-solution · streambim.com · guide.streambim.com/hc/no/articles/360018473519 ·
catenda.com/bim-solutions-open-standards/catenda-site-bim-on-site ·
egsoftware.com/no/byggebransjen/eg-holteportalen · planradar.com/no/app-for-avvikshandtering ·
svenn.com/prosjektstyring · svenn.com/priser · gripr.no · bygglet.com/funktion/projekt ·
tripletex.no/bransjer/elektro · nhoelektro.no (Integrator).
App Store-anmeldelser: `https://itunes.apple.com/no/rss/customerreviews/id=<ID>/sortBy=mostRecent/json`
med Cordel UTE 1451697663, SmartDok 1643849874, Dalux 504561520, HoltePortalen 1201502634,
Svenn 1194493886, SpeedyCraft 1146770283.

Internasjonalt: help.fieldwire.com (360000488886, 115000652623, 205197246, 115004458803,
360049713811) · fieldwire.com/ai · g2.com/products/fieldwire-by-hilti/reviews ·
help.autodesk.com (Automated_Drawing_Extraction, Compare_Sheets) ·
architosh.com/2026/09/au2026-autodesk-expands-forma-and-leverages-ai · procore.com/ai/agents ·
capterra.com/p/56250/Procore/reviews · bluebeam.com/bluebeam-max ·
dalux.com/solutions/reality-capture · openspace.ai/products/capture ·
capterra.com/p/171143/CompanyCam/reviews · togal.ai/trades/electrical ·
ibeam.ai/subcontractors/electrical · kreo.net/news-2d-takeoff/what-is-ai-takeoff ·
learn.poly.cam (Space Mode) · developer.apple.com/videos/play/wwdc2023/10192 ·
matterport.com/news/matterport-launches-property-intelligence-transforming-real-estate ·
g2.com/products/fonn/reviews.

Ikke verifisert: animasjoner og antall trykk i onboarding (videoer kan ikke leses);
Procore/Dalux/Togal/OpenSpace-priser (ikke offentlige).

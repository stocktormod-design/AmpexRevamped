# Verona — planlegging fra inntak til ferdigmelding (30.10.2026)

Dette er en gjennomgang til å lære av, ikke en innlevering. Hvert valg har en begrunnelse og en
peker til NEK 400 eller forskrift. Les ordlyden selv der det står «slå opp»: pekeren sier hvor,
ikke hva som står der ordrett. Tallene er forslag en installatør ville startet med, og flere av
dem avhenger av nettselskapet og av utstyret som faktisk velges.

Rekkefølgen er den du faktisk planlegger i: først hva huset trenger, så hvor strømmen kommer inn,
så tavla, så kursene, så kablene, og til slutt hvordan du beviser at det er riktig.

---

## 0. Hva tegningen sier

Målt på tegningen med 13,61 m-målet (±0,2 m; mål med målestokken i Ampex før du bruker tallene):

| Rom | Mål c/c | Areal ca. | Det som står inne |
|---|---|---|---|
| Kjøkken/stue | 13,4 × 4,5 m + 6,2 × 1,6 m | 65 m² | Kjøkkenøy med dobbel vask, benk langs vestvegg med kjøl (REF), koketopp og ett uavklart symbol; spisebord; sofagruppe; TV på østveggen; dør til terrasse |
| Soverom 1 (nord) | 4,4 × 4,6 m | 19 m² | Dobbeltseng, to vinduer mot vest |
| Soverom 2 (sør) | 4,4 × 4,5 m | 19 m² | Dobbeltseng, vinduer mot vest og sør |
| Gang | 2,9 × 7,4 m | 21 m² | Hovedinngang i sør, åpen mot stua |
| Bad/vask | 6,2 × 4,0 m | 24 m² | Vaskemaskin, tørketrommel, dobbel servant, WC, hjørnedusj; dør til garasjen |
| Bod | 6,2 × 3,4 m | 20 m² | Tom. Østveggen er yttervegg |
| Garasje | 7,4 × 10,2 m | 75 m² | Port og dør i sør; et apparat inntil vestveggen (trolig varmtvannsbereder — bekreft) |
| Terrasse | ca. 13 × 4,5 m | — | Utenfor stua mot nord |

Huset er altså rundt 170 m² boareal pluss 75 m² garasje, i én etasje. Det er større enn
«13,61 × 10,20» kan få det til å se ut: 10,20 er garasjens dybde, ikke husets.

**Ting du må avklare med kunden før du tegner noe:** oppvarming (varmepumpe? varmekabel hvor?),
elbil nå eller senere, hvor varmtvannsberederen står, om garasjen er oppvarmet, om det skal være
lysstyring (smarthus) og om det skal være verksted i garasjen. Alt under antar svarene som står i
avsnitt 2.

---

## 1. Rekkefølgen og papirene

1. **Risikovurdering av anlegget** (FEL § 16 — prosjektering skal bygge på en risikovurdering).
   Rom for rom: bruk, brukere og ytre påvirkninger (NEK 400-5-51). Ampex lager den levende fra
   tegningen og ordreteksten.
2. **Melding om installasjonsarbeid til nettselskapet** før du begynner (Elsmart eller
   nettselskapets portal). Her søker du også om **hovedsikring** og får svar på **nettsystem**
   (TN eller IT), **kortslutningsstrøm** i tilknytningspunktet og **krav til stikkledning**.
   Du kan ikke dimensjonere inntaket før du har dette svaret.
3. **Risikovurdering av arbeidet** (FSE § 10 / SJA) for hver jobb der det er spenning eller
   spesielle farer (inntaket, tilkobling i kabelskap).
4. Prosjektering (resten av dette dokumentet).
5. Sluttkontroll (NEK 400-6), samsvarserklæring og dokumentasjon til eier (FEL — slå opp
   paragrafen for samsvarserklæring), **ferdigmelding** til nettselskapet.

---

## 2. Effektbehov — hvor mye strøm trenger huset?

Først lister du alt som trekker effekt, så vurderer du hvor mye som går **samtidig**
(sammenlagring). Det er det samtidige tallet som bestemmer hovedsikringen.

| Last | Effekt | Kommentar |
|---|---|---|
| Induksjonstopp | 7,4 kW | Går nesten aldri på full effekt lenge |
| Stekeovn | 3,5 kW | |
| Oppvaskmaskin | 2,0 kW | |
| Vaskemaskin | 2,0 kW | |
| Tørketrommel (varmepumpe) | 1,0 kW | |
| Varmtvannsbereder 200 l | 2,0–3,0 kW | Kan styres bort fra toppene |
| Varmekabel bad (ca. 15 m² fritt gulv × 100 W/m²) | 1,5 kW | |
| Varmekabel gang/entré (ca. 8 m²) | 0,8 kW | |
| Panelovner soverom (2 × 2 × 0,6 kW) | 2,4 kW | Hvis varmepumpa ikke dekker soverommene |
| Varmepumpe luft-luft (stue) | 1,5 kW | Opptatt effekt, ikke avgitt |
| Frostvakt/ovn garasje | 2,0 kW | |
| Elbillader | 11,0 kW | 3 × 16 A, 400 V |
| Lys, stikk, TV, data, kjøl | 3,0 kW | |
| **Sum installert** | **≈ 40 kW** | |

Sammenlagret uten bil blir dette realistisk **12–15 kW** på en kald kveld med middag: koketopp
halvt, ovn, oppvask, varme og bereder. Med bilen i tillegg blir det rundt 26 kW.

**Valg av hovedsikring (TN 400 V):**
- 3 × 25 A gir 17 kW (√3 · 400 V · 25 A). For lite når bilen lader.
- 3 × 32 A gir 22 kW. Holder hvis laderen har **dynamisk laststyring** (leser strømmen i
  hovedkabelen eller via HAN-porten på måleren og skrur seg ned).
- 3 × 40 A gir 28 kW. Holder også uten laststyring, og gir rom for selektivitet mot en
  underfordeling på 3 × 25 A.

**Forslag: 3 × 40 A og likevel laststyring på laderen.** Begrunnelse: nettleia i Norge er i dag
basert på hvor høy effekt du faktisk bruker (kapasitetsledd), ikke på sikringen, så en større
sikring koster deg ikke noe i nettleie. Laststyringen gjør at du sjelden bruker den, og holder
deg på et lavt effekttrinn. Anleggsbidraget til nettselskapet kan derimot bli høyere for større
sikring — det er det du må sjekke.

**Hvis nettet er IT 230 V** (fortsatt vanlig i deler av Nord-Norge): da er strømmen per fase
√3 ganger høyere for samme effekt. 26 kW på IT 230 V er 26 000 / (√3 · 230) = 65 A, altså
hovedsikring 63 A. Alle kurser får **2-polet vern** (begge ledere er faseledere), og elbilladeren
må støtte IT (mange gjør det bare på 1-fase, eller trenger egen transformator). Spør
nettselskapet tidlig — det endrer tavla, laderen og vernene.

Resten antar **TN-C-S 400/230 V, 3 × 40 A**.

---

## 3. Inntaket

### Hvor

**Hovedtavla i boden, på vestveggen ved døra fra gangen. Inntakskap utvendig på bodens østvegg.**

- **Brannvesenet må finne hovedbryteren raskt.** Boden har dør rett fra gangen, ca. 4 m fra
  hovedinngangen. En brannmann som kommer inn hovedinngangen er ved tavla på sekunder, uten å gå
  gjennom rom som kan være fulle av røyk. Merk døra («Hovedtavle») og hovedbryteren tydelig.
  Garasjen er feil sted også av denne grunnen: der står bilen, og en bilbrann er ofte
  grunnen til at de kommer.
- Boden ligger midt i huset. Det gir korte kurser til kjøkken, bad og soverom og grei vei til
  garasjen.
- Inntaket må på en yttervegg, og bodens østvegg er yttervegg. Da går stikkledningen rett inn og
  er kort inne i huset.
- Hvorfor ikke tavla rett innenfor inntaket på østveggen? Da øker kursene til kjøkkenet med ca.
  6 m. Regn spenningsfall på den lengste stikk-kursen i avsnitt 6: med tavla på østveggen kommer
  kjøkkenet til ca. 4,0 % totalt, med tavla på vestveggen ca. 3,2 %. Det er forskjellen mellom
  «akkurat» og «god margin».
- Ikke i garasjen: kald, støvete, og bilen står der. Ikke på badet: vann.
- Fri plass foran tavla, tavla tilgjengelig uten verktøy, og ikke bak en dør som slår mot den.
  Slå opp kravene til betjeningsplass og plassering i NEK 400 (del 5-51 og 8-823).

### Stikkledningen (fra nettselskapets kabelskap til inntaket)

Nettselskapet bestemmer, og deres tekniske retningslinjer (ofte basert på REN-bladene) sier
hvem som eier og legger den. Typisk for 3 × 40 A er **TFXP 4 × 50 Al** i jord, i rør, med
merkebånd over.

Hvorfor 50 mm² aluminium når 40 A ikke trenger så mye?
- **Spenningsfall** over lengden fra kabelskapet. Tre-fase: ΔU = √3 · L · I · ρ / A.
  Med L = 25 m, I = 40 A, ρ(Al) ≈ 0,036 Ω·mm²/m:
  √3 · 25 · 40 · 0,036 / 50 = 1,25 V = **0,31 %** av 400 V. Godt under.
- **Kortslutningsstrømmen** må være høy nok til at vernet i kabelskapet løser ut raskt. Tynnere
  og lengre kabel gir høyere impedans og lavere strøm. Nettselskapet oppgir Ik i kabelskapet.
- Aluminium er billigere og lettere enn kobber for samme belastbarhet i jord.

### Inntakskabelen (fra inntaksvern til hovedtavla)

**halogenfri 1 kV-kabel 4G16 Cu** (for eksempel FXQ/IFXI 1 kV; 4-leder: L1, L2, L3, PEN), ca. 7 m gjennom himlingen i boden.

- PEN-lederen må være minst **10 mm² Cu** (slå opp NEK 400-5-54, krav til PEN). 16 mm² gir
  margin på kortslutning og på belastbarhet.
- 16 mm² Cu på vegg/i himling tåler klart over 40 A, så hovedsikringen beskytter kabelen.
- PEN **deles** i hovedtavla i PE og N. Etter delingen skal de aldri kobles sammen igjen. Det er
  overgangen fra TN-C til TN-C-S.

### Måler og overspenningsvern

- **AMS-måleren** settes av nettselskapet ved inntaket. Be om å få **HAN-porten åpnet** — den gir
  laderen og en eventuell energistyring sanntidsstrøm uten egen måletrafo.
- **Overspenningsvern type 2** i hovedtavla, rett etter hovedbryteren, med korte og rette
  tilkoblingsledere (lange ledere spiser beskyttelsen). Type 1+2 hvis bygget har lynavleder eller
  luftlinje inn. Slå opp NEK 400-4-44 (risikovurderingen av om det kreves) og 5-534 (valg og
  montasje). I en ny bolig med elektronikk, varmepumpe og lader er svaret i praksis ja.

---

## 4. Jording og utjevning

- **Fundamentjordelektrode** i grunnmuren: en ring av blank kobber (eller galvanisert stål) i
  betongen langs ytterveggene, ført opp til hovedjordskinna i tavla. Nye bygg skal ha den — slå
  opp NEK 400-5-54. Den må planlegges **før grunnmuren støpes**. Det er den viktigste tingen i
  hele planen å ikke glemme, fordi den ikke kan ettermonteres.
- **Hovedjordskinne** i tavla: PE fra PEN-delingen, jordelektroden, og
  **beskyttelsesutjevning** til alt ledende som kommer inn i huset: vannrør av metall,
  eventuelt fjernvarme, metallisk ventilasjonskanal og armering. Utjevningsleder minst 6 mm² Cu
  (slå opp 5-54).
- **Bad:** supplerende utjevning kan sløyfes når alle kursene på badet har 30 mA jordfeilvern og
  rørene er plast — slå opp vilkårene i NEK 400-7-701.

---

## 5. Hovedtavla

**Hovedbryter** 3-polet 40 A (eller lastskillebryter), så **overspenningsvern**, så
**kursene**.

**Jordfeilvern:** I bolig skal alle sluttkurser ha 30 mA jordfeilvern (slå opp NEK 400-4-41 og
8-823). Forslag: **jordfeilautomat (RCBO) per kurs** i stedet for én jordfeilbryter foran mange
kurser.
- Begrunnelse: en jordfeil i fryseren slår da ut fryseren, ikke halve huset. Lekkasjestrøm fra
  mange apparater summeres heller ikke opp på én bryter (uønsket utkobling).
- Type **A** som standard (tåler pulserende DC fra elektronikk).
- Elbillader: type **B**, eller type A når laderen har innebygd 6 mA DC-overvåking (RDC-DD).
  Slå opp NEK 400-7-722 og laderens datablad.
- Varmepumpe med frekvensomformer: sjekk databladet. Noen krever type F eller B.

**Komfyrvakt** på koketoppen (slå opp NEK 400-4-42 og 8-823). Den bryter strømmen til
koketoppen hvis den står på uten tilsyn.

**Underfordeling i garasjen** (forslag): 3 × 25 A C, halogenfri 1 kV-kabel 5G6 fra hovedtavla.
- Begrunnelse: garasjen får 4–6 kurser (lader, lys, stikk, ovn, port, kanskje verksted). Én kabel
  ut dit i stedet for seks gjennom veggen mellom bad og garasje.
- 25 A mot hovedsikringen på 40 A gir rimelig selektivitet ved overlast. Ved kortslutning er
  selektivitet mellom to små vern vanskelig å garantere — sjekk vernets selektivitetstabell.
- Alternativet er å trekke alle garasjekursene direkte fra hovedtavla. Det er færre komponenter
  og fullt lovlig. Velg underfordeling hvis garasjen skal være verksted.

Lader på 3 × 16 A går rett fra **hovedtavla** på egen kurs, ikke via underfordelingen: den alene
ville spist 16 av de 25 ampere.

---

## 6. Kursene

### Reglene du bruker for å fordele

- **Kabeltype: halogenfri overalt** (IFXI-typen), ikke PFSP eller PFXP. PFSP/PFXP har
  PVC i isolasjon og kappe. Brenner PVC, gir det tett, svart røyk og saltsyregass (HCl) — det er
  røyken, ikke flammene, som tar folk i en boligbrann, og gassen korroderer elektronikk etterpå.
  Halogenfri kabel brenner med mindre og ikke-etsende røyk. Nexans fases ut PVC i Norge, så
  PFSP/PFXP er også på vei ut av grossistene. Sjekk brannklassen (CPR, f.eks. Eca/Dca) på
  databladet mot kravet for bygget.
- **Lys:** B10, IFXI 3G1,5, opptil ca. 12 lyspunkter per kurs. Lys deles på flere kurser slik at
  ett brudd ikke gjør et helt hus mørkt.
- **Stikk:** C16, IFXI 3G2,5, opptil ca. 8 uttak per kurs, kjøkkenbenken på egne kurser fordi
  vannkoker, kaffemaskin og mikro står der.
- **Faste apparater over ca. 2 kW** får egen kurs: oppvask, vask, tørk, ovn, bereder, varme.
- **Varme** per rom eller per sone, med termostat.

Hvorfor B for lys og C for stikk? B løser ut magnetisk ved 3–5 × In, C ved 5–10 × In.
Apparater med motor eller trafo trekker høy startstrøm, og C tåler det. Lys har liten
startstrøm, og B løser raskere ut ved kortslutning på lange, tynne lyskurser.

Hvorfor 2,5 mm² på 16 A? Belastbarheten til 2,5 mm² skjult i isolert vegg (referansemetode A1)
er rundt 19,5 A med to belastede ledere (slå opp tabellene i NEK 400-5-52). Regelen er
**Ib ≤ In ≤ Iz**: lasten ≤ vernet ≤ det kabelen tåler. 16 ≤ 19,5, altså greit. 1,5 mm² er rundt
14,5 A, altså greit for B10 og ikke for 16 A.

### Kursfortegnelse (forslag)

| Nr | Kurs | Vern | Jordfeil | Kabel | Lengde ca. | ΔU ca. |
|---|---|---|---|---|---|---|
| 1 | Lys kjøkken og spisebord | B10 | 30 mA A | IFXI 3G1,5 | 22 m | 2,9 % |
| 2 | Lys stue og terrasse ute | B10 | 30 mA A | IFXI 3G1,5 | 18 m | 2,3 % |
| 3 | Lys gang, bad, bod, soverom | B10 | 30 mA A | IFXI 3G1,5 | 18 m | 2,3 % |
| 4 | Stikk kjøkkenbenk vest | C16 | 30 mA A | IFXI 3G2,5 | 22 m | 2,8 % |
| 5 | Stikk kjøkkenøy | C16 | 30 mA A | IFXI 3G2,5 | 18 m | 2,3 % |
| 6 | Stikk stue og TV | C16 | 30 mA A | IFXI 3G2,5 | 15 m | 1,9 % |
| 7 | Stikk soverom 1 og 2 | C16 | 30 mA A | IFXI 3G2,5 | 16 m | 2,0 % |
| 8 | Stikk gang, bod, bad (servant) | C16 | 30 mA A | IFXI 3G2,5 | 10 m | 1,3 % |
| 9 | Kjøl/frys | C16 | 30 mA A | IFXI 3G2,5 | 20 m | 2,5 % |
| 10 | Oppvaskmaskin | C16 | 30 mA A | IFXI 3G2,5 | 18 m | 2,3 % |
| 11 | Induksjonstopp (via komfyrvakt) | C16 3-pol | 30 mA A | IFXI 5G2,5 | 20 m | 1,2 % |
| 12 | Stekeovn | C16 | 30 mA A | IFXI 3G2,5 | 20 m | 2,5 % |
| 13 | Vaskemaskin | C16 | 30 mA A | IFXI 3G2,5 | 8 m | 1,0 % |
| 14 | Tørketrommel | C16 | 30 mA A | IFXI 3G2,5 | 8 m | 1,0 % |
| 15 | Varmekabel bad | C16 | 30 mA A | IFXI 3G2,5 | 8 m | 1,0 % |
| 16 | Varmekabel gang/entré | C16 | 30 mA A | IFXI 3G2,5 | 8 m | 1,0 % |
| 17 | Panelovner soverom | C16 | 30 mA A | IFXI 3G2,5 | 16 m | 2,0 % |
| 18 | Varmepumpe | etter datablad | etter datablad | etter datablad | 15 m | — |
| 19 | Varmtvannsbereder | C16 | 30 mA A | IFXI 3G2,5 | 15 m | 1,9 % |
| 20 | Rack/data, router | C16 | 30 mA A | IFXI 3G2,5 | 2 m | 0,3 % |
| 21 | Elbillader | C16 3-pol (eller etter lader) | 30 mA B / A + RDC-DD | halogenfri 1 kV 5G6 | 15 m | 0,4 % |
| 22 | Underfordeling garasje | C25 3-pol | — (jordfeil på kursene i UF) | halogenfri 1 kV 5G6 | 15 m | 0,6 % |
| UF.1 | Lys garasje og utelys port | B10 | 30 mA A | IFXI 3G1,5 | | |
| UF.2 | Stikk garasje | C16 | 30 mA A | IFXI 3G2,5 | | |
| UF.3 | Ovn/frostvakt garasje | C16 | 30 mA A | IFXI 3G2,5 | | |
| UF.4 | Garasjeport | C10 | 30 mA A | IFXI 3G1,5 | | |

Fordel kursene på de tre fasene slik at lasten blir mest mulig lik: varme og faste apparater
spres, ikke alle på L1.

**Elbilkabelen 5G6, når 5G2,5 holder for 16 A?** Kabelen er billig, veggen er dyr. Med 5G6
kan laderen senere oppgraderes til 22 kW (3 × 32 A) uten å åpne noe.

### Spenningsfall — slik regner du

Enfase: ΔU % = 2 · L · I · ρ / (A · 230) · 100, med ρ(Cu) ≈ 0,0225 Ω·mm²/m (varm leder).
Trefase: ΔU % = √3 · L · I · ρ / (A · 400) · 100.

Eksempel, kurs 4 (stikk kjøkkenbenk), L = 22 m, I = 16 A, 2,5 mm²:
2 · 22 · 16 · 0,0225 / (2,5 · 230) · 100 = **2,8 %**. Legg til inntaket (0,3 %) og
inntakskabelen (ca. 0,2 %) → **3,2 % totalt**. Vanlig mål er **maks 4 %** fra inntaket til det
lengste uttaket (slå opp 5-52, avsnittet om spenningsfall).

Regnet på full vernstrøm er det konservativt. Den faktiske lasten er lavere. Det er bevisst: du
vet ikke hva kunden plugger inn om ti år.

Lengdene i tabellen er grove (horisontalt langs vegg og himling + 3 m opp og ned). Tegn
føringene i Ampex med målestokk, så regner den lengde og ΔU per kurs selv.

---

## 7. Rom for rom

**Kjøkken/stue (65 m²)**
- Stikk: benken langs vestveggen ca. 4 doble over benk (1,1 m), kjøkkenøya 2 doble på enden
  (kabel i gulv i rør — **må legges før gulvet**), spiseplass 1 dobbel, stua 5–6 doble, TV-veggen
  2 doble + data.
- Faste uttak: koketopp (5-leder), ovn, oppvask, kjøl, ventilator.
- Lys: downlights over benk og øy, lampeuttak over spisebordet og over sofaen, dimmer på
  stuelyset. Brytere ved inngangene til rommet (fra gangen og fra terrassen) — trappekobling
  eller smarthus mellom dem.
- Ytre påvirkninger: kjøkkenet har damp og varme ved koketoppen; ellers normalt tørt rom.
- Varmepumpe innedel høyt på en innervegg i stua, utedel på nordveggen ved terrassen.

**Soverom (2 × 19 m²)**
- 4 doble stikk hver: to ved sengen (begge sider), én ved skrivebord/TV, én ved døra.
- Taklampe med bryter ved døra (innsiden, låsside).
- Røykvarsler i hvert soverom (anbefalt) — se avsnitt 8.

**Gang (21 m²)**
- Lys i himlingen, bryter ved hver inngang (hovedinngang, stua, soverommene) — trappekobling.
- 2 doble stikk (støvsuger, lading).
- Røykvarsler — gangen er rømningsveien fra soverommene.
- Ringeklokke/dørtelefon ved inngangen, utelys ved inngangsdøra.

**Bad/vask (24 m²)** — NEK 400-7-701
- Sonene: sone 0 er inne i dusjkaret/gulvet i dusjen, sone 1 er over det opp til 2,25 m,
  sone 2 er 0,6 m utenfor sone 1. Slå opp de nøyaktige målene.
- **Ingen stikk i sone 0, 1 og 2.** Servantens stikk (1,1 m, ved speilet) må stå utenfor
  sone 2 — her er hjørnedusjen i motsatt ende av rommet, så det er greit.
- Utstyr i sonene minst **IPX4** (IPX5 der det spyles).
- Vaskemaskin og tørketrommel på egne kurser (13 og 14), stikk ca. 1 m over gulv bak maskinene.
- Varmekabel i gulvet med termostat med **gulvføler**, varmekabel med jordet skjerm (slå opp
  NEK 400-7-753). Ikke under fast innredning.
- **Membranen:** ingen gjennomføringer i våtsona. Bokser på vegg som skal flislegges må tettes
  (mansjett) før membranen.
- Lys: downlights IP44, speil med lys, vifte (ofte på lyskursen eller egen styring med
  fuktføler).

**Bod (20 m², hovedtavla)**
- Hovedtavle, rack for data og fiber (fiberinntak i trekkrør fra tomtegrensen hit),
  overspenningsvern.
- Lys med bryter ved døra, 2 doble stikk.
- Varmtvannsberederen bør flyttes hit fra garasjen hvis garasjen ikke er oppvarmet (frost), og
  for å korte inn rørene til badet.

**Garasje (75 m²)**
- Underfordeling inntil veggen mot badet (kortest kabel fra hovedtavla).
- Lader ved porten, på veggen der bilen står med ladeuttaket. Laderens egen RCD-krav (avsnitt 5).
- Lysrør/LED-lister i taket, bryter ved døra fra badet og ved sidedøra.
- Stikk: 3–4 doble, ett ved arbeidsbenken. IP44 (støv og fukt fra bilen).
- Port: egen kurs, styring etter leverandør.
- Ytre påvirkninger: mekanisk påkjenning (bil, verktøy), fukt, støv. Kabler på vegg i rør eller
  i kabelkanal opp til 1,5 m (mekanisk beskyttelse).

**Ute og terrasse**
- Utelys ved hovedinngang, ved sidedøra i garasjen og på terrassen, med skumringsrelé eller
  bevegelsesføler.
- 1 dobbel stikk ute på terrassen, IP44 med lokk, 30 mA.
- Alt ute minst **IP44**.

### Monteringshøyder (vanlig praksis — ikke normtekst)

| Utstyr | Høyde over gulv |
|---|---|
| Brytere | 1,0–1,1 m (universell utforming: betjening mellom 0,8 og 1,2 m, TEK17) |
| Stikk i oppholdsrom | 0,3 m |
| Stikk over kjøkkenbenk | 1,1 m |
| Stikk ved servant | 1,1 m |
| Termostat | 1,1 m |
| Stikk bak vaskemaskin | 1,0 m |
| Stikk for TV | 0,3 m (eller 1,2 m bak veggmontert TV) |

---

## 7b. Apparat for apparat

Det som skiller en god installasjon fra en lovlig en ligger ofte her: hvordan hvert apparat
kobles, hva det krever av vern, og hva du må vite om det før veggene lukkes. Les alltid
apparatets **installasjonsanvisning** — den er en del av kravet (produsentens anvisning skal
følges, slå opp NEK 400-5-51 om valg og montasje).

### Koketopp (induksjon) og komfyr

- **Tilkobling i TN 400 V:** de fleste induksjonstopper kobles **2-fase + N** (to soner på hver
  sin fase, 2 × 16 A) eller 3-fase + N. Legg **5G2,5** uansett, så du kan koble om etter
  databladet uten ny kabel. Vern: 3-polet C16 med 30 mA (kurs 11).
- **I IT 230 V** kobles samme topp mellom faser (ingen N). Sjekk at toppen er godkjent for IT —
  ikke alle er.
- **Fast tilkoblet**, i et koblingsuttak/komfyrvaktens styreenhet bak skuffen under toppen, ikke
  i et stikk. Kabelen fra veggen må tåle varmen fra ovnen hvis de står over hverandre.
- **Stekeovn på egen kurs** (kurs 12). Hvis ovnen og toppen leveres som én komfyr (frittstående
  komfyr), går hele komfyren gjennom komfyrvakten.

### Komfyrvakt

- **Krav:** nye boliger skal ha komfyrvakt på komfyr og koketopp. Slå opp NEK 400-4-42 og
  NEK 400-8-823, og **hvilken kategori etter NEK EN 50615** gjeldende utgave krever. Kategori A
  slår av når det er i ferd med å bli farlig, B slår av før det oppstår en farlig situasjon.
- **Hvordan:** sensoren (på veggen bak toppen, under overskapet eller innebygd i ventilatoren)
  overvåker temperaturen og/eller tilstedeværelse. Styreenheten bryter strømmen til toppen.
  Plasser sensoren nøyaktig etter anvisningen — avstand og vinkel til toppen er hele poenget.
- **Hvorfor:** glemt komfyr er en av de vanligste årsakene til boligbrann i Norge. Komfyrvakten
  er det tiltaket i risikovurderingen som tar ned **sannsynligheten**, ikke konsekvensen.
- **Sluttkontroll:** funksjonstest etter produsentens metode (ofte testknapp + simulert varme),
  noteres i sluttkontrollen.

### Ventilator

- Stikk i overskapet over toppen (på stikk-kursen for benken eller lyskursen). Høyde etter
  ventilatorens anvisning.
- Hvis komfyrvaktens sensor sitter i ventilatoren, må ventilator og komfyrvakt være av samme
  system eller godkjent sammen.
- Avtrekk ut gjennom vegg: hullet planlegges med tømreren, ikke etterpå.

### Oppvaskmaskin

- Egen kurs (kurs 10), stikk **i skapet ved siden av**, ikke bak maskinen. Da kan den trekkes ut
  og strømmen brytes uten å flytte maskinen.
- **Lekkasjestopp** (vannstopper som stenger vannet ved lekkasje) er god praksis og et tiltak
  mot vannskade. Den trenger ofte strøm — planlegg uttaket.
- På kjøkkenøya: kabel og rør i gulvet til øya, avklart **før** gulvet legges.

### Kjøleskap og fryser

- Egen kurs (kurs 9) med egen jordfeilautomat. Begrunnelse: en jordfeil i en annen kurs skal
  ikke tine fryseren mens dere er på ferie.
- Stikk bak eller over integrert kjøl etter innredningsleverandørens mål.

### Vaskemaskin og tørketrommel (på badet)

- Hver sin kurs (13 og 14). Stikk ca. 1 m over gulv, utenfor sone 2 (sjekk avstanden til
  dusjen på tegningen — her er den lang).
- Lekkasjestopp også her, og sluk eller drypptrau under maskinene.
- Varmepumpetørketrommel trenger ikke avtrekk. En kondenstørker gjør heller ikke det, men
  varmer mer.

### Varmtvannsbereder

- Egen kurs (kurs 19), **fast tilkoblet** via koblingsboks eller med plugg i eget uttak etter
  anvisningen.
- **Styring:** en bereder på 2–3 kW er den enkleste lasten å flytte. Styr den med et relé eller
  smarthus slik at den varmer om natten, så holder huset seg på et lavere effekttrinn i
  nettleia.
- **Plassering:** i boden heller enn i en kald garasje (frost, varmetap, lange rør til badet).
  Over sluk eller med drypptrau.

### Varmekabel (bad og gang)

- NEK 400-7-753: varmekabel med **jordet skjerm**, 30 mA jordfeil, **termostat med gulvføler**
  og temperaturbegrensning. Ikke under fast innredning, badekar eller dusjkabinett på føtter.
- **Effekt per m²:** bad ofte 100–150 W/m², tregulv og parkett mye lavere — slå opp
  produsentens maksimum for gulvtypen.
- **Mål tre ganger:** resistans og isolasjon **før** utlegging, **etter** utlegging og **etter**
  flisleggingen. Hvis kabelen blir skadet av en murerkjelle, vil du vite det før flisene ligger
  der.
- **Dokumenter** hvor kabelen ligger (foto + tegning med mål) og legg det i FDV-en. Neste eier
  som skal bore i gulvet trenger det.

### Varmepumpe luft-luft

- Egen kurs (kurs 18), vern og RCD-type **etter databladet** (frekvensomformer kan kreve type F
  eller B).
- **Sikkerhetsbryter ved utedelen** så service kan skje uten å gå inn til tavla. Mange produsenter
  krever det.
- Utedel på vegg eller stativ, utenfor snøras fra taket, med plass for avrimingsvann. Kabel ute
  i UV-bestandig utførelse eller i rør.

### Elbillader

- NEK 400-7-722: **egen kurs per ladepunkt**, jordfeil **type B** eller type A når laderen har
  innebygd 6 mA DC-overvåking, og overstrømsvern per ladepunkt. Slå opp også kravet til
  overspenningsvern og til lader i IT-nett.
- **DC-deteksjon — hvorfor den finnes.** Bilen har likeretter i ombordladeren. En isolasjonsfeil
  der kan gi **glatt DC-feilstrøm** tilbake i kursen. En vanlig jordfeil type A tåler bare
  pulserende DC; glatt DC over ca. 6 mA kan **magnetisere kjernen i metning**, og da løser den
  ikke ut — heller ikke på en vanlig AC-jordfeil. Vernet ser fint ut, men er blindt.
- **To lovlige løsninger** (slå opp NEK 400-7-722, avsnittet om jordfeilvern for ladepunkt):
  1. **Jordfeil type B** i tavla. Den måler glatt DC selv og løser ut. Dyrere, større.
  2. **Type A (eller F) i tavla + RDC-DD i laderen** (residual direct current detecting device,
     IEC 62955). Laderen kobler fra bilen ved 6 mA DC før type A-vernet blir blindt. Mange
     ladere har dette innebygd — det står som «6 mA DC» eller «RDC-DD» i databladet. Står det
     ikke der, må du ha type B.
- **Fella: vernet foran.** DC-en stopper ikke ved laderen. Står det en felles jordfeilbryter
  type A foran flere kurser, kan **den** bli blindet av DC fra laderen, og da er alle kursene bak
  den ubeskyttet. Derfor: laderen på **egen kurs med eget jordfeilvern**, ikke bak en felles
  type A. Og aldri type B **etter** en type A — type B slipper DC gjennom til vernet foran.
  I Verona er dette løst ved at laderen går rett fra hovedtavla (kurs 21) med egen RCBO, og
  hovedtavla har ingen felles jordfeilbryter foran.
- **Sluttkontroll:** type B testes med en installasjonstester som kan gi DC-rampe. RDC-DD i
  laderen testes etter laderens anvisning (ofte innebygd selvtest ved oppstart). Før begge i
  sluttkontrollen.
- **Laststyring** mot HAN-porten eller en måletrafo på inntakskabelen (avsnitt 2).
- Plassering ved porten der bilens ladeuttak havner, i høyde etter anvisningen.

### Røykvarslere

- 230 V med batteri i reserve, seriekoblet. **Legg dem på en mye brukt lyskurs**: hvis kursen er
  av, merker dere det med en gang, og røykvarslerne er aldri «stille av» uten at noen vet det.

### Lysstyring

- Bestem tidlig om det skal være **vanlige brytere, trådløst (Plejd o.l.) eller kablet
  (KNX)**. KNX krever buskabel til hvert punkt **før** veggene lukkes. Trådløst kan legges til
  etterpå. Uansett: legg **nulleder i alle bryterbokser**, ellers kan ikke en smart dimmer
  settes inn senere.

### Ute, port og dørklokke

- Utelys ved hovedinngang, sidedør og terrasse med skumringsrelé eller bevegelsesføler, IP44.
- Garasjeport: egen kurs i underfordelingen, stikk eller fast tilkobling i himlingen ved
  portåpneren etter anvisningen.
- Dørklokke/dørtelefon: trekkrør fra inngangen til boden (racket), så det kan bli kamera senere.

---

## 8. Svakstrøm og brann

- **Røykvarslere** tilkoblet strøm med batteri i reserve, og **seriekoblet** (går én, går
  alle): gang, stue, hvert soverom. Slå opp TEK17 § 11-12 og veiledningen. I garasjen
  **varmevarsler**, ikke røyk (eksos gir falske alarmer).
- **Data:** stjerne fra racket i boden — CAT6 til stue (TV), hvert soverom, kontorplass og
  ett punkt i himling for trådløst aksesspunkt.
- **Fiber:** trekkrør fra tomtegrensen til boden. Legges samtidig med grøfta for stikkledningen
  hvis mulig — én grøft, to rør.

---

## 9. Føring av kablene

- **Skjult** i innervegger og himling. Unngå å legge kabler inne i isolasjonen i yttervegger:
  da gjelder referansemetode A1 (dårligst kjøling), og belastbarheten går ned.
- Fra tavla i boden går de fleste kursene opp i himlingen og ut over gangen. Kjøkkenøya får rør
  i gulvet (avsnitt 7).
- Mellom bad og garasje: gjennomføringen må brannisoleres (garasjen er egen branncelle mot
  boligen — slå opp kravet til branncelle i TEK17 og bruk godkjent tettemasse).
- Tegn **åpent** (heltrukken) og **skjult** (stiplet) forskjellig på installasjonstegningen.

---

## 10. Sluttkontroll — slik beviser du at det er riktig

NEK 400-6, i denne rekkefølgen:

1. **Visuell kontroll:** riktig utstyr, merking, IP-grader, tavla, kursfortegnelse på plass.
2. **Kontinuitet** i PE-ledere og utjevning.
3. **Isolasjonsmåling** 500 V DC mellom ledere og mot jord, med utstyr frakoblet. Minst
   1 MΩ (slå opp tabellen).
4. **Polaritet:** bryterne bryter fasen, ikke N.
5. **Kortslutningsstrøm / sløyfeimpedans** på lengste punkt per kurs. Vernet må løse ut innen
   0,4 s på sluttkurser i TN 230 V. For C16 betyr det at strømmen må nå 10 · 16 = 160 A, altså
   Zs ≤ 230 / 160 = **1,44 Ω**. For B10: 5 · 10 = 50 A → Zs ≤ **4,6 Ω**.
6. **Jordfeilvern:** utløsningstid og utløsningsstrøm per RCD (testknappen alene er ikke en
   måling).
7. **Spenningsfall** målt ved lengste uttak.
8. **Funksjonsprøve:** komfyrvakt, termostater, lader, røykvarslere, port.

Målingene føres per kurs i sluttkontrollskjemaet i Ampex. Samsvarserklæringen signeres når
alt er grønt, og ferdigmeldingen går til nettselskapet.

---

## 11. Det du må slå opp eller spørre om

- Nettselskapet: TN eller IT, Ik i kabelskapet, krav til stikkledning, hvem eier den,
  anleggsbidrag for 3 × 40 A.
- NEK 400-8-823: minimumsantall stikk per romtype, komfyrvakt, jordfeil i bolig.
- NEK 400-5-52: tabellene for belastbarhet (Iz) per referansemetode og korreksjonsfaktorer når
  kabler ligger samlet.
- Databladene: varmepumpe (vern og RCD-type), lader (RCD og laststyring), induksjonstopp
  (tilkobling 2- eller 3-fase), varmekabel (W/m² og maks for gulvtypen).
- TEK17 § 11-12 (røykvarslere) og kravene til branncelle mellom garasje og bolig.

---

## Til Ampex

Alt over kan legges inn på Verona-ordren: tegningen med punkter og kurser, kursfortegnelsen
(«Lag kursfortegnelse» gir et utgangspunkt som ligner tabellen i avsnitt 6), føringene med
lengde og ΔU, risikovurderingen og sluttkontrollen. Det som mangler i appen i dag for å gjøre
dette helt: et felt for **inntak og hovedtavle** (nettsystem, hovedsikring, stikkledning,
inntakskabel, overspenningsvern), **underfordeling** som egen forsyner med kurser under, og
**fasefordeling** per kurs.

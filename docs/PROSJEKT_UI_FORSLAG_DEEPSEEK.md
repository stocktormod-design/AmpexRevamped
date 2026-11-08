# Prosjekter — UI-forslag (DeepSeek)

Mål: premium og rolig som Apple, men med Formas logikk: **tegningen er arbeidsenheten**.
Montøren åpner Prosjekter for å komme til ett ark for ett bygg — ikke for å se et
dashbord. Alt som ikke hjelper ham dit, fjernes.

Tre prinsipper:
1. **Én vei inn.** Mapper er den eneste navigasjonsveien til tegninger. Søk og
   «fortsett» er snarveier, ikke egne seksjoner.
2. **Data leder raden.** Navn, sted, antall, status. Ingen dekorative ikonfliser,
   ingen tre tomme miniatyrer.
3. **Én fylt handling per skjerm.** Sort på hvitt. Alt annet er stille.

---

## 1. Prosjektlista

**Topp:** `Prosjekter` (display) · MegAvatar · ett sort «+» (44 pt). Ikke noe mer.

**Liste, ikke kort.** Én rad per prosjekt, 76–84 pt, hårlinje mellom:

```
Torvhaugan Omsorgsbolig           4 tegninger
Torvhaugan · Aktiv
```

- Venstre: navn (headline), under `kunde · adresse` (footnote). Status som
  **prikk + ord** («Aktiv»), ikke loddrett strek. Arkivert vises som «Arkivert» i
  sekundærfarge; aktive prosjekter får ingen status i det hele tatt — det er normen.
- Høyre: `4 tegninger` i tabulære tall. **Maks én miniatyr** (56×40, hårlinje) og
  bare hvis fila finnes; mangler den, rendres ingen boks. Aldri tre på rad.
- Sortering: aktive først, deretter sist endret.
- Søk vises først når det er flere enn åtte prosjekter — som felt under tittelen.
- **Tomtilstand:** hvitt kort, «Ingen prosjekter ennå», én linje om hva et prosjekt
  samler, og én sort CTA «Nytt prosjekt».

Låner: **Apple Files** (rader, ikke fliser), **Things 3** (luft og én aksent).

---

## 2. Prosjektsida

**Topp:** tilbake (44 pt). Ingen avatar — Meg er en annen fane. Tittelen er
prosjektnavnet (2 linjer maks), under den `kunde · adresse · Aktiv` på én linje.

**Fortsett-rad** (én rad, ikke en seksjon): «Fortsett · Elkraft» med ett lite
miniatyrbilde og chevron. Åpner sist åpnede tegning direkte. Vises bare når det
finnes en.

**Statuskort** (kompakt, hvitt, hårlinje):
- `0 av 41 montert` med en tynn fremdriftslinje (scaleX, hårlinje som spor).
- `Ingen åpne oppgaver` som andre linje.
- Trykk → Oppgaver.
- **Ikke** en stor ring med «0» alene. Ring er greit først når den har tall og
  etikett; her er en linje ærligere og roligere.

**Tegninger — én seksjon:**
- Overskrift `Tegninger 4` og et søkefelt rett under.
- **Mapper først:** mappeikon (liten, sort strek — ikke flis), navn,
  `1 mappe · 1 tegning` (rekursivt), chevron.
- **Løse tegninger** som egen **etikett** nederst, ikke som falsk mappe
  «Uten mappe».
- Tegningsrader: valgfritt ett lite miniatyrbilde (32×24), navn, underlinje
  `plan · fag` — men bare hvis planen ikke er identisk med navnet. «Elkraft /
  Elkraft» skal ikke kunne skje.
- **Fag-chipene fjernes som navigasjon.** De blir et filter inne i søket (én rad,
  bare når man søker), ikke en tredje vei til samme filer.
- **«Sist åpnet» fjernes som seksjon.** Det er «Fortsett»-raden over.

**Oppgaver** ligger under tegningene, som i dag. Dokumentasjon/vedlegg under der.

**Tomt prosjekt:** ett hvitt kort: «Ingen tegninger ennå», sort «Legg til tegning»,
stille «Ny mappe».

Låner: **Apple Files** (mappebrowser), **Forma** (status som metadata, ikke kort),
**Apple Notes** (søk under tittel).

---

## 3. Mappenivået

Samme mønster hele veien ned:

- **Brødsmule** øverst: `Prosjekt › Bygg A › Elkraft`, hvert ledd trykkbart
  (allerede implementert). Tittel = mappa du står i.
- **Undermapper først**, deretter tegninger på nivået. Samme rader som over.
- **Handlinger:** ett stille «+» i hodet som åpner `Ny mappe` / `Legg til tegning`;
  long-press mappe = nytt navn / flytt / slett (innholdet flyttes opp);
  long-press tegning = flytt. Ingen synlige handlingsknapper per rad.
- **Tom mappe:** hvitt kort, «Denne mappa er tom», sort «Legg til tegning», stille
  «Ny mappe».
- Ingen fag-chips, ingen «sist åpnet» her heller.

Låner: **Apple Files** (mapper, brødsmule, long-press-meny).

---

## 4. Tegningen på under tre trykk

Fra Prosjekter-fanen:

1. Trykk prosjektraden.
2. Trykk **Fortsett**-raden (siste tegning) **eller** mappa.
3. Trykk tegningen.

Det er **to** trykk når man skal tilbake til samme ark, tre når man må inn i en
mappe. Søk: trykk prosjekt → trykk søkefeltet → skriv → trykk treffet (3 trykk +
skriving). Treffene viser sti (`Bygg A › Elkraft`) så man ser at man er i riktig
bygg. Ingen egen «sist åpnet»-seksjon, ingen fagchips å forholde seg til.

---

## 5. Det vi fjerner

- Tre tomme miniatyrer per prosjektkort → **én** eller ingen.
- Fag-chipene som egen navigasjon → filter i søket.
- «Sist åpnet» som seksjon med stort kort → én «Fortsett»-rad.
- «Uten mappe» som mappe → etikett «Løse tegninger».
- Stor ring med «0» uten kontekst → kompakt statuslinje.
- Loddrett «Aktiv»-strek → prikk + ord (eller ingenting).
- Duplisert undertittel («Elkraft / Elkraft») → fag/plan vises bare når det gir
  ny informasjon.
- Pynt som ikke bærer data: ekstra ikoner, flere primærfarger, kort på kort.

---

## 6. Hva jeg låner, og hvorfor

| Mønster | Fra | Hvorfor |
|---|---|---|
| Lister med hårlinje, ikke kort | Apple Files / Notes | Roligere, flere prosjekter synlig, ingen tomme bilder |
| Brødsmule med trykkbare ledd | Apple Files / Finder | Alltid oversikt over hvor man er, rask vei opp |
| Long-press-meny | Apple Files | Handlingsrom uten knapper i hver rad |
| Én «Fortsett»-rad | Forma / Apple Health | Raskeste vei tilbake til jobben |
| Status som metadata | Forma | Prosjektstatus er informasjon, ikke et kort |
| Én fylt handling | Things 3 | Tydelig neste steg, ingen konkurrerende CTA-er |

---

## 7. Data og ytelse (alt lokalt)

- Prosjektliste: `projects` + `drawings` (telling) + siste tegning for miniatyr.
- Prosjektside: `useMapper` (rekursiv telling via `tellRekursivt`), oppgaver
  (`tasks`), fremdrift (`project-progress`), sist åpnet (`lib/siste-tegning`).
- Én miniatyr per rad maks; `DrawingThumb` lazily, og ingen boks når fila mangler.
- Ingen polling; alt reaktivt fra WatermelonDB.

Dette er et forslag, ikke en implementasjonsplan — men alle dataene finnes
allerede lokalt, og mappelogikken (brødsmule, flytt, slett, telling) er bygget.

---

## Uenigheter og hva jeg tar fra Claude

Jeg har lest `PROSJEKT_UI_FORSLAG_CLAUDE.md` etter at mitt eget var skrevet.

### Det jeg tar fra Claude — bedre enn mitt forslag

- **«Mine» / «Alle» øverst i prosjektlista.** Jeg hadde én liste; `project_members`
  gjør det billig å løfte prosjektene montøren faktisk jobber i. Tar den.
- **«⋯»-meny på prosjektsida** (medlemmer, rom, prosjektinfo). Jeg fjernet bare
  avataren uten å si hvor sekundærhandlingene skulle bli av. «⋯» er riktig sted.
- **Skjul fremdriften når den er 0.** Min kompakte statuslinje var ærlig, men
  Claudes «vis først når noe er registrert» er roligere og løser Tormods klage
  direkte. Tar den.
- **Revisjonsmetadata** («E-401 · rev C», endret-dato, prikk for ny revisjon).
  Det er Forma/ACC-detaljen som gjør raden profesjonell, og Claude bygger revisjoner
  nå. Tar den — med fallback til fag/plan til revisjonsfeltene finnes.
- **Liste/rutenett + sortering** (Navn · Nummer · Sist endret) i én meny, og
  **iPad-rutenett**. Tar det som senere steg; det er billig og Files-riktig.
- **Sveip for flytt/navn/slett**, med long-press som oppdaget vei. Tar sveip i
  tillegg til long-press, ikke i stedet.
- **Søk som dras fram (Mail)** i prosjektlista. Det løser min «bare ved >8»-regel
  uten å vise et tomt felt når det er ett prosjekt.
- **«Nylig» etter fokus i søket** — ikke som standardinnhold. Da er det en
  søkehjelp, ikke en tredje vei til tegningene.
- **Rettelse:** Claude skriver «Søk i 41 tegninger». 41 er komponenter
  («0 av 41 montert»); prosjektet har 4 tegninger. Søket må telle tegninger.
- **«Fortsett» bør åpne der du slapp.** Enig i intensjonen. Men `lib/siste-tegning.ts`
  lagrer bare id-er, ikke zoom/pan; «samme zoom» krever ny persistens. Utsett det
  eller si det som mål, ikke som noe som virker i dag.

### Der jeg er uenig

1. **Fortsett-kortet: stort hero-kort vs. kompakt rad.** Claude vil ha stor
   miniatyr og tre metadata-linjer. Jeg vil ha én kompakt rad (64×48 miniatyr,
   navn + «E-401 · rev C»). Grunnen: kortet blir den tredje store blokken over
   tegningene, og da er vi tilbake til tre konkurrerende innganger. Kompromiss:
   bredt nok til å være primær, men ikke høyere enn 84 pt.
2. **Brødsmulen: over tittelen vs. under, med long-press på tilbake.** Claude
   legger stien under tittelen og skjuler den bak long-press på tilbake. Jeg vil
   ha den **alltid synlig over tittelen** (som implementert). En montør i en
   kjeller skal ikke måtte holde inne en knapp for å vite hvilket bygg han er i.
3. **Chevron på mapperader.** Claude fjerner den for å følge regel 9. Regel 9
   forbyr *ikonflis + chevron*, ikke en mappeglyf + chevron. Uten chevron blir
   raden lettere å lese som ren tekst og svakere som «dette åpner noe». Jeg
   beholder en dempet chevron — eller dropper mappeikonet og beholder chevronen.
4. **«Nylig» som tom søketilstand.** Claude viser fem siste når feltet er tomt.
   Det er elegant, men det gjeninnfører «Sist åpnet» som en egen flate så snart
   man trykker i feltet. Jeg vil bare vise «Nylig» når feltet har fokus, og aldri
   som en del av standardsiden.
5. **Prosjektlistas miniatyr.** Vi er enige om én, ikke tre. Men jeg vil at boksen
   **skal mangle helt** når fila ikke finnes; Claude vil ha en 56 pt-boks. En tom
   ramme er nettopp det som ser ødelagt ut i dagens skjermbilde.
6. **Rekkefølgen nederst.** Claude: tegninger → mine oppgaver → fremdrift. Jeg
   vil ha oppgavene **over** fremdriften (handling før tall), og fremdriften helt
   til slutt. Liten sak, men det er samme prinsipp som «én fylt handling».

**Netto:** Claudes forslag er sterkere på metadata og på å skjule tomme tall; mitt
er strengere på at det bare skal finnes én vei til tegningene. Det beste er
Claudes «Fortsett» og revisjonslinje, med min kompakte høyde, alltid synlig
brødsmule og ingen tomme miniatyrrammer.

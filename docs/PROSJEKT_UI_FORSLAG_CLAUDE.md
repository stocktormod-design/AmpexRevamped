# Prosjekt-fanen — forslag fra Claude (2026-11-08)

Skrevet uavhengig av DeepSeeks forslag (`PROSJEKT_UI_FORSLAG_DEEPSEEK.md`). Tormod velger.
Skjermbilder av dagens: `skjerm-prosjekter-liste.png`, `skjerm-prosjekt-side.png`.

**Grunntanken:** én vei til tegningene — mappene. Apple Filer for strukturen, Forma for
tegningsdetaljene (nummer, revisjon, miniatyr). Montøren vil oftest tilbake til tegningen han
hadde åpen; det skal være ett trykk.

## Hva som fjernes

- **Fagchipsene** (Elkraft 2 · Svakstrøm 1 · Annet 1). Faget er en mappe (importen lager dem); to
  sorteringer av det samme gjør at man ikke vet hvor man skal lete.
- **«Uten mappe»**. Løse tegninger ligger som filer på rotnivået, slik Filer gjør det.
- **«Sist åpnet»-rutenettet.** Erstattes av ett «Fortsett»-kort (under) og av «Nylig» i søket.
- **Ringen med «0».** Framdrift vises først når det finnes noe å vise.
- **«Elkraft / Elkraft».** Undertittelen er tegningsnummer og revisjon, aldri navnet på nytt.

## (a) Prosjektlista

Stor tittel «Prosjekter», søkefelt som dras fram (som Mail), «+» oppe til høyre.

- **Rader, ikke kort.** Én rad per prosjekt: miniatyr 56 pt (sist åpnede tegning — EN, ikke tre
  tomme), navn, adresse, og «12 tegninger · åpnet i går» i grått. Status bare når den ikke er
  «Aktiv» (en liten prikk + ord, semantisk farge).
- **«Mine» øverst** (prosjekter jeg er med i), så «Alle» — seksjonsoverskrift, ikke filter.
- Tomt: «Ingen prosjekter ennå» + «Nytt prosjekt» (sort knapp). Kontoret lager de fleste.
- iPad: samme data som rutenett med større miniatyrer.

## (b) Prosjektsida

Ovenfra og ned:

1. **Navigasjonslinje:** tilbake · prosjektnavn (stor tittel som krymper ved rulling) · «⋯»
   (medlemmer, rom, prosjektinfo — det sjeldne bor der).
2. **Adresse og status** i én grå linje under tittelen. Trykk adressen → kart.
3. **Fortsett-kortet** (bare når det finnes en sist åpnet tegning): stor miniatyr, «Elkraft BF1»,
   «E-401 · rev C · åpnet 10:42». Ett trykk = rett inn i tegningen der du slapp (samme zoom).
4. **Søkefelt** «Søk i 41 tegninger» — søker i ALLE mapper og viser treff med sti
   («Adminbygg › Elkraft»). Tomt felt viser «Nylig» (5 siste).
5. **Tegninger** — rotnivået i mappetreet, rett på sida (ikke ett trykk unna): mapper først, så
   løse tegninger. Se (c).
6. **Mine oppgaver (3)** — én rad, bare når jeg har åpne oppgaver.
7. **Framdrift** — én rad «12 av 41 montert» med tynn strek, bare når noe er registrert.

## (c) Mappenivå (Apple Filer)

- **Tittel = mappenavnet.** Stien som brødsmuler under tittelen: «Torvhaugan › Adminbygg ›
  Elkraft», hvert ledd trykkbart. Langt trykk på tilbake viser stien (iOS-mønsteret).
- **Mapperader:** mappeikon (strek, ikke fylt flis), navn, «5 tegninger» (rekursivt). Ingen chevron.
- **Tegningsrader:** miniatyr 48 pt, navn, «E-401 · rev C» og endret-dato i grått. Ny revisjon
  siden sist jeg åpnet = liten sort prikk.
- **Liste/rutenett** og **sortering** (Navn · Nummer · Sist endret) i én meny oppe til høyre, som Filer.
- **«+»**: Ny mappe · Legg til tegning. Fungerer på alle nivåer.
- **Sveip / hold:** Flytt (til hvilken som helst mappe, aldri inn i seg selv) · Gi nytt navn · Slett
  (innhold flyttes ett hakk opp). Bekreftelse på slett.
- **Tom mappe:** «Tom mappe» + «Ny mappe» og «Legg til tegning».

## (d) Montøren — riktig tegning på under tre trykk

- Vanligst: **Prosjekter → prosjekt → Fortsett** (2 trykk).
- Vet nummeret: **prosjekt → søk «401»** (2 trykk + tasting).
- Ny tegning: **prosjekt → Adminbygg → Elkraft → tegning** (mappedybden avgjør; importen holder den
  grunn).
- **I tegningen**: tittelen i toppbaren åpner det samme mappetreet som et ark (i dag en flat liste
  over alle tegninger) — bytt tegning uten å gå ut.

## Mønstre vi låner

| Hvor | Fra |
|---|---|
| Rader med miniatyr, liste/rutenett, sortering, brødsmuler, sveip | Apple Filer |
| Stor tittel som krymper, søk som dras fram | iOS Mail / Innstillinger |
| Fortsett-kortet | Apple Bøker («Leser nå») |
| Tegningsnummer + revisjon som undertittel, revisjonsprikk | Autodesk Forma / ACC |
| Bytte tegning fra tittelen inne i viseren | Forma (arkvelgeren) |

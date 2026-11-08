# Tegningsviseren — forslag fra Claude (2026-11-08)

Skrevet uavhengig av DeepSeeks (`TEGNING_UI_FORSLAG_DEEPSEEK.md`). Skjermbilder:
`skjerm-tegning-en.png`, `skjerm-tegning-delt.png`. Forbilde: Formas arkviser — dokk til
høyre, visning nede til høyre, arkbytte fra tittelen — men roligere og iOS-ete.

**Grunntanken:** tegningen eier skjermen. Krom er tre små flater som aldri flytter seg:
toppen (hvor er jeg, bytt tegning), dokken (hva gjør jeg), hjørnet nede til høyre (hvordan ser
jeg). Ingenting annet ligger fast oppå arket.

## (a) Toppen

Én glassflate, 48 pt: **tilbake · tittelblokk · Lag · ⋯**

- **Tittelblokk** (trykkbar, med ⌄): tegningsnavnet i fet, under det «E-401 · rev C ·
  Adminbygg › Elkraft» i grått. Trykk = bytt tegning (b).
- **Lag** (ikon `Layers`): meny med av/på for Rom · Sløyfer · Komponenter · Andres markering.
  Erstatter «Rom»-knappen — rom er ett lag av flere, ikke en egen knapp.
- **⋯**: Del lenke · Åpne i 3D (når rommet har skann) · Info om tegningen.
- **Publiser N** (sort pille) kommer inn til høyre for tittelen bare når det finnes kladd.

## (b) Bytte tegning

Tre veier, alle til samme ark, ingen ny skjerm:

1. **Arkvelgeren** (trykk tittelen): et ark som dekker 2/3 av skjermen, med søkefelt øverst,
   «Nylig» som én vannrett rad med 4–6 miniatyrer, og under den **mappetreet** med mappa du står i
   åpen og tegningen du ser på markert. Samme mapper som prosjektsida — ikke en flat liste over
   alle tegninger slik i dag. Treff i søket viser sti.
2. **Forrige / neste i mappa**: «‹ 3 av 8 ›» i pillen nede til høyre, ved siden av visningen
   (Formas ‹ ▦ ›). For å bla gjennom etasjene uten å åpne noe.
3. **I delt visning**: hver rutes navnepille åpner samme arkvelger, for DEN ruta.

Bytte beholder ikke zoom (ny tegning starter på hele arket), men tilbake til forrige tegning
husker der du var.

## (c) Dokken

Mørk, loddrett, til høyre, midt på (bygget). Ikon + kort etikett — på telefon er det ingen
hover-tips, så etiketten er tipset.

- **Gruppe 1, markering:** Velg · Penn · (senere Tekst, Sky — revisjonssky er standard i
  bransjen).
- **Gruppe 2, el:** Sløyfe · Brann · (senere Oppgave — i dag langt trykk, ikke oppdagbart).
- **Valgene for verktøyet** (farge, strek, «Ny sløyfe», «Finn fra tegningen») i et lite panel
  rett til venstre for dokken, på høyde med verktøyet — ikke en rad som endrer størrelse.
- **Angre / gjør om** i en egen liten dokk under. Fast plass, alltid samme sted.
- **Intet verktøy = panorering.** Trykk på aktivt verktøy legger det bort.
- Ingen mål-verktøy (Tormod).

## (d) Delt og firedelt

- Toppen viser **prosjekt og mappe** når skjermen er delt; rutene viser hver sin tegning i
  navnepillen. I dag står samme navn to steder.
- **Lås** midt på skillelinja (som i dag), med kort animasjon når rutene snapper sammen.
- **Tom rute:** stiplet ramme, «Velg tegning» — åpner arkvelgeren.
- **Dokken skjules** i delt visning (verktøy gjelder én tegning); trykk på en rute og velg
  «Åpne alene» for å tegne på den.

## (e) Det som fjernes

- «Rom»-knappen i toppen (inn i Lag).
- Den flate tegningslista (erstattes av arkvelgeren med mappetre).
- Dobbelt navn i delt visning (topp + pille).
- Fargerike sirkler som ikke er valgt — valgfargen vises på verktøyknappen i dokken i stedet.

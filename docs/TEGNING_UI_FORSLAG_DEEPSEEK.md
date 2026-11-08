# Tegningsviseren — UI-forslag (DeepSeek)

Mål: Formas ro og logikk, Apples presisjon. Viseren er et **verktøy**, ikke en
bildefremviser: arket skal fylle skjermen, verktøyene skal ikke ligge oppå det, og
den vanligste handlingen — bytte ark — skal koste ett trykk.

Bærende prinsipper:
1. **Arket er helten.** Chrome flyter i margen; ingenting dekker selve tegningen.
2. **Én toppbar, én dokk, én visningsvelger.** Rom, publisering og flere handlinger
   skal ikke konkurrere i toppen.
3. **Forma på iPad, Apple på telefon.** Samme hierarki, men dokka er smalere og
   visningsvelgeren har to valg på telefon.

---

## (a) Toppbar

**Én tegning:**
`[tilbake 44] [ ‹  Elkraft            › ] [⋯]`
`                    E-401 · rev C · 1:100`

- Venstre: tilbake, 44 pt, hvit sirkel med hårlinje.
- Midten: navnet (subhead, 600) + **tegningsnummer · revisjon · målestokk** i
  caption. Ikke «BF1» alene og ikke planen om den gjentar navnet. Trykk på
  tittelen åpner arkvelgeren (se b). De to små `‹ ›` på hver side blar til
  forrige/neste ark i samme mappe — uten å åpne noe.
- Høyre: `⋯` (44 pt) med Prosjektinfo · Rom · Medlemmer · Del/Eksporter.
  **«Rom» og «Publiser» flyttes ut av toppbaren.**

**Delt visning:** toppbaren mister arknavnet (hver rute har sin egen pille):
`[tilbake] [Prosjektnavn] [⋯]`. Ingen publisering, ingen rommodus — delt visning
er lesing og sammenligning.

**Publisering:** når det finnes upubliserte strøk, vises en **sort pille nede
midt på** (`Publiser 3`) rett over hjemmeindikatoren. Den er borte når det ikke
er noe å publisere, og gir «Publisert» + haptikk etterpå. Publisering er en
handling, ikke et verktøy.

Låner: **Forma/ACC** (tittel + arkbytte), **Apple Books** (kapittel-/sidebytte).

---

## (b) Bytte tegning

Dagens flate `ChoiceSheet` med alle tegninger erstattes av **én arkvelger**:

- Bunnark, 90 % høyde, med håndtak.
- **Søk** øverst: «Søk i 4 tegninger», søker i alle mapper og viser sti
  (`Adminbygg › Elkraft`).
- **Sist åpnet:** en horisontal **filmstripe** med de tre siste (72×52 miniatyr,
  navn under). Ett trykk bytter; dette er den raskeste veien tilbake.
- **Mappetreet** under: samme rader som Prosjekter (mapper med rekursivt antall,
  tegninger med miniatyr, navn og `E-401 · rev C`). Gjeldende ark har hake.
- **Forrige/neste** finnes også som `‹ ›` i toppbaren, så man kan bla sekvensielt
  uten å åpne arket. Rekkefølgen er mappens rekkefølge.
- **I delt visning:** hver rutes pille åpner samme arkvelger, men med tittelen
  «Velg til rute 2». Valget setter bare den ruta og lukker arket. Låsen blokkerer
  ikke bytte.

Hvorfor ikke en permanent filmstripe nederst? Den stjeler 80 pt av arket hele
tiden. Filmstripen hører hjemme i arkvelgeren, der man allerede har bestemt seg
for å bytte.

---

## (c) Verktøydokken

Høyre side, **56 pt bred** (iPad 64), loddrett midtstilt, med luft til toppbar og
visningsvelger:

```
┌────┐
│ ▢  │  Velg      ← aktiv = hvit firkant, sort ikon
│ ✎  │  Penn
│ ⌘  │  Sløyfe
│ ♨  │  Brann
├────┤
│ ↶  │
│ ↷  │
└────┘
```

- Fire verktøy: **Velg, Penn, Sløyfe, Brann**. «Mål» finnes ikke og skal ikke
  tilbake (Tormod).
- **Etikett under hvert ikon** (9–10 pt). Montøren er fagperson, ikke designer;
  ikonet alene er for tvetydig. Bredden holdes nede ved å stable ikon + tekst.
- **Aktivt verktøy** er en hvit 44×44-flate med sort ikon og hvit etikett; de
  andre er hvite på sort med 60 % opacity. Ett trykk på aktivt verktøy legger det
  bort (som i dag).
- **Valgene** (farger, strektykkelse, «Ny sløyfe», «Finn fra tegningen») ligger
  ikke i en permanent 176 pt-panel. De åpnes som et **lite ark** når man trykker
  på den lille chevronen på det aktive verktøyet, eller fra en `⋯`-rad nederst i
  dokka. Arket er 200 pt høyt, har fargedotter og tre strektykkelser, og lukkes
  når man velger. Arket dekker aldri mer enn nederste tredjedel.
- **Angre/gjør om** nederst i samme dokk, skilt med en hårlinje — ikke en egen
  boks med luft mellom. Deaktivert = 30 % opacity.
- **Publiser** er ikke i dokka; se (a).

Låner: **Forma/ACC** (loddrett dokk), **Procreate** (aktivt verktøy + options),
**Freeform** (inspector).

---

## (d) Delt og firedelt

- **Rutepiller:** øverst til venstre i hver rute, `Elkraft · BF1` + chevron.
  Aktiv rute = sort pille med hvit tekst; de andre hvite med hårlinje. Pillen
  ligger **inne i ruta**, ikke over toppbaren, og dekker bare margen.
- **Låsen:** en liten kapsel midt på skillelinja, 36 pt høy, låsikon + «Låst».
  Trykk låser opp; da vises «Lås opp»/ulåst ikon og hver rute kan beveges for
  seg. Teksten bør være **«Samme utsnitt»** når den er låst, ikke bare «Låst» —
  det er det låsen faktisk gjør (samme skjermutsnitt, ikke samme papirpunkt).
- **Tom rute:** en dempet, stiplet boks (1 px hårlinje) med `+` og «Velg tegning»
  i sekundærfarge — ikke en stor grå flate. Trykk åpner arkvelgeren for den ruta.
  Pillen viser «Tom rute» og en liten `×` som lukker ruta (tilbake til én).
- **Visningsvelger:** nede til høyre, 44 pt, to segmenter på telefon (én · delt)
  og tre på iPad (én · delt · fire). Valgt segment er sort. Den ligger over
  margen, ikke over arket.
- **Aktiv rute** markeres med sort pille + en 0,5 px hårlinje rundt ruta. Ingen
  farget ramme.
- Verktøydokka er **skjult** i delt visning (lesing), og det sies med ett lite
  «Sammenligning»-merke i toppbaren? Nei — det holder at dokka er borte og
  publiseringspilla ikke vises.

Låner: **Forma** (view layout, pane switcher), **Apple Maps** (flytende
kontroller nede til høyre), **Photos** (sammenligning uten verktøy).

---

## (e) Det vi fjerner

- «Rom» som stor pille i toppbaren → `⋯` eller visningsclusteren.
- «Publiser» fra toppbaren → sort pille nederst, bare når det finnes strøk.
- Det permanente 176 pt-optionspanelet → ark/popover.
- Den separate angre/gjør om-boksen med luft → samme dokk.
- Arknavnet i toppbaren i delt visning (dupliseres av rutepillene).
- Den store grå «Velg tegning»-flaten → stiplet tomtilstand.
- Den flate lista over alle tegninger → mappetre + filmstripe + `‹ ›`.
- «Mål» (finnes ikke i dag — skal ikke gjeninnføres).
- 36 pt tilbakeknapp → 44 pt.

---

## Hva jeg låner, og hvorfor

| Mønster | Fra | Hvorfor |
|---|---|---|
| Loddrett verktøydokk med etiketter | Forma / ACC | Kjente verktøy, alltid synlige, ingen modus |
| Aktivt verktøy + options-ark | Procreate / Freeform | Valgene vises bare når de trengs; arket er fritt |
| Filmstripe + mappetre i arkvelger | Apple Photos / Filer | Visuelt og raskt; tre siste dekker «tilbake til i går» |
| `‹ ›` ved tittelen | Apple Books | Sekvensiell blaing uten modal |
| Flytende visningsvelger nede til høyre | Forma / Maps | Layout er en visning, ikke en handling |
| «Samme utsnitt»-lås | Forma | Ærlig om hva låsen gjør på tvers av ulike ark |

## Data og ytelse

- Arkvelgeren leser `drawings` + `drawing_folders` fra WatermelonDB (samme
  `useMapper`/`tre` som Prosjekter); «sist åpnet» fra `lib/siste-tegning.ts`.
- Ett miniatyrbilde per rad; filmstripen gjenbruker `DrawingThumb`.
- Ingen nye nettlesinger; ingen polling. Alt er lokalt, som i dag.

---

## Uenigheter og hva jeg tar fra Claude

Lest etter at mitt eget var skrevet.

### Det jeg tar fra Claude — bedre enn mitt forslag

- **«Lag»-menyen** i stedet for en «Rom»-knapp: Rom · Sløyfer · Komponenter (·
  Andres markering senere). Rom er ett lag, ikke en egen modus. Tar den.
- **«‹ 3 av 8 ›» nede til høyre**, ved visningsvelgeren, i stedet for mine
  chevroner i toppbaren. Det gir posisjon i mappa og er innenfor tommelen. Tar
  den — toppbaren blir roligere av det.
- **«Åpne alene»** fra en rute i delt visning. Jeg hadde skjult dokka uten å gi
  en vei tilbake til redigering; det er en reell mangel. Tar den.
- **Zoom-hukommelse per tegning** (tilbake til forrige ark husker utsnittet).
  Godt mål — men `lib/siste-tegning.ts` lagrer bare id-er i dag, så det krever ny
  persistens. Vi bør si det som mål, ikke som noe som virker nå.
- **Egen liten dokk for angre/gjør om** under verktøyene. Jeg ville slått dem
  sammen for å spare høyde, men den faste grupperingen er tydeligere og finnes
  alt. Tar den.
- **4–6 siste i filmstripen** (jeg sa 3). Fire får plass på telefon; tar fire.
- **Revisjonssky og «Oppgave» som verktøy senere** — ikke nå. Enig i rekkefølgen:
  markering først, el-verktøyene etterpå.
- **«Publiser N» bare når det finnes kladd** — samme konklusjon som meg.

### Der jeg er uenig

1. **Optionspanelet: 176 pt ved siden av dokka vs. et lite ark.** Claude beholder
   panelet til venstre for dokka, «på høyde med verktøyet». Det dekker opptil
   40 % av bredden på en telefon og ligger oppå arket mens man velger farge. Jeg
   vil ha et **lite bunnark** (200 pt) som åpnes fra en chevron på aktivt verktøy
   og lukkes etter valg. Arket er stabilt (ingen størrelseshopp), men arket er
   fritt mens man velger. Dette er den viktigste forskjellen vår.
2. **«Publiser» i toppbaren vs. nederst.** Claude setter den sorte pillen i
   toppbaren sammen med Lag og ⋯. Da har toppbaren fem kontroller (tilbake,
   tittel, Lag, Publiser, ⋯) på 390 pt. Jeg vil ha publisering som en flytende
   sort pille nede midt på, bare når det finnes strøk: tommelvennlig, og toppen
   forblir fire kontroller. Hvis Tormod vil ha den oppe, må den være ikon + tall
   (64 pt), ikke «Publiser 3».
3. **Arkvelgerens høyde: 2/3 vs. 90 %.** Claude vil ha 2/3 så man ser arket bak.
   Det er fint med fire tegninger, men et prosjekt med 41 og dype mapper trenger
   plassen. Jeg vil ha **adaptiv høyde**: 2/3 ved ≤8 tegninger, 90 % ellers.
4. **«Andres markering» og «Del lenke».** Begge er nevnt i Claudes lag/⋯-meny,
   men jeg finner ikke flerbruker-markering eller en delbar tegningslenke i koden
   i dag. Ikke vis et lag eller en menyrad som er død — ta dem når funksjonen
   finnes.
5. **Toppbarens tittelblokk med tre linjer.** Claude vil ha «E-401 · rev C ·
   Adminbygg › Elkraft» under navnet. På en telefon blir det trangt når Lag og ⋯
   også skal inn. Jeg vil ha **to linjer**: navn + `E-401 · rev C` (målestokk
   bare når den finnes). Mappestien hører hjemme i arkvelgeren, ikke i toppen.
6. **Dokkas etiketter på iPad.** Claude sier ikon + kort etikett også der. Enig
   på telefon; på iPad kan etiketten skjules når dokka er bred nok til hover —
   men det er en detalj, ikke en konflikt.

**Netto:** Claudes «Lag», `‹ 3 av 8 ›`, «Åpne alene» og zoom-hukommelse er
bedre enn mitt forslag. Mitt strengere krav står på at arket skal være fritt:
options i bunnark, publisering nederst, og ingen døde lag.

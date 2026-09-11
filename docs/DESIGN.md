# DESIGN.md — Ampex designmanifest

Kort og bindende. Målet er et moderne, gjennomtenkt AI-produkt — iOS-disiplinen
(konsistens, fysikk, respons, HIG-mål) står fast, men overflaten skal ikke lese
som iOS Innstillinger. Se «Overflate» under for det som skiller de to.

## Kilde til sannhet

- **`lib/tokens.js`** — farger, spacing, radius, størrelser. Ingen skjerm bruker
  en verdi som ikke finnes her. Nye verdier legges i tokens først.
- **`lib/theme.ts`** — typografi-skala (`type.*`) og spring-presets (`springs.*`).
- Tailwind-klasser er koblet til samme tokens (`bg-bg`, `text-label`, `p-screen`,
  `rounded-xl`) — bruk klasser eller `theme.ts`-import, aldri rå hex/px.
- `brandSoft` er det ENE tint-tokenet for ikon-chips/aksent-bakgrunner (kobber).
  Ikke innfør en ny "soft"-farge per skjerm — det er nettopp «tilfeldig pastell».

## Idiomer (gjør alltid)

1. **Stor tittel** (`type.display`) øverst på hver hovedskjerm, venstrestilt.
   `display` er Ampex-signaturen — 800-vekt, −1.0 tracking. `largeTitle` er
   HIG-fallbacken og skal IKKE brukes som skjermtittel: forskjellen mellom de to
   er nettopp forskjellen på «laget med omhu» og «Innstillinger».
   Samme token brukes til **det ene store tallet** en skjerm finnes for —
   ukesummen, tilbudets total, billigste pris. Har en skjerm ikke ett slikt
   tall, har den sannsynligvis ikke ett tydelig formål heller.
2. **Alle trykkbare flater bruker `components/pressable.tsx`** — spring-skalering
   + haptikk er innebygd. Aldri `TouchableOpacity` direkte.
3. **Lister**: rader med 0.5px `separator`-hairline, ikonbrikke 40px `rounded-md`
   med `fill`-bakgrunn, chevron i `tertiaryLabel`.
4. **Touch targets ≥ 44pt** (`sizes.touchTarget`) — også når ikonet er lite.
5. **Lucide-ikoner** med `strokeWidth={sizes.lucideStroke}` (1.8).
6. **Entrance-animasjoner** på lister: `FadeInDown.springify().delay(i * 40)` —
   stagger, aldri alt-på-en-gang.
7. **Safe areas** alltid via `useSafeAreaInsets` — aldri hardkodede toppmarger.
8. **Skeleton/placeholder** ved lasting — aldri spinner alene på en tom skjerm.

## Hvitt og sort (2026-09-06) — erstatter «Papir og messing»

Tormod: «føler hvit er mer premium» og «recreate den som om Tesla eller Apple
skulle lage field app SaaS elektro». Grunnflaten er nå **hvit** (`canvas` =
`bg` = #FFFFFF). Platen skiller seg fra grunnen med **hårlinje + nøytral
skygge**, ikke med farge. Én grå (`fill` #F2F2F4, `groupedBg` #F5F5F7) grupperer.
Blekket er sort (#1D1D1F). Den ene fylte handlingen per skjerm er **sort med
hvit tekst** (`cta`/`brand`): sort på hvitt leser som beslutning, farget som
kampanje. Messingen er borte fra UI-et; `brand` peker på sort så ingen skjerm
måtte skrives om. Farge finnes kun som semantikk (status, vær). Valgt
filterchip = sort pille. De mørke instrumentflatene (`toolBg`) er nøytralt
sort, ikke brunsvart. Dokumentflatene (`paper*`) er nøytralt lysegrå.

Avsnittet under beskriver æraen FØR og beholdes som historikk.

## Papir og messing (låst 2026-08-29 — HISTORIKK, erstattet 2026-09-06)

Grunnflaten er **varmt papir** — en arbeidsordre på et skrivebord, ikke en
notatblokk og ikke en mørk hule. Full spec med verifiserte mock-er: artifact
«Espresso-prøven». Tre lag:

| | Grunn | Hvilke skjermer |
|---|---|---|
| **Papir** | `canvas` #F3EEE6 | Alt daglig: Hjem, Prosjekter, Ordre, Lager, Meg |
| **Dokument** | `paperCanvas` kremet | Inne i skjema, tilbud, tegning — mykere ark |
| **Instrument** | `toolBg` mørk | Skann/AR, tegning i mørk modus |

Valnøtt (`#2A221C`/`#3A2F26`) er planlagt som kveldsmodus — en utseende-
veksling, aldri standarden.

**Platen er et hvitere ark på skitnere papir.** `bg` #FFFBF5 over `canvas`
#F3EEE6 — det 4–6 %-skiftet er hele premium-trikset i lys modus. Er de like,
dør flaten.

**Dybde lages med varm skygge og luft** — stor blur, liten opasitet, brun-tonet
(`shadows.card`/`shadows.floating`), aldri grå Material-skygge. Hårlinjene
(`separator` #E4DCD0) er nesten usynlige; kontrasten bor i skyggen.

**Glass finnes KUN tre steder** (regel 10): den frostede navbaren, dock-pillen
og stemme-orben. Aldri per listecelle — kort fingerer aldri glass.

**Messing (`brand` #C4A574) brukes GJERRIG**: neste-prikken på Hjem,
primærknappen (som er det MØRKESTE VARME på skjermen — aldri blek på blek,
tekst `#1C1712`), og maks én aksent per skjermområde. Aktiv fane i BLEKK.

**Platen er kontrollen.** Hjems hero (neste ordre) åpner ordren ved trykk på
hele flaten — ingen «Åpne»-knapp, ingen chevron; hintet er press-state +
haptikk. På platen står bare beslutningsdataene: etikett, jobbnavn, adresse.
Ingen materiellstatus («elektrikeren vet det selv») — en linje under adressen
er et UNNTAK som krever handling, i varsel-tone.

**Rader ledes av sine egne data** — klokkeslett på Ordre, oppgavetall på
Prosjekter, timer på Meg — aldri grå ikonfliser + chevron per rad (det er
Innstillinger-mønsteret, avvist). Unntak: Lager er visuelt og bruker
Finn-stil rutenett med produktbilder (EFO-bildene fra prisfilene) som default.

**Varsel-oransje (`warning` #B4530A) er eneste semantikk på oversiktene**:
avvik, lav beholdning, ting som venter. Grønn/rød beholdes for ekte status i
dokumenter og detaljer.

**Statuslinja er mørk-på-lys** på papirflatene; instrument-skjermene setter lys
via `useMorkStatuslinje()` og gjenoppretter mørk ved blur.

Instrument-rammen (`ToolScreen`, `ToolCard`, `ToolChip`) består for de mørke
skjermene — der lages dybde fortsatt med VERDI, ikke skygge.

## Radius med mening

At alt har samme hjørne er et av de tydeligste tegnene på et grensesnitt ingen
har tatt et valg i. Skalaen skal brukes slik:

| Token | Til |
|-------|-----|
| `sm` 8 | inputfelt, små merker |
| `md` 10 | rader i en liste, ikonfliser |
| `lg` 12 | paneler og kort |
| `xl` 14 | ÉN flate per skjerm — den som er hovedsaken |
| `hero` 24 | store, isolerte kort (tilbudskort, arkivkort) |
| `pill` | kun chips og runde knapper |

## Kjennetegnene vi IKKE skal ha

Målt mot lista over hva som avslører maskingenerert design. Ampex var skyldig i
tre av dem, og alle tre er rettet eller under retting:

- ~~systemfont uten personlighet på alt~~ → Geist overalt, display-signaturen
- ~~lik hjørneradius overalt~~ → skalaen over
- ~~myk grå skygge på 0.08 over hele appen~~ → VARM skygge kun på heroer,
  hårlinje ellers; verdi-dybde på de mørke instrumentene
- lilla gradient-orber — har aldri vært her
- hvit boks på beige uten standpunkt («2024-AI-kit») — platen skiller seg fra
  papiret med det 4–6 %-skiftet + varm skygge, og messingen er standpunktet

## Soner, ikke kort på kort på kort

Den skarpeste kritikken skjermene har fått: **«det ser ut som en handleliste.»**
Den var riktig, og diagnosen var ikke fargen — det var rytmen. Like høye, like
hvite kort stablet i én jevn kolonne, med en «+ Legg til …»-knapp under hvert.
Da leser øyet listepunkter med avhukingsbokser, uansett hvor pen beigen er.

En skjerm som beskriver noe SAMMENSATT — en jobb, et prosjekt — skal deles i
soner med ulik vekt, ikke i like kort:

1. **Mørk grunn, lyse kort — HELE veien.** Første forsøk hadde mørkt hode over
   beige grunn, og det ble halvt om halvt: to konkurrerende bakgrunner med en
   søm midt på skjermen. En detaljskjerm som skal ha vekt tar `colors.cta` som
   grunn for hele siden, og lar de lyse kortene flyte på den. Samme modell som
   ellers (tonet grunn + kort som løftes), bare snudd — og «ark»-følelsen er
   borte fordi det ikke finnes noe ark igjen.
   Det viktigste — kunde, adresse, kart — bor rett på grunnen, ikke i et kort.

   Følgene må tas med: `SectionHeader tone="light"`, `StatusBar style="light"`,
   og hovedknappen kan ikke være `cta` på `cta` — den blir `brandSoft` med mørk
   skrift, som er den sterkeste kontrasten paletten har.
2. **Ett stort tall.** Én bred stripe der tallet står i `type.display`. Annen
   høyde og annen typografi enn alt annet på siden.
3. **Fliser side om side.** To like ting ved siden av hverandre er et
   instrumentpanel; de samme to under hverandre er en liste. `flexDirection:
   'row'` er det billigste grepet som finnes mot handleliste-følelsen.
4. **En mørk verktøysone** for det som er handling snarere enn papirarbeid
   (`colors.slate`). Den bryter den hvite kolonnen én gang til.

**Pluss-knapper hører til PÅ tingen, ikke UNDER den.** En stor «+ Legg til
materiell» under et kort skriver seg inn i kolonnen som enda en linje. Et lite
pluss i flisas hjørne er en handling på det du ser på.

**Status er en stripe, ikke en prikk.** En 3 px kobberstrek foran ordet leses
før teksten; en liten prikk i en pille gjør ikke det.

## Overflate: ambient + glass (ikke Settings)

Samme innhold og flyt som før — kun materialene endrer seg.

**Gjør:**
- Glass KUN på kromen: navbar, dock-pille, stemme-orb. Innholdet som scroller
  under er det glasset bryter.
- Heroer (platen) på `bg` med `shadows.card` — varm skygge, hairline-kant,
  `radius.hero`.
- Luft: mer whitespace mellom seksjoner enn tradisjonell iOS-tetthet.
- Én messing-aksent per skjermområde — resten av flaten er papir og blekk.

**Eksplisitt anti-Settings:**
- Aldri `groupedBg` (flat iOS-systemgrå) som eneste bakgrunn på en hovedskjerm.
- Aldri kun hvite inset-grouped-lister som eneste virkemiddel for struktur.
- Aldri sort systemknapp (`colors.cta`) som eneste CTA-stil — det leser som en
  iOS-systemhandling, ikke et produkt.

**Anti-slop (like viktig som anti-Settings):**
- Ingen neon/regnbue-gradienter, ingen tilfeldig pastell-per-ikon.
- Ingen generisk «AI-orb»/chat-bubble-avatar som hoved-UI-element.
- Kobber (`brand`/`brandSoft`) er ÉN aksent per skjermområde — gjerrig.
- Statusfarge (`success`/`warning`/`danger`) betyr KUN status — aldri dekor.
- Glass er dybde, ikke pynt — bruk der det gir hierarki (hero-kort, chrome),
  ikke på hver eneste rad.

## Bevegelse

**Ikke innfelling på detaljskjermer.** Push-overgangen ER inngangen; innhold
som beveger seg etter at skjermen har glidd inn er dobbel bevegelse, og øyet
ser noe som fortsatt setter seg mens det allerede leser. På ordreskjermen kom
det i tillegg samtidig med at MapView initialiserte — og da finnes det ingen
rammer å gi bort til pynt.

Bevegelse må gjøre en jobb: trykk-respons, overganger, verdier som endrer seg.
Innhold som glir på plass ved åpning gjør ingen.


- Springs (`springs.*`), aldri duration+easing.
- Animer kun `transform` og `opacity` (GPU-billig, 120Hz, batterivennlig).
- Haptikk: `light` på rader/knapper, `medium` på primær-CTA,
  `notificationAsync(Success)` når noe er lagret/fullført.

## Synk-/nettverksfeil i UI

Synk er usynlig (regel #2 i CLAUDE.md) — feilhåndtering skal være det også:

- **Lokal data finnes:** aldri toast/alert/rødt. Ved vedvarende synk-feil,
  dempet `warningSoft`-tekst i relevant seksjon — aldri blokkerende.
- **Ingen lokal data + nettverksfeil:** eneste unntak — vis en rolig
  `GlassCard`-melding («Kunne ikke hente data — sjekk nett»), ikke en teknisk
  feilkode eller stack trace.

## Ikke gjør

- Ingen systemblå (`#007AFF`/default iOS-tint) noe sted — primær er `brand`/kobber, sekundær er nøytral (`label`/`secondaryLabel`/`border`), aldri systemfargen.
- Ingen rå hex-verdier eller ad-hoc fontSize i skjermer.
- Ingen blokkerende spinnere når data finnes lokalt (offline-først = alt åpner umiddelbart).
- Ingen synk-indikatorer/knapper i UI.

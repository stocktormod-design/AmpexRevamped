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

## To slags skjermer: verktøy og papir

Den varme kremfargen ligger i **nøyaktig samme familie som lese- og notatapper**
— Kindle sepia `#FBF0D9`, Apple Notes `#FFFBED`, Goodreads `#F4F1EA`, Panera
`#F4EFE1`. Derfor leste hver skjerm som en notatblokk: paletten sier «dokument»,
fordi det er det alle andre bruker den til.

Fargen er ikke feil. Den hadde bare ingen jobb. Nå har den én:

| | Grunn | Hvilke skjermer |
|---|---|---|
| **Verktøy** | `toolBg` mørk | Ordre, lager, prosjekter, lister, kart |
| **Papir** | `canvas` kremet | Skjema, tilbud, arkiv, fakturagrunnlag |

**Chromen er ALLTID brun.** Tab-baren er mørk på hver eneste skjerm, også de
kremede. Den lyse glassbaren var det siste store beige feltet i appen, og fordi
den ligger over alt, skar den som en lys stripe gjennom de mørke skjermene.
At chromen er konstant er dessuten det som gjør at kremfargen kan BETY noe: når
flaten blir kremet, er det fordi du har åpnet et dokument — ikke fordi skjermen
tilfeldigvis er lys.

**Knapper er brune.** Hovedhandlingen er `colors.cta` på papir. På mørk grunn
kan den ikke være det, og kremet flyter når baren under er brun — der er
hovedhandlingen `colors.brand` (kobber). Det er det ENE stedet kobber brukes
som flate og ikke som aksent, og derfor leses den umiddelbart som handlingen.

**Statuslinja følger flaten.** `useMorkStatuslinje()` i mørke skjermer setter
lys stil i fokus og MØRK igjen ved blur. `<StatusBar>` gjenoppretter ingenting
ved unmount, så uten dette blir klokka hvit på kremet bakgrunn i det du åpner
et skjema. Å legge `<StatusBar style="dark" />` i alle papirskjermene ville
vært å rette symptomet 32 ganger.

Skiftet betyr noe: det forteller deg at du har gått fra å JOBBE til å
DOKUMENTERE. `components/tool-surface.tsx` er rammen — bruk `ToolScreen`,
`ToolCard`, `ToolChip` og `ToolSectionHeader`, ikke egne verdier.

**Dybde lages med VERDI, ikke med skygge.** En lysere flate leses som nærmere.
Det er slik mørke grensesnitt faktisk bygges — og det fjerner samtidig den
diffuse skyggen som lå på absolutt alt.

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

- ~~systemfont uten personlighet på alt~~ → serif på display (`lib/fonts.ts`)
- ~~lik hjørneradius overalt~~ → skalaen over
- ~~myk skygge på 0.08 over hele appen~~ → hårlinje og verdi på mørke flater
- lilla gradient-orber — har aldri vært her
- hvitt/lysegrått uten standpunkt — brunt og kobber ER et standpunkt

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
- Ambient bakgrunn (`AmbientBackdrop`, `ambientCool`/`ambientWarm`): myke,
  nøytrale/varme gradient-flekker bak innholdet på hver hovedskjerm — glass
  trenger noe å bryte, en flat farge bak glass er usynlig.
- Frostede glasskort (`GlassCard`, `radius.hero`) for hero-innhold og
  fremhevet informasjon. `cardGlassStrong` for tettere lister/empty-states
  som trenger mer kontrast enn hero-glasset.
- Luft: mer whitespace mellom seksjoner enn tradisjonell iOS-tetthet.
- Ikon-chips i `brandSoft` (kobber-tint) på primærhandlinger — flat `fill`-grå
  er OK for sekundære/nøytrale ikoner, ikke for det brukeren skal legge merke til.

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

# Handoff — EFObasen inne i appen (skrevet 30.09.2026 kveld)

Les dette først i neste økt. Alt under er UKOMMITTERT (se «Tilstand i git»).

## Oppgaven som venter

Tormod: **EFObasen er katalogen, Ampex er handlekurven.** Montøren blar fritt i
EFObasen (de har alle varedata) og bestiller gjennom oss — EFObasen har ingen
handlefunksjon, så vi bruker dem akkurat som de vil: som katalog.

**Det skal ligge INNE I APPEN, ikke som Chrome-utvidelse** («vil ikke ha en chrome
extension … enten overlay eller lignende»). Og: **«integrasjon av det helt nederst må
være seamless. veldig bra og god UI»** — panelet nederst er selve produktet.

### Slik det skal virke (mobilappen)

1. En skjerm med EFObasen i et nettleservindu (`react-native-webview`), åpnet på
   `https://efobasen.efo.no/produkt/<elnr>` fra varekortet, eller på forsiden/søket
   fra Lager.
2. **Et eget, innebygd panel nederst** (vårt, ikke injisert i siden deres) som følger
   varen han står på:
   - varenavn, firmaets pris per grossist (billigst først, «BILLIGST»/«LISTEPRIS» som
     i varekortet), antall, og ÉN sort knapp «Legg i kurv · Solar».
   - Trykk på en grossistrad velger den; standard = billigste.
   - Etter trykk: kort bekreftelse («80 m lagt i Solar-lista · 3 varer»), og en vei
     til handlelista.
   - Når han er på søk/forside (ingen vare): panelet krymper til en diskret linje, eller
     viser handlelista-antallet. Aldri en tom boks.
3. Panelet skal føles som en del av appen, ikke en nettside med noe klistret på:
   bunnark som kan dras ned/opp (Reanimated, transform/opacity — regel 10), glass KUN
   på krom (regel 9), hvit plate med hårlinje + nøytral skygge, Geist via
   `components/text`, én fylt (sort) handling. Se `docs/DESIGN.md` «Hvitt og sort».
   Følg `app/(app)/lager/vare.tsx` for prisradene (samme språk).
4. Prisene og kurven er LOKALE (WatermelonDB, regel 2): priser via `useVare(productId)`
   i `lib/products.ts` (gir `priser`, `pris.billigste`), kurven via
   `leggVareIHandleliste(grossist, product, antall)` i `lib/bestilling.ts` (utkast per
   grossist, samme el-nummer øker antallet). Bare nettsiden krever nett.

### Tekniske funn som gjelder

- **El-nummer fra adressen:** `elnummerFraEfobasen(url)` i `lib/pricefile/varekort.ts`
  (selvtestet i `npm run verify:varesok`). `efobasenUrl(elnr)` er motsatt vei.
  Ruten er deres egen: `produkt/:elnr` (og `produkt/:levnr/:elnr` → sendes dit),
  bekreftet med skjermbilde 30.09.
- **EFObasen er en SPA** — adressen byttes uten sidelasting. I WebView: en liten
  injisert lytter som BARE poster `location.href` ved pushState/replaceState/popstate
  (`injectedJavaScriptBeforeContentLoaded` + `onMessage`), i tillegg til
  `onNavigationStateChange`. Ikke rør DOM-en deres.
- **EFObasen forbyr innbygging:** `X-Frame-Options: SAMEORIGIN` og CSP
  `frame-ancestors 'self'`. Gjelder iframes, ikke en native WebView — men det viser
  vilje. Derfor: **les EFObasens brukervilkår før dette går til andre enn piloten**
  (ikke lest; siden er en SPA, lenken «Brukervilkår og personvern» ligger i menyen).
  Kontorappen (Vite i nettleser) kan IKKE iframe dem — der blir det «åpne i ny fane».
- Siden bruker Cloudflare-utfordringer (`challenges.cloudflare.com`) — test at de
  løses i WebView.
- **`react-native-webview` er ikke installert** → nytt native bygg (ios/ finnes,
  pod install). **Spør Tormod før Xcode-bygg/simulator** (viftene).
- Demokatalogens el-nummer er oppdiktet (1451020 er en BRYTER i EFObasen, men PFXP-kabel
  hos oss). Test med en vare fra Solar-fila (`solar.sqlite`) som også finnes i
  firmaets `products`/`product_prices`.
- Varekortet har alt en «Åpne i EFObasen»-knapp (`app/(app)/lager/vare.tsx`, bruker
  `Linking.openURL`). Den skal nå åpne den nye skjermen i appen i stedet.

### Chrome-utvidelsen skal BORT

`extension/` ble bygget 30.09 før Tormod sa nei. Fjern: mappa `extension/`,
`"utvidelse:bygg"` i `package.json`, linjene om den i `CLAUDE.md` (mappestruktur +
kommandoer), `extension/dist/` i `.gitignore`, `"extension/**"` i `tsconfig.json`s
exclude, og 30.09-seksjonen i `docs/NAA.md` må omskrives. Bakgrunnens logikk
(priser + kurv mot Supabase) ble testet mot live og ryddet — ingenting å rydde i basen.
`elnummerFraEfobasen` + selvtestene BEHOLDES.

## Annet som ble gjort i økten 28.–30.09 (også ukommittert)

- **Læretid-AI (`supabase/functions/laeretid-ai`, DEPLOYET):** leser bildene (`se`,
  lagres i `laeretid_bilde.modellbeskrivelse`, første linje = bildetekst), smarte
  spørsmål i prioritet (inntil 3 HVORFOR om hans egne operasjoner → risiko som forslag
  han bekrefter → kontroll → egenvurdering), `MAKS_EKSTRA` 7, egenvurdering tvinges fram
  i koden, stopper hvorfor etter «husker ikke», Pro skriver loggen (95 s), quiz/retting
  på Flash, testbrukere (@ampex.no) kan sende `modell`. Ti rollespilte logger mot
  Tormods egne i fire+ runder — tall og rest-svakheter i `docs/NAA.md` (28.–30.09).
  Klientsiden (bildelesing, «Hopp over og skriv loggen», bildetekster i PDF) er IKKE
  prøvd på telefon.
- **Varekortet:** «Åpne i EFObasen» (`efobasenUrl`).
- **Produsentbilder:** Nexans (May Britt kan sende fil med bilde-URL per vare — ikke
  bedt om ennå), Wibe ja, Siemens ja (SiePortal), Prysmian takket nei til møte.
  Detaljer i minnet `produktbilder-produsenter`.
- **Google Play:** Tormod oppretter utviklerkonto (personlig). Pekt på 12-testere/14-
  dager-kravet og at organisasjonskonto (org.nr + D-U-N-S) slipper det.

## Tilstand i git

Ingenting committet (regel 7 — bare når Tormod ber om det). `npm run typecheck`,
`verify:laeretid` og `verify:varesok` var grønne sist de ble kjørt.

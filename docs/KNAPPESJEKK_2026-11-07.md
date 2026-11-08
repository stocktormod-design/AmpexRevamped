# Knappesjekk — 2026-11-07

**Omfang:** alle `onPress` / `onLongPress` / `onClick` i `app/` + `components/`
(523 handlere i 100 filer) og `desktop/src/` (293 i 31 filer) = **816 handlere**.
`app/(app)/prosjekter/tegning.tsx` og `components/drawing-pane.tsx` er holdt utenfor
(under ombygging, Claude eier dem).

**Metode:**

1. **Inventar og rutesjekk av alle filene.** Alle 54 litterære navigasjonsmål
   (`router.push`/`replace`/`dismissTo` og `pathname:`) er kjørt mot rutetreet i
   `app/`: **0 døde ruter**. Dynamiske ruter får parametre der de brukes.
2. **Maskinell sjekk av alle 131 filer** for de åtte kriteriene: tomme handlere/TODO,
   direkte Supabase i UI, hard delete, iOS-only API, destruktive handlinger uten
   bekreftelse, `async` uten `catch`, manglende busy-lås og touch-mål.
3. **Linje-for-linje-lesing av 25 skjermer/filer** — de mest brukte og de med høyest
   risiko (ordre, prosjekter, kunder, tilbud, lager, meg, godkjenning, skjema,
   innlogging, delte ark). Funnene nedenfor kommer fra disse.

**Dekning — viktig begrensning:** alle 816 er talt og alle filer er maskinelt
sjekket, men de øvrige 106 filene er **ikke** enkeltknapp-verifisert i denne runden.
Det betyr at listen under er konkret og etterprøvbar, men ikke uttømmende. Ingen P0
funnet i det som er lest.

---

## Sammendrag

| Alvor | Antall | Betydning |
|---|---|---|
| **P0** | 0 | krasj, datatap eller feil data |
| **P1** | 6 | knappen gjør ingenting, eller feil ting |
| **P2** | 13 | manglende vakt eller tilbakemelding |
| **P3** | 3 | kosmetisk / touch-mål |

**De ti verste:**

| # | Sted | Knapp | Alvor | Kort |
|---|---|---|---|---|
| 1 | `app/(app)/ordre/signatur.tsx:198` | Søppelbøtte (slett signatur) | P1 | Sletter kundens signatur uten bekreftelse og uten rollesjekk |
| 2 | `app/(app)/tilbud/[id].tsx:396` | «Slett tilbudet» | P1 | Sletter tilbud + linjer uten bekreftelse; ikke rollegated |
| 3 | `app/(app)/godkjenning.tsx:110` | «Godkjenn» | P1 | Ingen bekreftelse, ingen busy-lås, ingen feilmelding — dobbelttrykk kan gi dobbel godkjenning |
| 4 | `app/(app)/prosjekter/tegning-edit.tsx:356` | «Nytt rom» | P1 | `Alert.prompt` bak `Platform.OS === 'ios'` — knappen er død på Android |
| 5 | `app/(app)/ordre/tillegg.tsx:174` | «Slett» (tillegg) | P1 | Sletter et pengekrav uten bekreftelse |
| 6 | `app/(app)/tilbud/linje.tsx:323` | «Slett linje» | P1 | Sletter en prislinje uten bekreftelse |
| 7 | `app/(app)/prosjekter/medlem.tsx:31` | (lastes ved åpning) | P2 | Direkte Supabase-lesing i UI — bryter regel 2, tom liste offline |
| 8 | `app/(app)/kunder/ny.tsx:44` m.fl. | «Lagre» | P2 | Busy-flagget nullstilles ikke ved feil — knappen blir død til skjermen åpnes på nytt |
| 9 | `app/(app)/tilbud/[id].tsx:204` | «Kopier» | P2 | Ingen busy-lås/feilhåndtering — dobbelttrykk kan gi to tilbud |
| 10 | `app/(app)/lager/index.tsx:137` | «Søk i varer» | P2 | Trykkbar når kartoteket er tomt — åpner tom skjerm |

---

## Funn per fil

### `app/(app)/ordre/signatur.tsx` — 4 handlere, 3 OK

- **P1 — `:198` «Slett signatur».** `onPress={() => slettSignatur(s)}` uten
  `Alert`/bekreftelse og uten rollesjekk. Signaturen er dokumentasjonen i en tvist;
  et feiltrykk (ikonet er 16 px uten tekst) fjerner den. Sjekk også at
  `slettSignatur` er myk sletting — den bør auditeres som destruktiv.
- **P3 — `:109`** tilbakeknappen er 36×36 (under 44 pt).

### `app/(app)/tilbud/[id].tsx` — 13 handlere, 11 OK

- **P1 — `:396` «Slett tilbudet».** `onPress={async () => { await slettTilbud(tilbud); router.back() }}`
  — ingen bekreftelse, ingen `catch`, ingen busy. Sletter tilbud og alle linjer
  (myk sletting, men brukeren ser det som borte). Vises til alle som kan redigere
  tilbudet, ikke bare `owner/admin/bas`.
- **P2 — `:204` «Kopier».** `await dupliserTilbud` uten busy-lås og uten `catch`;
  dobbelttrykk kan lage to kopier, og en feil gir ingen beskjed.
- **P3 — `:207`** «Kopier»-pillen er 34 pt høy.

### `app/(app)/godkjenning.tsx` — 4 handlere, 2 OK

- **P1 — `:110` «Godkjenn».** `onBeslutt(... 'godkjent')` → `beslutt()` (`:147`)
  kaller `registrerBeslutning` uten `try/catch`, uten busy-lås og uten bekreftelse.
  Godkjenningen låser opp fakturering; et dobbelttrykk kan gi to rader i
  `order_approvals`, og en feil gir helt stille ingen godkjenning.
- **P2 — `:147`** `beslutt` fanger ikke feil; brukeren får verken kvittering eller
  feilmelding når skrivingen feiler.

### `app/(app)/prosjekter/tegning-edit.tsx` — 17 handlere, 16 OK

- **P1 — `:356` «Nytt rom».** `if (Platform.OS === 'ios' && Alert.prompt)` — på
  Android skjer ingenting. `Alert.prompt` er iOS-only, og det finnes ingen
  `PromptSheet`-fallback her (i motsetning til `tillegg.tsx`, som bevisst valgte
  ark). Knappen er død på halvparten av enhetene.

### `app/(app)/ordre/tillegg.tsx` — 6 handlere, 5 OK

- **P1 — `:174` «Slett».** `onPress={slett}` → `slett()` (`:29`) `markAsDeleted`
  uten bekreftelse. Tillegg er penger; et feiltrykk fjerner et pengekrav fra
  fakturagrunnlaget.

### `app/(app)/tilbud/linje.tsx` — 5 handlere, 4 OK

- **P1 — `:323` «Slett linje».** `slett()` (`:191`) kaller `slettLinje` og
  `router.back()` uten bekreftelse og uten `catch`. Prislinjer er penger.

### `app/(app)/prosjekter/medlem.tsx` — 2 handlere, 1 OK

- **P2 — `:31`.** `supabase.from('profiles').select(...)` direkte i en skjerm.
  Bryter regel 2 (offline-først). Konsekvens: uten nett er deltakerlista tom, og
  «legg til»-radene forsvinner. Enten dokumenter unntaket (som tilbakemelding/
  skannlogg) eller les fra en lokal profiltabell.

### Create-skjermene — busy uten `finally`

Felles mønster: `setSaving(true)` settes, men `setSaving(false)` ligger ikke i
`finally` og det finnes ingen `catch`. Feiler `database.write` (f.eks. full disk,
sync-feil), blir knappen permanent deaktivert og brukeren får ingen beskjed.

- **P2 — `app/(app)/kunder/ny.tsx:44` «Lagre»** (4 handlere, 3 OK)
- **P2 — `app/(app)/prosjekter/ny.tsx:18` «Opprett»** (2 handlere, 1 OK)
- **P2 — `app/(app)/lager/ny-lokasjon.tsx:23` «Lagre»** (4 handlere, 3 OK)
- **P2 — `app/(app)/ordre/material.tsx:50` «Legg til»** (4 handlere, 3 OK)
- **P2 — `app/(app)/lager/bevegelse.tsx:51` «Lagre»** (5 handlere, 4 OK)

### `app/(app)/lager/index.tsx` — 5 handlere, 4 OK

- **P2 — `:137` «Søk i varer».** Knappen er alltid trykkbar, også når
  `vareantall === 0` (den viser «Kartoteket er tomt»). Trykket åpner en tom
  varekatalog. Bør være `disabled` eller føre til import.

### `app/(app)/ordre/timer.tsx` — 8 handlere, 7 OK

- **P2 — `:83` «Slett» (sveip).** Selve sveipet avdekker knappen (to trinn), men
  slettingen bekreftes ikke. En timeføring er lønnsgrunnlag; vurder `Alert` som
  for materiell.

### `app/(app)/ordre/[id].tsx` — 29 handlere, 28 OK

- **P2 — `:990` «Ja, send faktura».** `await setStatus('fakturaklar')` uten
  `try/catch`; feiler skrivingen, lukkes arket og ingenting skjer — uten beskjed.
- Merk: material-sletting (`:486-487`) har bekreftelsesark og er OK.

### `app/(app)/ordre/skjema.tsx` — 5 handlere, 4 OK

- **P2 — `:443` «Fullfør og signer».** `fullfor()` (`:264`) mangler busy-lås.
  `persist` er en update (ikke duplikat), men dobbelttrykk gir dobbel synk/haptikk
  og kan kjøre samtidig med «Ta opp mer».

### `components/product-picker.tsx` — 3 handlere, 2 OK

- **P2 — `:165`.** `onVelg(await opprettFraKatalog(k))` uten `catch`; feiler
  opprettelsen, skjer ingenting og brukeren står i velgeren uten beskjed.

### `components/scan-card.tsx` — 5 handlere, 4 OK (Claude eier fila)

- **P3 — `:37`.** `if (Platform.OS !== 'ios') return` gjør hele skannemenyen død på
  Android; `:124` bruker i tillegg `Alert.prompt` (iOS-only). Skann er iOS-only i
  dag, så det er dokumentert, men menyen bør skjules helt på Android i stedet for
  å se trykkbar ut.

### `lib/ai/tools-runtime.ts` — ikke en knapp, men en handling brukeren kan utløse

- **P2 — `:460` `glem_notat`.** `note.destroyPermanently()` er hard delete. Regel 5
  sier myk sletting på alt. Assistentnotater er personlige, men regelen gjelder
  også dem; bruk `markAsDeleted` og la synken rydde.

---

## Maskinelle funn på tvers (ingen enkeltfil)

| Kriterium | Resultat |
|---|---|
| Litterære navigasjonsmål | 54/54 finnes i `app/` |
| Tomme handlere / TODO / bare `console.log` | 0 |
| Direkte Supabase i telefon-UI | 1 (`prosjekter/medlem.tsx`) |
| Hard delete (`destroyPermanently`) | 1 (`lib/ai/tools-runtime.ts:460`) |
| `ActionSheetIOS` / `Alert.prompt` | 2 steder, begge rapportert over |
| Destruktive uten bekreftelse | 6 knapper (P1-lista) |
| `onPress={async` uten `try/catch` | 4 treff, alle rapportert |
| Busy-flag uten `finally` | 5 skjermer, alle rapportert |
| Rollesjekk på destruktiv handling | 2 mangler (signatur, tilbud) |
| iOS-only uten Android-vei | 2 (tegning-edit, scan-card) |

**P3 — touch-mål:** 21 tilbakeknapper er 36×36 og 19 handlingspiller er 34 pt
høye (bl.a. «Kopier» i tilbud, «Rediger» i skjema). Regel 4 sier ≥44 pt. Dette er
kosmetisk, men går ut over treffsikkerheten i felt.

---

## Knapper uten funn (leselinje for leselinje)

| Fil | Handlere | OK |
|---|---:|---:|
| `app/(app)/ordre/[id].tsx` | 29 | 28 |
| `app/(app)/prosjekter/tegning-edit.tsx` | 17 | 16 |
| `app/(app)/prosjekter/[id].tsx` | 14 | 14 |
| `app/(app)/meg.tsx` | 14 | 14 |
| `app/(app)/tilbud/[id].tsx` | 13 | 11 |
| `app/(app)/ordre/timer.tsx` | 8 | 7 |
| `app/(app)/avvik.tsx` | 8 | 8 |
| `app/(app)/ordre/tillegg.tsx` | 6 | 5 |
| `components/scan-card.tsx` | 5 | 4 |
| `app/(app)/tilbud/linje.tsx` | 5 | 4 |
| `app/(app)/ordre/skjema.tsx` | 5 | 4 |
| `app/(app)/lager/index.tsx` | 5 | 4 |
| `app/(app)/lager/bevegelse.tsx` | 5 | 4 |
| `app/(app)/kunder/[id].tsx` | 5 | 5 |
| `app/(app)/ordre/signatur.tsx` | 4 | 3 |
| `app/(app)/ordre/material.tsx` | 4 | 3 |
| `app/(app)/lager/ny-lokasjon.tsx` | 4 | 3 |
| `app/(app)/kunder/ny.tsx` | 4 | 3 |
| `app/(app)/godkjenning.tsx` | 4 | 2 |
| `app/(app)/arkiv.tsx` | 4 | 4 |
| `components/product-picker.tsx` | 3 | 2 |
| `app/(auth)/login.tsx` | 2 | 2 |
| `app/(app)/prosjekter/ny.tsx` | 2 | 1 |
| `app/(app)/prosjekter/medlem.tsx` | 2 | 1 |
| `app/(app)/internkontroll.tsx` | 2 | 2 |

De øvrige 106 filene (øvrige ordre-, prosjekt-, lager-, tilbud-, kunde-,
læretid-, internkontroll- og kontorskjermer samt komponenter) er kun maskinelt
sjekket. Neste runde bør ta dem gruppe for gruppe; prioriter
`app/(app)/ordre/deltakere.tsx`, `app/(app)/ordre/faktura.tsx`,
`app/(app)/lager/vare.tsx`, `app/(app)/lager/varer.tsx` og
`desktop/src/ruter/Ordre.tsx`.

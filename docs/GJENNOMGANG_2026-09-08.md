# Gjennomgang av hele prosjektet — 2026-09-08

Full lesing av repoet: app-skallet, offline-synken, domenelogikken, backend og RLS,
AI-laget, integrasjonene og dokumentasjonen. Ingenting er endret i koden som følge av
denne gjennomgangen, med to unntak som er nevnt eksplisitt nederst.

Alle funn er verifisert i kilden. Der noe er usikkert, står det.

---

## Helsesjekk

| Sjekk | Resultat |
|---|---|
| `npm run typecheck` | grønn (var rød, se «Rettet under gjennomgangen») |
| 12 rene selvtester | alle grønne |
| `verify:tripletex` mot sandkasse | grønn, inkludert fakturering og betaling |
| Ukommittert arbeid | 147 filer, 63 nye. Siste commit 2026-09-01 |
| Kodemengde | ~13k linjer app, ~20k lib, ~11k modules, ~5,7k components |

Kodekvaliteten i appskallet er uvanlig høy: ingen TODO, ingen FIXME, ingen tomme
handlere, ingen mockdata i 64 skjermer.

---

## P0 — sikkerhetshull som bryter fler-firma-isolasjonen

### 1. Rettighetseskalering og tilgang på tvers av firma via `profiles`
`supabase/migrations/20260703160000_foundation.sql:73`

```sql
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid());
```

For UPDATE bruker Postgres USING-uttrykket også som WITH CHECK når WITH CHECK mangler.
Predikatet begrenser derfor bare `id`. Raden må tilhøre deg etterpå, men ingenting
hindrer at du endrer de to kolonnene som styrer all tilgang:

```sql
update public.profiles set role = 'owner' where id = auth.uid();
update public.profiles set company_id = '<annet firma>' where id = auth.uid();
```

Den andre er den alvorlige. `current_company_id()` (`foundation.sql:55`) leser nettopp
`profiles.company_id`, og alle RLS-policyer sammenligner mot den. En innlogget lærling
kan flytte seg selv inn i et hvilket som helst firma og få full tilgang til deres ordrer,
kunder, timer og dokumentasjon.

**Dette er en regresjon.** Legacy hadde vakten
(`docs/legacy-schema/migrations/20260421192000_profile_role_guard.sql`, som festet
`company_id` i sin WITH CHECK). Den ble aldri portert til revamp-fundamentet. Det finnes
ingen trigger som kompenserer (verifisert).

**Fiks skrevet, ikke kjørt:** `supabase/migrations/20260908090000_profile_privilege_guard.sql`.
En BEFORE UPDATE-trigger, fordi en RLS-policy ikke kan se OLD-raden og «rollen skal være
uendret» derfor ikke er uttrykkbart i WITH CHECK. Trygg å kjøre: appen leser fra
`profiles`, men skriver aldri til den (verifisert i `auth-user.ts`, `order-access.ts`,
`company-guard.ts`, `medlem.tsx`).

### 2. `r2-sign` mangler firmascoping
`supabase/functions/r2-sign/index.ts:34`

Validerer bare prefiks. Enhver innlogget bruker kan signere GET og PUT på hvilken som
helst nøkkel under `drawings/` eller `room-scans/`. Tegninger og skann på tvers av firma
kan leses og overskrives av den som kjenner eller gjetter nøkkelen. Fiks: ta `company_id`
inn i nøkkelstien og valider den mot `current_company_id()`.

### 3. Ingen rollevalidering server-side
`watermelon_push` er trygg på firmagrensen: `company_id`, `created_by` og `updated_at`
overskrives server-side, UPDATE er begrenset til eget firma, og funksjonen er invoker så
RLS gjelder. Men ingen migrasjon validerer `role` i det hele tatt. All rollelogikk ligger
i UI-et. En lærling kan pushe `status='fakturert'`, endre priser og soft-slette ordrer.

### 4. `sync_tables` er en åpen dør
`supabase/migrations/20260819121000_generic_sync.sql`

`watermelon_pull` bygger dynamisk SQL uten egen firmafilter. Isolasjonen hviler helt på at
hver registrerte tabell har RLS. Funksjonen er riktignok ikke SECURITY DEFINER, så det
holder i dag, men én `insert into sync_tables` for en tabell uten RLS lekker hele tabellen
på tvers av firma, uten feilmelding. Legg inn en kjøretidssjekk på at tabellen har RLS.

---

## P1 — stille datatap

### 5. 13 lokale tabeller synkes aldri, men markeres som synket
Verifisert: `sync_tables` inneholder 22 tabeller. Disse står i `lib/db/schema.ts` men
mangler både Postgres-tabell og registrering:

```
quotes · quote_lines · order_signatures · order_approvals · order_archives
service_agreements · purchase_orders · purchase_order_lines · deviations
product_prices · reminders · nfc_tags · assistant_notes
```

Push itererer over registeret og hopper stille over resten. WatermelonDB markerer dem
likevel som synket. **Signaturer, godkjenninger, tilbud og arkivpakker lever altså kun i
SQLite på én telefon og er permanent tapt ved reinstall.** For en elektrikerapp er det
nøyaktig de radene som er dokumentasjonsverdien.

Samme feilklasse som `lib/db/id-repair.ts` er skrevet for å rydde opp i.

### 6. Ingen synk ved nettverksretur
Ingen `NetInfo` i repoet. Synken trigges bare av innlogging og forgrunn. Kommer man opp av
en kjeller med appen åpen, skjer ingenting før appen har vært i bakgrunnen.

### 7. `orders.service_agreement_id` mangler i schema.ts
Finnes i `lib/db/models/order.ts:38` og `lib/db/migrations.ts:96`, men ikke i
`lib/db/schema.ts`. En fersk installasjon bygger fra schema og får aldri kolonnen →
`lib/serviceavtaler.ts:110` krasjer. Eksisterende installasjoner har den via migrasjonen,
så feilen viser seg bare på nye enheter.

### 8. Stille dropp i `watermelon_push`
`on conflict (id) do nothing` dropper endringen uten feil hvis UPDATE traff null rader.
UPDATE mangler `deleted_at is null`-vakt, så en sletting kan delvis gjenopplives.
`last_pulled_at` ignoreres helt, altså ingen avvisning av foreldede skrivinger.

### 9. Advarsel skjult i stedet for løst
`app/(app)/_layout.tsx:24` skjuler advarselen om `task_mottakere`. Serveren sender den
tabellen, klienten har den ikke, og endringene droppes i stillhet.

---

## P2 — penger og domenelogikk

### 10. Fiken-adapteren ville feilet ved første ekte kall
- `lib/accounting/fiken.ts:152-159` sender `net`/`gross` per linje, men verken
  `unitPrice` eller `quantity`. Fiken regner beløp fra pris × antall. Resultatet blir 400,
  eller linjer på 0 kr. Rabatten forsvinner også helt.
- `lib/accounting/fiken.ts:177` slår opp utkast-ID mot `/invoices/{id}`. Utkast og faktura
  har ulike ID-rom, så statusen blir alltid «utkast».
- Ingen selvtest. Tripletex er verifisert ende til ende; Fiken er ikke kjørt én gang.

### 11. Dekningsbidrag regnes på delvis kjent kost
`lib/invoicing.ts:384-385` og `lib/quoting.ts:135`. `kostOre` summerer med `?? 0`, men
flagget for «har kost» er sant hvis én eneste linje har kostpris. Har 1 av 20 materiellinjer
kostpris, vises DB som ~99 %. Det er ikke et øre feil, det er feil beslutningsgrunnlag på
et tilbud.

### 12. Ukjent MVA-kode faller stille til høy sats
`lib/invoicing.ts:34`. En feilstavet «fritatt» blir 25 % MVA på en ekte faktura, uten logg
og uten oppføring i `utelatt`. Bør enten kaste eller havne i utelatt-lista.

### 13. Motstridende rabattregel mellom to moduler
`lib/pricefile/efo-nelfo.ts:318` bruker rabatt kun når pristypen er brutto. Er felt 19
tomt, som er vanlig, blir pristypen ukjent og rabatten ignoreres, altså for høy kostpris.
`lib/pricing.ts:33` bruker motsatt regel. De to er uenige om samme rad.

### 14. Utestet logikk som håndterer penger
`lib/accounting/fiken.ts`, `lib/pricing.ts` (`kostprisFra`, som setter kostpris og dermed
DB), `lib/pricefile/import.ts` (billigst-pris-valg og påslag), `lib/order-billing.ts`
(`markerFakturert`/`angreFakturert`, altså dobbeltfakturering), `lib/schedule-calc.ts`.

---

## P3 — AI, kostnadskontroll og død kode

### 15. Forbruket rapporteres av klienten selv
`lib/ai/live-session.ts:817` → `lib/ai/gemini-client.ts:103`. Taket sjekkes riktig ved
øktstart (`voice_cap_check` i edge-funksjonen, kan ikke omgås), men selve forbruket sendes
inn av klienten. En modifisert klient kan rapportere 0. Rapporten er også fyr-og-glem, så
et appdrap før avslutning gir gratis minutter. Taket sjekkes aldri underveis i en økt.

### 16. `mind` og `tale` har ingen takssjekk
`supabase/functions/ai-voice/index.ts:826,836`. Den turbaserte assistenten og TTS er
fallbacken når stemmetaket nås, men koster penger per kall uten øvre grense.

### 17. Verktøy som skriver uten bekreftelse
Mennesket-fullfører-mønsteret holder på de store: ingen faktura-, sende- eller
signeringsverktøy finnes, skjema kan fylles men ikke signeres, tilbud kan bygges men ikke
sendes. Men `ta_ut_materiell` skriver `stock_movements` direkte, og `foer_timer` oppretter
fakturagrunnlag. Ingen av dem har angre-motstykke. Et feilhørt antall gir feil lager.

### 18. Død kode
- **`lib/pdf/*` og `lib/accounting/*` importeres ikke av noen skjerm.** PDF-laget er bygget
  og testet, men ikke koblet inn. «Del» på faktura sender tabseparert tekst
  (`app/(app)/ordre/faktura.tsx:108`).
- `app/(app)/prosjekter/tegning-edit.tsx`, 779 linjer, er registrert i stacken men ingen
  navigerer dit. (Stemmer med at `tegning.tsx` + `drawing-pane.tsx` er den levende stien.)
- `lib/ai/voice-usage.ts` har ingen kallere. Admin-UI for tak og forbruk finnes ikke, så
  tier kan bare settes med SQL.
- `worker/` er forlatt. Egen README innrømmer at migrasjonen aldri er kjørt og at
  edge-funksjonen `scan-blobs` den avhenger av ikke finnes.

### 19. Ingen utlogging finnes
Null treff på `signOut` i repoet. `lib/db/company-guard.ts` kan derfor knapt utløses, og
når den gjør det kaller den `unsafeResetDatabase()`, som sletter usendte lokale endringer
uten forvarsel.

---

## P4 — dokumentasjonen lyver

`docs/STATUS.md` er fra 19.–21. august med ett påklistret septemberavsnitt, og beskriver
seg selv som «hvor vi står nå». Den tar feil om følgende:

| STATUS.md påstår | Virkeligheten |
|---|---|
| «Ingen PDF finnes, ingen `expo-print`» | `lib/pdf/` har seks moduler, `expo-print` er installert, `verify:pdf` finnes |
| «Påminnelser påminner ikke» | `lib/varsler.ts` planlegger lokale varsler via `expo-notifications` |
| «Bare fotofangsten mangler» | `lib/foto.ts` med `taOrdrefoto`/`velgOrdrefoto` finnes |
| «Skjema v31», «25 tabeller», «28 tabeller» | `schema.ts` er v36 med 38 tabeller |
| «Elleve selvtester» | 15 |
| «Ingen ekte synk er sett lykkes» | Motsier seg selv 1100 linjer lenger opp |

Udokumentert, men bygget: hele tegningssporet med multiview og brannlag, romdeteksjonen,
TSDF-geometrien, Tripletex-adapteren, serviceavtalene.

`types/` er tom. Ruteavsnittet i CLAUDE.md beskriver fem faner; det er egentlig fire pluss
en AI-orb, og Prosjekter og Ordre deler plass.

**Anbefaling:** STATUS.md er nå mer villedende enn nyttig. Enten skriv den om fra bunnen,
eller erstatt den med et kort «nå-bilde» og la beslutningsloggene bære historikken.

---

## Rettet under gjennomgangen

1. **`npm run typecheck` var rød.** `lib/accounting/tripletex.ts` brukte Node-globalen
   `Buffer` for base64, og appens tsconfig har ikke `@types/node`. Erstattet med en
   håndskrevet `base64Ascii`, verifisert bit-identisk mot Node på tomme strenger og alle
   tre modulo-lengder. Typecheck er grønn og Tripletex-testen fortsatt grønn.
2. **Død dokumentlenke.** `docs/NEW_APP_PLAN.md` er referert fra CLAUDE.md og STATUS.md,
   men finnes ikke. Fjernet fra CLAUDE.md.

---

## Foreslått rekkefølge

1. Kjør `20260908090000_profile_privilege_guard.sql`. Til den er kjørt er fler-firma-
   isolasjonen brutt, og det er den ene tingen et SaaS ikke kan bomme på.
2. Firmascoping i `r2-sign`.
3. Lag Postgres-tabeller og `sync_tables`-rader for de 13 manglende, med signaturer,
   godkjenninger og arkiv først. Dette taper data akkurat nå.
4. Legg `service_agreement_id` inn i `schema.ts`.
5. Commit. 147 filer og en uke med arbeid ligger usikret.
6. Deretter penger: Fiken-adapteren, DB-regnestykket, MVA-fallbacken.

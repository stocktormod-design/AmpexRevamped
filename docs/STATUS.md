# Status — les denne først

Sist oppdatert: 2026-08-18. Holdes oppdatert; ikke lag daterte kopier.

## Hvor vi står nå

Branch **`grossist-og-pool`** — 4 commits, pushet, ikke merget til `main`.
PR kan opprettes på:
https://github.com/stocktormod-design/AmpexRevamped/pull/new/grossist-og-pool

```
028386c docs: grossistarkitektur, roadmap og hva som er blokkert
861a8ea feat(db): Ampex public pool, rettferdig kø, versjonssperre, køposisjon
587290a feat(pricefile): EFO/NELFO 4.0-parser med fixture og selvtest
fd3e4bb fix(ui): døde knapper, dokumentasjonsprogress, sveip-slett, LiDAR i én seksjon
```

`npm run typecheck` og `npm run verify:pricefile` er grønne.

### Uncommittet i arbeidstreet — bevisst ikke rørt

| Fil | Hva |
|-----|-----|
| `modules/ampex-splat/ios/MeshBakeV2.swift` | Din WIP, 252 linjer endret |
| `modules/ampex-splat/ios/MeshScanPresenter.swift` | Din WIP, 159 linjer endret |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Utracket plan-dokument |

Swift-filene er ditt arbeid — jeg lot dem være fordi jeg ikke vet om de er i en
tilstand du vil feste. **Vil du kjøre `/code-review ultra` på dem, commit dem
først** så diffen fanges av reviewen.

---

## Hva som trengs fra deg

**Én ekte EFO/NELFO-prisfil.** Dette blokkerer hele grossist-sporet — prisimport,
terskler, autobestilling, prissammenligning. Parseren er skrevet mot spec
E-NVare4.0r4, men fixturen er håndskrevet, så den er ikke bevist mot
virkeligheten.

Skaff en `V4*`- eller `P4*`-fil fra Onninen/Elektroskandia, Solar eller Ahlsell,
legg den i `lib/pricefile/fixture/`, og kjør:

```
npm run verify:pricefile
```

Avvikslisten forteller umiddelbart hva som er tolket feil.

**Én telefon til grossisten** når du vil ha ordretransport: «hvordan sender jeg
ordre elektronisk?» Svaret avhenger av kundeforholdet og kan ikke googles.

---

## Neste steg, i rekkefølge

1. **Merge eller review branchen.** Migrasjonen `20260817200000_ampex_public_pool.sql`
   er **ikke kjørt mot database** — verifiser med `supabase db reset` mot et
   branch-prosjekt før den går i produksjon.

2. **AI-materiellverktøy** — største hullet i «alt administrativt». Timeføring,
   dokumentasjon og ordre finnes; materiell og lager har **ingen** verktøy.
   - `legg_til_materiell` først: fritekst på ordren, ingen katalogmatching, ingen
     beholdning som kan bli feil. Lav risiko.
   - `ta_ut_materiell` etterpå: mot `products`, og skal fylle **kurven**
     (`cart.ts`) — ikke commite uttaket. AI-en fyller, mennesket gjennomfører.
   - Lesetilbakemelding uten pronomen: «Tre stykk Nelko infelt stikk 1,5 — ut fra
     Bil 2, ført på Storgata 4. Stemmer det?»

3. **Slå sammen `mine_*`-verktøyene** til ett spørreverktøy før flere legges til.
   Fire verktøy som er ett spørsmål. Jo flere verktøy, jo dårligere velger
   modellen.

4. **Tegningssamhandling** — spec ligger i `ROADMAP_2026-08.md`. Rekkefølge:
   markeringer som rader med `created_by`/`visibility`/`status` (låser opp mest),
   så pins med koordinat, så revisjoner med overlegg.

5. **CUDA-porten av `bake.py`** når du vil at GPU-en skal bety noe. Tekstur er
   nesten gratis, fusjon er moderat, **refine (Zhou-Koltun) er den vonde** — den
   finnes kun som legacy uten CUDA-vei.

---

## Beslutninger som er tatt (ikke ta dem opp igjen)

- **EFObasen droppes for v1.** Prisfila fra grossisten dekker behovet, koster
  kunden ingenting, og har kundens egne priser. Standardavtalen tillater dessuten
  ikke videreformidling til tredjepart.
- **Ampex public pool skal finnes**, med egen node først og Ampex som fallback.
- **Aktivering av AI-en er avklart:** to-finger-dobbelttrykk beholdes, `MicButton`
  beholdes. Rist, back tap, dobbeltbank, løft-til-øret, vekkeord, App Intents og
  Flic er alle vurdert og forkastet. **Ikke foreslå en tolvte gest.**
- **AR er den vanskeligste anvendelsen av LiDAR, ikke den viktigste.** De store
  gevinstene — tegning fra skann, måling uten målebånd — krever mindre presisjon
  og treffer større marked.
- **Rist-lytteren bør slettes** (`useShakeListener()` i `app/_layout.tsx:69`).
  50 Hz akselerometer i forgrunnen for ti aktiveringer om dagen. Ikke gjort ennå;
  kommentaren i `app/assistant.tsx` sier dessuten feilaktig at rist er borte.

---

## Dokumentkart

| Fil | Innhold |
|-----|---------|
| `docs/STATUS.md` | Denne — hvor vi står, hva som er neste |
| `docs/ROADMAP_2026-08.md` | Full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering |
| `docs/GROSSIST_INTEGRASJON.md` | Prisfiler, prissammenligning, autobestilling, admin-konsoll |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Skann-planen (utracket) |
| `docs/NEW_APP_PLAN.md` | Opprinnelig domene- og datamodell-plan |

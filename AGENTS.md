# AGENTS.md — les dette først

Inngangsdokument for enhver AI-assistent eller ny utvikler på Ampex. Verktøy-uavhengig:
Claude Code leser `CLAUDE.md`, andre leser denne. Innholdet skal ikke dupliseres mellom
dem — `CLAUDE.md` har reglene, denne har kartet.

## ⚠️ Expo har endret seg

Les de eksakte versjonerte docsene på https://docs.expo.dev/versions/v56.0.0/ før du
skriver kode. Ikke stol på trenings­kunnskap om Expo-API-er.

## Arbeidsregler

1. **Implementasjonen er fasit, ikke antakelsene dine.** Koden er iterert mot ekte skann,
   ekte prisfiler og ekte regnskaps-API-er i månedsvis. Ser noe rart ut, er det som regel
   fordi noe feilet i felten. Finn begrunnelsen før du «rydder».
2. **Ikke skriv om systemer som virker uten en målt grunn.** Særlig skann-pipelinen,
   synken og fakturagrunnlaget.
3. **Les beslutningsloggen før du foreslår noe i skann-pipelinen.** `docs/SKANN_BESLUTNINGER.md`
   er lista over ting som ER prøvd og forkastet, med målinger. Nesten alle «åpenbare»
   forbedringer står der allerede.
4. **Bevar invariantene:** offline-først (UI leser og skriver KUN lokal SQLite, aldri
   Supabase direkte), RLS per `company_id`, soft delete, audit log på destruktive
   handlinger. Se `CLAUDE.md` for hele lista.
5. **Penger, dokumentasjon og lønn får en selvtest.** Ny ren logikk i de kategoriene skal
   ha et `tools/verify-*.ts`-skript med harde påstander. Ingen testrunner.
6. **Minimal diff.** Løs oppgaven, ikke refaktorer bredt.
7. **Commit og push kun når brukeren ber om det.**

## Hvor begrunnelsene ligger

Koden er kommentert for å bære *hvorfor*, ikke bare *hva*. En kommentar som forklarer en
måling eller et forkastet alternativ er dokumentasjon — ikke fjern den.

| Fil | Hva den svarer på |
|---|---|
| `CLAUDE.md` | Stack, mappestruktur, kommandoer, designregler, roller |
| `docs/STATUS.md` | **Hvor vi står nå og hva som er neste steg. Les denne først.** |
| `docs/SESSION_HANDOFF.md` | Kortere øyeblikksbilde av hva som er bygget |
| `docs/ROADMAP_2026-08.md` | Full roadmap, AI-hull, tegningsspec, LiDAR-kalibrering |
| `docs/DESIGN.md` | «Papir og messing» — designsystemet, låst 2026-08-29 |
| `docs/DB_DRIFT.md` | Skjemaendringer og migrasjonshistorikk |
| `docs/REGNSKAPSINTEGRASJON.md` | Fiken, Tripletex, PowerOffice Go. Tripletex er verifisert ende til ende |
| `docs/GROSSIST_INTEGRASJON.md` | Prisfiler (EFO/NELFO 4.0), prissammenligning, autobestilling |
| `docs/DESKTOP_OG_IMPORT.md` | Ampex Desktop og SpeedyCraft-import |
| `docs/KONKURRENTANALYSE.md` | Hva konkurrentene gjør, inkl. Boligmappa |
| `docs/TEGNING_MULTIVIEW_PLAN.md` | PDF-tegninger, multiview, markup |
| **Skann og 3D** | |
| `docs/ON_DEVICE_SCAN_PLAN.md` | Arkitekturen i capture → fusjon → mesh → tekstur → GLB |
| `docs/GPU_BAKE_PLAN.md` | GPU-baken, fixtures som metodikk |
| `docs/SUBPIXEL_ALIGN_PLAN.md` | Pose-raffinering og warp, med fellene |
| **`docs/SKANN_BESLUTNINGER.md`** | **Forkastede veier, målinger, kræsjfeller, Mac-harnessen** |

## Selvtester

```
npm run typecheck          tsc --noEmit
npm run verify:invoicing   fakturagrunnlaget (øre, MVA, gruppering, avrunding)
npm run verify:tripletex   ENDE-TIL-ENDE mot Tripletex-sandkassen (krever tokens)
npm run verify:e2e         hele kjeden mot den LEVENDE databasen
```

Full liste i `CLAUDE.md`. `verify:e2e` og `verify:tripletex` treffer eksterne systemer;
begge nekter å kjøre mot produksjon.

## Hemmeligheter

`.env.local` er git-ignorert og inneholder Supabase-nøkler og Tripletex-sandkassetokens.
Tokens skal **aldri** ligge på en montørtelefon — regnskapsadapterne er skrevet uten
React Native-avhengigheter nettopp for å kunne kjøre i en Edge Function eller i Desktop.

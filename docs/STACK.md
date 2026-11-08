# Ampex: the whole stack (2026-11-08)

**What it is:** an all-in-one app for Norwegian electrician firms. It covers orders, hours,
materials, drawings, LiDAR scans, forms and internal control, quotes, apprentice training and
invoicing. It is offline-first: everything works in a basement with no signal.

## 1. The phone app (montørappen)

- **Framework:** Expo SDK 56 + React Native, Expo Router (tabs: Hjem, Prosjekter, Ordre, Lager, Meg).
- **Data on the phone:** WatermelonDB (SQLite). Screens only read and write locally; sync is
  invisible and runs on its own when the app comes to the front or the network returns.
- **UI:** NativeWind (Tailwind), Geist font, Reanimated + Gesture Handler for smooth gestures,
  Skia for drawing rendering and markup, Lottie, haptics.
- **Drawings:** pdf.js plus the device's own PDF renderer, tile-based and re-rasterised on zoom;
  split and quad views; right-hand tool dock; folders inside folders.
- **3D / scan:** our own native module `ampex-splat` (Swift/Metal + ARKit LiDAR):
  scan → TSDF → mesh → xatlas UV unwrap → texture bake **on the phone**. House mode with multiple
  parts, loop closure, LOD. Shown with three.js/expo-gl.
- **Other:** maps, GPS, notifications, camera/document picker, PDF printing, voice
  (expo-audio + audio-api).

## 2. Ampex Kontor (the office app, `desktop/`)

- React + TypeScript + Vite, intended to be wrapped in Tauri v2. The Rust shell isn't compiled
  yet; it runs in the browser today.
- Writes straight to Supabase, with no offline layer.
- Screens: customers, orders, quotes, hours, items/price files, projects + drawing plan, forms,
  internal control, scans, firm and admin, feedback.
- **AmpexAdmin:** your own panel across every firm.

## 3. Backend

- **Supabase Postgres:** 52 migrations, RLS per `company_id` on every table, soft delete
  everywhere, audit log. Sync runs through two RPCs (`watermelon_push` / `watermelon_pull`).
- **Supabase Auth:** login. Roles in `profiles.role`: owner, admin, bas, installatør, montør,
  lærling, regnskapsfører. `company_id` can't be set from a client.
- **Edge Functions (12):** ai-voice, ampex-admin, inviter-ansatt, r2-sign, regnskap
  (Tripletex/Fiken), delt-ordre, epost-videresend, laeretid-ai, laeretid-invitasjon, scan-blobs,
  slett-bruker, vegvesen.
- **Cloudflare R2:** all files (drawings, photos, scans) via signed URLs.
- **pg_net + Vault:** scan log → Telegram bot (@ampex_skann_bot) automatically.

## 4. Outside services and integrations

- **AI:** Gemini Live voice, with client-side voice detection and daily caps per tier; text AI.
  To be switched off for Aqila.
- **Accounting:** Tripletex (verified end-to-end in the sandbox); Fiken (adapter exists, not
  usable yet).
- **Wholesalers:** EFO/NELFO 4.0 price files and the B4 order file; Efobasen.
- **Other:** Boligmappa (sandbox), Statens vegvesen, Teltonika GPS webhook.
- **GPU bake worker** (`worker/`, Python): the old cloud bake on RunPod or a PC pool. Baking now
  happens mainly on the phone.

## 5. Tooling and operations

- **Builds:** `scripts/testflight.sh` + `scripts/asc.mjs` (App Store Connect API).
  Groups: Pilot (external) and Intern (Tormod).
- **Quality:** ~25 self-tests (`npm run verify:*`) for money, documentation and drawings, plus
  `verify:e2e` against the live database.
- **Two AIs:** Claude + DeepSeek, coordinated through `docs/AGENT_BRO.md` (locks, messages, log)
  and the bridge on port 58392.

## 6. Cost profile

Supabase + R2 only. WatermelonDB was chosen precisely to avoid any other running costs. AI is the
only variable cost per user, which is why it's off in the Aqila deal.

## Status, roughly

- **Strong:** offline core, orders, hours, forms/internal control, drawing view, LiDAR scan
  (works for testers).
- **Under way:** Aqila pilot (drawings and folders first), revisions on drawings, AI-off per firm.
- **Designed, not built:** encryption, wholesaler "request a deal", smart-home/ODM.
- **Weak spots:** the 13 tables that never sync, the Fiken adapter, and Tauri not yet compiled.

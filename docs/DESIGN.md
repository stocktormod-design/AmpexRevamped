# DESIGN.md — Ampex designmanifest

Kort og bindende. Målet er iOS-følelse («Apple-like») på begge plattformer:
konsistens, fysikk og respons — ikke dekorasjon.

## Kilde til sannhet

- **`lib/tokens.js`** — farger, spacing, radius, størrelser. Ingen skjerm bruker
  en verdi som ikke finnes her. Nye verdier legges i tokens først.
- **`lib/theme.ts`** — typografi-skala (`type.*`) og spring-presets (`springs.*`).
- Tailwind-klasser er koblet til samme tokens (`bg-bg`, `text-label`, `p-screen`,
  `rounded-xl`) — bruk klasser eller `theme.ts`-import, aldri rå hex/px.

## Idiomer (gjør alltid)

1. **Stor tittel** (`type.largeTitle`) øverst på hver hovedskjerm, venstrestilt.
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

## Bevegelse

- Springs (`springs.*`), aldri duration+easing.
- Animer kun `transform` og `opacity` (GPU-billig, 120Hz, batterivennlig).
- Haptikk: `light` på rader/knapper, `medium` på primær-CTA,
  `notificationAsync(Success)` når noe er lagret/fullført.

## Ikke gjør

- Ingen rå hex-verdier eller ad-hoc fontSize i skjermer.
- Ingen skygger/gradienter for «dybde» — iOS-følelsen er flat + fysikk.
- Ingen blokkerende spinnere når data finnes lokalt (offline-først = alt åpner umiddelbart).
- Ingen synk-indikatorer/knapper i UI.

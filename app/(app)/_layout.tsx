import { Tabs, useSegments, usePathname } from 'expo-router'
import { AppState, View } from 'react-native'
import { useEffect } from 'react'
import { CartBar } from '../../components/cart-bar'
import { GlassTabBar } from '../../components/glass-tab-bar'
import { registrerRute, tømKø } from '../../lib/tilbakemelding'

// Fanelinja tegnes av GlassTabBar (Apple-formen fra iOS 26, samme på Android).
// Rekkefølgen og ikonene står der; her står bare rutene og når linja skjules.
export default function AppLayout() {
  // Tegningen fyller hele skjermen: dokken over lerretet stjal nederste
  // stripe av tegningen (og la seg over delt skjerm).
  const segments = useSegments() as string[]
  // Læretidssamtalen og quizen har skrivefeltet nederst — docken ville ligget oppå det.
  const skjulDock = segments.includes('tegning') || segments.includes('tegning-edit')
    || segments.includes('samtale') || segments.includes('quiz')
    || (segments.includes('laeretid') && segments.includes('bilder'))
    // EFObasen har sitt eget panel nederst — docken ville ligget oppå det.
    || segments.includes('efobasen')

  // Sporet tilbakemeldingen legger ved: hvilke skjermer brukeren var innom.
  const sti = usePathname()
  useEffect(() => { registrerRute(sti) }, [sti])
  // Tilbakemeldinger skrevet uten nett sendes når appen kommer fram igjen.
  useEffect(() => {
    void tømKø()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void tømKø() })
    return () => sub.remove()
  }, [])

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      tabBar={props => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        /*
         * FRYS FANER SOM IKKE VISES (2026-08-30).
         *
         * Alle fem fanene blir stående montert etter første besøk, og uten
         * dette re-renderer de fire usynlige hver gang en WatermelonDB-
         * spørring emitter (54 observe-abonnement i appen). Det arbeidet
         * skjer på JS-tråden — den samme tråden som skal ta imot neste trykk,
         * som dermed må stå i kø bak et gjenoppbygd Lager ingen ser på.
         *
         * `freezeOnBlur` stopper KUN rendering; useEffect-abonnement, synk og
         * opplastinger går som før, så ingenting mister tråden.
         */
        freezeOnBlur: true,
        tabBarStyle: { display: skjulDock ? 'none' : 'flex', position: 'absolute' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Hjem' }} />
      <Tabs.Screen name="prosjekter" options={{ title: 'Prosjekter' }} />
      <Tabs.Screen name="ordre" options={{ title: 'Ordre' }} />
      <Tabs.Screen name="lager" options={{ title: 'Lager' }} />
      {/* Meg nås fra avataren øverst på hver hovedskjerm (som Apples App Store). */}
      <Tabs.Screen name="meg" options={{ href: null }} />
      {/* Assistenten er glasssirkelen ved siden av linja; ruta finnes bare for deep links. */}
      <Tabs.Screen name="ai" options={{ href: null }} />
      {/* Skjult fra tab-baren, navigerbar via snarveier (handlekurv er nå overlay, se CartBar) */}
      <Tabs.Screen name="skjema" options={{ href: null }} />
      {/* Registrene nås fra Meg og fra ordredetalj — de hører ikke til i tab-baren,
          som er for det montøren gjør hver dag, ikke det som settes opp én gang. */}
      <Tabs.Screen name="kunder" options={{ href: null }} />
      {/* Tilbud nås fra ordrelista. Det er ikke en daglig montørhandling — det er
          basen som svarer på en forespørsel — så det tar ikke plass i tab-baren. */}
      <Tabs.Screen name="tilbud" options={{ href: null }} />
      {/* Mine timer nås fra Meg — det er lønnsgrunnlaget, ikke en daglig handling. */}
      <Tabs.Screen name="mine-timer" options={{ href: null }} />
      {/* Faglig godkjenning nås fra Meg og fra Hjem når noe venter. Den er
          faglig ansvarliges skjerm, ikke montørens daglige flate. */}
      <Tabs.Screen name="godkjenning" options={{ href: null }} />
      {/* Gamle jobber — arkivet. Nås fra Meg og fra kundekortet. */}
      <Tabs.Screen name="arkiv" options={{ href: null }} />
      <Tabs.Screen name="aktiviteter" options={{ href: null }} />
      {/* Internkontrollen leses fra Meg. Kontoret skriver den. */}
      <Tabs.Screen name="internkontroll" options={{ href: null }} />
      {/* Læretid (2026-09-16). Skjult fra dokken inntil lærlingdokken er bygget
          — flata eies av lærlingen, ikke av firmaet, og skal ha egne knapper
          for dem som bare har kjøpt læretid. Se docs/LAERLING.md. */}
      <Tabs.Screen name="laeretid" options={{ href: null }} />
      <Tabs.Screen name="skanner" options={{ href: null }} />
      {/* Avvik leses fra Meg, som internkontrollen. */}
      <Tabs.Screen name="avvik" options={{ href: null }} />
      {/* Fullskjerm skanner/viewer — skjul tab-baren mens den er fokusert */}
      <Tabs.Screen name="skann" options={{ href: null, tabBarStyle: { display: 'none' } }} />
    </Tabs>
    <CartBar />
    </View>
  )
}

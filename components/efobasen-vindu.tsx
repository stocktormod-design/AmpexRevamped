import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, Linking, Platform } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { Text } from './text'
import { Pressable } from './pressable'
import { colors, spacing, radius, springs, type as t } from '../lib/theme'

export type EfobasenVinduRef = { tilbake: () => void; lastPaNytt: () => void }

/**
 * EFObasen er en SPA: adressen byttes med pushState, uten sidelasting, og da
 * sier `onNavigationStateChange` ingenting på Android og for sent på iOS.
 * Lytteren under poster BARE `location.href` når historikken endres. Den leser
 * ikke siden og rører ikke DOM-en deres — adressen er alt vi trenger.
 */
const ADRESSELYTTER = `(function () {
  if (window.__ampexAdresse) return; window.__ampexAdresse = true;
  function meld() { try { window.ReactNativeWebView.postMessage(location.href) } catch (e) {} }
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k];
    history[k] = function () { var r = o.apply(this, arguments); meld(); return r };
  });
  window.addEventListener('popstate', meld);
  meld();
})(); true;`

/** Sider som får åpnes inne i vinduet. Cloudflare-utfordringen må med. */
function hjemmeHos(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return /(^|\.)efo\.no$/.test(h) || h === 'challenges.cloudflare.com'
  } catch {
    return url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:')
  }
}

/**
 * EFObasen i et nettleservindu. Alt utenfor efo.no (FDV-PDF-er hos produsenten,
 * lenker ut) åpnes i systemets nettleser — vinduet er katalogen, ikke en nettleser.
 */
export const EfobasenVindu = forwardRef<EfobasenVinduRef, {
  startUrl: string
  onAdresse: (url: string) => void
  onKanGaTilbake: (kan: boolean) => void
  bunn: number
}>(function EfobasenVindu({ startUrl, onAdresse, onKanGaTilbake, bunn }, ref) {
  const web = useRef<WebView>(null)
  const [feil, setFeil] = useState(false)
  const fremdrift = useSharedValue(0)
  const synlig = useSharedValue(0)

  useImperativeHandle(ref, () => ({
    tilbake: () => web.current?.goBack(),
    lastPaNytt: () => { setFeil(false); web.current?.reload() },
  }), [])

  // Tynn strek øverst mens siden laster. Bare transform/opacity (regel 10).
  const strekStil = useAnimatedStyle(() => ({
    opacity: synlig.value,
    transform: [{ scaleX: Math.max(0.04, fremdrift.value) }],
  }))

  function nav(n: WebViewNavigation) {
    onAdresse(n.url)
    onKanGaTilbake(n.canGoBack)
  }

  return (
    // contentInset finnes bare på iOS. På Android krymper vinduet i stedet.
    <View style={{ flex: 1, backgroundColor: colors.canvas, paddingBottom: Platform.OS === 'android' ? bunn : 0 }}>
      <WebView
        ref={web}
        source={{ uri: startUrl }}
        style={{ flex: 1, backgroundColor: colors.canvas }}
        injectedJavaScriptBeforeContentLoaded={ADRESSELYTTER}
        onMessage={e => onAdresse(e.nativeEvent.data)}
        onNavigationStateChange={nav}
        onShouldStartLoadWithRequest={r => {
          // Iframes (Cloudflare) er ikke navigasjon — de skal alltid få laste.
          if (r.isTopFrame === false || hjemmeHos(r.url)) return true
          Linking.openURL(r.url).catch(() => {})
          return false
        }}
        onLoadStart={() => { synlig.value = 1; fremdrift.value = 0 }}
        onLoadProgress={e => { fremdrift.value = withSpring(e.nativeEvent.progress, springs.settle) }}
        onLoadEnd={() => { synlig.value = withTiming(0, { duration: 220 }) }}
        onError={() => setFeil(true)}
        onHttpError={e => { if (e.nativeEvent.statusCode >= 500) setFeil(true) }}
        // Panelet ligger over bunnen av siden; uten innrykket ville siste
        // rad i søkeresultatet ligge under det for alltid.
        contentInset={{ bottom: bunn }}
        scrollIndicatorInsets={{ bottom: bunn }}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        decelerationRate="normal"
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
      />
      <Animated.View pointerEvents="none" style={[{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        backgroundColor: colors.label, transformOrigin: 'left',
      }, strekStil]} />

      {feil && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: bunn,
          backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: spacing.xl,
        }}>
          <Text style={t.headline}>EFObasen svarer ikke</Text>
          <Pressable haptic="light" onPress={() => { setFeil(false); web.current?.reload() }}
            style={{
              marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
              borderRadius: radius.pill, backgroundColor: colors.fill,
            }}>
            <Text style={[t.subhead, { fontWeight: '600' }]}>Prøv igjen</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
})

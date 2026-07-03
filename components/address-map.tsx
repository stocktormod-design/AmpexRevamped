/**
 * Fallback for Android/web: ingen kartpreview (react-native-maps krever
 * Google Maps-nøkkel på Android og støtter ikke web). Adresseraden under
 * kartet finnes uansett — denne returnerer bare null.
 * iOS-varianten med ekte MapKit ligger i address-map.ios.tsx.
 */
export function AddressMap(_props: { address: string; onPress: () => void }) {
  return null
}

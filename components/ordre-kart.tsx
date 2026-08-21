import type { Order } from '../lib/db/models/order'

/**
 * Fallback for Android/web: react-native-maps krever Google Maps-nøkkel på
 * Android og støtter ikke web. iOS-varianten med ekte MapKit ligger i
 * ordre-kart.ios.tsx. Lista er alltid der uansett — denne gir bare null, og
 * kartknappen skjules (se `kartStottes`).
 */
export const kartStottes = false

export function OrdreKart(_props: { orders: Order[]; onVelg: (order: Order) => void }) {
  return null
}

import { Redirect } from 'expo-router'

/** Dokkens midtknapp er Ampex-merket (AI). Ruta finnes bare for å gi knappen en
 *  fast plass i midten av fanelinja; trykk starter assistenten, aldri navigasjon.
 *  Havner noen her likevel (deep link), sendes de til Hjem. */
export default function AiRute() {
  return <Redirect href="/(app)" />
}

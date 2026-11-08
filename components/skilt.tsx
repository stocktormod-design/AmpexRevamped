import { View } from 'react-native'
import { Text } from './text'
import { colors } from '../lib/theme'

/**
 * Norsk skilt-chip: hvit plate, blå EU-stripe, tabulære tegn.
 *
 * Delt mellom Meg (bilkortet) og Lager (bilkortene), så en bil ser lik ut
 * begge steder. Den blå stripa er ikke pynt: det ER skiltet, og den er den
 * eneste fargen på flaten ved siden av semantisk status.
 */
export function Skilt({ regNr, stor = false }: { regNr: string; stor?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', alignSelf: 'flex-start',
      borderWidth: 1, borderColor: colors.separator, borderRadius: 4, overflow: 'hidden',
      backgroundColor: '#FFFFFF',
    }}>
      <View style={{ width: stor ? 8 : 6, backgroundColor: '#2A5CAA' }} />
      <Text style={{
        paddingHorizontal: stor ? 9 : 7, paddingVertical: stor ? 3 : 2,
        fontSize: stor ? 14 : 12, fontWeight: '600', letterSpacing: 1.2,
        color: colors.label, fontVariant: ['tabular-nums'],
      }}>
        {regNr.replace(/\s+/g, '').toUpperCase().replace(/^([A-ZÆØÅ]{2})/, '$1 ')}
      </Text>
    </View>
  )
}

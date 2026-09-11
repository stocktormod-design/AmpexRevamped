import { Pressable } from './pressable'
import { AmpexLogo } from './ampex-logo'
import { useVoiceSession } from '../lib/ai/voice-session'
import { colors, sizes, shadows } from '../lib/theme'

/**
 * Merket ER assistenten. Lyn-A-en fra AmpexLogo er inngangen til AI-økten, og
 * ved trykk slår to lyn-ringer utover før overlayet tar over.
 *
 * Hvorfor merket og ikke et mikrofonikon: en generisk `Mic` sier «tale», mens
 * lynet sier Ampex. Og logoen lå der allerede uten jobb — dette koster null nye
 * piksler, som var kravet.
 *
 * HVILE ER STILLE (regel 8). Overlayet har roterende buer og en ring som puster
 * med mikrofonnivået, men det lever kun mens økten varer. Denne knappen står på
 * fire skjermer hele dagen, så en evig rotasjon her ville vært kontinuerlig
 * UI-arbeid uten informasjonsverdi. Ringene finnes bare i overgangen — de er
 * utladningen som blir til orben.
 */
/**
 * Grunnflaten er papir nå: standard er messing-merke i et messing-vasket felt
 * (`papir` er beholdt som alias). `tone="orb"` er STEMME-ORBEN fra specen:
 * 54 pt frostet sirkel med blekk-logo, forankret over docken — glasskrom nr. 3
 * (navbar, dock, orb) og det eneste stedet den store varianten brukes.
 */
export function AmpexMarkButton({ tone = 'default' }: { tone?: 'default' | 'papir' | 'orb' } = {}) {
  const { stage, beginSession } = useVoiceSession()
  const orb = tone === 'orb'

  // STATISK (Tormod 2026-09-06: «ai knappen er ikke static den beveger seg»).
  // Utladningsringene og den elastiske spretten er tatt bort. Merket står i ro
  // som en signatur øverst til høyre; trykket gir vanlig, kort press-respons.
  // Overlayet overtar den visuelle jobben så snart økten er i gang.
  if (stage !== 'idle') return null

  const size = orb ? sizes.voiceOrb : sizes.iconChip
  return (
    <Pressable
      haptic="medium"
      pressScale={0.94}
      onPress={beginSession}
      accessibilityLabel="Start med AI"
      style={[
        {
          alignItems: 'center', justifyContent: 'center',
          width: size, height: size, borderRadius: size / 2,
          // Sort disk med hvitt merke: logoen ER knappen, og den leser som
          // Ampex på hver skjerm — ikke som et grått ikon i et grått felt.
          backgroundColor: colors.label,
        },
        orb && { ...shadows.floating },
      ]}
    >
      <AmpexLogo size={orb ? sizes.iconLg : sizes.icon - 1} color="#FFFFFF" />
    </Pressable>
  )
}

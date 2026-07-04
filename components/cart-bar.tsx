import { View, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { router } from 'expo-router'
import { Minus, Plus, ShoppingCart } from 'lucide-react-native'
import { Pressable } from './pressable'
import { useCart, takenQty, adjustCartLine } from '../lib/cart'
import { colors, spacing, radius, sizes, shadows, type as t } from '../lib/theme'

/**
 * Spotify-stil mini-bar for aktiv handletur. Vises KUN når kurven har varer —
 * ellers null (ingen pop-up uten en handletur). Viser sist vare + stepper;
 * trykk på kroppen → full handleliste.
 */
export function CartBar() {
  const insets = useSafeAreaInsets()
  const lines = useCart()
  if (lines.length === 0) return null

  const last = lines[lines.length - 1]
  const total = lines.reduce((n, l) => n + takenQty(l.movement), 0)

  return (
    <View
      style={{
        position: 'absolute', left: spacing.sm, right: spacing.sm,
        bottom: sizes.tabBar + insets.bottom + spacing.sm,
      }}
      pointerEvents="box-none"
    >
      <View style={[{ borderRadius: radius.xl }, shadows.card]}>
        <BlurView
          tint="systemChromeMaterialLight"
          intensity={90}
          style={{
            borderRadius: radius.xl, overflow: 'hidden',
            backgroundColor: colors.chromeGlass,
            borderWidth: 0.5, borderColor: colors.glassEdge,
            flexDirection: 'row', alignItems: 'center',
            paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: spacing.sm,
          }}
        >
          {/* Kropp: trykk → full liste */}
          <Pressable
            haptic="none"
            onPress={() => router.push('/(app)/handlekurv')}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <View style={{
              width: sizes.iconChip - 6, height: sizes.iconChip - 6, borderRadius: radius.sm,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
            }}>
              <ShoppingCart size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={t.bodyMedium} numberOfLines={1}>{last.product.name}</Text>
              <Text style={[t.caption, { marginTop: 1 }]}>
                {`${lines.length} ${lines.length === 1 ? 'vare' : 'varer'} · ${total} totalt`}
              </Text>
            </View>
          </Pressable>

          {/* Stepper for sist vare */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Pressable
              onPress={() => adjustCartLine(last.movement, -1)}
              pressScale={0.9}
              style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}
            >
              <Minus size={16} color={colors.label} strokeWidth={2.4} />
            </Pressable>
            <Text style={[t.bodyMedium, { minWidth: 22, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>
              {takenQty(last.movement)}
            </Text>
            <Pressable
              onPress={() => adjustCartLine(last.movement, 1)}
              pressScale={0.9}
              style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={16} color={colors.ctaLabel} strokeWidth={2.4} />
            </Pressable>
          </View>
        </BlurView>
      </View>
    </View>
  )
}

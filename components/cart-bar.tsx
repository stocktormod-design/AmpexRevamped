import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import { usePathname } from 'expo-router'
import { Minus, Plus, ShoppingCart } from 'lucide-react-native'
import { Pressable } from './pressable'
import { CartSheet } from './cart-sheet'
import { useCart, takenQty, adjustCartLine } from '../lib/cart'
import { colors, spacing, radius, sizes, shadows, type as t } from '../lib/theme'

// Tom-invitten er BORTE (Tormod 12.09: «fjern materielluttak nederst på lager»).
// Baren finnes bare når kurven har varer; uttak startes fra varen eller lokasjonen.
const ROOT_TAB_PATHS: string[] = []

/**
 * Spotify-stil mini-bar for aktivt materielluttak. Har kurven varer → full bar
 * (navn/antall/stepper) på alle skjermer. Tom kurv → rolig invitt kun på Lager-
 * rota. Trykk ekspanderer til CartSheet som overlay over gjeldende fane.
 */
export function CartBar() {
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const lines = useCart()
  const [expanded, setExpanded] = useState(false)

  // Tømmes kurven mens sheet er åpen (f.eks. siste linje slettet derfra) — lukk den.
  useEffect(() => { if (lines.length === 0) setExpanded(false) }, [lines.length])

  const hasItems = lines.length > 0
  const isRootTab = ROOT_TAB_PATHS.includes(pathname)
  if (!hasItems && !isRootTab) return null
  if (pathname === '/skann') return null // fullskjerm skanner/3D-viewer — ingen overlays

  const last = hasItems ? lines[lines.length - 1] : null
  const total = lines.reduce((n, l) => n + takenQty(l.movement), 0)

  return (
    <>
      <View
        style={{
          position: 'absolute', left: spacing.sm, right: spacing.sm,
          bottom: (sizes.tabBar + insets.bottom + spacing.sm) + 36 /* over det hevede Ampex-merket i docken */,
        }}
        pointerEvents="box-none"
      >
        <View style={[{ borderRadius: radius.xl }, shadows.floating]}>
          <BlurView
            tint="systemChromeMaterialLight"
            intensity={90}
            style={{
              borderRadius: radius.xl, overflow: 'hidden',
              backgroundColor: colors.chromeGlassWarm,
              borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'center',
              paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: spacing.sm,
            }}
          >
            {hasItems && last ? (
              <>
                {/* Kropp: trykk → ekspander sheet */}
                <Pressable
                  haptic="light"
                  onPress={() => setExpanded(true)}
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
              </>
            ) : (
              // Tom kurv, men på en hovedfane — rolig invitt, ingen stepper (ingenting å justere ennå).
              // Trykk åpner samme overlay som ellers — varer scannet inn (NFC/lager) dukker opp der reaktivt.
              <Pressable
                haptic="light"
                onPress={() => setExpanded(true)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs }}
              >
                <View style={{
                  width: sizes.iconChip - 6, height: sizes.iconChip - 6, borderRadius: radius.sm,
                  backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
                }}>
                  <ShoppingCart size={sizes.icon - 2} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[t.bodyMedium, { color: colors.secondaryLabel }]}>Materielluttak</Text>
                  <Text style={[t.caption, { marginTop: 1 }]}>Klar når du er. Trykk for å starte</Text>
                </View>
              </Pressable>
            )}
          </BlurView>
        </View>
      </View>

      {expanded && <CartSheet lines={lines} onClose={() => setExpanded(false)} />}
    </>
  )
}

import { useEffect, useState } from 'react'
import { Modal, View, Pressable as RNPressable } from 'react-native'
import { Text, TextInput } from './text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { Pressable } from './pressable'
import { colors, spacing, radius, sizes, springs, type as t } from '../lib/theme'

/**
 * Ark for valg og korte spørsmål.
 *
 * Erstatter `Alert.prompt` og `Alert.alert` med mange knapper — begge er
 * iOS-bare i praksis: `Alert.prompt` finnes ikke på Android og gjør INGENTING
 * (stille), og `Alert.alert` viser maks tre knapper der. En godkjenningsknapp
 * som ikke gjør noe på halvparten av enhetene er verre enn ingen knapp.
 *
 * At det samtidig ser bedre ut enn en systemdialog er en bonus, ikke grunnen.
 */

function Ark({ synlig, onLukk, children }: {
  synlig: boolean; onLukk: () => void; children: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const y = useSharedValue(40)
  const bak = useSharedValue(0)

  useEffect(() => {
    y.value = synlig ? withSpring(0, springs.settle) : 40
    bak.value = synlig ? withTiming(1, { duration: 160 }) : 0
  }, [synlig, y, bak])

  const arkStil = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }))
  const bakStil = useAnimatedStyle(() => ({ opacity: bak.value }))

  return (
    <Modal visible={synlig} transparent animationType="fade" onRequestClose={onLukk}>
      <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }, bakStil]}>
        {/* Trykk utenfor lukker. RNPressable uten haptikk — det er en avbrytelse,
            ikke en handling. */}
        <RNPressable style={{ flex: 1 }} onPress={onLukk} />
        <Animated.View style={[{
          backgroundColor: colors.canvas,
          borderTopLeftRadius: radius.hero, borderTopRightRadius: radius.hero,
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.lg,
        }, arkStil]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  )
}

export function PromptSheet({ synlig, tittel, forklaring, plassholder, startverdi, knapp, onSvar, onAvbryt }: {
  synlig: boolean
  tittel: string
  forklaring?: string
  plassholder?: string
  startverdi?: string
  knapp?: string
  onSvar: (verdi: string) => void
  onAvbryt: () => void
}) {
  const [verdi, setVerdi] = useState(startverdi ?? '')
  useEffect(() => { if (synlig) setVerdi(startverdi ?? '') }, [synlig, startverdi])
  const kanSende = verdi.trim().length > 0

  return (
    <Ark synlig={synlig} onLukk={onAvbryt}>
      <View style={{ paddingHorizontal: spacing.screen }}>
        <Text style={t.title3}>{tittel}</Text>
        {!!forklaring && <Text style={[t.footnote, { marginTop: spacing.xs }]}>{forklaring}</Text>}
        <TextInput
          value={verdi}
          onChangeText={setVerdi}
          placeholder={plassholder}
          placeholderTextColor={colors.tertiaryLabel}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => kanSende && onSvar(verdi.trim())}
          style={[t.body, {
            backgroundColor: colors.bg, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            marginTop: spacing.lg,
          }]}
        />
        <Pressable
          haptic="medium"
          onPress={() => kanSende && onSvar(verdi.trim())}
          disabled={!kanSende}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
            alignItems: 'center', justifyContent: 'center',
            marginTop: spacing.md, opacity: kanSende ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>{knapp ?? 'Lagre'}</Text>
        </Pressable>
        <Pressable onPress={onAvbryt} style={{ alignItems: 'center', paddingVertical: spacing.md }}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
      </View>
    </Ark>
  )
}

export type Valg<T> = { verdi: T; etikett: string; underetikett?: string }

export function ChoiceSheet<T>({ synlig, tittel, forklaring, valg, valgt, onVelg, onAvbryt }: {
  synlig: boolean
  tittel: string
  forklaring?: string
  valg: Valg<T>[]
  valgt?: T
  onVelg: (verdi: T) => void
  onAvbryt: () => void
}) {
  return (
    <Ark synlig={synlig} onLukk={onAvbryt}>
      <View style={{ paddingHorizontal: spacing.screen }}>
        <Text style={t.title3}>{tittel}</Text>
        {!!forklaring && <Text style={[t.footnote, { marginTop: spacing.xs }]}>{forklaring}</Text>}
      </View>
      <View style={{
        marginTop: spacing.lg, marginHorizontal: spacing.screen,
        backgroundColor: colors.bg, borderRadius: radius.lg,
        borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
      }}>
        {valg.map((v, i) => (
          <Pressable
            key={String(v.verdi)}
            haptic="light"
            onPress={() => onVelg(v.verdi)}
            style={{
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
              borderBottomWidth: i === valg.length - 1 ? 0 : 0.5, borderBottomColor: colors.separator,
              backgroundColor: valgt === v.verdi ? colors.brandSoft : undefined,
            }}
          >
            <Text style={[t.body, valgt === v.verdi && { color: colors.brand, fontWeight: '600' }]}>
              {v.etikett}
            </Text>
            {!!v.underetikett && <Text style={[t.footnote, { marginTop: 1 }]}>{v.underetikett}</Text>}
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onAvbryt} style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
        <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
      </Pressable>
    </Ark>
  )
}

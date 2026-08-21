import { useState } from 'react'
import { View, ScrollView, FlatList } from 'react-native'
import { Text, TextInput } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { ChevronLeft, Archive, ChevronRight, ShieldCheck } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { Chip } from '../../components/ui'
import { ToolGlow } from '../../components/tool-surface'
import { OrderArchive } from '../../lib/db/models/order-archive'
import { useArkiv, useArkivAar } from '../../lib/archive/freeze'
import { useKunder } from '../../lib/customers'
import { formatDate } from '../../lib/format'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../lib/theme'

function Rad({ arkiv, indeks }: { arkiv: OrderArchive; indeks: number }) {
  const tall = arkiv.telleverk
  const deler = [
    tall.dokumenter ? `${tall.dokumenter} dokumenter` : null,
    tall.signaturer ? `${tall.signaturer} signaturer` : null,
    tall.timer ? `${tall.timer} timeføringer` : null,
    tall.materiell ? `${tall.materiell} materiellinjer` : null,
  ].filter(Boolean)

  return (
    <Animated.View entering={FadeInDown.springify().damping(18).delay(Math.min(indeks, 10) * 35)}>
      <Pressable
        onPress={() => router.push({ pathname: '/(app)/ordre/[id]', params: { id: arkiv.orderId } })}
        style={[{
          backgroundColor: colors.bg, borderRadius: radius.lg,
          marginHorizontal: spacing.screen, marginBottom: spacing.sm,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
          flexDirection: 'row', alignItems: 'center',
        }, shadows.card]}
      >
        <View style={{
          width: sizes.iconChip - 6, height: sizes.iconChip - 6, borderRadius: radius.sm,
          backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
        }}>
          <Archive size={17} color={colors.brand} strokeWidth={sizes.lucideStroke} />
        </View>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={t.bodyMedium} numberOfLines={1}>
            {[arkiv.orderNumber ? `#${arkiv.orderNumber}` : null, arkiv.customerName ?? 'Uten kunde']
              .filter(Boolean).join(' · ')}
          </Text>
          <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
            {deler.join(' · ') || 'Tom pakke'}
          </Text>
          {/* Fristen står på hver rad. Den er hele grunnen til at pakken finnes,
              og den er stemplet ved frysing — ikke regnet ut nå. */}
          <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2 }]}>
            {`Frosset ${formatDate(arkiv.frossetAt)} · oppbevares til ${formatDate(arkiv.oppbevaresTil)}`}
          </Text>
        </View>
        <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
      </Pressable>
    </Animated.View>
  )
}

/**
 * Gamle jobber.
 *
 * **Registeret er denne lista, ikke R2.** Filtrering på kunde og år er en
 * spørring mot lokal SQLite — objektlageret er oppbevaring. Å liste opp bøtter
 * for å finne en jobb fra 2027 ville vært tregt, feilbarlig, og et tapt objekt
 * ville ikke merkes.
 */
export default function Arkiv() {
  const insets = useSafeAreaInsets()
  const [sok, setSok] = useState('')
  const [kunde, setKunde] = useState<string | null>(null)
  const [aar, setAar] = useState<number | null>(null)

  const rader = useArkiv({ customerId: kunde, aar, sok })
  const alleAar = useArkivAar()
  const kunder = useKunder()
  // Bare kunder som FAKTISK har arkiv — et filter med tomme valg er støy.
  const arkivKunder = useArkiv({})
  const medArkiv = new Set(arkivKunder.map(a => a.customerId).filter(Boolean))

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ToolGlow height={340} />
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.screen }}>
        <Pressable onPress={() => router.back()} pressScale={0.92}
          style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
        </Pressable>
        <Text style={[t.display, { marginTop: spacing.md }]}>Gamle jobber</Text>
        <Text style={[t.footnote, { marginTop: 2 }]}>
          {arkivKunder.length === 0
            ? 'Ingenting arkivert ennå. Ordrer fryses når de er fakturert og godkjent.'
            : `${arkivKunder.length} arkiverte jobber`}
        </Text>

        <TextInput
          value={sok} onChangeText={setSok}
          placeholder="Kunde eller ordrenummer"
          placeholderTextColor={colors.tertiaryLabel}
          autoCorrect={false} clearButtonMode="while-editing"
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.md,
          }]}
        />
      </View>

      {(alleAar.length > 1 || medArkiv.size > 1) && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}
          style={{ marginTop: spacing.md, flexGrow: 0 }}
        >
          {alleAar.map(a => (
            <Chip key={a} label={String(a)} selected={aar === a} onPress={() => setAar(aar === a ? null : a)} />
          ))}
          {kunder.filter(k => medArkiv.has(k.id)).map(k => (
            <Chip key={k.id} label={k.name} selected={kunde === k.id}
              onPress={() => setKunde(kunde === k.id ? null : k.id)} />
          ))}
        </ScrollView>
      )}

      <FlatList
        data={rader}
        keyExtractor={a => a.id}
        contentContainerStyle={{
          paddingTop: spacing.lg,
          paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => <Rad arkiv={item} indeks={index} />}
        ListEmptyComponent={
          arkivKunder.length === 0 ? (
            <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
              <View style={{
                width: sizes.iconChip + 12, height: sizes.iconChip + 12, borderRadius: radius.pill,
                backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
              }}>
                <ShieldCheck size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
              </View>
              <Text style={[t.footnote, { marginTop: spacing.md, textAlign: 'center', paddingHorizontal: spacing.xxl }]}>
                En arkivert jobb er låst med en sjekksum. Endres pakken, stemmer den ikke lenger.
              </Text>
            </View>
          ) : (
            <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xl }]}>
              Ingen treff. Prøv et annet år eller en annen kunde.
            </Text>
          )
        }
      />
    </View>
  )
}

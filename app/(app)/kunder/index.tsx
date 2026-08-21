import { useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, Plus, ChevronRight, Building2, User } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader } from '../../../components/ui'
import { useKunder, useOrdreAntallPerKunde } from '../../../lib/customers'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function KunderScreen() {
  const insets = useSafeAreaInsets()
  const [sok, setSok] = useState('')
  const kunder = useKunder(sok)
  const antall = useOrdreAntallPerKunde()

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
          </Pressable>
          <Text style={t.headline}>Kunder</Text>
        </View>
        <Pressable onPress={() => router.push('/(app)/kunder/ny')} hitSlop={12}>
          <Plus size={24} color={colors.brand} strokeWidth={sizes.lucideStroke} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.md }}>
        <TextInput
          value={sok}
          onChangeText={setSok}
          placeholder="Søk navn, telefon, org.nr eller adresse"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }]}
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {kunder.length === 0 ? (
          <View style={{ paddingHorizontal: spacing.screen + spacing.lg, paddingTop: spacing.xxl }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              {sok ? 'Ingen treff.' : 'Ingen kunder ennå. Første kunde kan opprettes rett fra en ordre.'}
            </Text>
          </View>
        ) : (
          <>
            <SectionHeader>{`${kunder.length} kunder`}</SectionHeader>
            <ListCard>
              {kunder.map((k, i) => (
                <Pressable
                  key={k.id}
                  onPress={() => router.push(`/(app)/kunder/${k.id}`)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                    borderBottomWidth: i === kunder.length - 1 ? 0 : 0.5, borderBottomColor: colors.separator,
                  }}
                >
                  {k.isCompany
                    ? <Building2 size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
                    : <User size={18} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
                  <View style={{ flex: 1 }}>
                    <Text style={t.body} numberOfLines={1}>{k.name}</Text>
                    {!!k.postalAddress && (
                      <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{k.postalAddress}</Text>
                    )}
                  </View>
                  {!!antall[k.id] && (
                    <Text style={t.footnote}>{antall[k.id]} ordre</Text>
                  )}
                  <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </Pressable>
              ))}
            </ListCard>
          </>
        )}
      </ScrollView>
    </View>
  )
}

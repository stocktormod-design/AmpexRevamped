import { useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from './text'
import { Plus, Building2, User, Check } from 'lucide-react-native'
import { Pressable } from './pressable'
import { ListCard } from './ui'
import { useKunder } from '../lib/customers'
import { Customer } from '../lib/db/models/customer'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/**
 * Selve kundelista: søk, «ny kunde» og radene.
 *
 * Trukket ut fordi den åpnes fra to steder med hver sin vei tilbake: ordren
 * (legg kunden på ordren) og en ny ordre (velg kunden før ordren finnes).
 * Den som lager en ny ordre må havne TILBAKE på ordreskjermen sin — se
 * `app/(app)/ordre/velg-kunde.tsx` og kommentaren der.
 */
export function KundeVelger({ onVelg, onNy }: {
  onVelg: (kunde: Customer) => void
  onNy: (navn: string) => void
}) {
  const [sok, setSok] = useState('')
  const kunder = useKunder(sok)

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.md }}>
        <TextInput
          value={sok}
          onChangeText={setSok}
          placeholder="Søk"
          placeholderTextColor={colors.tertiaryLabel}
          style={[t.body, {
            backgroundColor: colors.fill, borderRadius: radius.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }]}
          autoFocus
          clearButtonMode="while-editing"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Nyopprettelse ligger øverst med søketeksten som navn — den vanligste
            grunnen til å ikke finne en kunde er at hun ikke finnes ennå. */}
        <ListCard style={{ marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => onNy(sok.trim())}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            }}
          >
            <Plus size={18} color={colors.brand} strokeWidth={sizes.lucideStroke} />
            <Text style={[t.body, { color: colors.brand }]}>
              {sok.trim() ? `Ny kunde «${sok.trim()}»` : 'Ny kunde'}
            </Text>
          </Pressable>
        </ListCard>

        {kunder.length > 0 && (
          <ListCard>
            {kunder.map((k, i) => (
              <Pressable
                key={k.id}
                onPress={() => onVelg(k)}
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
                  {!!k.postalAddress && <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{k.postalAddress}</Text>}
                </View>
                <Check size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
              </Pressable>
            ))}
          </ListCard>
        )}
      </ScrollView>
    </View>
  )
}

import { useState } from 'react'
import { View, Text, TextInput } from 'react-native'
import { Package, Plus } from 'lucide-react-native'
import { Pressable } from './pressable'
import { Product } from '../lib/db/models/product'
import { useVaresok, formatBeholdning } from '../lib/products'
import { formatKr, tilOre } from '../lib/invoicing'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/**
 * Gjenbrukbart varesøk. Brukes både ved uttak fra lager og ved materiell på
 * ordre — de to stedene der feil vare koster penger.
 *
 * «Ny vare»-raden ligger ØVERST og ikke nederst: den vanligste grunnen til at
 * du ikke finner varen er at den ikke finnes ennå, og da skal du ikke måtte
 * scrolle forbi 40 treff for å oppdage det.
 */
export function ProductPicker({ onVelg, onNy, autoFocus }: {
  onVelg: (p: Product) => void
  /** Kalles med søketeksten når brukeren vil opprette varen i stedet. */
  onNy?: (sok: string) => void
  autoFocus?: boolean
}) {
  const [sok, setSok] = useState('')
  const treff = useVaresok(sok)
  const q = sok.trim()

  return (
    <View>
      <TextInput
        value={sok}
        onChangeText={setSok}
        placeholder="Søk vare eller el-nummer"
        placeholderTextColor={colors.tertiaryLabel}
        autoFocus={autoFocus}
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[t.body, {
          backgroundColor: colors.fill, borderRadius: radius.md,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          marginBottom: spacing.md,
        }]}
      />

      {!!q && onNy && (
        <Pressable
          onPress={() => onNy(q)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
            backgroundColor: colors.bg, borderRadius: radius.md,
            borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
          }}
        >
          <Plus size={18} color={colors.brand} strokeWidth={sizes.lucideStroke} />
          <Text style={[t.body, { color: colors.brand, flex: 1 }]} numberOfLines={1}>
            Ny vare «{q}»
          </Text>
        </Pressable>
      )}

      {treff.length === 0 ? (
        <Text style={[t.footnote, { paddingHorizontal: spacing.lg }]}>
          {q
            ? 'Ingen treff.'
            : 'Ingen varer ennå. Last inn en prisfil fra grossisten, eller opprett varen når du tar den ut.'}
        </Text>
      ) : (
        <View style={{
          backgroundColor: colors.bg, borderRadius: radius.md,
          borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
        }}>
          {treff.map((x, i) => (
            <Pressable
              key={x.product.id}
              haptic="light"
              onPress={() => onVelg(x.product)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                borderBottomWidth: i === treff.length - 1 ? 0 : 0.5,
                borderBottomColor: colors.separator,
              }}
            >
              <Package size={17} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />
              <View style={{ flex: 1 }}>
                <Text style={t.body} numberOfLines={1}>{x.product.name}</Text>
                <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                  {x.product.elnummer ? `EL ${x.product.elnummer}` : 'Uten el-nummer'}
                  {x.beholdning !== null ? `  ·  ${formatBeholdning(x.beholdning, x.product.unit)} på lager` : ''}
                  {x.product.supplier ? `  ·  ${x.product.supplier}` : ''}
                </Text>
              </View>
              {x.product.unitPrice != null && (
                <Text style={[t.subhead, { fontVariant: ['tabular-nums'] }]}>
                  {formatKr(tilOre(x.product.unitPrice))}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

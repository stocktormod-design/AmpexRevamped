import { useState } from 'react'
import { View, Image } from 'react-native'
import { Text, TextInput } from './text'
import { Package, Plus, TrendingDown } from 'lucide-react-native'
import { Pressable } from './pressable'
import { Product } from '../lib/db/models/product'
import { useVaresok, formatBeholdning } from '../lib/products'
import { formatKr, tilOre } from '../lib/invoicing'
import { colors, spacing, radius, sizes, type as papirType, toolType } from '../lib/theme'

/**
 * Gjenbrukbart varesøk. Brukes både ved uttak fra lager og ved materiell på
 * ordre — de to stedene der feil vare koster penger.
 *
 * «Ny vare»-raden ligger ØVERST og ikke nederst: den vanligste grunnen til at
 * du ikke finner varen er at den ikke finnes ennå, og da skal du ikke måtte
 * scrolle forbi 40 treff for å oppdage det.
 */
export function ProductPicker({ onVelg, onNy, autoFocus, flate = 'verktoy' }: {
  onVelg: (p: Product) => void
  /** Kalles med søketeksten når brukeren vil opprette varen i stedet. */
  onNy?: (sok: string) => void
  autoFocus?: boolean
  /**
   * Hvilken flate søket står på. Standard er verktøy (brun grunn), som er der
   * alle tre bruksstedene ligger i dag — uttak fra lager, materiell på ordre og
   * linje på tilbud. `papir` finnes for den dagen søket skal stå i et dokument.
   */
  flate?: 'papir' | 'verktoy'
}) {
  const morkt = flate === 'verktoy'
  const t = morkt ? toolType : papirType
  const f = morkt
    ? { felt: colors.toolRaisedStrong, kort: colors.toolRaised, kant: colors.toolBorder, hint: colors.toolTertiary, ikon: colors.toolSecondary }
    : { felt: colors.fill, kort: colors.bg, kant: colors.border, hint: colors.tertiaryLabel, ikon: colors.iconMuted }
  const [sok, setSok] = useState('')
  const treff = useVaresok(sok)
  const q = sok.trim()

  return (
    <View>
      <TextInput
        value={sok}
        onChangeText={setSok}
        placeholder="El-nummer, navn, produsent eller strekkode"
        placeholderTextColor={f.hint}
        autoFocus={autoFocus}
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[t.body, {
          backgroundColor: f.felt, borderRadius: radius.md,
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
            backgroundColor: f.kort, borderRadius: radius.md,
            borderWidth: 1, borderColor: f.kant, marginBottom: spacing.md,
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
          backgroundColor: f.kort, borderRadius: radius.md,
          borderWidth: 1, borderColor: f.kant, overflow: 'hidden',
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
                borderBottomColor: f.kant,
              }}
            >
              {/* Bildet kommer fra grossistens katalog via prisfila. Uten det
                  er raden en tekstlinje, og da er varen vanskelig å kjenne igjen. */}
              <View style={{
                width: 34, height: 34, borderRadius: radius.sm,
                backgroundColor: x.product.imageUrl ? colors.brandSoft : f.felt,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {x.product.imageUrl
                  ? <Image source={{ uri: x.product.imageUrl }} style={{ width: 34, height: 34 }} resizeMode="contain" />
                  : <Package size={17} color={f.ikon} strokeWidth={sizes.lucideStroke} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={t.body} numberOfLines={2}>{x.product.name}</Text>
                <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                  {[
                    x.product.fabrikat,
                    x.product.elnummer ? `EL ${x.product.elnummer}` : 'Uten el-nummer',
                    x.beholdning !== null ? `${formatBeholdning(x.beholdning, x.product.unit)} på lager` : null,
                  ].filter(Boolean).join('  ·  ')}
                </Text>
                {/* Hvor det er billigst. Det er her valget faktisk tas — når
                    varen legges på ordren, ikke i en rapport en måned senere. */}
                {x.besparelse !== null && x.besparelse > 0 && x.billigste && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                    <TrendingDown size={11} color={colors.success} strokeWidth={2.4} />
                    <Text style={[t.caption, { color: colors.success, fontWeight: '600' }]} numberOfLines={1}>
                      {`${x.billigste.grossist} ${formatKr(tilOre(x.besparelse))} billigere`}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {x.product.unitPrice != null && (
                  <Text style={[t.subhead, { fontVariant: ['tabular-nums'] }]}>
                    {formatKr(tilOre(x.product.unitPrice))}
                  </Text>
                )}
                {/* Kjenner vi bare listeprisen, er kostnaden — og dermed
                    dekningsbidraget på ordren — ikke til å stole på. */}
                {x.pris.kunListepriser && (
                  <Text style={[t.caption, { color: f.hint, marginTop: 1 }]}>listepris</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

import { useEffect, useState } from 'react'
import { View, ScrollView, Platform } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Plus, Warehouse, Search, BookOpen } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ChoiceSheet } from '../../../components/sheet'
import { MegAvatar } from '../../../components/meg-avatar'
import { Skilt } from '../../../components/skilt'
import { usePapirFokus } from '../../../components/papir-surface'
import { database } from '../../../lib/db'
import { Location } from '../../../lib/db/models/location'
import { useLocationCounts } from '../../../lib/stock'
import { useVareantall } from '../../../lib/products'
import { useUserId } from '../../../lib/auth-user'
import { EFOBASEN_I_APPEN } from '../../../lib/pricefile/varekort'
import { TAB_BAR_HOYDE, tabBarBunn } from '../../../components/glass-tab-bar'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

function useLocations() {
  const [locations, setLocations] = useState<Location[]>([])
  useEffect(() => {
    const sub = database.get<Location>('locations').query().observe().subscribe(setLocations)
    return () => sub.unsubscribe()
  }, [])
  return locations
}

/** Seksjonstittel med valgfri stille verdi til høyre. */
function Seksjonshode({ tittel, verdi }: { tittel: string; verdi?: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      marginHorizontal: spacing.screen + spacing.xs, marginBottom: spacing.sm,
    }}>
      <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.tertiaryLabel }]}>{tittel}</Text>
      {!!verdi && <Text style={[t.caption, { color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }]}>{verdi}</Text>}
    </View>
  )
}

function LocationRow({ location, count, first }: { location: Location; count: number; first: boolean }) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/lager/${location.id}`)}
      style={{
        backgroundColor: colors.bg,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        borderTopWidth: first ? 0 : 1, borderTopColor: colors.separator,
      }}
    >
      {/* Raden ledes av sine egne data: navn, regnr og antall — ingen ikonflis. */}
      <View style={{ flex: 1 }}>
        <Text style={t.bodyMedium} numberOfLines={1}>{location.name}</Text>
        {!!location.regNr && <Text style={[t.footnote, { marginTop: 1 }]}>{location.regNr}</Text>}
      </View>
      <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>
        {`${count} ${count === 1 ? 'vare' : 'varer'}`}
      </Text>
    </Pressable>
  )
}

/**
 * LAGER — det du har, ikke en innstillingsside.
 *
 * Heroen er ett tall: hvor mange varelinjer som faktisk står på lager. Under
 * den ligger bilene som Wallet-kort (skiltet er identiteten, antallet er
 * innholdet), og lokasjonene som en stille liste. «Legg til» er ett pluss i
 * hodet, ikke to rader over søket.
 */
export default function LagerScreen() {
  const insets = useSafeAreaInsets()
  const userId = useUserId()
  usePapirFokus()
  const locations = useLocations()
  const counts = useLocationCounts()
  const vareantall = useVareantall()
  const [velger, setVelger] = useState(false)

  const lagre = locations.filter(l => l.type === 'lager')
  const biler = locations.filter(l => l.type === 'bil')
  const lagerLinjer = lagre.reduce((n, l) => n + (counts[l.id] ?? 0), 0)
  const minBil = biler.find(b => !!b.assignedTo && b.assignedTo === userId) ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.xl, paddingBottom: TAB_BAR_HOYDE + tabBarBunn(insets.bottom) + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
          paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
        }}>
          <Text style={t.display}>Lager</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
            <MegAvatar size={44} />
            <Pressable
              haptic="medium" pressScale={0.92}
              onPress={() => setVelger(true)}
              accessibilityLabel="Legg til bil eller lokasjon"
              style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={sizes.icon} color={colors.brand} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>

        {/* HERO — ett tall, stor luft, nøytral skygge. Ingen farge. */}
        <View style={[{
          marginHorizontal: spacing.screen, borderRadius: radius.hero,
          backgroundColor: colors.bg, padding: spacing.xl,
        }, shadows.card]}>
          <Text style={[t.eyebrow, { textTransform: 'uppercase', color: colors.tertiaryLabel }]}>På lager</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 2 }}>
            <Text style={{
              fontSize: 54, lineHeight: 58, fontWeight: '600', letterSpacing: -2,
              color: colors.label, fontVariant: ['tabular-nums'],
            }}>
              {lagerLinjer}
            </Text>
            <Text style={[t.footnote, { color: colors.secondaryLabel }]}>
              {lagerLinjer === 1 ? 'vare' : 'varer'}
            </Text>
          </View>
          <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: spacing.sm }]}>
            {`${vareantall} i kartoteket · ${locations.length} ${locations.length === 1 ? 'lokasjon' : 'lokasjoner'}`}
          </Text>
        </View>

        {/* Søket er alltid her — det er inngangen til varekartoteket. */}
        <Pressable
          haptic="light"
          onPress={() => router.push('/(app)/lager/varer')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            backgroundColor: colors.bg, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.separator,
            marginHorizontal: spacing.screen, marginTop: spacing.md,
            paddingHorizontal: spacing.lg, minHeight: 52,
          }}
        >
          <Search size={18} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
          <View style={{ flex: 1 }}>
            <Text style={[t.body, { color: colors.secondaryLabel }]}>
              {vareantall === 0 ? 'Kartoteket er tomt' : 'Søk i varer'}
            </Text>
          </View>
          {vareantall > 0 && (
            <Text style={[t.caption, { color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }]}>{`${vareantall}`}</Text>
          )}
        </Pressable>

        {Platform.OS !== 'web' && EFOBASEN_I_APPEN && (
          <Pressable
            haptic="light"
            onPress={() => router.push('/(app)/lager/efobasen')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              backgroundColor: colors.bg, borderRadius: radius.lg,
              borderWidth: 1, borderColor: colors.separator,
              marginHorizontal: spacing.screen, marginTop: spacing.sm,
              paddingHorizontal: spacing.lg, minHeight: 48,
            }}
          >
            <BookOpen size={18} color={colors.label} strokeWidth={sizes.lucideStroke} />
            <View style={{ flex: 1 }}>
              <Text style={t.body}>Bla i EFObasen</Text>
            </View>
          </Pressable>
        )}

        {/* BILENE — Wallet-kort: skiltet øverst, navnet og antallet nederst. */}
        {biler.length > 0 && (
          <View style={{ marginTop: spacing.xl }}>
            <Seksjonshode tittel="Biler" verdi={`${biler.length}`} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}
            >
              {biler.map(b => {
                const antall = counts[b.id] ?? 0
                const erMin = !!minBil && b.id === minBil.id
                return (
                  <Pressable
                    key={b.id}
                    haptic="light"
                    pressScale={0.98}
                    onPress={() => router.push(`/(app)/lager/${b.id}`)}
                    style={[{
                      width: 236, height: 132, borderRadius: radius.hero,
                      backgroundColor: colors.bg, padding: spacing.lg,
                      justifyContent: 'space-between',
                    }, shadows.card]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      {b.regNr ? <Skilt regNr={b.regNr} stor /> : <View />}
                      {erMin && (
                        <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>Din bil</Text>
                      )}
                    </View>
                    <View>
                      <Text style={[t.headline, { color: colors.label }]} numberOfLines={1}>{b.name}</Text>
                      <Text style={[t.footnote, { color: colors.secondaryLabel, marginTop: 2 }]}>
                        {antall === 1 ? '1 vare' : `${antall} varer`}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        )}

        {/* LOKASJONENE — den stille lista. */}
        {lagre.length > 0 && (
          <View style={{ marginTop: spacing.xl }}>
            <Seksjonshode tittel="Lokasjoner" verdi={`${lagre.length}`} />
            <View style={{
              marginHorizontal: spacing.screen, borderRadius: radius.lg,
              borderWidth: 1, borderColor: colors.separator, overflow: 'hidden',
            }}>
              {lagre.map((l, i) => (
                <LocationRow key={l.id} location={l} count={counts[l.id] ?? 0} first={i === 0} />
              ))}
            </View>
          </View>
        )}

        {locations.length === 0 && (
          <View style={[{
            marginHorizontal: spacing.screen, marginTop: spacing.xl, borderRadius: radius.hero,
            backgroundColor: colors.bg, alignItems: 'center',
            paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl,
          }, shadows.card]}>
            <View style={{
              width: sizes.iconChip + 8, height: sizes.iconChip + 8, borderRadius: radius.pill,
              backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center',
            }}>
              <Warehouse size={sizes.iconLg} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
            </View>
            <Text style={[t.headline, { marginTop: spacing.md }]}>Ingen lokasjoner</Text>
            <Text style={[t.footnote, { marginTop: 4, textAlign: 'center' }]}>
              Trykk «+» for å legge til bil eller lokasjon.
            </Text>
          </View>
        )}
      </ScrollView>

      <ChoiceSheet<'bil' | 'lager'>
        synlig={velger}
        tittel="Legg til"
        valg={[
          { verdi: 'bil', etikett: 'Bil' },
          { verdi: 'lager', etikett: 'Lokasjon' },
        ]}
        onVelg={v => {
          setVelger(false)
          router.push({ pathname: '/(app)/lager/ny-lokasjon', params: { type: v } })
        }}
        onAvbryt={() => setVelger(false)}
      />
    </View>
  )
}

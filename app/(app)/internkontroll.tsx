import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, ChevronDown } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { database } from '../../lib/db'
import { IkPunkt } from '../../lib/db/models/ik-punkt'
import { IkRutine } from '../../lib/db/models/ik-rutine'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/**
 * INTERNKONTROLL — firmaets IK-system, til å lese (2026-09-13).
 *
 * Kontoret skriver rutinene (Ampex Kontor); montøren skal kunne slå dem opp
 * der arbeidet skjer, også uten dekning. Derfor leses de fra den lokale
 * basen som alt annet (regel 2). Ingen redigering her: en rutine endret fra
 * en telefon i en kjeller uten endringsnotat er ikke en revisjon.
 *
 * Punktene i firmaets nummerering, ett kort per punkt; trykk åpner formålet
 * og rutinene under. Utgåtte punkter vises ikke — de er historikk, ikke
 * instruks.
 */

function useIk() {
  const [punkter, setPunkter] = useState<IkPunkt[]>([])
  const [rutiner, setRutiner] = useState<IkRutine[]>([])
  useEffect(() => {
    const a = database.get<IkPunkt>('ik_punkter').query(Q.where('status', Q.notEq('utgatt')), Q.sortBy('sort_order', Q.asc)).observe().subscribe(setPunkter)
    const b = database.get<IkRutine>('ik_rutiner').query(Q.where('status', Q.notEq('utgatt')), Q.sortBy('sort_order', Q.asc)).observe().subscribe(setRutiner)
    return () => { a.unsubscribe(); b.unsubscribe() }
  }, [])
  return { punkter, rutiner }
}

/** «2.1» før «2.10» før «3»: nummer sorteres som tall der de er tall. */
function nummerRekkefolge(a: IkPunkt, b: IkPunkt): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const da = a.nummer.split('.').map(Number)
  const db = b.nummer.split('.').map(Number)
  for (let i = 0; i < Math.max(da.length, db.length); i++) {
    const x = da[i] ?? -1, y = db[i] ?? -1
    if (Number.isNaN(x) || Number.isNaN(y)) return a.nummer.localeCompare(b.nummer, 'nb')
    if (x !== y) return x - y
  }
  return 0
}

function Punkt({ punkt, rutiner }: { punkt: IkPunkt; rutiner: IkRutine[] }) {
  const [apen, setApen] = useState(false)
  const utkast = punkt.status === 'utkast'
  // Rutinene er det nye hjemmet for teksten; `innhold` på punktet er fra før
  // rutinene fantes og vises kun når det ikke finnes noe nyere.
  const tekst = rutiner.length === 0 && punkt.innhold?.trim() ? punkt.innhold.trim() : null
  return (
    <View style={{
      backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg,
      marginHorizontal: spacing.screen, marginBottom: spacing.sm, overflow: 'hidden',
    }}>
      <Pressable
        haptic="light"
        onPress={() => setApen(v => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, gap: spacing.md }}
      >
        <Text style={[t.subhead, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'], minWidth: 28 }]}>{punkt.nummer}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[t.bodyMedium, { color: colors.label }]}>{punkt.tittel}</Text>
          <Text style={[t.footnote, { marginTop: 2 }]} numberOfLines={apen ? undefined : 1}>
            {[
              utkast ? 'Utkast' : `Versjon ${punkt.gjeldendeVersjon}`,
              rutiner.length ? `${rutiner.length} ${rutiner.length === 1 ? 'rutine' : 'rutiner'}` : null,
              punkt.hjemmel || null,
            ].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <ChevronDown size={16} color={colors.tertiaryLabel} strokeWidth={2.2}
          style={{ transform: [{ rotate: apen ? '180deg' : '0deg' }] }} />
      </Pressable>

      {apen && (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }}>
          {!!punkt.formal && (
            <Text style={[t.body, { color: colors.secondaryLabel }]}>{punkt.formal}</Text>
          )}
          {rutiner.map(r => (
            <View key={r.id} style={{ borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: spacing.md }}>
              <Text style={[t.headline, { color: colors.label }]}>{r.tittel}</Text>
              {r.status === 'utkast' && (
                <Text style={[t.caption, { color: colors.tertiaryLabel, marginTop: 2 }]}>Utkast · ikke vedtatt ennå</Text>
              )}
              <Text style={[t.body, { color: colors.label, marginTop: spacing.sm }]}>
                {r.innhold?.trim() || 'Rutinen er ikke skrevet ennå.'}
              </Text>
            </View>
          ))}
          {tekst && (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.separator, paddingTop: spacing.md }}>
              <Text style={[t.body, { color: colors.label }]}>{tekst}</Text>
            </View>
          )}
          {rutiner.length === 0 && !tekst && (
            <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>Ingen rutine er skrevet under dette punktet ennå.</Text>
          )}
        </View>
      )}
    </View>
  )
}

export default function InternkontrollScreen() {
  const insets = useSafeAreaInsets()
  const { punkter, rutiner } = useIk()
  const sortert = useMemo(() => [...punkter].sort(nummerRekkefolge), [punkter])
  const perPunkt = useMemo(() => {
    const m = new Map<string, IkRutine[]>()
    for (const r of rutiner) m.set(r.punktId, [...(m.get(r.punktId) ?? []), r])
    return m
  }, [rutiner])

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} pressScale={0.92} hitSlop={8}
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
        </Pressable>
        <Text style={t.title2}>Internkontroll</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }} showsVerticalScrollIndicator={false}>
        {sortert.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xxl }}>
            <Text style={[t.headline, { color: colors.label }]}>Ingen internkontroll ennå</Text>
            <Text style={[t.footnote, { marginTop: spacing.xs, textAlign: 'center' }]}>
              Firmaets IK-system skrives i Ampex Kontor. Når punktene er lagt inn der, står de her.
            </Text>
          </View>
        ) : (
          sortert.map(p => <Punkt key={p.id} punkt={p} rutiner={perPunkt.get(p.id) ?? []} />)
        )}
      </ScrollView>
    </View>
  )
}

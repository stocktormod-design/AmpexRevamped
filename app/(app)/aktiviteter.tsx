import { useState } from 'react'
import { View, Text, ScrollView, TextInput } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { Pressable } from '../../components/pressable'
import { ListCard, SectionHeader } from '../../components/ui'
import { PromptSheet } from '../../components/sheet'
import { database } from '../../lib/db'
import { syncQuietly } from '../../lib/db/sync'
import { Activity } from '../../lib/db/models/activity'
import { useAktiviteter, opprettAktivitet } from '../../lib/activities'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/**
 * Timeprisene. Én skjerm fordi det er ett tall per aktivitet — en egen
 * redigeringsmodal per rad ville vært tre trykk for å endre 850 til 895.
 */
function Rad({ aktivitet, sist }: { aktivitet: Activity; sist: boolean }) {
  const [pris, setPris] = useState(aktivitet.hourlyRate == null ? '' : String(aktivitet.hourlyRate))

  async function lagre() {
    const tall = parseFloat(pris.replace(',', '.'))
    const ny = Number.isFinite(tall) && tall >= 0 ? tall : null
    if (ny === aktivitet.hourlyRate) return
    await database.write(async () => {
      await aktivitet.update(a => { a.hourlyRate = ny })
    })
    syncQuietly()
  }

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: sist ? 0 : 0.5, borderBottomColor: colors.separator,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={t.body}>{aktivitet.name}</Text>
        {!aktivitet.billable && (
          <Text style={[t.footnote, { marginTop: 1 }]}>Ikke fakturerbar</Text>
        )}
      </View>
      {aktivitet.billable ? (
        <>
          <TextInput
            value={pris}
            onChangeText={setPris}
            onBlur={lagre}
            placeholder="—"
            placeholderTextColor={colors.tertiaryLabel}
            keyboardType="decimal-pad"
            selectTextOnFocus
            style={[t.body, { minWidth: 72, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
          />
          <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>kr/t</Text>
        </>
      ) : (
        <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>—</Text>
      )}
    </View>
  )
}

export default function AktiviteterScreen() {
  const insets = useSafeAreaInsets()
  const aktiviteter = useAktiviteter()
  // Alert.prompt finnes ikke på Android og gjør ingenting der — knappen var død.
  const [nyÅpen, setNyÅpen] = useState(false)

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
          <Text style={t.headline}>Aktiviteter</Text>
        </View>
        <Pressable onPress={() => setNyÅpen(true)} hitSlop={12}>
          <Plus size={24} color={colors.brand} strokeWidth={sizes.lucideStroke} />
        </Pressable>
      </View>

      <PromptSheet
        synlig={nyÅpen}
        tittel="Ny aktivitet"
        forklaring="Navnet vises på fakturaen. «Montasje», «Feilsøking», «Kjøring»."
        plassholder="Navn"
        knapp="Opprett"
        onSvar={async navn => { setNyÅpen(false); await opprettAktivitet({ name: navn }) }}
        onAvbryt={() => setNyÅpen(false)}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader>Timepriser</SectionHeader>
        <ListCard>
          {aktiviteter.map((a, i) => (
            <Rad key={a.id} aktivitet={a} sist={i === aktiviteter.length - 1} />
          ))}
        </ListCard>
        <View style={{ paddingHorizontal: spacing.screen + spacing.lg, marginTop: spacing.md }}>
          <Text style={t.footnote}>
            Prisen låses på fakturagrunnlaget når ordren markeres fakturert. Endrer du satsen
            i dag, gjelder den nye ordrer — ikke ordre som allerede er fakturert.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

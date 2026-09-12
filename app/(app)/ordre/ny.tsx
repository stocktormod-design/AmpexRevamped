import { useEffect, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { router } from 'expo-router'
import { X, ChevronRight, UserRound } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order } from '../../../lib/db/models/order'
import { markOrderOpened } from '../../../lib/last-opened'
import { settValgtKunde, useValgtKunde } from '../../../lib/customers'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function Field({ value, onChange, placeholder, last, ...inputProps }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  last?: boolean
} & Partial<Omit<React.ComponentProps<typeof TextInput>, 'onChange'>>) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.tertiaryLabel}
      style={[
        t.body as TextStyle,
        { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
        !last && { borderBottomWidth: 0.5, borderBottomColor: colors.separator },
      ]}
      {...inputProps}
    />
  )
}

/** Neste hele time — fornuftig startverdi for planlagt tidspunkt */
function nextFullHour() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

/** Android har ikke datetime-modus — dato-dialog etterfulgt av tid-dialog */
function pickAndroidDateTime(initial: Date, onPicked: (d: Date) => void) {
  DateTimePickerAndroid.open({
    value: initial,
    mode: 'date',
    onChange: (event, date) => {
      if (event.type !== 'set' || !date) return
      DateTimePickerAndroid.open({
        value: date,
        mode: 'time',
        is24Hour: true,
        onChange: (timeEvent, dateTime) => {
          if (timeEvent.type === 'set' && dateTime) onPicked(dateTime)
        },
      })
    },
  })
}

export default function NyOrdreScreen() {
  const [title, setTitle] = useState('')
  // Kunden velges fra registeret (eller opprettes der med navn, telefon og adresse) —
  // ikke fritekst per ordre. Da finnes hun med telefonnummer for alltid.
  const kunde = useValgtKunde()
  useEffect(() => { settValgtKunde(null) }, []) // start rent hver gang skjermen åpnes
  const [address, setAddress] = useState('')
  useEffect(() => { if (kunde?.postalAddress && !address) setAddress(kunde.postalAddress) }, [kunde]) // eslint-disable-line react-hooks/exhaustive-deps
  const [description, setDescription] = useState('')
  const [scheduled, setScheduled] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const canSave = title.trim().length > 0 && !saving

  async function create() {
    if (!canSave) return
    setSaving(true)
    const created = await database.write(async () =>
      database.get<Order>('orders').create(o => {
        o.title = title.trim()
        o.customerId = kunde?.id ?? null
        o.customerName = kunde?.name ?? null
        o.customerPhone = kunde?.phone ?? null
        o.address = address.trim() || null
        o.description = description.trim() || null
        o.scheduledAt = scheduled
        o.status = scheduled ? 'planlagt' : 'mottatt'
      }),
    )
    markOrderOpened(created.id)
    syncQuietly()
    router.dismiss()
    router.push(`/(app)/ordre/${created.id}`)
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      {/* Modal-header: Avbryt | tittel */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingVertical: spacing.lg,
      }}>
        <Pressable onPress={() => (router.canDismiss() ? router.dismiss() : router.back())} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Ny ordre</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <Field value={title} onChange={setTitle} placeholder="Tittel (påkrevd)" autoFocus returnKeyType="next" />
          <Pressable
            haptic="light"
            onPress={() => router.push('/(app)/kunder/velg')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2,
              borderBottomWidth: 0.5, borderBottomColor: colors.separator,
            }}
          >
            <UserRound size={18} color={kunde ? colors.label : colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            <View style={{ flex: 1 }}>
              <Text style={[t.body, { color: kunde ? colors.label : colors.tertiaryLabel }]} numberOfLines={1}>
                {kunde ? kunde.name : 'Kunde'}
              </Text>
              {!!kunde?.phone && <Text style={[t.footnote, { marginTop: 1 }]}>{kunde.phone}</Text>}
            </View>
            <ChevronRight size={18} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
          </Pressable>
          <Field value={address} onChange={setAddress} placeholder="Adresse (jobben)" returnKeyType="next" />
          {/* Planlagt tidspunkt — inline compact-picker (iOS), dialoger (Android) */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: sizes.touchTarget,
            borderBottomWidth: 0.5, borderBottomColor: colors.separator,
          }}>
            <Text style={[t.body, { color: scheduled ? colors.label : colors.tertiaryLabel }]}>Planlagt</Text>
            {scheduled ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={scheduled}
                    mode="datetime"
                    display="compact"
                    minuteInterval={5}
                    locale="nb-NO"
                    onChange={(_, d) => d && setScheduled(d)}
                  />
                ) : (
                  <Pressable onPress={() => pickAndroidDateTime(scheduled, setScheduled)} hitSlop={8}>
                    <Text style={t.body}>{scheduled.toLocaleString('nb-NO', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setScheduled(null)} hitSlop={8}>
                  <X size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  const initial = nextFullHour()
                  if (Platform.OS === 'android') pickAndroidDateTime(initial, setScheduled)
                  else setScheduled(initial)
                }}
                hitSlop={8}
              >
                <Text style={[t.body, { color: colors.secondaryLabel }]}>Legg til</Text>
              </Pressable>
            )}
          </View>
          <Field
            value={description} onChange={setDescription} placeholder="Beskrivelse"
            multiline style={[t.body as TextStyle, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, minHeight: 88, textAlignVertical: 'top' }]}
            last
          />
        </View>

        <Pressable
          haptic="medium"
          onPress={create}
          disabled={!canSave}
          style={{
            height: sizes.ctaHeight,
            borderRadius: radius.xl,
            backgroundColor: colors.cta,
            alignItems: 'center',
            justifyContent: 'center',
            marginHorizontal: spacing.screen,
            marginTop: spacing.xl,
            opacity: canSave ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>Opprett ordre</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

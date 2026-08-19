import { useState } from 'react'
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, TextStyle } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable } from '../../../components/pressable'
import { Chip } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Order } from '../../../lib/db/models/order'
import { opprettKunde } from '../../../lib/customers'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

function Field({ value, onChange, placeholder, last, ...rest }: {
  value: string; onChange: (v: string) => void; placeholder: string; last?: boolean
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
      {...rest}
    />
  )
}

export default function NyKundeScreen() {
  // Kommer man hit fra en ordre, skal den nye kunden festes på ordren med en gang.
  const { orderId, navn: navnFraOrdre } = useLocalSearchParams<{ orderId?: string; navn?: string }>()
  const [erBedrift, setErBedrift] = useState(false)
  const [navn, setNavn] = useState(navnFraOrdre ?? '')
  const [orgNr, setOrgNr] = useState('')
  const [telefon, setTelefon] = useState('')
  const [epost, setEpost] = useState('')
  const [adresse, setAdresse] = useState('')
  const [postnr, setPostnr] = useState('')
  const [sted, setSted] = useState('')
  const [lagrer, setLagrer] = useState(false)
  const kanLagre = navn.trim().length > 0 && !lagrer

  async function lagre() {
    if (!kanLagre) return
    setLagrer(true)
    const kunde = await opprettKunde({
      name: navn, isCompany: erBedrift, orgNr, phone: telefon, email: epost,
      address: adresse, postalCode: postnr, city: sted,
    })
    if (orderId) {
      const order = await database.get<Order>('orders').find(orderId).catch(() => null)
      if (order) {
        await database.write(async () => {
          await order.update(o => {
            o.customerId = kunde.id
            // Snapshotet på ordren holdes i synk ved kobling — deretter fryses det.
            o.customerName = kunde.name
            if (kunde.phone) o.customerPhone = kunde.phone
            if (!o.address && kunde.postalAddress) o.address = kunde.postalAddress
          })
        })
        syncQuietly()
      }
    }
    router.dismiss()
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.screen, paddingVertical: spacing.lg,
      }}>
        <Pressable onPress={() => router.dismiss()} hitSlop={12}>
          <Text style={[t.body, { color: colors.secondaryLabel }]}>Avbryt</Text>
        </Pressable>
        <Text style={t.headline}>Ny kunde</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Chip label="Privat" selected={!erBedrift} onPress={() => setErBedrift(false)} />
          <Chip label="Bedrift" selected={erBedrift} onPress={() => setErBedrift(true)} />
        </View>

        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <Field value={navn} onChange={setNavn} placeholder={erBedrift ? 'Firmanavn (påkrevd)' : 'Navn (påkrevd)'} autoFocus={!navnFraOrdre} returnKeyType="next" />
          {erBedrift && (
            <Field value={orgNr} onChange={setOrgNr} placeholder="Organisasjonsnummer" keyboardType="number-pad" maxLength={11} returnKeyType="next" />
          )}
          <Field value={telefon} onChange={setTelefon} placeholder="Telefon" keyboardType="phone-pad" returnKeyType="next" />
          <Field value={epost} onChange={setEpost} placeholder="E-post" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
          <Field value={adresse} onChange={setAdresse} placeholder="Adresse" returnKeyType="next" />
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 120, borderRightWidth: 0.5, borderRightColor: colors.separator }}>
              <Field value={postnr} onChange={setPostnr} placeholder="Postnr" keyboardType="number-pad" maxLength={4} last />
            </View>
            <View style={{ flex: 1 }}>
              <Field value={sted} onChange={setSted} placeholder="Poststed" last />
            </View>
          </View>
        </View>

        <Pressable
          haptic="medium"
          onPress={lagre}
          disabled={!kanLagre}
          style={{
            height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
            alignItems: 'center', justifyContent: 'center',
            marginHorizontal: spacing.screen, marginTop: spacing.xl,
            opacity: kanLagre ? 1 : 0.35,
          }}
        >
          <Text style={[t.headline, { color: colors.ctaLabel }]}>
            {orderId ? 'Opprett og velg' : 'Opprett kunde'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

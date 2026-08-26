// Device-ark for brannkomponenter (fase 4, docs/TEGNING_MULTIVIEW_PLAN.md).
// Åpnes rett etter stempel-plassering (tag er AUTOFORESLÅTT = neste ledige
// adresse på sløyfa — montøren skal kunne sette 40 detektorer uten å skrive
// ett tall) og ved tapp på eksisterende komponent i velg-modus.
// Serienummer tastes i v1 — strekkodeskanning kommer når expo-camera legges til.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text, TextInput } from './text'
import { Ark } from './sheet'
import { Pressable } from './pressable'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { FireDevice, fireDeviceKindLabel, type FireDeviceKind } from '../lib/db/models/fire-device'
import { colors, radius, spacing, type as t } from '../lib/theme'

const KINDS = Object.keys(fireDeviceKindLabel) as FireDeviceKind[]

export function FireDeviceSheet({ device, onClose }: {
  device: FireDevice | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<FireDeviceKind>('royk')
  const [tag, setTag] = useState('')
  const [serial, setSerial] = useState('')
  const [model, setModel] = useState('')

  useEffect(() => {
    if (!device) return
    setKind(device.kind)
    setTag(device.tag)
    setSerial(device.serial ?? '')
    setModel(device.model ?? '')
  }, [device])

  async function lagre() {
    if (!device) return
    await database.write(async () => {
      await device.update(d => {
        d.kind = kind
        d.tag = tag.trim()
        d.serial = serial.trim() || null
        d.model = model.trim() || null
      })
    })
    syncQuietly()
    onClose()
  }

  async function slett() {
    if (!device) return
    await database.write(async () => { await device.markAsDeleted() })
    syncQuietly()
    onClose()
  }

  const input = {
    backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.md, height: 44, color: colors.label,
  } as const

  return (
    <Ark synlig={device !== null} onLukk={onClose}>
      <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
        <Text style={t.title3}>Brannkomponent</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {KINDS.map(k => (
            <Pressable key={k} haptic="light" pressScale={0.96} onPress={() => setKind(k)}
              style={{
                paddingHorizontal: spacing.md, height: 32, borderRadius: radius.pill,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: kind === k ? colors.brand : colors.bg,
                borderWidth: kind === k ? 0 : 1, borderColor: colors.border,
              }}>
              <Text style={[t.caption, { fontWeight: '600', color: kind === k ? colors.brandLabel : colors.label }]}>
                {fireDeviceKindLabel[k]}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ width: 110 }}>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>Tag</Text>
            <TextInput value={tag} onChangeText={setTag} placeholder="01.001"
              placeholderTextColor={colors.tertiaryLabel} autoCapitalize="none" style={[t.body, input]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>Serienummer</Text>
            <TextInput value={serial} onChangeText={setSerial} placeholder="Fra etiketten"
              placeholderTextColor={colors.tertiaryLabel} autoCapitalize="characters" style={[t.body, input]} />
          </View>
        </View>
        <View>
          <Text style={[t.footnote, { color: colors.secondaryLabel, marginBottom: spacing.xs }]}>Modell</Text>
          <TextInput value={model} onChangeText={setModel} placeholder="F.eks. OP720"
            placeholderTextColor={colors.tertiaryLabel} style={[t.body, input]} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
          <Pressable haptic="light" onPress={slett}
            style={{
              paddingHorizontal: spacing.lg, height: 48, borderRadius: radius.pill,
              alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg,
              borderWidth: 1, borderColor: colors.border,
            }}>
            <Text style={[t.headline, { color: '#C0392B' }]}>Slett</Text>
          </Pressable>
          <Pressable haptic="medium" onPress={lagre}
            style={{
              flex: 1, height: 48, borderRadius: radius.pill, alignItems: 'center',
              justifyContent: 'center', backgroundColor: colors.brand,
            }}>
            <Text style={[t.headline, { color: colors.brandLabel }]}>Lagre</Text>
          </Pressable>
        </View>
      </View>
    </Ark>
  )
}

import { useState } from 'react'
import { View, Image, ActionSheetIOS, Alert, Platform, ActivityIndicator } from 'react-native'
import { Text } from './text'
import { Box, Ellipsis } from 'lucide-react-native'
import { Pressable } from './pressable'
import * as FileSystem from 'expo-file-system/legacy'
import { rebakeMeshScan, subscribeRebakeProgress } from '../lib/splat'
import { listRevisions, scanThumbUri, type ScanRevision } from '../lib/scan-revisions'
import { colors, spacing, radius, type as t } from '../lib/theme'

// Skann-kort: hero-thumbnail av 3D-modellen med tittel i mørk scrim — ikke en
// innstillinger-rad. Handlinger (ny skann / revisjoner / slett) i native action
// sheet via ⋯ eller langt trykk. Uten skann: rolig capture-kort med CTA.

export function ScanCard({ title, meta, scanPath, revisionKey, onOpen, onScan, onOpenRevision, onDelete, onRebuilt }: {
  title: string
  meta?: string
  scanPath: string | null
  revisionKey: string
  onOpen: () => void
  onScan: () => void
  onOpenRevision: (rev: ScanRevision) => void
  onDelete?: () => void
  /** Kalles med ny GLB-sti når modellen er bygget om fra samme skann. Kortet venter på den
   *  før overlayet forsvinner, så kalleren kan lagre og åpne vieweren i samme bevegelse. */
  onRebuilt?: (glbPath: string) => void | Promise<void>
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  // Fasen baken står i («Pakker UV-atlas…») — vises i overlayet på kortet mens den kjører.
  const [phase, setPhase] = useState('')

  async function showActions() {
    if (Platform.OS !== 'ios') return
    const revisions = await listRevisions(revisionKey)
    const options = ['Åpne i 3D', 'Bygg skarpere modell', 'Skann på nytt']
    if (revisions.length > 0) options.push(`Revisjoner (${revisions.length})`)
    if (onDelete) options.push('Slett skann')
    options.push('Avbryt')
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options,
        destructiveButtonIndex: onDelete ? options.length - 2 : undefined,
        cancelButtonIndex: options.length - 1,
      },
      idx => {
        const chosen = options[idx]
        if (chosen === 'Åpne i 3D') onOpen()
        else if (chosen === 'Bygg skarpere modell') rebuild()
        else if (chosen === 'Skann på nytt') onScan()
        else if (chosen?.startsWith('Revisjoner')) showRevisions(revisions)
        else if (chosen === 'Slett skann') confirmDelete()
      },
    )
  }

  // Bygger modellen på nytt fra det lagrede skann-bundlet, uten å skanne rommet igjen.
  // Nyttig når pipelinen er forbedret siden skannet ble tatt — eller når en bake ble
  // avbrutt. Bundlet ligger i scan-frames/ under samme uuid som GLB-en; tidsstemplene
  // avviker (GLB skrives etter at rammene er lagret), så vi matcher på uuid alene.
  async function rebuild() {
    if (!scanPath || busy) return
    setBusy(true)
    setPhase('Starter…')
    const unsubscribe = subscribeRebakeProgress(setPhase)
    try {
      const file = scanPath.split('/').pop() ?? ''
      const uuid = file.replace(/^mesh-/, '').replace(/\.glb$/, '').split('-').slice(1, 6).join('-')
      const root = (FileSystem.documentDirectory ?? '') + 'scan-frames'
      const names = await FileSystem.readDirectoryAsync(root).catch(() => [] as string[])
      const dir = names.find(n => n.includes(uuid))
      if (!dir) { Alert.alert('Kan ikke bygge om', 'Rådataene fra skannet finnes ikke lenger på denne enheten.'); return }
      const r = await rebakeMeshScan(`${root}/${dir}`.replace('file://', ''), {})
      // Rebaken skriver GLB-en ved siden av rådataene. Flytt den dit lagrede skann bor, med
      // et navn i samme form, og gi kalleren den RELATIVE stien — det er den formen som
      // overlever reinstall og som synk/opplasting forventer.
      const store = (FileSystem.documentDirectory ?? '') + 'room-scans/'
      await FileSystem.makeDirectoryAsync(store, { intermediates: true }).catch(() => {})
      const name = `mesh-${dir}-${Date.now()}.glb`
      await FileSystem.moveAsync({ from: 'file://' + r.glbPath, to: store + name })
      // Forhåndsvisningen ligger ved siden av GLB-en (<glb>.jpg) og må følge med, ellers
      // viser kortet boks-ikonet til neste skann.
      await FileSystem.moveAsync({ from: 'file://' + r.glbPath + '.jpg', to: store + name + '.jpg' }).catch(() => {})
      setThumbFailed(false)
      await onRebuilt?.('room-scans/' + name)
    } catch (e: any) {
      Alert.alert('Bygging feilet', typeof e?.message === 'string' ? e.message : 'Ukjent feil')
    } finally {
      unsubscribe()
      setBusy(false)
      setPhase('')
    }
  }

  function showRevisions(revisions: ScanRevision[]) {
    const labels = revisions.map(r =>
      new Date(r.ts).toLocaleString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Tidligere versjoner', options: [...labels, 'Avbryt'], cancelButtonIndex: labels.length },
      idx => { if (idx < labels.length) onOpenRevision(revisions[idx]) },
    )
  }

  function confirmDelete() {
    Alert.alert('Slette skannet?', 'Modellen og alle tidligere versjoner slettes fra enheten.', [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Slett', style: 'destructive', onPress: onDelete },
    ])
  }

  if (!scanPath) {
    // Uten skann: et stiplet ark på samme høyde som miniatyrene — ikke en rad
    // med ikonflis. Tittelen og ett verb er alt kortet trenger.
    return (
      <Pressable
        haptic="medium"
        onPress={onScan}
        onLongPress={onDelete ? confirmDelete : undefined}
        style={{
          height: 124, borderRadius: radius.lg,
          borderWidth: 1, borderColor: colors.separator, borderStyle: 'dashed',
          paddingHorizontal: spacing.md, paddingVertical: spacing.md, justifyContent: 'flex-end',
        }}
      >
        <Text style={[t.subhead, { color: colors.label, fontWeight: '600' }]} numberOfLines={1}>{title}</Text>
        <Text style={[t.caption, { color: colors.brand, marginTop: 2 }]}>Skann</Text>
      </Pressable>
    )
  }

  return (
    <Pressable
      haptic="light"
      pressScale={0.985}
      onPress={busy ? undefined : onOpen}
      onLongPress={busy ? undefined : showActions}
      disabled={busy}
      style={{
        borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#101012',
        height: 124,
      }}
    >
      {!thumbFailed ? (
        <Image
          source={{ uri: scanThumbUri(scanPath) }}
          onError={() => setThumbFailed(true)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          resizeMode="cover"
        />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Box size={40} color="rgba(255,255,255,0.35)" strokeWidth={1.4} />
        </View>
      )}

      {/* Tittel i et smalt teppe nederst. Handlingene (bygg om, revisjoner, slett)
          ligger på ⋯ og på langt trykk — den runde knappen oppe i hjørnet og den brede
          skyggen var det som gjorde kortene til krom i stedet for bilder. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.38)', flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
        <Text style={[t.subhead, { color: '#fff', fontWeight: '600', flex: 1 }]} numberOfLines={1}>{title}</Text>
        <Pressable onPress={showActions} hitSlop={12} pressScale={0.9}>
          <Ellipsis size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Ombygging pågår: mørkt teppe med fasen baken står i. Uten dette så et trykk på
          «Bygg om» ut som om ingenting skjedde i 30–60 s. */}
      {busy && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <ActivityIndicator color="#fff" />
          <Text style={[t.footnote, { color: '#fff' }]} numberOfLines={1}>{phase || 'Bygger om…'}</Text>
        </View>
      )}
    </Pressable>
  )
}

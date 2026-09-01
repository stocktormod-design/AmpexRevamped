import { useState } from 'react'
import { View, Image, ActionSheetIOS, Alert, Platform } from 'react-native'
import { Text } from './text'
import { ScanLine, Box, Ellipsis } from 'lucide-react-native'
import { Pressable } from './pressable'
import * as FileSystem from 'expo-file-system/legacy'
import { rebakeMeshScan } from '../lib/splat'
import { listRevisions, scanThumbUri, type ScanRevision } from '../lib/scan-revisions'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

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
  /** Kalles med ny GLB-sti når modellen er bygget om fra samme skann. */
  onRebuilt?: (glbPath: string) => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function showActions() {
    if (Platform.OS !== 'ios') return
    const revisions = await listRevisions(revisionKey)
    const options = ['Åpne i 3D', 'Bygg om modellen', 'Skann på nytt']
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
        else if (chosen === 'Bygg om modellen') rebuild()
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
    if (!scanPath) return
    setBusy(true)
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
      onRebuilt?.('room-scans/' + name)
    } catch (e: any) {
      Alert.alert('Bygging feilet', typeof e?.message === 'string' ? e.message : 'Ukjent feil')
    } finally {
      setBusy(false)
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
    return (
      <Pressable
        haptic="medium"
        onPress={onScan}
        onLongPress={onDelete ? confirmDelete : undefined}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
          backgroundColor: colors.bg, borderRadius: radius.lg,
          paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
        }}
      >
        <View style={{ width: sizes.iconChip, height: sizes.iconChip, borderRadius: radius.md, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <ScanLine size={sizes.icon} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={t.bodyMedium}>{title}</Text>
          <Text style={[t.footnote, { marginTop: 2 }]}>Ikke skannet. Trykk for å starte</Text>
        </View>
      </Pressable>
    )
  }

  return (
    <Pressable
      haptic="light"
      pressScale={0.985}
      onPress={onOpen}
      onLongPress={showActions}
      style={{
        borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#101012',
        height: 148,
        shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
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

      {/* ⋯ oppe til høyre */}
      <Pressable onPress={showActions} hitSlop={10} pressScale={0.9}
        style={{ position: 'absolute', top: spacing.sm, right: spacing.sm, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' }}>
        <Ellipsis size={17} color="#fff" strokeWidth={2.2} />
      </Pressable>

      {/* Scrim med tittel + meta */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md, backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <Text style={[t.headline, { color: '#fff' }]} numberOfLines={1}>{title}</Text>
        {!!meta && <Text style={[t.caption, { color: 'rgba(255,255,255,0.72)', marginTop: 1 }]}>{meta}</Text>}
      </View>
    </Pressable>
  )
}

import { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BlurView } from 'expo-blur'
import Pdf from 'react-native-pdf'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, FileText, Upload } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function TegningViewer() {
  const insets = useSafeAreaInsets()
  const { drawingId } = useLocalSearchParams<{ drawingId: string }>()
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [siblings, setSiblings] = useState<Drawing[]>([])
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Aktiv tegning
  useEffect(() => {
    if (!drawingId) return
    const sub = database.get<Drawing>('drawings').findAndObserve(drawingId).subscribe({
      next: setDrawing, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [drawingId])

  // Søsken i samme prosjekt (for swap-navbaren)
  useEffect(() => {
    const projectId = drawing?.projectId
    if (!projectId) return
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setSiblings)
    return () => sub.unsubscribe()
  }, [drawing?.projectId])

  // Hent PDF lokalt (cache) når tegningen har en fil
  const filePath = drawing?.filePath
  useEffect(() => {
    let mounted = true
    if (!filePath) { setLocalUri(null); return }
    setBusy(true)
    getLocalPdf(filePath)
      .then(uri => { if (mounted) setLocalUri(uri) })
      .catch(() => { if (mounted) setLocalUri(null) })
      .finally(() => { if (mounted) setBusy(false) })
    return () => { mounted = false }
  }, [filePath])

  async function pickAndUpload() {
    if (!drawing) return
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
    if (res.canceled || !res.assets?.[0]) return
    setBusy(true)
    try {
      const key = await uploadDrawingPdf(drawing.id, res.assets[0].uri)
      await database.write(async () => { await drawing.update(d => { d.filePath = key }) })
      syncQuietly()
    } finally {
      setBusy(false)
    }
  }

  if (!drawing) return <View style={{ flex: 1, backgroundColor: '#000' }} />
  const win = Dimensions.get('window')

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0B0C' }}>
      {/* Topp: tilbake + tittel, over lerretet */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }} pointerEvents="box-none">
        <BlurView tint="dark" intensity={40} style={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color="#fff" strokeWidth={2.2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[t.headline, { color: '#fff' }]} numberOfLines={1}>{drawing.name}</Text>
            <Text style={[t.caption, { color: 'rgba(255,255,255,0.6)' }]}>
              {[drawing.plan, disciplineLabel[drawing.discipline] ?? drawing.discipline].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </BlurView>
      </View>

      {/* Lerret — native PDF-render (react-native-pdf) */}
      {localUri ? (
        <Pdf
          source={{ uri: localUri }}
          style={{ flex: 1, width: win.width, backgroundColor: '#0B0B0C' }}
          trustAllCerts={false}
          spacing={8}
          maxScale={6}
          renderActivityIndicator={() => <ActivityIndicator color="#fff" />}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {busy ? (
            <ActivityIndicator color="rgba(255,255,255,0.7)" />
          ) : (
            <>
              <FileText size={48} color="rgba(255,255,255,0.25)" strokeWidth={1.4} />
              <Text style={[t.body, { color: 'rgba(255,255,255,0.5)', marginTop: spacing.md, textAlign: 'center' }]}>
                Ingen PDF lastet opp ennå
              </Text>
              <Pressable
                haptic="medium" onPress={pickAndUpload}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: '#fff' }}
              >
                <Upload size={sizes.icon - 2} color="#000" strokeWidth={sizes.lucideStroke} />
                <Text style={[t.headline, { color: '#000' }]}>Legg til PDF</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* Swap-navbar: bytt raskt mellom tegninger i prosjektet */}
      {siblings.length > 1 && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
          <BlurView tint="dark" intensity={60} style={{ paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.sm }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}>
              {siblings.map(d => {
                const active = d.id === drawing.id
                return (
                  <Pressable
                    key={d.id} pressScale={0.95}
                    onPress={() => router.setParams({ drawingId: d.id })}
                    style={{
                      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
                      backgroundColor: active ? '#fff' : 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Text style={[t.footnote, { fontWeight: '600', color: active ? '#000' : 'rgba(255,255,255,0.85)' }]}>
                      {disciplineLabel[d.discipline] ?? d.discipline}
                    </Text>
                    <Text style={[t.caption, { color: active ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)' }]} numberOfLines={1}>
                      {d.plan}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          </BlurView>
        </View>
      )}
    </View>
  )
}

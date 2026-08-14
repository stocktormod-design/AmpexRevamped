import { useEffect, useState } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Dimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Pdf from 'react-native-pdf'
import * as DocumentPicker from 'expo-document-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, FileText, Upload, Pencil } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Drawing, disciplineLabel } from '../../../lib/db/models/drawing'
import { uploadDrawingPdf, getLocalPdf } from '../../../lib/drawings-storage'
import { colors, spacing, radius, sizes, shadows, type as t } from '../../../lib/theme'

// Forma-lys arbeidsflate — matcher editoren
const WORKSPACE = '#E7E7EC'
const PANEL = 'rgba(252,252,253,0.96)'

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

  // Søsken i samme plan (for swap-navbaren) — planen er inngangen fra prosjektet
  const planKey = drawing?.plan
  useEffect(() => {
    const projectId = drawing?.projectId
    if (!projectId || planKey == null) return
    const sub = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.where('plan', planKey), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setSiblings)
    return () => sub.unsubscribe()
  }, [drawing?.projectId, planKey])

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

  if (!drawing) return <View style={{ flex: 1, backgroundColor: WORKSPACE }} />
  const win = Dimensions.get('window')
  const panel = { backgroundColor: PANEL, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)', ...shadows.card } as const

  return (
    <View style={{ flex: 1, backgroundColor: WORKSPACE }}>
      {/* Lerret — native PDF-render på lyst lerret (siden flyter hvit) */}
      {localUri ? (
        <Pdf
          source={{ uri: localUri }}
          style={{ flex: 1, width: win.width, backgroundColor: WORKSPACE }}
          trustAllCerts={false}
          spacing={12}
          maxScale={6}
          renderActivityIndicator={() => <ActivityIndicator color={colors.secondaryLabel} />}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {busy ? (
            <ActivityIndicator color={colors.secondaryLabel} />
          ) : (
            <>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={30} color={colors.secondaryLabel} strokeWidth={1.6} />
              </View>
              <Text style={[t.body, { color: colors.secondaryLabel, marginTop: spacing.lg, textAlign: 'center' }]}>
                Ingen PDF lastet opp ennå
              </Text>
              <Pressable
                haptic="medium" onPress={pickAndUpload}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.cta }}
              >
                <Upload size={sizes.icon - 2} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.headline, { color: colors.ctaLabel }]}>Legg til PDF</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {/* Topp-pill (venstre) + rediger-øy (høyre) */}
      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.screen, right: spacing.screen, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }} pointerEvents="box-none">
        <View style={[panel, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 5, paddingRight: spacing.md, height: 44, borderRadius: radius.pill, maxWidth: '80%' }]}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexShrink: 1 }}>
            <Text style={[t.subhead, { fontWeight: '700' }]} numberOfLines={1}>{drawing.name}</Text>
            <Text style={t.caption} numberOfLines={1}>
              {[drawing.plan, disciplineLabel[drawing.discipline] ?? drawing.discipline].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        {localUri && (
          <Pressable onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning-edit', params: { drawingId: drawing.id } })} pressScale={0.92}
            style={[panel, { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }]}>
            <Pencil size={sizes.icon - 1} color={colors.label} strokeWidth={2.1} />
          </Pressable>
        )}
      </View>

      {/* Swap-navbar: flytende lyse pill-øyer, bytt tegning i planen */}
      {siblings.length > 1 && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + spacing.sm }} pointerEvents="box-none">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}>
            {siblings.map(d => {
              const active = d.id === drawing.id
              return (
                <Pressable
                  key={d.id} pressScale={0.95} haptic="light"
                  onPress={() => router.setParams({ drawingId: d.id })}
                  style={[panel, {
                    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg,
                    backgroundColor: active ? colors.label : PANEL, borderColor: active ? colors.label : 'rgba(0,0,0,0.08)',
                  }]}
                >
                  <Text style={[t.footnote, { fontWeight: '700', color: active ? '#fff' : colors.label }]} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={[t.caption, { color: active ? 'rgba(255,255,255,0.6)' : colors.tertiaryLabel }]} numberOfLines={1}>
                    {disciplineLabel[d.discipline] ?? d.discipline}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

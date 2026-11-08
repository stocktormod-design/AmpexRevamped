import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView, useWindowDimensions } from 'react-native'
import { ChevronRight, Folder, Search, X } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { Ark } from './sheet'
import { DrawingThumb } from './drawing-thumb'
import { useMapper, mappeSti, tellRekursivt } from './tegning-mapper'
import { hentSisteTegninger } from '../lib/siste-tegning'
import type { Drawing } from '../lib/db/models/drawing'
import { colors, spacing, radius, type as t } from '../lib/theme'

/**
 * Arkvelgeren inne i tegningen (Forma-mønsteret, Tormod 07.11): trykk tittelen → bytt
 * tegning uten å gå ut. Samme mappetre som prosjektsida — før var dette en flat liste over
 * ALLE tegningene i prosjektet, og i et prosjekt med 200 tegninger er det ubrukelig.
 *
 * Åpner i mappa tegningen du ser på ligger i. Søk leter i alle mappene og viser stien.
 * «Nylig» øverst: den du så på i går er nesten alltid den du leter etter i dag.
 */
export function TegningVelger({ synlig, projectId, valgtId, tittel = 'Bytt tegning', onVelg, onLukk }: {
  synlig: boolean
  projectId: string
  /** Tegningen som vises nå — markeres, og velgeren åpner i dens mappe. */
  valgtId?: string | null
  tittel?: string
  onVelg: (drawingId: string) => void
  onLukk: () => void
}) {
  const win = useWindowDimensions()
  const { mapper, tegninger } = useMapper(projectId)
  const [mappeId, setMappeId] = useState<string | null>(null)
  const [sok, setSok] = useState('')
  const [nylig, setNylig] = useState<string[]>([])

  // Hver gang arket åpnes: start i mappa til tegningen du ser på, tomt søk.
  useEffect(() => {
    if (!synlig) return
    setSok('')
    setMappeId(tegninger.find(d => d.id === valgtId)?.folderId ?? null)
    void hentSisteTegninger(projectId).then(setNylig)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synlig, valgtId, projectId])

  const sti = useMemo(() => {
    const ut: { id: string | null; navn: string }[] = [{ id: null, navn: 'Alle' }]
    let id = mappeId, vakt = 0
    const ledd: { id: string; navn: string }[] = []
    while (id && vakt++ < 20) {
      const m = mapper.find(x => x.id === id)
      if (!m) break
      ledd.unshift({ id: m.id, navn: m.name })
      id = m.parentId
    }
    return ut.concat(ledd)
  }, [mappeId, mapper])

  const undermapper = mapper.filter(m => (m.parentId ?? null) === mappeId)
  const herTegninger = tegninger.filter(d => (d.folderId ?? null) === mappeId)
  const q = sok.trim().toLowerCase()
  const treff = q
    ? tegninger.filter(d => `${d.name} ${d.plan ?? ''}`.toLowerCase().includes(q))
    : []
  const nyligeTegninger = nylig
    .map(id => tegninger.find(d => d.id === id))
    .filter((d): d is Drawing => !!d)
    .slice(0, 6)

  const velg = (id: string) => { onVelg(id); onLukk() }

  const rad = (d: Drawing, visSti = false) => {
    const valgt = d.id === valgtId
    const under = visSti
      ? mappeSti(d.folderId, mapper).join(' › ') || 'Prosjektets rot'
      : (d.plan && d.plan !== d.name ? d.plan : '')
    return (
      <Pressable key={d.id} haptic="light" onPress={() => velg(d.id)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.screen, backgroundColor: valgt ? colors.fill : 'transparent' }}>
        <View style={{ width: 52, height: 38, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 0.5, borderColor: colors.separator, backgroundColor: '#fff' }}>
          {d.filePath ? <DrawingThumb filePath={d.filePath} px={240} style={{ width: 52, height: 38 }} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[t.body, { fontWeight: valgt ? '700' : '500' }]} numberOfLines={1}>{d.name}</Text>
          {!!under && <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: 1 }]} numberOfLines={1}>{under}</Text>}
        </View>
        {valgt && <Text style={[t.caption, { color: colors.secondaryLabel, fontWeight: '600' }]}>Åpen</Text>}
      </Pressable>
    )
  }

  return (
    <Ark synlig={synlig} onLukk={onLukk}>
      <View style={{ height: Math.round(win.height * 0.68) }}>
        <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
          <Text style={t.title3}>{tittel}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill }}>
            <Search size={16} color={colors.secondaryLabel} strokeWidth={2.2} />
            <TextInput value={sok} onChangeText={setSok} placeholder={`Søk i ${tegninger.length} tegninger`}
              placeholderTextColor={colors.tertiaryLabel} autoCorrect={false} returnKeyType="search"
              style={[t.body, { flex: 1, paddingVertical: 0 }]} />
            {!!sok && (
              <Pressable onPress={() => setSok('')} hitSlop={10} accessibilityLabel="Tøm søket">
                <X size={16} color={colors.secondaryLabel} strokeWidth={2.2} />
              </Pressable>
            )}
          </View>
        </View>

        <ScrollView style={{ flex: 1, marginTop: spacing.md }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {q ? (
            treff.length ? treff.map(d => rad(d, true)) : (
              <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xl }]}>Ingen tegning heter «{sok.trim()}»</Text>
            )
          ) : (
            <>
              {nyligeTegninger.length > 1 && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={[t.eyebrow, { textTransform: 'uppercase', paddingHorizontal: spacing.screen, marginBottom: spacing.sm }]}>Nylig</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.sm }}>
                    {nyligeTegninger.map(d => (
                      <Pressable key={d.id} haptic="light" pressScale={0.96} onPress={() => velg(d.id)} style={{ width: 112 }}>
                        <View style={{ width: 112, height: 80, borderRadius: radius.md, overflow: 'hidden', borderWidth: d.id === valgtId ? 2 : 0.5, borderColor: d.id === valgtId ? colors.label : colors.separator, backgroundColor: '#fff' }}>
                          {d.filePath ? <DrawingThumb filePath={d.filePath} px={320} style={{ width: 112, height: 80 }} /> : null}
                        </View>
                        <Text style={[t.caption, { fontWeight: '600', marginTop: 4 }]} numberOfLines={1}>{d.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Stien — hvert ledd kan trykkes. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, alignItems: 'center', gap: 2 }} style={{ marginBottom: spacing.xs }}>
                {sti.map((l, i) => (
                  <View key={l.id ?? 'rot'} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    {i > 0 && <ChevronRight size={13} color={colors.tertiaryLabel} strokeWidth={2.2} />}
                    <Pressable haptic="light" onPress={() => setMappeId(l.id)} disabled={i === sti.length - 1} hitSlop={6}>
                      <Text style={[t.subhead, { fontWeight: i === sti.length - 1 ? '700' : '500', color: i === sti.length - 1 ? colors.label : colors.secondaryLabel }]}>{l.navn}</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>

              {undermapper.map(m => (
                <Pressable key={m.id} haptic="light" onPress={() => setMappeId(m.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.screen }}>
                  <View style={{ width: 52, alignItems: 'center' }}>
                    <Folder size={22} color={colors.label} strokeWidth={1.8} />
                  </View>
                  <Text style={[t.body, { flex: 1, fontWeight: '500' }]} numberOfLines={1}>{m.name}</Text>
                  <Text style={[t.caption, { color: colors.secondaryLabel }]}>{tellRekursivt(m.id, mapper, tegninger)}</Text>
                  <ChevronRight size={15} color={colors.tertiaryLabel} strokeWidth={2.2} />
                </Pressable>
              ))}
              {herTegninger.map(d => rad(d))}
              {undermapper.length === 0 && herTegninger.length === 0 && (
                <Text style={[t.footnote, { textAlign: 'center', marginTop: spacing.xl }]}>Ingen tegninger her</Text>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Ark>
  )
}

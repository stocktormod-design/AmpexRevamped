import { useEffect, useMemo, useState } from 'react'
import { View, TextInput as RNTextInput, type TextStyle } from 'react-native'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { CircleCheckBig, ChevronRight, Folder, FolderPlus, LayoutGrid, List, Plus } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { Ark, ChoiceSheet } from './sheet'
import { DrawingThumb } from './drawing-thumb'
import { useEffect as useEffekt } from 'react'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { Drawing, disciplineLabel } from '../lib/db/models/drawing'
import { DrawingFolder } from '../lib/db/models/drawing-folder'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'

/**
 * Mapper for tegninger (Tormod 2026-09-06): «inne i et prosjekt burde være litt
 * mer listeaktig … bygg → mapper som elkraft/ikt/adgang → DER inne fliser».
 * Mappene er RADER (liste), tegningene på et nivå er FLISER med miniatyr.
 */

export function useMapper(projectId: string) {
  const [mapper, setMapper] = useState<DrawingFolder[]>([])
  const [tegninger, setTegninger] = useState<Drawing[]>([])
  useEffect(() => {
    if (!projectId) return
    const s1 = database.get<DrawingFolder>('drawing_folders')
      .query(Q.where('project_id', projectId), Q.sortBy('sort_order', Q.asc), Q.sortBy('name', Q.asc))
      .observe().subscribe(setMapper)
    const s2 = database.get<Drawing>('drawings')
      .query(Q.where('project_id', projectId), Q.sortBy('created_at', Q.asc))
      .observe().subscribe(setTegninger)
    return () => { s1.unsubscribe(); s2.unsubscribe() }
  }, [projectId])
  return { mapper, tegninger }
}

/** Antall tegninger i mappa OG alle undermapper. */
export function tellRekursivt(mappeId: string, mapper: DrawingFolder[], tegninger: Drawing[]): number {
  let n = tegninger.filter(d => d.folderId === mappeId).length
  for (const m of mapper) if (m.parentId === mappeId) n += tellRekursivt(m.id, mapper, tegninger)
  return n
}

/** Sti fra rot: «Bygg A / Elkraft». */
export function mappeSti(mappeId: string | null, mapper: DrawingFolder[]): string[] {
  const ut: string[] = []
  let id = mappeId
  let vakt = 0
  while (id && vakt++ < 20) {
    const m = mapper.find(x => x.id === id)
    if (!m) break
    ut.unshift(m.name)
    id = m.parentId
  }
  return ut
}

export async function opprettMappe(projectId: string, parentId: string | null, name: string, userId: string | null) {
  await database.write(async () => {
    await database.get<DrawingFolder>('drawing_folders').create(m => {
      m.projectId = projectId
      m.parentId = parentId
      m.name = name.trim()
      m.sortOrder = 0
      m.createdBy = userId
    })
  })
  syncQuietly()
}

export async function flyttTegning(drawing: Drawing, folderId: string | null) {
  await database.write(async () => { await drawing.update(d => { d.folderId = folderId }) })
  syncQuietly()
}

/** Ark: nytt mappenavn. */
export function MappeNySheet({ synlig, onLukk, onOpprett, forelder }: {
  synlig: boolean; onLukk: () => void; onOpprett: (navn: string) => void; forelder?: string
}) {
  const [navn, setNavn] = useState('')
  useEffect(() => { if (synlig) setNavn('') }, [synlig])
  const kan = navn.trim().length > 0
  return (
    <Ark synlig={synlig} onLukk={onLukk}>
      <View style={{ paddingHorizontal: spacing.screen, gap: spacing.md }}>
        <View>
          <Text style={t.title3}>Ny mappe</Text>
          <Text style={[t.footnote, { marginTop: 2 }]}>
            {forelder ? `Inne i ${forelder}` : 'På prosjektets rot — f.eks. et bygg, eller et fag'}
          </Text>
        </View>
        <TextInput
          value={navn} onChangeText={setNavn} autoFocus placeholder="Navn (f.eks. Bygg A, Elkraft, IKT)"
          placeholderTextColor={colors.tertiaryLabel} returnKeyType="done"
          onSubmitEditing={() => kan && onOpprett(navn.trim())}
          style={[t.body as TextStyle, { backgroundColor: colors.fill, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }]}
        />
        <Pressable haptic="medium" disabled={!kan} onPress={() => onOpprett(navn.trim())}
          style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center', opacity: kan ? 1 : 0.35 }}>
          <Text style={[t.headline, { color: colors.ctaLabel }]}>Opprett mappe</Text>
        </Pressable>
      </View>
    </Ark>
  )
}

/** Innholdet på ETT nivå: undermapper som rader, tegninger som fliser. */
const VISNING_NOKKEL = 'tegninger.visning'

export function MappeInnhold({ projectId, parentId, mapper, tegninger, userId, kanRedigere = true, rotTegninger = false }: {
  projectId: string
  parentId: string | null
  mapper: DrawingFolder[]
  tegninger: Drawing[]
  userId: string | null
  kanRedigere?: boolean
  /** Rota viser normalt BARE mapper (Tormod 2026-09-06). Tegninger uten mappe
   *  nås via en egen «Uten mappe»-rad, som åpner rota MED tegninger. */
  rotTegninger?: boolean
}) {
  const erRot = parentId === null && !rotTegninger
  const under = useMemo(() => mapper.filter(m => m.parentId === parentId), [mapper, parentId])
  const her = useMemo(() => (erRot ? [] : tegninger.filter(d => (d.folderId ?? null) === parentId)), [tegninger, parentId, erRot])
  const utenMappe = useMemo(() => tegninger.filter(d => !d.folderId).length, [tegninger])
  const [nyMappe, setNyMappe] = useState(false)
  const [flytter, setFlytter] = useState<Drawing | null>(null)
  const forelder = parentId ? mapper.find(m => m.id === parentId)?.name : undefined
  // Tegninger som fliser eller liste — valget er brukerens og huskes.
  const [visning, setVisning] = useState<'fliser' | 'liste'>('fliser')
  useEffekt(() => { database.localStorage.get<string>(VISNING_NOKKEL).then(v => { if (v === 'liste' || v === 'fliser') setVisning(v) }) }, [])
  const byttVisning = (v: 'fliser' | 'liste') => { setVisning(v); void database.localStorage.set(VISNING_NOKKEL, v) }

  const flyttValg = [
    { verdi: '', etikett: 'Prosjektets rot' },
    ...mapper.map(m => ({ verdi: m.id, etikett: m.name, underetikett: mappeSti(m.parentId, mapper).join(' / ') || undefined })),
  ]

  return (
    <View>
      {/* Mapper — ALLTID liste. */}
      {(under.length > 0 || (erRot && utenMappe > 0)) && (
        <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, marginBottom: spacing.md }}>
          {erRot && utenMappe > 0 && (
            <Pressable haptic="light"
              onPress={() => router.push({ pathname: '/(app)/prosjekter/mappe', params: { projectId, folderId: '' } })}
              style={[
                { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 1 },
                under.length > 0 && { borderBottomWidth: 1, borderBottomColor: colors.separator },
              ]}>
              <Folder size={sizes.icon} color={colors.secondaryLabel} strokeWidth={sizes.lucideStroke} />
              <View style={{ flex: 1 }}>
                <Text style={t.bodyMedium} numberOfLines={1}>Uten mappe</Text>
                <Text style={[t.footnote, { marginTop: 1 }]}>{`${utenMappe} ${utenMappe === 1 ? 'tegning' : 'tegninger'}`}</Text>
              </View>
              <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
          )}
          {under.map((m, i) => {
            const n = tellRekursivt(m.id, mapper, tegninger)
            const barn = mapper.filter(x => x.parentId === m.id).length
            return (
              <Pressable key={m.id} haptic="light"
                onPress={() => router.push({ pathname: '/(app)/prosjekter/mappe', params: { folderId: m.id } })}
                style={[
                  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 1 },
                  i < under.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.separator },
                ]}>
                <Folder size={sizes.icon} color={colors.brand} strokeWidth={sizes.lucideStroke} />
                <View style={{ flex: 1 }}>
                  <Text style={t.bodyMedium} numberOfLines={1}>{m.name}</Text>
                  <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                    {[barn > 0 ? `${barn} ${barn === 1 ? 'mappe' : 'mapper'}` : null, `${n} ${n === 1 ? 'tegning' : 'tegninger'}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
              </Pressable>
            )
          })}
        </View>
      )}

      {/* Tegninger — fliser eller liste, brukerens valg. Hold inne for å flytte. */}
      {her.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginHorizontal: spacing.screen, marginBottom: spacing.sm }}>
          {(['fliser', 'liste'] as const).map(v => (
            <Pressable key={v} haptic="light" onPress={() => byttVisning(v)} hitSlop={6}
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: visning === v ? colors.fill : 'transparent' }}>
              {v === 'fliser' ? <LayoutGrid size={16} color={visning === v ? colors.label : colors.tertiaryLabel} strokeWidth={2} /> : <List size={16} color={visning === v ? colors.label : colors.tertiaryLabel} strokeWidth={2} />}
            </Pressable>
          ))}
        </View>
      )}
      {her.length > 0 && visning === 'fliser' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 2, marginHorizontal: spacing.screen }}>
          {her.map(d => (
            <Pressable
              key={d.id} haptic="light" pressScale={0.97}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: d.id } })}
              onLongPress={kanRedigere ? () => setFlytter(d) : undefined}
              style={{ width: '48%', flexGrow: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}
            >
              <DrawingThumb filePath={d.filePath} style={{ height: 150 }} />
              <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderTopWidth: 1, borderTopColor: colors.separator }}>
                <Text style={t.bodyMedium} numberOfLines={1}>{d.name}</Text>
                <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>
                  {[disciplineLabel[d.discipline] ?? d.discipline, d.plan || null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      {her.length > 0 && visning === 'liste' && (
        <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
          {her.map((d, i) => (
            <Pressable key={d.id} haptic="light"
              onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning', params: { drawingId: d.id } })}
              onLongPress={kanRedigere ? () => setFlytter(d) : undefined}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 }, i < her.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}>
              <DrawingThumb filePath={d.filePath} style={{ width: 56, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.separator }} />
              <View style={{ flex: 1 }}>
                <Text style={t.bodyMedium} numberOfLines={1}>{d.name}</Text>
                <Text style={[t.footnote, { marginTop: 1 }]} numberOfLines={1}>{[disciplineLabel[d.discipline] ?? d.discipline, d.plan || null].filter(Boolean).join(' · ')}</Text>
              </View>
              <ChevronRight size={16} color={colors.tertiaryLabel} strokeWidth={sizes.lucideStroke} />
            </Pressable>
          ))}
        </View>
      )}

      {under.length === 0 && her.length === 0 && !(erRot && utenMappe > 0) && (
        <View style={{ marginHorizontal: spacing.screen, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, borderStyle: 'dashed', alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xl }}>
          <Text style={[t.footnote, { textAlign: 'center' }]}>
            {erRot ? 'Ingen mapper ennå. Lag en for hvert bygg eller fag.' : 'Tomt her. Legg til en tegning, eller en mappe til.'}
          </Text>
        </View>
      )}

      {/* Handlingene PÅ nivået, ikke under hvert kort. */}
      {kanRedigere && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.screen, marginTop: spacing.md }}>
          <Pressable haptic="light" pressScale={0.97} onPress={() => setNyMappe(true)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, height: 40, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
            <FolderPlus size={16} color={colors.label} strokeWidth={2} />
            <Text style={[t.subhead, { fontWeight: '600' }]}>Ny mappe</Text>
          </Pressable>
          {erRot ? (
            <Pressable haptic="light" pressScale={0.97}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/oppgaver', params: { projectId } })}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, height: 40, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator }}>
              <CircleCheckBig size={16} color={colors.label} strokeWidth={2.1} />
              <Text style={[t.subhead, { fontWeight: '600' }]}>Oppgaver</Text>
            </Pressable>
          ) : (
            <Pressable haptic="light" pressScale={0.97}
              onPress={() => router.push({ pathname: '/(app)/prosjekter/tegning-ny', params: { projectId, folderId: parentId ?? '' } })}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, height: 40, borderRadius: radius.md, backgroundColor: colors.label }}>
              <Plus size={16} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={[t.subhead, { fontWeight: '600', color: '#FFFFFF' }]}>Legg til tegning</Text>
            </Pressable>
          )}
        </View>
      )}

      <MappeNySheet
        synlig={nyMappe} forelder={forelder} onLukk={() => setNyMappe(false)}
        onOpprett={async navn => { setNyMappe(false); await opprettMappe(projectId, parentId, navn, userId) }}
      />
      <ChoiceSheet
        synlig={flytter !== null}
        tittel={flytter ? `Flytt «${flytter.name}»` : 'Flytt'}
        forklaring="Velg mappa tegningen skal ligge i."
        valg={flyttValg}
        valgt={flytter?.folderId ?? ''}
        onVelg={async id => { const d = flytter; setFlytter(null); if (d) await flyttTegning(d, id || null) }}
        onAvbryt={() => setFlytter(null)}
      />
    </View>
  )
}

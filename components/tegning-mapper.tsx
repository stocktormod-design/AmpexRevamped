import { useEffect, useMemo, useState } from 'react'
import { View, Alert, type TextStyle } from 'react-native'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronRight, Folder, FolderPlus, LayoutGrid, List, Plus } from 'lucide-react-native'
import { Text, TextInput } from './text'
import { Pressable } from './pressable'
import { Ark, ChoiceSheet, PromptSheet } from './sheet'
import { DrawingThumb } from './drawing-thumb'
import { database } from '../lib/db'
import { syncQuietly } from '../lib/db/sync'
import { Drawing, disciplineLabel } from '../lib/db/models/drawing'
import { DrawingFolder } from '../lib/db/models/drawing-folder'
import { colors, spacing, radius, sizes, type as t } from '../lib/theme'
import { tellRekursivt, mappeSti, etterkommere, mapperITreRekkefolge, kanFlyttesTil, slettePlan } from '../lib/tegning-tre'

/**
 * Mapper for tegninger (Tormod 2026-09-06): «inne i et prosjekt burde være litt
 * mer listeaktig … bygg → mapper som elkraft/ikt/adgang → DER inne fliser».
 * Mappene er RADER (liste), tegningene på et nivå er FLISER med miniatyr.
 *
 * Hold inne en mappe: gi nytt navn, flytt, slett. Hold inne en tegning: flytt.
 * Sletting av en mappe mister aldri innhold — undermapper og tegninger flyttes
 * ett hakk opp (til forelderen, eller til rota).
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

// Ren trelogikk (telling, sti, syklusvern, sletteplan) bor i lib/tegning-tre.ts
// og har selvtest: npm run verify:tegning-tre.
export { tellRekursivt, mappeSti, etterkommere, mapperITreRekkefolge } from '../lib/tegning-tre'

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

export async function omdopMappe(mappe: DrawingFolder, name: string) {
  const nytt = name.trim()
  if (!nytt || nytt === mappe.name) return
  await database.write(async () => { await mappe.update(m => { m.name = nytt }) })
  syncQuietly()
}

/** Flytter mappa (med alt under) til en annen forelder. Avviser seg selv og egne etterkommere. */
export async function flyttMappe(mappe: DrawingFolder, nyForelder: string | null, mapper: DrawingFolder[]) {
  if (!kanFlyttesTil(mappe.id, nyForelder, mapper)) return
  if ((mappe.parentId ?? null) === nyForelder) return
  await database.write(async () => { await mappe.update(m => { m.parentId = nyForelder }) })
  syncQuietly()
}

/**
 * Sletter mappa (myk sletting, regel 5). Innholdet flyttes ett hakk opp i
 * samme skriving, så ingen tegning blir foreldreløs og usynlig.
 */
export async function slettMappe(mappe: DrawingFolder, mapper: DrawingFolder[], tegninger: Drawing[]) {
  const plan = slettePlan(mappe, mapper, tegninger)
  await database.write(async () => {
    await database.batch(
      ...plan.barn.map(m => m.prepareUpdate(x => { x.parentId = plan.nyForelder })),
      ...plan.tegninger.map(d => d.prepareUpdate(x => { x.folderId = plan.nyForelder })),
      mappe.prepareMarkAsDeleted(),
    )
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

const VISNING_NOKKEL = 'tegninger.visning'

type MappeHandling = 'omdop' | 'flytt' | 'slett'

/**
 * Innholdet på ETT nivå: undermapper som rader, tegninger som fliser.
 *
 * Rota viser normalt BARE mapper (Tormod 2026-09-06); tegninger uten mappe nås
 * via en egen «Uten mappe»-rad. Unntaket er et prosjekt UTEN mapper: da vises
 * tegningene rett på rota, så et lite prosjekt aldri må lage en mappe for å
 * få lagt til sin første tegning.
 */
export function MappeInnhold({ projectId, parentId, mapper, tegninger, userId, kanRedigere = true, rotTegninger = false }: {
  projectId: string
  parentId: string | null
  mapper: DrawingFolder[]
  tegninger: Drawing[]
  userId: string | null
  kanRedigere?: boolean
  /** «Uten mappe»-skjermen: rota MED tegningene som ikke ligger i noen mappe. */
  rotTegninger?: boolean
}) {
  // «Uten mappe»-skjermen viser bare de løse tegningene — rotmappene står alt på prosjektet.
  const under = useMemo(() => (rotTegninger ? [] : mapper.filter(m => m.parentId === parentId)), [mapper, parentId, rotTegninger])
  // Rota skjuler tegningene bak «Uten mappe» bare når det faktisk finnes mapper å velge mellom.
  const erRot = parentId === null && !rotTegninger && mapper.length > 0
  const her = useMemo(() => (erRot ? [] : tegninger.filter(d => (d.folderId ?? null) === parentId)), [tegninger, parentId, erRot])
  const utenMappe = useMemo(() => tegninger.filter(d => !d.folderId).length, [tegninger])
  const [nyMappe, setNyMappe] = useState(false)
  const [flytter, setFlytter] = useState<Drawing | null>(null)
  const [mappeValgt, setMappeValgt] = useState<DrawingFolder | null>(null)
  const [mappeHandling, setMappeHandling] = useState<MappeHandling | null>(null)
  const forelder = parentId ? mapper.find(m => m.id === parentId)?.name : undefined
  // Tegninger som fliser eller liste — valget er brukerens og huskes.
  const [visning, setVisning] = useState<'fliser' | 'liste'>('fliser')
  useEffect(() => { database.localStorage.get<string>(VISNING_NOKKEL).then(v => { if (v === 'liste' || v === 'fliser') setVisning(v) }) }, [])
  const byttVisning = (v: 'fliser' | 'liste') => { setVisning(v); void database.localStorage.set(VISNING_NOKKEL, v) }

  const tre = useMemo(() => mapperITreRekkefolge(mapper), [mapper])
  const flyttValg = [
    { verdi: '', etikett: 'Prosjektets rot' },
    ...tre.map(({ mappe: m }) => ({ verdi: m.id, etikett: m.name, underetikett: mappeSti(m.parentId, mapper).join(' / ') || undefined })),
  ]
  // En mappe kan ikke flyttes inn i seg selv eller noe under seg.
  const mappeFlyttValg = useMemo(() => {
    if (!mappeValgt) return []
    const sperret = etterkommere(mappeValgt.id, mapper)
    return [
      { verdi: '', etikett: 'Prosjektets rot' },
      ...tre.filter(({ mappe: m }) => !sperret.has(m.id))
        .map(({ mappe: m }) => ({ verdi: m.id, etikett: m.name, underetikett: mappeSti(m.parentId, mapper).join(' / ') || undefined })),
    ]
  }, [mappeValgt, mapper, tre])

  function bekreftSlett(m: DrawingFolder) {
    const n = tellRekursivt(m.id, mapper, tegninger)
    const barn = mapper.filter(x => x.parentId === m.id).length
    const dit = m.parentId ? mapper.find(x => x.id === m.parentId)?.name ?? 'forelderen' : 'prosjektets rot'
    const innhold = [
      barn > 0 ? `${barn} ${barn === 1 ? 'undermappe' : 'undermapper'}` : null,
      n > 0 ? `${n} ${n === 1 ? 'tegning' : 'tegninger'}` : null,
    ].filter(Boolean).join(' og ')
    Alert.alert(
      `Slett «${m.name}»?`,
      innhold ? `${innhold} flyttes til ${dit}. Ingenting slettes utover mappa.` : 'Mappa er tom.',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Slett mappe', style: 'destructive', onPress: () => { void slettMappe(m, mapper, tegninger) } },
      ],
    )
  }

  const leggTilTegning = () => router.push({ pathname: '/(app)/prosjekter/tegning-ny', params: { projectId, folderId: parentId ?? '' } })

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
                onPress={() => router.push({ pathname: '/(app)/prosjekter/mappe', params: { projectId, folderId: m.id } })}
                onLongPress={kanRedigere ? () => setMappeValgt(m) : undefined}
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
            {parentId === null && !rotTegninger
              ? 'Ingen tegninger ennå. Legg til en tegning, eller lag mapper for bygg og fag.'
              : 'Tomt her. Legg til en tegning, eller en mappe til.'}
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
          <Pressable haptic="light" pressScale={0.97} onPress={leggTilTegning}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, height: 40, borderRadius: radius.md, backgroundColor: colors.label }}>
            <Plus size={16} color="#FFFFFF" strokeWidth={2.2} />
            <Text style={[t.subhead, { fontWeight: '600', color: '#FFFFFF' }]}>Legg til tegning</Text>
          </Pressable>
        </View>
      )}
      {kanRedigere && (under.length > 0 || her.length > 0) && (
        <Text style={[t.caption, { marginHorizontal: spacing.screen + spacing.xs, marginTop: spacing.sm, color: colors.tertiaryLabel }]}>
          {under.length > 0 && her.length > 0
            ? 'Hold inne en mappe eller tegning for å flytte, gi nytt navn eller slette'
            : under.length > 0 ? 'Hold inne en mappe for å gi nytt navn, flytte eller slette' : 'Hold inne en tegning for å flytte den'}
        </Text>
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
      {/* Mappe holdt inne: velg handling, så åpnes riktig ark. */}
      <ChoiceSheet<MappeHandling>
        synlig={mappeValgt !== null && mappeHandling === null}
        tittel={mappeValgt ? `«${mappeValgt.name}»` : 'Mappe'}
        valg={[
          { verdi: 'omdop', etikett: 'Gi nytt navn' },
          { verdi: 'flytt', etikett: 'Flytt til …', underetikett: mappeValgt ? (mappeSti(mappeValgt.parentId, mapper).join(' / ') || 'Ligger på prosjektets rot') : undefined },
          { verdi: 'slett', etikett: 'Slett mappe', underetikett: 'Innholdet flyttes ett hakk opp' },
        ]}
        onVelg={h => {
          if (h === 'slett') { const m = mappeValgt; setMappeValgt(null); if (m) bekreftSlett(m); return }
          setMappeHandling(h)
        }}
        onAvbryt={() => setMappeValgt(null)}
      />
      <PromptSheet
        synlig={mappeValgt !== null && mappeHandling === 'omdop'}
        tittel="Gi nytt navn"
        startverdi={mappeValgt?.name}
        plassholder="Navn"
        onSvar={async navn => { const m = mappeValgt; setMappeValgt(null); setMappeHandling(null); if (m) await omdopMappe(m, navn) }}
        onAvbryt={() => { setMappeValgt(null); setMappeHandling(null) }}
      />
      <ChoiceSheet
        synlig={mappeValgt !== null && mappeHandling === 'flytt'}
        tittel={mappeValgt ? `Flytt «${mappeValgt.name}»` : 'Flytt'}
        forklaring="Velg hvor mappa skal ligge. Alt under den blir med."
        valg={mappeFlyttValg}
        valgt={mappeValgt?.parentId ?? ''}
        onVelg={async id => { const m = mappeValgt; setMappeValgt(null); setMappeHandling(null); if (m) await flyttMappe(m, id || null, mapper) }}
        onAvbryt={() => { setMappeValgt(null); setMappeHandling(null) }}
      />
    </View>
  )
}

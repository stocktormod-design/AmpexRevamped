import { useEffect, useState } from 'react'
import { View, Text, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, ScanLine, CircleCheck } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Slider } from '../../../components/slider'
import { SectionHeader } from '../../../components/ui'
import { database } from '../../../lib/db'
import { syncQuietly } from '../../../lib/db/sync'
import { Room, overallProgress, type RoomProgress } from '../../../lib/db/models/room'
import { disciplines, disciplineLabel, type Discipline } from '../../../lib/db/models/drawing'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

export default function RomDetailScreen() {
  const insets = useSafeAreaInsets()
  const { roomId } = useLocalSearchParams<{ roomId: string }>()
  const [room, setRoom] = useState<Room | null>(null)

  useEffect(() => {
    if (!roomId) return
    const sub = database.get<Room>('rooms').findAndObserve(roomId).subscribe({
      next: setRoom, error: () => router.back(),
    })
    return () => sub.unsubscribe()
  }, [roomId])

  async function setProgress(discipline: Discipline, value: number) {
    if (!room) return
    const next: RoomProgress = { ...room.progressMap, [discipline]: value }
    await database.write(async () => { await room.update(r => { r.progress = JSON.stringify(next) }) })
    syncQuietly()
  }

  if (!room) return <View style={{ flex: 1, backgroundColor: colors.groupedBg }} />
  const prog = room.progressMap
  const overall = overallProgress(prog)

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: spacing.screen, marginBottom: spacing.lg }}>
          <Pressable onPress={() => router.back()} pressScale={0.92}
            style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <Text style={t.title1}>{room.name}</Text>
              <Text style={[t.footnote, { marginTop: spacing.xs }]}>{room.plan}</Text>
            </View>
            <Text style={[t.largeTitle, { color: colors.cta, fontVariant: ['tabular-nums'] }]}>{overall}%</Text>
          </View>
        </View>

        {/* Framdrift per fagfelt */}
        <SectionHeader>Framdrift per fagfelt</SectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginBottom: spacing.screen }}>
          {disciplines.map((d, i) => (
            <View key={d} style={[{ paddingVertical: spacing.md }, i < disciplines.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.separator }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                <Text style={t.bodyMedium}>{disciplineLabel[d]}</Text>
                <Text style={[t.bodyMedium, { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }]}>{prog[d] ?? 0}%</Text>
              </View>
              <Slider value={prog[d] ?? 0} onChange={v => setProgress(d, v)} />
            </View>
          ))}
        </View>

        {/* LiDAR-skann */}
        <SectionHeader>LiDAR-skann</SectionHeader>
        <View style={{ backgroundColor: colors.bg, borderRadius: radius.lg, marginHorizontal: spacing.screen, overflow: 'hidden' }}>
          <Pressable
            haptic="medium"
            onPress={() => { /* skann-flyt kommer — splat-pipeline */ }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 }}
          >
            <View style={{ width: sizes.iconChip - 8, height: sizes.iconChip - 8, borderRadius: radius.sm, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
              {room.scanPath
                ? <CircleCheck size={sizes.icon - 2} color={colors.label} strokeWidth={sizes.lucideStroke} />
                : <ScanLine size={sizes.icon - 2} color={colors.iconMuted} strokeWidth={sizes.lucideStroke} />}
            </View>
            <Text style={[t.body, { flex: 1 }]}>{room.scanPath ? 'Skann finnes' : 'Skann rommet'}</Text>
            <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>Kommer</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { Knapp, Kort, Merke, Tittel, lt, type Farge } from '../../../components/laeretid-ui'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { LaeretidLogg, LaeretidBelegg } from '../../../lib/db/models/laeretid'
import { useUserId } from '../../../lib/auth-user'

/**
 * LOGGENE MINE (2026-09-16).
 *
 * Livsløpet speiler fagbrev.io — kladd, sendt, godkjent, må rettes — fordi
 * loggen ender opp der uansett, og en lærling skal ikke lære to systemer.
 *
 * Raden viser antall mål, og det tallet er et VARSEL og ikke en prestasjon:
 * over åtte betyr som regel at tabellene bærer kryssene i stedet for teksten.
 * Se `varselForLogg()`.
 */

type Filter = 'alle' | 'kladd' | 'sendt' | 'maa_rettes'

const FILTERNAVN: Record<Filter, string> = {
  alle: 'Alle',
  kladd: 'Kladd',
  sendt: 'Sendt',
  maa_rettes: 'Må rettes',
}

const LOGGSTATUS: Record<LaeretidLogg['status'], { tekst: string; farge: Farge | 'graa' }> = {
  kladd: { tekst: 'Kladd', farge: 'graa' },
  sendt: { tekst: 'Sendt', farge: 'bla' },
  godkjent: { tekst: 'Godkjent', farge: 'gronn' },
  maa_rettes: { tekst: 'Må rettes', farge: 'oransje' },
}

function useLogger(brukerId: string | null) {
  const [logger, setLogger] = useState<LaeretidLogg[]>([])
  const [belegg, setBelegg] = useState<LaeretidBelegg[]>([])
  useEffect(() => {
    if (!brukerId) return
    const a = database.get<LaeretidLogg>('laeretid_logg')
      .query(Q.where('laerling_id', brukerId), Q.sortBy('arbeidsdato', Q.desc))
      .observe().subscribe(setLogger)
    const b = database.get<LaeretidBelegg>('laeretid_belegg')
      .query(Q.where('laerling_id', brukerId))
      .observe().subscribe(setBelegg)
    return () => { a.unsubscribe(); b.unsubscribe() }
  }, [brukerId])
  return { logger, belegg }
}

/** «6. september», ikke «2026-09-06». Ingen leser ISO. */
function norskDato(iso: string | null): string {
  if (!iso) return 'Uten dato'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' })
}

export default function Logger() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { logger, belegg } = useLogger(brukerId)
  const [filter, setFilter] = useState<Filter>('alle')

  const maalPerLogg = useMemo(() => {
    const m = new Map<string, Set<number>>()
    for (const b of belegg) {
      if (!m.has(b.loggId)) m.set(b.loggId, new Set())
      m.get(b.loggId)!.add(b.maalNr)
    }
    return m
  }, [belegg])

  const antall = useMemo(() => ({
    alle: logger.length,
    kladd: logger.filter(l => l.status === 'kladd').length,
    sendt: logger.filter(l => l.status === 'sendt').length,
    maa_rettes: logger.filter(l => l.status === 'maa_rettes').length,
  }), [logger])

  const synlige = filter === 'alle' ? logger : logger.filter(l => l.status === filter)

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: lt.hvit }}
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 130 }}
    >
      <Pressable
        haptic="light"
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6, marginBottom: 8 }}
      >
        <ChevronLeft size={22} color={lt.stille} strokeWidth={2.4} />
        <Text style={{ fontSize: 16, fontWeight: '600', color: lt.stille }}>Læretid</Text>
      </Pressable>

      <Tittel str={34}>Logger</Tittel>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
        {(Object.keys(FILTERNAVN) as Filter[]).filter(f => f === 'alle' || antall[f] > 0).map(f => {
          const valgt = filter === f
          return (
            <Pressable
              key={f}
              haptic="light"
              onPress={() => setFilter(f)}
              style={{
                paddingVertical: 7, paddingHorizontal: 14, borderRadius: 12,
                backgroundColor: valgt ? lt.blaLys : lt.hvit,
                borderWidth: 2, borderColor: valgt ? lt.bla : lt.kant, borderBottomWidth: 3,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: valgt ? lt.blaMork : lt.stille }}>
                {FILTERNAVN[f]} {antall[f]}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {synlige.length === 0 ? (
        <Kort style={{ marginTop: 18, alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: lt.tekst }}>Ingen logger ennå</Text>
          <Text style={{ fontSize: 14, color: lt.stille, textAlign: 'center' }}>
            Ta bilder mens du jobber, så lager assistenten loggen.
          </Text>
        </Kort>
      ) : (
        <View style={{ gap: 10, marginTop: 18 }}>
          {synlige.map(l => {
            const maal = maalPerLogg.get(l.id)?.size ?? 0
            return (
              <Kort key={l.id} onPress={() => router.push(`/(app)/laeretid/logg/${l.id}` as never)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: lt.tekst }} numberOfLines={1}>
                      {l.tittel?.trim() || 'Uten navn'}
                    </Text>
                    <Text style={{ fontSize: 13, color: lt.stille, marginTop: 2 }}>
                      {norskDato(l.arbeidsdato)}{maal > 0 ? ` · ${maal} mål` : ''}
                    </Text>
                  </View>
                  <Merke {...LOGGSTATUS[l.status]} />
                </View>
              </Kort>
            )
          })}
        </View>
      )}

      <Knapp tekst="Ny logg" style={{ marginTop: 20 }}
        ikon={<Plus size={20} color={lt.hvit} strokeWidth={3} />}
        onPress={() => router.push('/(app)/laeretid/logg/ny' as never)} />
    </ScrollView>
  )
}

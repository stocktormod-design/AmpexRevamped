import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView, ActivityIndicator } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, ChevronLeft, Star } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Tittel, lt } from '../../../components/laeretid-ui'
import { database } from '../../../lib/db'
import { LaeretidSporsmaal } from '../../../lib/db/models/laeretid'
import { useUserId } from '../../../lib/auth-user'
import { isoDag } from '../../../lib/laeretid/quiz'
import { lagTeori, tilSporsmaal } from '../../../lib/laeretid/quiz-klient'
import { NIVAANAVN, nesteTema, temaProfil, type Nivaa } from '../../../lib/laeretid/profil'
import { ENHETER, TEMAER, temaerI } from '../../../lib/laeretid/teori'

/**
 * TEORISTIEN — Duolingo-stien for faget (27.09.2026).
 *
 * Tormod: «teoretisk for resten: Ohms lov, overspenningsvern, karakteristikk»
 * og «UI burde være hjernedødt lett å skjønne seg på».
 *
 * Én ting å gjøre: trykk på en sirkel. Fargen sier hvor godt du kan det, og
 * sirkelen med «START» er den stien anbefaler nå (profil.ts: det du bommet på,
 * så det neste du ikke har prøvd). Alt er åpent — ingen låste nivåer, for en
 * lærling som skal ha om vern i morgen skal ikke måtte ta Ohms lov først.
 */

const FARGE: Record<Nivaa, [string, string]> = {
  0: [lt.kant, '#CFCFCF'],
  1: [lt.oransje, lt.oransjeMork],
  2: [lt.bla, lt.blaMork],
  3: [lt.gul, lt.gulMork],
}

const ENHETFARGE = [lt.gronn, lt.bla, lt.lilla, lt.oransje, lt.rod, lt.gronnMork]

// Sikksakk som Duolingo: forskyvning per plass i enheten.
const SVING = [0, 60, 90, 60, 0, -60, -90, -60]

export default function Teori() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const [rader, setRader] = useState<LaeretidSporsmaal[]>([])
  const [starter, setStarter] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    if (!brukerId) return
    const sub = database.get<LaeretidSporsmaal>('laeretid_sporsmaal')
      .query(Q.where('laerling_id', brukerId), Q.where('tema', Q.notEq(null))).observe()
      .subscribe(setRader)
    return () => sub.unsubscribe()
  }, [brukerId])

  const profil = useMemo(() => temaProfil(rader.map(tilSporsmaal), isoDag(new Date())), [rader])
  const neste = useMemo(() => nesteTema(TEMAER.map(t => t.id), profil), [profil])
  const sterke = [...profil.values()].filter(t => t.nivaa === 3).length

  async function start(temaId: string) {
    if (!brukerId || starter) return
    setStarter(temaId)
    setFeil(null)
    const ut = await lagTeori(brukerId, temaId)
    setStarter(null)
    if (!ut.ok) { setFeil(ut.grunn); return }
    router.push(`/(app)/laeretid/quiz?tema=${temaId}` as never)
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: lt.hvit }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 140 }}>
      <Pressable
        haptic="light"
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6, marginBottom: 8 }}
      >
        <ChevronLeft size={22} color={lt.stille} strokeWidth={2.4} />
        <Text style={{ fontSize: 16, fontWeight: '600', color: lt.stille }}>Læretid</Text>
      </Pressable>
      <Tittel>Teori</Tittel>
      <Text style={{ fontSize: 16, color: lt.stille, marginTop: 4 }}>
        Trykk på en sirkel. Tre korte spørsmål, tilpasset nivået ditt.
      </Text>
      <Text style={{ fontSize: 14, fontWeight: '700', color: lt.gulMork, marginTop: 8 }}>
        {sterke} av {TEMAER.length} temaer sitter
      </Text>
      {feil && <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '600', marginTop: 8 }}>{feil}</Text>}

      {ENHETER.map((enhet, ei) => (
        <View key={enhet} style={{ marginTop: 28 }}>
          <View style={{
            backgroundColor: ENHETFARGE[ei % ENHETFARGE.length], borderRadius: 16,
            paddingVertical: 14, paddingHorizontal: 18, borderBottomWidth: 4, borderBottomColor: 'rgba(0,0,0,0.15)',
          }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', letterSpacing: 1 }}>ENHET {ei + 1}</Text>
            <Text style={{ fontSize: 20, fontWeight: '700', color: lt.hvit }}>{enhet}</Text>
          </View>

          <View style={{ alignItems: 'center', gap: 18, marginTop: 22 }}>
            {temaerI(enhet).map((t, i) => {
              const niv = (profil.get(t.id)?.nivaa ?? 0) as Nivaa
              const [fyll, kant] = FARGE[niv]
              const erNeste = t.id === neste
              return (
                <View key={t.id} style={{ alignItems: 'center', transform: [{ translateX: SVING[i % SVING.length] }] }}>
                  {erNeste && (
                    <View style={{
                      backgroundColor: lt.hvit, borderWidth: 2, borderColor: lt.kant, borderRadius: 12,
                      paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8,
                    }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: lt.gronnMork, letterSpacing: 0.6 }}>START</Text>
                    </View>
                  )}
                  <Pressable
                    haptic="medium"
                    onPress={() => start(t.id)}
                    style={{
                      width: 76, height: 72, borderRadius: 38,
                      backgroundColor: erNeste && niv === 0 ? lt.gronn : fyll,
                      borderBottomWidth: 7, borderBottomColor: erNeste && niv === 0 ? lt.gronnMork : kant,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {starter === t.id
                      ? <ActivityIndicator color={lt.hvit} />
                      : niv === 3
                        ? <Star size={32} color={lt.hvit} fill={lt.hvit} strokeWidth={2} />
                        : niv >= 1
                          ? <Check size={32} color={lt.hvit} strokeWidth={3.4} />
                          : <Star size={30} color={erNeste ? lt.hvit : '#B5B5B5'} fill={erNeste ? lt.hvit : '#B5B5B5'} strokeWidth={2} />}
                  </Pressable>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: lt.tekst, marginTop: 6 }}>{t.navn}</Text>
                  {niv > 0 && <Text style={{ fontSize: 12, fontWeight: '600', color: kant }}>{NIVAANAVN[niv]}</Text>}
                </View>
              )
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

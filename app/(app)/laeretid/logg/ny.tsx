import { useEffect, useRef } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Text } from '../../../../components/text'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { lt } from '../../../../components/laeretid-ui'
import { database } from '../../../../lib/db'
import { LaeretidLogg } from '../../../../lib/db/models/laeretid'
import { useUserId } from '../../../../lib/auth-user'
import { MALER, STANDARD_MAL_ID } from '../../../../lib/laeretid/mal'
import { isoDag } from '../../../../lib/laeretid/quiz'

/**
 * NY LOGG — lager kladden og går rett til bildene (forenklet 27.09.2026).
 *
 * Ingen skjerm å fylle ut først. Malen er den han brukte sist (ellers
 * standardmalen), og kan byttes med én knapp på bildeskjermen — det er ikke
 * verdt et eget steg hver gang, når nesten alle bruker samme mal hver gang.
 *
 * Ruta er statisk («ny»), så den vinner over `[id]` i Expo Router.
 */
export default function NyLogg() {
  const brukerId = useUserId()
  const startet = useRef(false)

  useEffect(() => {
    if (!brukerId || startet.current) return
    startet.current = true
    let avbrutt = false
    ;(async () => {
      const forrige = await database.get<LaeretidLogg>('laeretid_logg')
        .query(Q.where('laerling_id', brukerId), Q.where('mal_id', Q.notEq(null)), Q.sortBy('created_at', Q.desc), Q.take(1))
        .fetch().catch(() => [])
      const malId = forrige[0]?.malId && MALER.some(m => m.id === forrige[0].malId) ? forrige[0].malId : STANDARD_MAL_ID
      const logg = await database.write(async () =>
        database.get<LaeretidLogg>('laeretid_logg').create(r => {
          r.laerlingId = brukerId
          r.status = 'kladd'
          r.arbeidsdato = isoDag(new Date()) // lokal dato — ikke UTC rett etter midnatt
          r.aiEndringerBrukt = 0
          r.malId = malId
        }),
      )
      if (avbrutt) return
      // `replace`: «tilbake» skal gå til forsida, ikke hit og lage en kladd til.
      router.replace(`/(app)/laeretid/logg/bilder?id=${logg.id}` as never)
    })()
    return () => { avbrutt = true }
  }, [brukerId])

  return (
    <View style={{ flex: 1, backgroundColor: lt.hvit, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator color={lt.svak} />
      <Text style={{ fontSize: 14, color: lt.stille }}>Lager ny logg …</Text>
    </View>
  )
}

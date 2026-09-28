import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { BookOpen, Check, ChevronLeft } from 'lucide-react-native'
import { Pressable } from '../../../../components/pressable'
import { Knapp, Kort, Seksjonstittel, Tittel, lt } from '../../../../components/laeretid-ui'
import { database } from '../../../../lib/db'
import { LaeretidBelegg, LaeretidLaerling } from '../../../../lib/db/models/laeretid'
import { useUserId } from '../../../../lib/auth-user'
import { finnMaal, type Laereplankode } from '../../../../lib/laeretid/laereplan'
import { dekningForMaal, raadForMaal, vurderBelegg, type Belegg } from '../../../../lib/laeretid/dekning'
import { TEMAER } from '../../../../lib/laeretid/teori'
import { lagTeori } from '../../../../lib/laeretid/quiz-klient'

/**
 * ETT KOMPETANSEMÅL — hva som teller, og hva du kan gjøre med resten
 * (forenklet 27.09.2026).
 *
 * Den ORDRETTE forskriftsteksten står øverst — det er den sensor holder ham
 * til. Under: hver del med én farge og én setning. Grønt teller, blått venter
 * på quizen, grått er ikke dekket. Nederst: teoritemaene som hører til målet,
 * så «ikke dekket» alltid har noe han kan gjøre med en gang.
 */

type DelStatus = { delId: string; navn: string; farge: string; tekst: string; holder: boolean }

export default function MaalDetalj() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { nr } = useLocalSearchParams<{ nr: string }>()
  const nummer = Number(nr)
  const gyldig = Number.isInteger(nummer) && nummer >= 1 && nummer <= 20
  const [rader, setRader] = useState<LaeretidBelegg[]>([])
  const [kode, setKode] = useState<Laereplankode>('ELE03-04')
  const [starter, setStarter] = useState<string | null>(null)
  const [feil, setFeil] = useState<string | null>(null)

  useEffect(() => {
    if (!brukerId || !gyldig) return
    const a = database.get<LaeretidBelegg>('laeretid_belegg')
      .query(Q.where('laerling_id', brukerId), Q.where('maal_nr', nummer)).observe().subscribe(setRader)
    const b = database.get<LaeretidLaerling>('laeretid_laerling')
      .query(Q.where('id', brukerId)).observe().subscribe(r => { if (r[0]) setKode(r[0].laereplanKode) })
    return () => { a.unsubscribe(); b.unsubscribe() }
  }, [brukerId, nummer, gyldig])

  const data = useMemo(() => {
    if (!gyldig) return null
    const maal = finnMaal(kode, nummer)
    const belegg: Belegg[] = rader.map(r => ({
      loggId: r.loggId, maalNr: r.maalNr, delId: r.delId, kilde: r.kilde,
      generert: r.generert, utfortSelv: r.utfortSelv, utspurt: r.utspurt,
    }))
    const dekning = dekningForMaal(maal, belegg)
    const deler: DelStatus[] = maal.deler.map(del => {
      const mine = belegg.filter(b => b.delId === del.id)
      const vurdert = mine.map(b => vurderBelegg(del, b))
      if (vurdert.some(v => v.holder)) {
        return { delId: del.id, navn: del.navn, farge: lt.gronn, tekst: 'Teller', holder: true }
      }
      if (vurdert.length) {
        return { delId: del.id, navn: del.navn, farge: lt.bla, tekst: vurdert[0].grunn, holder: false }
      }
      return { delId: del.id, navn: del.navn, farge: lt.kant, tekst: 'Ikke i noen logg ennå', holder: false }
    })
    return { maal, dekning, deler, raad: raadForMaal(maal, dekning, belegg) }
  }, [gyldig, kode, nummer, rader])

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: lt.hvit, padding: 20, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, color: lt.stille }}>Ukjent kompetansemål.</Text>
      </View>
    )
  }

  const temaer = TEMAER.filter(t => t.maalNr === nummer)
  async function ov(temaId: string) {
    if (!brukerId || starter) return
    setStarter(temaId)
    setFeil(null)
    const ut = await lagTeori(brukerId, temaId)
    setStarter(null)
    if (!ut.ok) { setFeil(ut.grunn); return }
    router.push(`/(app)/laeretid/quiz?tema=${temaId}` as never)
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: lt.hvit }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 130 }}>
      <Pressable
        haptic="light"
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6, marginBottom: 8 }}
      >
        <ChevronLeft size={22} color={lt.stille} strokeWidth={2.4} />
        <Text style={{ fontSize: 16, fontWeight: '600', color: lt.stille }}>Læretid</Text>
      </Pressable>

      <Tittel str={34}>{data.maal.etikett}</Tittel>
      <Text style={{ fontSize: 13, fontWeight: '700', color: lt.gronnMork, marginTop: 4 }}>
        {data.dekning.dekkede} av {data.dekning.totalt} deler teller
      </Text>
      {/* ORDRETT fra Udir. Skal aldri omskrives. */}
      <Text style={{ fontSize: 16, color: lt.stille, lineHeight: 23, marginTop: 12 }}>
        {data.maal.tekst.slice(0, 1).toUpperCase() + data.maal.tekst.slice(1)}
      </Text>

      <Seksjonstittel>Delene</Seksjonstittel>
      <View style={{ gap: 10 }}>
        {data.deler.map(d => (
          <Kort key={d.delId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={{
              width: 30, height: 30, borderRadius: 15, backgroundColor: d.farge,
              alignItems: 'center', justifyContent: 'center',
            }}>
              {d.holder && <Check size={17} color={lt.hvit} strokeWidth={3.4} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: lt.tekst }}>{d.navn}</Text>
              <Text style={{ fontSize: 13, color: lt.stille, marginTop: 1 }}>{d.tekst}</Text>
            </View>
          </Kort>
        ))}
      </View>

      {data.raad.slag !== 'ingen' && (
        <Kort farge="gul" style={{ marginTop: 14 }}>
          <Text style={{ fontSize: 15, color: lt.tekst, lineHeight: 21 }}>{data.raad.tekst}</Text>
        </Kort>
      )}

      {temaer.length > 0 && (
        <>
          <Seksjonstittel>Øv på dette</Seksjonstittel>
          <View style={{ gap: 10 }}>
            {temaer.map(t => (
              <Knapp key={t.id} tekst={t.navn} farge="bla" kontur venter={starter === t.id}
                ikon={<BookOpen size={18} color={lt.bla} strokeWidth={2.6} />} onPress={() => ov(t.id)} />
            ))}
          </View>
          {feil && <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '600', marginTop: 8 }}>{feil}</Text>}
        </>
      )}
    </ScrollView>
  )
}

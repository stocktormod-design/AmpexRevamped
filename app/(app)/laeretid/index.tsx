import { useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { BookOpen, ChevronLeft, Plus } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { Boble, Knapp, Kort, Merke, Seksjonstittel, Tittel, lt, norskDato, type Farge } from '../../../components/laeretid-ui'
import { database } from '../../../lib/db'
import { LaeretidBelegg, LaeretidLaerling, LaeretidLogg, LaeretidSporsmaal } from '../../../lib/db/models/laeretid'
import { useUserId } from '../../../lib/auth-user'
import { laereplan, type Laereplankode } from '../../../lib/laeretid/laereplan'
import { dekningForMaal, type Belegg, type Status } from '../../../lib/laeretid/dekning'
import { anbefaltDytt, isoDag, svakeTemaer } from '../../../lib/laeretid/quiz'
import { lagTeori, tilSporsmaal } from '../../../lib/laeretid/quiz-klient'
import { byggProfil, fokus, fordeling, nesteTema, temaProfil, type Nivaa } from '../../../lib/laeretid/profil'
import { TEMAER, finnTema } from '../../../lib/laeretid/teori'

/**
 * LÆRETID — forsida (omgjort 27.09.2026).
 *
 * Tormod: «Jeg vil heller ikke at det skal stå kompetansemål først. Det kan stå
 * hvor mange logger osv.» Rekkefølgen er derfor det han gjør, ikke det han
 * måles på: loggene og øvingen øverst, en stor knapp for ny logg, de siste
 * loggene, og kompetansemålene nederst som et kart han kan trykke seg inn i.
 *
 * Alt leses lokalt (regel 2). Skjermen regner ingenting selv — reglene står i
 * lib/laeretid/ og er selvtestet.
 */

const STATUSFARGE: Record<Status, string> = {
  holder: lt.gronn,
  dekket: lt.bla,
  tynt: lt.gul,
  kritisk: lt.oransje,
  tomt: lt.kant,
}

const LOGGSTATUS: Record<LaeretidLogg['status'], { tekst: string; farge: Farge | 'graa' }> = {
  kladd: { tekst: 'Kladd', farge: 'graa' },
  sendt: { tekst: 'Sendt', farge: 'bla' },
  godkjent: { tekst: 'Godkjent', farge: 'gronn' },
  maa_rettes: { tekst: 'Må rettes', farge: 'oransje' },
}

function useLaeretid(brukerId: string | null) {
  const [logger, setLogger] = useState<LaeretidLogg[]>([])
  const [belegg, setBelegg] = useState<Belegg[]>([])
  const [sporsmaal, setSporsmaal] = useState<LaeretidSporsmaal[]>([])
  const [kode, setKode] = useState<Laereplankode>('ELE03-04')

  useEffect(() => {
    if (!brukerId) return
    const subs = [
      database.get<LaeretidLogg>('laeretid_logg')
        .query(Q.where('laerling_id', brukerId), Q.sortBy('updated_at', Q.desc)).observe().subscribe(setLogger),
      database.get<LaeretidBelegg>('laeretid_belegg')
        .query(Q.where('laerling_id', brukerId)).observe()
        .subscribe(r => setBelegg(r.map(b => ({
          loggId: b.loggId, maalNr: b.maalNr, delId: b.delId, kilde: b.kilde,
          generert: b.generert, utfortSelv: b.utfortSelv, utspurt: b.utspurt,
        })))),
      database.get<LaeretidSporsmaal>('laeretid_sporsmaal')
        .query(Q.where('laerling_id', brukerId)).observe().subscribe(setSporsmaal),
      database.get<LaeretidLaerling>('laeretid_laerling')
        .query(Q.where('id', brukerId)).observe()
        .subscribe(r => { if (r[0]) setKode(r[0].laereplanKode) }),
    ]
    return () => subs.forEach(s => s.unsubscribe())
  }, [brukerId])

  return useMemo(() => {
    const alle = sporsmaal.map(tilSporsmaal)
    const maal = laereplan(kode).maal.map(m => ({ maal: m, dekning: dekningForMaal(m, belegg) }))
    const profil = byggProfil(alle, belegg.map(b => ({ loggId: b.loggId, maalNr: b.maalNr, delId: b.delId, utfortSelv: b.utfortSelv })), isoDag(new Date()))
    const tp = temaProfil(alle, isoDag(new Date()))
    const temaFordeling: Record<Nivaa, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
    for (const t of tp.values()) temaFordeling[t.nivaa]++
    return {
      kode,
      profil,
      temaFordeling,
      temaSterke: temaFordeling[3],
      nesteTema: nesteTema(TEMAER.map(t => t.id), tp),
      aapneJobb: alle.filter(s => s.besvart === null && !s.tema).length,
      fordeling: fordeling(profil),
      fokus: fokus(profil, 3),
      logger,
      antallLogger: logger.length,
      innsendt: logger.filter(l => l.status === 'sendt' || l.status === 'godkjent').length,
      besvart: alle.filter(s => s.besvart !== null).length,
      aapne: alle.filter(s => s.besvart === null).length,
      dytt: anbefaltDytt(alle, isoDag(new Date())),
      svake: svakeTemaer(alle).length,
      maal,
      holder: maal.filter(m => m.dekning.status === 'holder').length,
    }
  }, [logger, belegg, sporsmaal, kode])
}

const NIVAAFARGE: Record<Nivaa, string> = { 0: lt.kant, 1: lt.oransje, 2: lt.bla, 3: lt.gronn }

export default function Laeretid() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const d = useLaeretid(brukerId)
  const [lagerOving, setLagerOving] = useState(false)
  const [ovingFeil, setOvingFeil] = useState<string | null>(null)
  async function ovTema(temaId: string) {
    if (!brukerId || lagerOving) return
    setLagerOving(true)
    setOvingFeil(null)
    const ut = await lagTeori(brukerId, temaId)
    setLagerOving(false)
    if (!ut.ok) { setOvingFeil(ut.grunn); return }
    router.push(`/(app)/laeretid/quiz?tema=${temaId}` as never)
  }

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
        <Text style={{ fontSize: 16, fontWeight: '600', color: lt.stille }}>Meg</Text>
      </Pressable>
      <Tittel str={34}>Læretid</Tittel>

      {/* ── Øving først: det er der han lærer. Én knapp. ──────────────────── */}
      <Kort farge="bla" style={{ marginTop: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Boble farge="bla"><BookOpen size={22} color={lt.hvit} strokeWidth={2.6} /></Boble>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, fontWeight: '700', color: lt.tekst }}>Øv til fagprøven</Text>
            <Text style={{ fontSize: 14, color: lt.stille, marginTop: 2 }}>
              {d.temaSterke} av {TEMAER.length} teoritemaer sitter
            </Text>
          </View>
        </View>

        {/* Framgang i teorien: fargene er de samme som på stien. */}
        <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: lt.kant, gap: 2 }}>
          {([3, 2, 1] as Nivaa[]).filter(n => d.temaFordeling[n] > 0).map(n => (
            <View key={n} style={{ flex: d.temaFordeling[n], backgroundColor: NIVAAFARGE[n] }} />
          ))}
          {TEMAER.length - d.temaFordeling[1] - d.temaFordeling[2] - d.temaFordeling[3] > 0 && (
            <View style={{ flex: TEMAER.length - d.temaFordeling[1] - d.temaFordeling[2] - d.temaFordeling[3] }} />
          )}
        </View>

        {/* ÉN knapp. Spørsmål om jobbene først — de avgjør kryssene. Ellers teori. */}
        {d.aapneJobb > 0 ? (
          <Knapp tekst={`Quiz om jobben · ${d.aapneJobb}`} farge="bla"
            onPress={() => router.push('/(app)/laeretid/quiz' as never)} />
        ) : d.nesteTema ? (
          <Knapp tekst={`Øv: ${finnTema(d.nesteTema)?.navn ?? ''}`} farge="bla"
            venter={lagerOving} onPress={() => ovTema(d.nesteTema!)} />
        ) : null}
        <Pressable haptic="light" onPress={() => router.push('/(app)/laeretid/teori' as never)} style={{ alignSelf: 'center', paddingVertical: 4 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: lt.blaMork }}>Se alle teoritemaene</Text>
        </Pressable>
        {ovingFeil && <Text style={{ fontSize: 13, color: lt.rodMork, fontWeight: '600' }}>{ovingFeil}</Text>}
      </Kort>

      <Knapp
        tekst="Ny logg"
        style={{ marginTop: 16 }}
        ikon={<Plus size={20} color={lt.hvit} strokeWidth={3} />}
        onPress={() => router.push('/(app)/laeretid/logg/ny' as never)}
      />

      {/* De siste loggene. */}
      {d.logger.length > 0 && (
        <>
          <Seksjonstittel>Siste logger</Seksjonstittel>
          <Text style={{ fontSize: 14, color: lt.stille, marginTop: -6, marginBottom: 10 }}>
            {d.antallLogger} {d.antallLogger === 1 ? 'logg' : 'logger'} · {d.innsendt} sendt inn · {d.besvart} spørsmål øvd
          </Text>
          <View style={{ gap: 10 }}>
            {d.logger.slice(0, 3).map(l => (
              <Kort key={l.id} onPress={() => router.push(`/(app)/laeretid/logg/${l.id}` as never)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: lt.tekst }} numberOfLines={1}>
                      {l.tittel?.trim() || 'Uten navn'}
                    </Text>
                    <Text style={{ fontSize: 13, color: lt.stille, marginTop: 2 }}>{norskDato(l.arbeidsdato)}</Text>
                  </View>
                  <Merke {...LOGGSTATUS[l.status]} />
                </View>
              </Kort>
            ))}
          </View>
          {d.logger.length > 3 && (
            <Knapp tekst="Alle loggene" kontur farge="bla" style={{ marginTop: 12 }}
              onPress={() => router.push('/(app)/laeretid/logger' as never)} />
          )}
        </>
      )}

      {/* Kompetansemålene, nederst: et kart han kan trykke seg inn i. */}
      <Seksjonstittel>Kompetansemål</Seksjonstittel>
      <Kort style={{ gap: 14 }}>
        <Text style={{ fontSize: 15, color: lt.stille }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: lt.tekst }}>{d.holder} av {d.maal.length}</Text> holder
        </Text>
        {/* Fire rader à fem: 1.1–1.5, 1.6–1.10 … Samme rekkefølge som læreplanen. */}
        <View style={{ gap: 12 }}>
          {[0, 5, 10, 15].map(start => (
            <View key={start} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {d.maal.slice(start, start + 5).map(({ maal, dekning }) => (
                <Pressable
                  key={maal.nr}
                  haptic="light"
                  onPress={() => router.push(`/(app)/laeretid/maal/${maal.nr}` as never)}
                  style={{
                    width: 52, height: 52, borderRadius: 26,
                    backgroundColor: STATUSFARGE[dekning.status],
                    borderBottomWidth: 3, borderBottomColor: 'rgba(0,0,0,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: dekning.status === 'tomt' ? lt.stille : lt.hvit }}>
                    {maal.etikett}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {([['holder', 'Holder'], ['dekket', 'Dekket'], ['tynt', 'Tynt'], ['kritisk', 'Kritisk'], ['tomt', 'Tomt']] as [Status, string][]).map(([s, navn]) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: STATUSFARGE[s] }} />
              <Text style={{ fontSize: 12, color: lt.stille, fontWeight: '600' }}>{navn}</Text>
            </View>
          ))}
        </View>
      </Kort>
    </ScrollView>
  )
}

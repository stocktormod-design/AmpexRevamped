import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView, Image, KeyboardAvoidingView, Platform } from 'react-native'
import { Text, TextInput } from '../../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Camera, Clock, Images, Repeat, X } from 'lucide-react-native'
import { Pressable } from '../../../../components/pressable'
import { Knapp, Tittel, lt } from '../../../../components/laeretid-ui'
import { database } from '../../../../lib/db'
import { LaeretidBilde, LaeretidLogg } from '../../../../lib/db/models/laeretid'
import { useUserId } from '../../../../lib/auth-user'
import { bildeUri, fjernBilde, hentBilder, lastOppVentende, taBilde } from '../../../../lib/laeretid/bilder'
import { MALER, finnMal } from '../../../../lib/laeretid/mal'

/**
 * DAGEN I BILDER — første steg i en ny logg (27.09.2026).
 *
 * Tormod: «når jeg trykker ny logg, så syns jeg det skal være en bilde taker
 * mode … så kan du skrive kort under det bilde du nettopp tok. Da blir det
 * lettere enn å huske back in time. Blir lettere for AI fordi da får den tids
 * metadata + en beskrivelse.» Og: «det må funke selv om du har tatt bildene
 * utenfor.»
 *
 * Derfor to veier inn, likestilt: ta bilde nå, eller hent de du har. Det
 * nyeste bildet står øverst med tastaturet klart, for én setning skrives best
 * i det øyeblikket bildet tas. Tomt notat stopper ingenting — boten spør om
 * det senere: «du tok dette 14:20, hva var det?»
 */

function klokke(d: Date | null): string | null {
  return d ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : null
}

function dag(d: Date | null): string | null {
  return d ? d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }) : null
}

function Miniatyr({ bilde }: { bilde: LaeretidBilde }) {
  const [uri, setUri] = useState<string | null>(null)
  useEffect(() => {
    let aktiv = true
    bildeUri(bilde).then(u => { if (aktiv) setUri(u) })
    return () => { aktiv = false }
  }, [bilde.id, bilde.r2Nokkel]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: 88, height: 88, borderRadius: 14, overflow: 'hidden', backgroundColor: lt.flate }}>
      {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
    </View>
  )
}

export default function Bilder() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { id } = useLocalSearchParams<{ id: string }>()
  const loggId = String(id)

  const [logg, setLogg] = useState<LaeretidLogg | null>(null)
  const [bilder, setBilder] = useState<LaeretidBilde[]>([])
  const [venter, setVenter] = useState<'kamera' | 'rull' | null>(null)
  const [nyeste, setNyeste] = useState<string | null>(null)

  useEffect(() => {
    const a = database.get<LaeretidLogg>('laeretid_logg').query(Q.where('id', loggId)).observe()
      .subscribe(r => setLogg(r[0] ?? null))
    const b = database.get<LaeretidBilde>('laeretid_bilde').query(Q.where('logg_id', loggId)).observe()
      .subscribe(setBilder)
    return () => { a.unsubscribe(); b.unsubscribe() }
  }, [loggId])

  // Det som ikke kom fram sist, prøves når skjermen får fokus.
  useFocusEffect(useCallback(() => { void lastOppVentende(loggId) }, [loggId]))

  // Dagens rekkefølge: når bildet ble tatt. Et bilde tatt nå havner nederst,
  // og skjermen ruller dit med tastaturet klart. Uten tid: der han valgte det.
  const sortert = useMemo(() => [...bilder].sort((a, b) => {
    if (a.tattAt && b.tattAt) return a.tattAt.getTime() - b.tattAt.getTime()
    if (a.tattAt) return -1
    if (b.tattAt) return 1
    return a.rekkefolge - b.rekkefolge
  }), [bilder])
  const rulle = useRef<ScrollView>(null)
  useEffect(() => {
    if (!nyeste) return
    const t = setTimeout(() => rulle.current?.scrollToEnd({ animated: true }), 150)
    return () => clearTimeout(t)
  }, [nyeste, bilder.length])
  const utenNotat = bilder.filter(b => !b.notat?.trim()).length

  async function kamera() {
    if (!logg || !brukerId || venter) return
    setVenter('kamera')
    const b = await taBilde(logg, brukerId)
    setVenter(null)
    if (b) setNyeste(b.id)
  }

  async function rull() {
    if (!logg || !brukerId || venter) return
    setVenter('rull')
    const nye = await hentBilder(logg, brukerId)
    setVenter(null)
    if (nye.length) setNyeste(nye[nye.length - 1].id)
  }

  // Notatet skrives rett til raden, ordrett. Egen tilstand per felt så
  // markøren ikke hopper når raden oppdateres.
  const utkast = useRef<Record<string, string>>({})
  const skrivNotat = (b: LaeretidBilde, tekst: string) => {
    utkast.current[b.id] = tekst
    void database.write(async () => { await b.update(r => { r.notat = tekst }) })
  }

  // Bildene er første steg; samtalen er neste. Har loggen alt blitt skrevet
  // (han kom hit via «Flere bilder»), går han tilbake til loggen i stedet.
  const ferdig = () => router.replace((logg?.utfylling
    ? `/(app)/laeretid/logg/${loggId}`
    : `/(app)/laeretid/logg/samtale?id=${loggId}`) as never)

  // Malen: én knapp, siste brukte er valgt fra før. Trykk for å bytte.
  const mal = finnMal(logg?.malId)
  const byttMal = () => {
    if (!logg || logg.utfylling) return
    const i = MALER.findIndex(m => m.id === mal.id)
    const neste = MALER[(i + 1) % MALER.length]
    void database.write(async () => { await logg.update(l => { l.malId = neste.id }) })
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: lt.hvit }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 8 }}>
        <Pressable haptic="light" onPress={ferdig} style={{ padding: 4, marginLeft: -4 }}>
          <X size={26} color={lt.svak} strokeWidth={2.8} />
        </Pressable>
      </View>

      <ScrollView
        ref={rulle}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <Tittel>Dagen i bilder</Tittel>
        {!logg?.utfylling && (
          <Pressable haptic="light" onPress={byttMal} style={{
            alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: lt.blaLys, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
          }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: lt.blaMork }}>Mal: {mal.navn}</Text>
            {MALER.length > 1 && <Repeat size={13} color={lt.blaMork} strokeWidth={2.8} />}
          </Pressable>
        )}
        <Text style={{ fontSize: 16, color: lt.stille, lineHeight: 22 }}>
          Ta bildene du ellers ville tatt, og skriv én setning under hvert med en gang.
          Har du alt tatt dem, henter du dem inn — tiden følger med.
        </Text>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <Pressable
            haptic="medium"
            onPress={kamera}
            disabled={!!venter}
            style={{
              flex: 1, aspectRatio: 1.1, borderRadius: 20, backgroundColor: lt.gronn,
              borderBottomWidth: 5, borderBottomColor: lt.gronnMork,
              alignItems: 'center', justifyContent: 'center', gap: 8, opacity: venter === 'rull' ? 0.5 : 1,
            }}
          >
            <Camera size={40} color={lt.hvit} strokeWidth={2.4} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: lt.hvit, letterSpacing: 0.6, textTransform: 'uppercase' }}>
              {venter === 'kamera' ? 'Vent …' : 'Ta bilde'}
            </Text>
          </Pressable>
          <Pressable
            haptic="medium"
            onPress={rull}
            disabled={!!venter}
            style={{
              flex: 1, aspectRatio: 1.1, borderRadius: 20, backgroundColor: lt.hvit,
              borderWidth: 2, borderColor: lt.kant, borderBottomWidth: 5,
              alignItems: 'center', justifyContent: 'center', gap: 8, opacity: venter === 'kamera' ? 0.5 : 1,
            }}
          >
            <Images size={38} color={lt.bla} strokeWidth={2.4} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: lt.bla, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>
              {venter === 'rull' ? 'Vent …' : 'Hent bilder'}
            </Text>
          </Pressable>
        </View>

        {bilder.length > 0 && (
          <Text style={{ fontSize: 14, fontWeight: '700', color: lt.stille, marginTop: 8 }}>
            {bilder.length} {bilder.length === 1 ? 'bilde' : 'bilder'}
            {utenNotat > 0 ? ` · ${utenNotat} uten notat` : ' · alle har notat'}
          </Text>
        )}

        {sortert.map(b => {
          const tid = klokke(b.tattAt)
          const utenTekst = !b.notat?.trim()
          return (
            <View key={b.id} style={{
              flexDirection: 'row', gap: 12, padding: 12, borderRadius: 18,
              borderWidth: 2, borderBottomWidth: 4,
              borderColor: utenTekst ? lt.oransje : lt.kant,
              backgroundColor: utenTekst ? lt.oransjeLys : lt.hvit,
            }}>
              <Miniatyr bilde={b} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} color={tid ? lt.blaMork : lt.svak} strokeWidth={2.6} />
                  <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: tid ? lt.blaMork : lt.svak }}>
                    {tid ? `${dag(b.tattAt)} · ${tid}` : 'Uten tid'}
                  </Text>
                  <Pressable haptic="light" onPress={() => fjernBilde(b)} style={{ padding: 2 }}>
                    <X size={18} color={lt.svak} strokeWidth={2.6} />
                  </Pressable>
                </View>
                <TextInput
                  defaultValue={b.notat ?? ''}
                  onChangeText={t => skrivNotat(b, t)}
                  placeholder="Hva er dette? Én setning."
                  placeholderTextColor={lt.svak}
                  autoFocus={b.id === nyeste}
                  autoCorrect={false}
                  multiline
                  style={{
                    fontSize: 15, lineHeight: 20, color: lt.tekst, minHeight: 44,
                    backgroundColor: lt.hvit, borderRadius: 12, borderWidth: 2, borderColor: lt.kant,
                    paddingHorizontal: 10, paddingVertical: 8, textAlignVertical: 'top',
                  }}
                />
              </View>
            </View>
          )
        })}
      </ScrollView>

      <View style={{ padding: 18, paddingBottom: insets.bottom + 12, borderTopWidth: 2, borderTopColor: lt.kant }}>
        <Knapp
          tekst={logg?.utfylling ? 'Ferdig' : bilder.length ? 'Neste' : 'Hopp over bildene'}
          kontur={bilder.length === 0}
          farge={bilder.length ? 'gronn' : 'bla'}
          onPress={ferdig}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

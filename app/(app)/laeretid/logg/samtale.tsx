import { useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { Text, TextInput } from '../../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { ArrowUp, BookOpen, Sparkles, X } from 'lucide-react-native'
import { Pressable } from '../../../../components/pressable'
import { database } from '../../../../lib/db'
import {
  LaeretidBilde, LaeretidLaerling, LaeretidLogg, LaeretidMelding,
} from '../../../../lib/db/models/laeretid'
import { useUserId } from '../../../../lib/auth-user'
import type { Laereplankode } from '../../../../lib/laeretid/laereplan'
import { gjennomgang, nekHenvisning } from '../../../../lib/laeretid/samtale'
import { nesteReplikk, skrivLogg, tilMelding } from '../../../../lib/laeretid/samtale-klient'
import { Boble, Fremdrift, Knapp, lt } from '../../../../components/laeretid-ui'
import { finnMal } from '../../../../lib/laeretid/mal'

/**
 * OM DAGEN DIN — samtalen som skriver loggen (2026-09-27).
 *
 * Lærlingen skriver ikke loggen. Han forteller, boten spør, og loggen skrives
 * av det han sa. Kun tekst — ingen tale: diktering bommer på dialekt, og en
 * forvansket transkripsjon er verre enn ingen (docs/LAERLING.md).
 *
 * Rekkverket ligger i `lib/laeretid/samtale.ts`: hva som MÅ spørres om er
 * bestemt av reglene, boten sier aldri hva NEK krever — bare hvor det står —
 * og samtalen går ikke i ring. Denne skjermen viser bare fram.
 *
 * Samtalen er hans alene. Ingen faglig leder eller koordinator ser den.
 */
export default function Samtale() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { id } = useLocalSearchParams<{ id: string }>()
  const loggId = String(id)

  const [logg, setLogg] = useState<LaeretidLogg | null>(null)
  const [rader, setRader] = useState<LaeretidMelding[]>([])
  const [bilder, setBilder] = useState<LaeretidBilde[]>([])
  const [kode, setKode] = useState<Laereplankode>('ELE03-04')
  const [lastet, setLastet] = useState(false)

  useEffect(() => {
    if (!brukerId) return
    const a = database.get<LaeretidLogg>('laeretid_logg').query(Q.where('id', loggId)).observe()
      .subscribe(r => setLogg(r[0] ?? null))
    const b = database.get<LaeretidMelding>('laeretid_melding')
      .query(Q.where('logg_id', loggId), Q.sortBy('created_at', Q.asc)).observe()
      .subscribe(r => { setRader(r); setLastet(true) })
    const c = database.get<LaeretidBilde>('laeretid_bilde').query(Q.where('logg_id', loggId)).observe()
      .subscribe(setBilder)
    const d = database.get<LaeretidLaerling>('laeretid_laerling').query(Q.where('id', brukerId)).observe()
      .subscribe(r => { if (r[0]) setKode(r[0].laereplanKode) })
    return () => { a.unsubscribe(); b.unsubscribe(); c.unsubscribe(); d.unsubscribe() }
  }, [loggId, brukerId])

  const status = useMemo(() => gjennomgang({
    instruks: logg?.instruks ?? null,
    notater: bilder.map(b => b.notat?.trim() ?? '').filter(Boolean),
    bilderUtenNotat: bilder.filter(b => !b.notat?.trim()).length,
    malKrav: finnMal(logg?.malId).sporOm,
  }, rader.map(tilMelding)), [logg, bilder, rader])

  const [tekst, setTekst] = useState('')
  const [venter, setVenter] = useState(false)
  const [skriver, setSkriver] = useState(false)
  const [feil, setFeil] = useState<string | null>(null)

  async function runde(svar: string | null) {
    if (!logg || !brukerId || venter) return
    setVenter(true)
    setFeil(null)
    const ut = await nesteReplikk(logg, brukerId, svar)
    setVenter(false)
    if (!ut.ok) setFeil(ut.grunn)
  }

  // Boten åpner samtalen. Ligger det et ubesvart svar fra forrige gang (nettet
  // ryk), leses det nå.
  const aapnet = useRef(false)
  useEffect(() => {
    if (!lastet || !logg || aapnet.current) return
    aapnet.current = true
    const siste = rader[rader.length - 1]
    // Tre grunner til at boten tar ordet: samtalen er ny, svaret hans ble ikke
    // lest (nettet ryk), eller det står igjen noe annet enn det boten sist spurte
    // om — f.eks. når malen har fått et nytt punkt siden sist.
    const ulest = siste?.rolle === 'laerling' && siste.dekker === null
    const utdatert = siste?.rolle === 'bot' && !status.ferdig && (siste.dekker ?? '') !== (status.neste ?? '')
    if (!siste || ulest || utdatert) runde(null)
  }, [lastet, logg, bilder.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const rulle = useRef<ScrollView>(null)
  useEffect(() => {
    const t = setTimeout(() => rulle.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(t)
  }, [rader.length, venter, feil])

  async function skriv() {
    if (!logg || !brukerId || skriver) return
    setSkriver(true)
    setFeil(null)
    const ut = await skrivLogg(logg, brukerId, kode)
    setSkriver(false)
    if (!ut.ok) { setFeil(ut.grunn); return }
    // Rett til den ferdige loggen, uansett hvor han kom fra.
    router.replace(`/(app)/laeretid/logg/${loggId}` as never)
  }

  const send = () => {
    const s = tekst.trim()
    if (!s) return
    setTekst('')
    runde(s)
  }

  const harTekst = !!logg?.innhold?.trim()
  const erKladd = logg?.status === 'kladd'

  const totalt = status.besvart.length + status.igjen.length
  const andel = totalt ? status.besvart.length / totalt : 0

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: lt.hvit }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Topp: lukk + fremdrift gjennom avhørslista. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable haptic="light" onPress={() => router.replace(`/(app)/laeretid/logg/${loggId}` as never)} style={{ padding: 4, marginLeft: -4 }}>
          <X size={26} color={lt.svak} strokeWidth={2.8} />
        </Pressable>
        <View style={{ flex: 1 }}><Fremdrift andel={andel} /></View>
      </View>

      <ScrollView
        ref={rulle}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: lt.svak, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
          Bare du ser denne samtalen
        </Text>
        {rader.map(r => {
          if (r.rolle === 'laerling') {
            return (
              <View key={r.id} style={{
                alignSelf: 'flex-end', maxWidth: '82%',
                backgroundColor: lt.bla, borderRadius: 18, borderBottomRightRadius: 6,
                borderBottomWidth: 3, borderBottomColor: lt.blaMork,
                paddingVertical: 10, paddingHorizontal: 14,
              }}>
                <Text style={{ fontSize: 16, lineHeight: 22, color: lt.hvit, fontWeight: '500' }}>{r.tekst}</Text>
              </View>
            )
          }
          const h = nekHenvisning(r.nek)
          return (
            <View key={r.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end', maxWidth: '90%' }}>
              <Boble farge="gronn" str={34}><Sparkles size={16} color={lt.hvit} strokeWidth={2.6} /></Boble>
              <View style={{ flex: 1, gap: 8 }}>
                <View style={{
                  backgroundColor: lt.hvit, borderRadius: 18, borderBottomLeftRadius: 6,
                  borderWidth: 2, borderColor: lt.kant, borderBottomWidth: 4,
                  paddingVertical: 10, paddingHorizontal: 14,
                }}>
                  <Text style={{ fontSize: 16, lineHeight: 22, color: lt.tekst }}>{r.tekst}</Text>
                </View>
                {/* Hvor det står, aldri hva. Slå opp selv. */}
                {h && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
                    backgroundColor: lt.lillaLys, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
                  }}>
                    <BookOpen size={15} color={lt.lillaMork} strokeWidth={2.6} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: lt.lillaMork }}>{h.linje}</Text>
                  </View>
                )}
              </View>
            </View>
          )
        })}
        {venter && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Boble farge="gronn" str={34}><Sparkles size={16} color={lt.hvit} strokeWidth={2.6} /></Boble>
            <View style={{ backgroundColor: lt.flate, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16 }}>
              <ActivityIndicator color={lt.svak} />
            </View>
          </View>
        )}
        {feil && (
          <View style={{ backgroundColor: lt.rodLys, borderRadius: 14, padding: 12, gap: 6 }}>
            <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '600' }}>{feil}</Text>
            {!skriver && (
              <Pressable haptic="light" onPress={() => runde(null)}>
                <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '700' }}>PRØV IGJEN</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* Når avhørslista er gjennomgått, er loggen den ene handlingen. */}
      {status.ferdig && erKladd && rader.length > 0 && (
        <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <Knapp
            tekst={skriver ? 'Fyller ut malen …' : harTekst ? 'Skriv loggen på nytt' : 'Skriv loggen'}
            venter={skriver}
            disabled={venter}
            onPress={skriv}
          />
        </View>
      )}

      {erKladd && (
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 10,
          borderTopWidth: 2, borderTopColor: lt.kant,
          paddingHorizontal: 18, paddingTop: 10,
          paddingBottom: insets.bottom + 10,
        }}>
          <TextInput
            value={tekst}
            onChangeText={setTekst}
            placeholder="Skriv svaret ditt"
            // Fagord er ikke i ordboka: autokorrektur gjorde «varerør» til «varmerør»
            // og «avmantler» til «semantiker» (27.09.2026). Feil ord blir feil fakta i loggen.
            autoCorrect={false}
            placeholderTextColor={lt.svak}
            multiline
            editable={!skriver}
            style={{
              flex: 1, maxHeight: 140, fontSize: 16, lineHeight: 22, color: lt.tekst,
              backgroundColor: lt.flate, borderRadius: 16, borderWidth: 2, borderColor: lt.kant,
              paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top',
            }}
          />
          <Pressable
            haptic="light"
            disabled={!tekst.trim() || venter || skriver}
            onPress={send}
            style={{
              width: 46, height: 46, borderRadius: 14,
              backgroundColor: tekst.trim() && !venter ? lt.gronn : lt.kant,
              borderBottomWidth: 4, borderBottomColor: tekst.trim() && !venter ? lt.gronnMork : lt.svak,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <ArrowUp size={22} color={lt.hvit} strokeWidth={3} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

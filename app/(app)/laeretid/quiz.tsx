import { useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { Text, TextInput } from '../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { Check, Repeat, X } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { database } from '../../../lib/db'
import { LaeretidLaerling, LaeretidLogg, LaeretidSporsmaal } from '../../../lib/db/models/laeretid'
import { useUserId } from '../../../lib/auth-user'
import { finnMaal, type Laereplankode } from '../../../lib/laeretid/laereplan'
import {
  DAGER_TIL_REPETISJON, DAGER_TIL_RUNDE_2,
  etterprovLinje, forTidlig, isoDag, repetisjonerAaLage,
} from '../../../lib/laeretid/quiz'
import {
  lagRepetisjon, lagRunde2, lagTeori, tilSporsmaal, vurderSvar, type Dom,
} from '../../../lib/laeretid/quiz-klient'
import { Boble, Fremdrift, Knapp, Merke, Tittel, lt } from '../../../components/laeretid-ui'
import { TEMAER, finnTema } from '../../../lib/laeretid/teori'
import { nesteTema, temaProfil } from '../../../lib/laeretid/profil'

/**
 * ØVING TIL FAGPRØVEN — det «duolingoaktige» (2026-09-27).
 *
 * Ett spørsmål om gangen, besvart med én eller to setninger, og svaret kommer
 * med én gang. Det er det vi tar fra Duolingo: korte økter, spredt over tid,
 * rettet mot det som er svakt. Det vi IKKE tar: streaks, poeng, ligaer og
 * barnete tone. Framgangen som vises er prikker for denne økta, ikke en score.
 *
 * Innrammingen er bevisst: dette er ikke lekser, det er generalprøven på den
 * muntlige delen, der sensor spør om nøyaktig dette arbeidet.
 *
 * Takten er en anbefaling, ikke en sperre. Et runde 2-spørsmål som ikke er
 * modent ennå kan tas likevel — skjermen sier bare hva som går tapt.
 *
 * Svarene er hans alene (RLS: `laerling_id = auth.uid()`, uten unntak).
 */

type Rad = LaeretidSporsmaal

export default function Quiz() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { logg: loggParam, tema: temaParam } = useLocalSearchParams<{ logg?: string; tema?: string }>()
  const loggId = loggParam ? String(loggParam) : null
  // Teoriøkt: bare spørsmålene i dette temaet.
  const temaId = temaParam ? String(temaParam) : null

  const [rader, setRader] = useState<Rad[]>([])
  const [lastet, setLastet] = useState(false)
  const [kode, setKode] = useState<Laereplankode>('ELE03-04')
  const [titler, setTitler] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!brukerId) return
    const a = database.get<LaeretidSporsmaal>('laeretid_sporsmaal')
      .query(Q.where('laerling_id', brukerId)).observe()
      .subscribe(r => { setRader(r); setLastet(true) })
    const b = database.get<LaeretidLaerling>('laeretid_laerling')
      .query(Q.where('id', brukerId)).observe()
      .subscribe(r => { if (r[0]) setKode(r[0].laereplanKode) })
    const c = database.get<LaeretidLogg>('laeretid_logg')
      .query(Q.where('laerling_id', brukerId)).observe()
      .subscribe(l => setTitler(Object.fromEntries(l.map(x => [x.id, x.tittel ?? 'Uten navn']))))
    return () => { a.unsubscribe(); b.unsubscribe(); c.unsubscribe() }
  }, [brukerId])

  const iDag = isoDag(new Date())
  const alle = useMemo(() => rader.map(tilSporsmaal), [rader])

  // Forfalte repetisjoner lages én gang når skjermen åpnes uten en bestemt
  // logg. Feiler det (ingen dekning), prøves det neste gang — ingenting tapt.
  const repetert = useRef(false)
  useEffect(() => {
    if (!lastet || loggId || temaId || !brukerId || repetert.current) return
    repetert.current = true
    for (const tema of repetisjonerAaLage(alle, iDag)) {
      lagRepetisjon(tema, alle, brukerId, kode)
    }
    // Runde 2 som aldri ble laget (nettet røk da runde 1 ble ferdig): lag den nå.
    const loggIder = new Set(alle.filter(s => s.runde === 1 && s.loggId).map(s => s.loggId!))
    for (const id of loggIder) {
      const r1 = alle.filter(s => s.loggId === id && s.runde === 1)
      if (r1.some(s => !s.besvart) || alle.some(s => s.loggId === id && s.runde === 2)) continue
      database.get<LaeretidLogg>('laeretid_logg').find(id).then(l => lagRunde2(l, brukerId, kode)).catch(() => {})
    }
  }, [lastet, loggId, brukerId, alle, iDag, kode])

  /**
   * Økta: spørsmålene som var åpne da den startet, pluss det som dukker opp
   * underveis. Rekkefølgen er runde 1 først (fersk jobb avgjør kryss), så
   * modne runde 2, så de som ikke er modne ennå.
   */
  const [okt, setOkt] = useState<string[]>([])
  // Nytt tema i samme skjerm («Neste tema»): økta bygges på nytt fra null.
  const forrigeTema = useRef(temaId)
  useEffect(() => {
    const nyttTema = forrigeTema.current !== temaId
    forrigeTema.current = temaId
    const base = nyttTema ? [] : okt
    const aapne = alle.filter(s => s.besvart === null
      && (!loggId || s.loggId === loggId)
      && (!temaId || s.tema === temaId))
    const vekt = (s: typeof aapne[number]) =>
      s.runde === 1 ? 0 : forTidlig(s, alle, iDag) ? 2 : 1
    const nye = aapne
      .filter(s => !base.includes(s.id))
      .sort((a, b) => vekt(a) - vekt(b) || a.laget.localeCompare(b.laget))
      .map(s => s.id)
    if (nyttTema) {
      setOkt(nye); setIndeks(0); setDom(null); setSvar(''); setFeil(null)
    } else {
      // Et runde 2-spørsmål som blir laget MENS økta pågår er ikke modent ennå
      // — det skal komme om noen dager, ikke rett etter fasiten.
      const modne = base.length === 0 ? nye : nye.filter(id => {
        const sp = alle.find(x => x.id === id)
        return !sp || !forTidlig(sp, alle, iDag)
      })
      if (modne.length > 0) setOkt(o => [...o, ...modne])
    }
  }, [alle, loggId, temaId, iDag]) // eslint-disable-line react-hooks/exhaustive-deps

  const [indeks, setIndeks] = useState(0)
  const [svar, setSvar] = useState('')
  const [venter, setVenter] = useState(false)
  const [dom, setDom] = useState<Dom | null>(null)
  const [feil, setFeil] = useState<string | null>(null)


  const radId = okt[indeks]
  const rad = rader.find(r => r.id === radId) ?? null
  const sp = rad ? tilSporsmaal(rad) : null
  const ferdig = lastet && indeks >= okt.length

  async function send(tekst: string) {
    if (!rad || !tekst.trim() || venter) return
    setVenter(true)
    setFeil(null)
    const ut = await vurderSvar(rad, tekst.trim(), kode)
    setVenter(false)
    if (!ut.ok) { setFeil(ut.grunn); return }
    setDom(ut)
    // Er runde 1 for loggen ferdig nå, lages runde 2 mens han leser fasiten.
    if (rad.runde === 1 && rad.loggId && brukerId) {
      const logg = await database.get<LaeretidLogg>('laeretid_logg').find(rad.loggId).catch(() => null)
      if (logg) lagRunde2(logg, brukerId, kode)
    }
  }

  function neste() {
    setDom(null)
    setSvar('')
    setFeil(null)
    setIndeks(i => i + 1)
  }

  const maal = sp ? finnMaal(kode, sp.maalNr) : null
  const del = maal?.deler.find(d => d.id === sp?.delId)
  const advarsel = sp ? forTidlig(sp, alle, iDag) : null
  const bestatt = dom?.vurdering === 'bestatt'
  const bommet = okt
    .map(id => alle.find(s => s.id === id))
    .filter(s => s?.vurdering === 'stroket').length

  const ferdigeIOkta = indeks + (dom ? 1 : 0)

  // Neste tema på stien, regnet ut når økta er ferdig (svarene er med).
  const nesteId = useMemo(() => {
    if (!ferdig || !temaId) return null
    return nesteTema(TEMAER.map(t => t.id), temaProfil(alle, iDag))
  }, [ferdig, temaId, alle, iDag])
  const [lagerNeste, setLagerNeste] = useState(false)
  const [nesteFeil, setNesteFeil] = useState<string | null>(null)
  async function nesteTemaNa() {
    if (!brukerId || !nesteId || lagerNeste) return
    setLagerNeste(true)
    setNesteFeil(null)
    const ut = await lagTeori(brukerId, nesteId)
    setLagerNeste(false)
    if (!ut.ok) { setNesteFeil(ut.grunn); return }
    router.replace(`/(app)/laeretid/quiz?tema=${nesteId}` as never)
  }

  return (
    <View style={{ flex: 1, backgroundColor: lt.hvit }}>
      {/* Topp: lukk + fremdrift for økta. Framgang, ikke poeng. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8 }}>
        <Pressable haptic="light" onPress={() => router.back()} style={{ padding: 4, marginLeft: -4 }}>
          <X size={26} color={lt.svak} strokeWidth={2.8} />
        </Pressable>
        <View style={{ flex: 1 }}><Fremdrift andel={okt.length ? ferdigeIOkta / okt.length : 0} /></View>
      </View>

      {!lastet ? null : ferdig ? (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center', gap: 16 }}>
          <Boble farge={okt.length === 0 ? 'bla' : bommet > 0 ? 'oransje' : 'gronn'} str={96}>
            {okt.length === 0
              ? <Check size={46} color={lt.hvit} strokeWidth={3.4} />
              : bommet > 0 ? <Repeat size={44} color={lt.hvit} strokeWidth={3} /> : <Check size={46} color={lt.hvit} strokeWidth={3.4} />}
          </Boble>
          <Tittel str={30}>{okt.length === 0 ? 'Ingenting venter' : 'Økta er ferdig!'}</Tittel>
          <Text style={{ fontSize: 17, color: lt.stille, textAlign: 'center', lineHeight: 24 }}>
            {okt.length === 0
              ? 'Du er à jour.'
              : temaId
                ? bommet > 0
                  ? `${bommet} av ${okt.length} satt ikke helt. Temaet kommer tilbake til det sitter.`
                  : 'Alt satt. Neste gang i dette temaet blir det litt vanskeligere.'
                : bommet > 0
                  ? `${bommet} av ${okt.length} satt ikke helt. De kommer tilbake om ${DAGER_TIL_REPETISJON / 7} uker — det er repetisjonen som gjør at det sitter på fagprøven.`
                  : `Om ${DAGER_TIL_RUNDE_2} dager kommer ett spørsmål til om det samme. Det er da det setter seg.`}
          </Text>
          {/* Duolingo-flyten: rett videre til neste tema, ett trykk. */}
          {nesteId && (
            <Knapp tekst={`Neste: ${finnTema(nesteId)?.navn ?? ''}`} style={{ alignSelf: 'stretch', marginTop: 12 }}
              venter={lagerNeste} onPress={nesteTemaNa} />
          )}
          <Knapp tekst="Ferdig" kontur={!!nesteId} farge={nesteId ? 'bla' : 'gronn'} style={{ alignSelf: 'stretch', marginTop: nesteId ? 0 : 12 }}
            onPress={() => router.back()} />
          {nesteFeil && <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '600' }}>{nesteFeil}</Text>}
        </View>
      ) : sp && maal ? (
        <>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {sp.tema ? (
              <Merke tekst={`Teori · ${finnTema(sp.tema)?.navn ?? sp.tema}`} farge="lilla" />
            ) : (
              <>
                <Merke tekst={`${maal.etikett} · ${del?.navn ?? sp.delId}`} farge="lilla" />
                <Text style={{ fontSize: 13, color: lt.stille, marginTop: 8 }}>fra «{(sp.loggId && titler[sp.loggId]) || 'loggen'}»</Text>
              </>
            )}
            <Text style={{ fontSize: 24, lineHeight: 31, fontWeight: '700', color: lt.tekst, marginTop: 14, letterSpacing: -0.3 }}>
              {sp.tekst}
            </Text>
            {advarsel && !dom && (
              <Text style={{ fontSize: 14, color: lt.blaMork, marginTop: 10, fontWeight: '600' }}>{advarsel}</Text>
            )}

            <TextInput
              value={dom ? (sp.svar ?? svar) : svar}
              onChangeText={setSvar}
              placeholder="Svar som om du forklarer det til en ny lærling."
              // Fagord er ikke i ordboka: autokorrektur gjorde «varerør» til «varmerør»
              // og «avmantler» til «semantiker» (27.09.2026). Feil ord blir feil fakta i loggen.
              autoCorrect={false}
              placeholderTextColor={lt.svak}
              editable={!dom && !venter}
              multiline
              autoFocus
              style={{
                marginTop: 24, minHeight: 130, fontSize: 17, lineHeight: 24, color: lt.tekst,
                backgroundColor: lt.flate, borderRadius: 16, borderWidth: 2, borderColor: lt.kant,
                padding: 14, textAlignVertical: 'top',
              }}
            />
            {feil && <Text style={{ fontSize: 14, color: lt.rodMork, marginTop: 10, fontWeight: '600' }}>{feil}</Text>}
          </ScrollView>

          {/* Bunnen: sjekk-knappen, eller dommen i farge. */}
          {!dom ? (
            <View style={{ padding: 18, paddingBottom: insets.bottom + 14, gap: 10, borderTopWidth: 2, borderTopColor: lt.kant }}>
              <Knapp tekst={venter ? 'Sjekker …' : 'Sjekk'} venter={venter} disabled={!svar.trim()} onPress={() => send(svar)} />
              {/* «Vet ikke» er et ærlig svar, ikke en snarvei. Det gir stryk, men ingen skam. */}
              {!venter && <Knapp tekst="Jeg vet ikke" kontur farge="bla" onPress={() => send('Jeg vet ikke.')} />}
            </View>
          ) : (
            <View style={{
              backgroundColor: bestatt ? lt.gronnLys : lt.rodLys,
              padding: 18, paddingBottom: insets.bottom + 14, gap: 10,
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Boble farge={bestatt ? 'gronn' : 'rod'} str={36}>
                  {bestatt ? <Check size={20} color={lt.hvit} strokeWidth={3.4} /> : <Repeat size={18} color={lt.hvit} strokeWidth={3} />}
                </Boble>
                <Text style={{ fontSize: 22, fontWeight: '700', color: bestatt ? lt.gronnMork : lt.rodMork }}>
                  {bestatt ? 'Det sitter!' : 'Ikke helt ennå'}
                </Text>
              </View>
              {!!dom.tilbakemelding && (
                <Text style={{ fontSize: 15, lineHeight: 21, color: bestatt ? lt.gronnMork : lt.rodMork }}>{dom.tilbakemelding}</Text>
              )}
              <Text style={{ fontSize: 13, color: bestatt ? lt.gronnMork : lt.rodMork, fontWeight: '600' }}>
                {sp.tema
                  ? bestatt
                    ? 'Neste spørsmål i temaet blir litt vanskeligere.'
                    : 'Temaet kommer tilbake til det sitter.'
                  : bestatt
                  ? sp.runde === 1 ? 'Svaret ditt står bak krysset.' : 'Krysset står, og nå sitter det.'
                  : sp.runde === 1
                    ? 'Denne delen krysses ikke av på denne loggen før du har forklart den.'
                    : `Krysset står, du gjorde jobben. Temaet kommer tilbake om ${DAGER_TIL_REPETISJON / 7} uker.`}
              </Text>
              {!!dom.fasit.tekst && (
                <View style={{ backgroundColor: lt.hvit, borderRadius: 14, padding: 12, gap: 6, maxHeight: 220 }}>
                  <ScrollView>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: lt.stille, letterSpacing: 1 }}>ET GODT SVAR</Text>
                    <Text style={{ fontSize: 15, lineHeight: 21, color: lt.tekst, marginTop: 4 }}>{dom.fasit.tekst}</Text>
                    <Text style={{ fontSize: 12, color: lt.stille, marginTop: 6 }}>{etterprovLinje(dom.fasit)}</Text>
                  </ScrollView>
                </View>
              )}
              <Knapp tekst={indeks + 1 < okt.length ? 'Fortsett' : 'Ferdig'} farge={bestatt ? 'gronn' : 'rod'} onPress={neste} />
            </View>
          )}
        </>
      ) : null}
    </View>
  )
}

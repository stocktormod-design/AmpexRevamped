import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, ScrollView, Image } from 'react-native'
import { Text, TextInput } from '../../../../components/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Q } from '@nozbe/watermelondb'
import { BookOpen, Check, ChevronLeft, FileDown, Image as BildeIkon, MessageCircle, Plus, X } from 'lucide-react-native'
import { Pressable } from '../../../../components/pressable'
import { Boble, Knapp, Kort, Merke, Seksjonstittel, lt, norskDato } from '../../../../components/laeretid-ui'
import { database } from '../../../../lib/db'
import {
  LaeretidBelegg, LaeretidBilde, LaeretidLaerling, LaeretidLogg, LaeretidSporsmaal,
} from '../../../../lib/db/models/laeretid'
import { useUserId } from '../../../../lib/auth-user'
import { finnMaal, type Laereplankode } from '../../../../lib/laeretid/laereplan'
import { varselForLogg, vurderBelegg } from '../../../../lib/laeretid/dekning'
import { kanBeOmEndring } from '../../../../lib/laeretid/abonnement'
import { lagRunde1 } from '../../../../lib/laeretid/quiz-klient'
import { advarslerFor } from '../../../../lib/laeretid/samtale-klient'
import { bildeDataUri, bildeUri } from '../../../../lib/laeretid/bilder'
import {
  NEK_NOKKEL, finnMal, fyllResten, lesUtfylling, mangler, nekFelter, nekHenvisningstekst, tilTekst,
  type Seksjon, type TabellSeksjon, type Utfylling,
} from '../../../../lib/laeretid/mal'
import { loggPdfHtml } from '../../../../lib/pdf/logg'
import { delPdf } from '../../../../lib/pdf/skriv'

/**
 * ÉN LOGG — i malen han leverer (omgjort 27.09.2026).
 *
 * Loggen er malen: oppdrag, risikovurdering, materielliste, verktøy,
 * utførelse, sluttkontroll, bilder, vurdering og egenvurdering, i den
 * rekkefølgen og med de overskriftene. Samtalen fyller den ut; han retter
 * direkte i hvert felt. Faste tabellrader står alltid — et ubesvart punkt er
 * oransje til han har svart, og loggen kan ikke sendes før malen er fylt ut.
 *
 * Bildenotatet lagres ORDRETT. 30.08.2026 oppsto tre faktafeil fordi bilder
 * ble tolket som fakta; bildet er bevis, notatet er forklaringen.
 *
 * Alt skrives lokalt (regel 2). Loggen skal kunne skrives i en kjeller.
 */

function useLogg(id: string, brukerId: string | null) {
  const [logg, setLogg] = useState<LaeretidLogg | null>(null)
  const [bilder, setBilder] = useState<LaeretidBilde[]>([])
  const [belegg, setBelegg] = useState<LaeretidBelegg[]>([])
  const [sporsmaal, setSporsmaal] = useState<LaeretidSporsmaal[]>([])
  const [kode, setKode] = useState<Laereplankode>('ELE03-04')

  useEffect(() => {
    if (!brukerId) return
    const subs = [
      database.get<LaeretidLogg>('laeretid_logg').query(Q.where('id', id)).observe()
        .subscribe(r => setLogg(r[0] ?? null)),
      database.get<LaeretidBilde>('laeretid_bilde').query(Q.where('logg_id', id)).observe().subscribe(setBilder),
      database.get<LaeretidBelegg>('laeretid_belegg').query(Q.where('logg_id', id)).observe().subscribe(setBelegg),
      database.get<LaeretidSporsmaal>('laeretid_sporsmaal').query(Q.where('logg_id', id)).observe().subscribe(setSporsmaal),
      database.get<LaeretidLaerling>('laeretid_laerling').query(Q.where('id', brukerId)).observe()
        .subscribe(r => { if (r[0]) setKode(r[0].laereplanKode) }),
    ]
    return () => subs.forEach(s => s.unsubscribe())
  }, [id, brukerId])

  return { logg, bilder, belegg, sporsmaal, kode }
}

function LoggMiniatyr({ bilde }: { bilde: LaeretidBilde }) {
  const [uri, setUri] = useState<string | null>(null)
  useEffect(() => {
    let aktiv = true
    bildeUri(bilde).then(u => { if (aktiv) setUri(u) })
    return () => { aktiv = false }
  }, [bilde.id, bilde.r2Nokkel]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: lt.flate }}>
      {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
    </View>
  )
}

function klokke(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

const feltStil = {
  fontSize: 16, lineHeight: 22, color: lt.tekst,
  backgroundColor: lt.flate, borderRadius: 12, borderWidth: 2, borderColor: lt.kant,
  paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' as const,
}

/** Ja/nei som to knapper. Ubesvart = ingen valgt. */
function JaNei({ verdi, onVelg, laast }: { verdi: string; onVelg: (v: string) => void; laast: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {(['Ja', 'Nei'] as const).map(v => {
        const paa = verdi === v
        const farge = v === 'Ja' ? lt.gronn : lt.stille
        return (
          <Pressable
            key={v}
            haptic="light"
            disabled={laast}
            onPress={() => onVelg(paa ? '' : v)}
            style={{
              paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10,
              borderWidth: 2, borderBottomWidth: 3,
              borderColor: paa ? farge : lt.kant,
              backgroundColor: paa ? (v === 'Ja' ? lt.gronnLys : lt.flate) : lt.hvit,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: paa ? (v === 'Ja' ? lt.gronnMork : lt.tekst) : lt.svak }}>{v}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Tabell({ s, rader, endre, laast }: {
  s: TabellSeksjon
  rader: string[][]
  endre: (rader: string[][]) => void
  laast: boolean
}) {
  const jn = s.kolonner.indexOf('Ja/nei')
  const sett = (r: number, k: number, v: string) =>
    endre(rader.map((rad, i) => (i === r ? rad.map((c, j) => (j === k ? v : c)) : rad)))

  if (!s.faste) {
    // Fri tabell (materielliste): rader han kan legge til og fjerne.
    return (
      <View style={{ gap: 8 }}>
        {rader.map((rad, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {rad.map((c, k) => (
              <TextInput autoCorrect={false}
                key={k}
                value={c}
                editable={!laast}
                onChangeText={v => sett(i, k, v)}
                placeholder={s.kolonner[k]}
                placeholderTextColor={lt.svak}
                style={[feltStil, { flex: k === 0 ? 2 : 1, paddingVertical: 8 }]}
              />
            ))}
            {!laast && (
              <Pressable haptic="light" onPress={() => endre(rader.filter((_, j) => j !== i))} style={{ padding: 4 }}>
                <X size={18} color={lt.svak} strokeWidth={2.6} />
              </Pressable>
            )}
          </View>
        ))}
        {!laast && (
          <Pressable
            haptic="light"
            onPress={() => endre([...rader, s.kolonner.map(() => '')])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
          >
            <Plus size={18} color={lt.bla} strokeWidth={3} />
            <Text style={{ fontSize: 15, fontWeight: '700', color: lt.bla }}>Legg til rad</Text>
          </Pressable>
        )}
      </View>
    )
  }

  // Faste rader: spørsmålet står, han svarer ja/nei. Feltene for risiko og
  // tiltak kommer først når svaret er ja — et nei er ferdig besvart, og tolv
  // kort med to tomme felt hver ble en vegg ingen gidder å lese.
  const ubesvarte = jn >= 0 ? rader.filter(r => !r[jn]).length : 0
  return (
    <View style={{ gap: 8 }}>
      {!laast && ubesvarte > 0 && jn >= 0 && (
        <Pressable
          haptic="medium"
          onPress={() => endre(s.faste!.map((_, i) => {
            const rad = rader[i] ?? s.kolonner.map(() => '')
            if (rad[jn]) return rad
            return s.kolonner.map((_, j) => (j === jn ? 'Nei' : 'Ikke relevant.'))
          }))}
          style={{
            alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: lt.flate, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: lt.stille }}>
            Sett {ubesvarte === 1 ? 'den ubesvarte' : `de ${ubesvarte} ubesvarte`} til nei
          </Text>
        </Pressable>
      )}
      {s.faste.map((sporsmaal, i) => {
        const rad = rader[i] ?? s.kolonner.map(() => '')
        const svar = jn >= 0 ? rad[jn] : 'Ja'
        const ubesvart = jn >= 0 && !svar
        const visFelt = jn < 0 || svar === 'Ja' || (svar === 'Nei' && rad.some((c, j) => j !== jn && c && c !== 'Ikke relevant.'))
        return (
          <View key={i} style={{
            borderRadius: 14, borderWidth: 2, padding: 12, gap: 8,
            borderColor: ubesvart ? lt.oransje : lt.kant,
            backgroundColor: ubesvart ? lt.oransjeLys : lt.hvit,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: lt.tekst, lineHeight: 20 }}>{sporsmaal}</Text>
              {jn >= 0 && <JaNei verdi={svar} laast={laast} onVelg={v => sett(i, jn, v)} />}
            </View>
            {visFelt && s.kolonner.map((k, j) => j === jn ? null : (
              <TextInput autoCorrect={false}
                key={k}
                value={rad[j]}
                editable={!laast}
                onChangeText={v => sett(i, j, v)}
                placeholder={k}
                placeholderTextColor={lt.svak}
                multiline
                style={[feltStil, { paddingVertical: 8, fontSize: 15 }]}
              />
            ))}
          </View>
        )
      })}
    </View>
  )
}

export default function LoggDetalj() {
  const insets = useSafeAreaInsets()
  const brukerId = useUserId()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { logg, bilder, belegg, sporsmaal, kode } = useLogg(String(id), brukerId)

  const mal = useMemo(() => finnMal(logg?.malId), [logg?.malId])
  const [instruks, setInstruks] = useState('')
  const [utf, setUtfState] = useState<Utfylling | null>(null)
  // Speilet i en ref: raske tastetrykk i to felt etter hverandre skal ikke
  // skrive over hverandre med en gammel utgave av utfyllingen.
  const utfRef = useRef<Utfylling | null>(null)
  const setUtf = (u: Utfylling | null) => { utfRef.current = u; setUtfState(u) }
  const [lastet, setLastet] = useState(false)

  useEffect(() => {
    if (!logg || lastet) return
    setInstruks(logg.instruks ?? '')
    let u = logg.utfylling ? lesUtfylling(mal, logg.utfylling) : null
    // En kladd skrevet før sikkerhetsnettet kom kan ha tomme faste rader.
    // Fyll dem nå, så han aldri møter en halvtom mal.
    if (u && logg.status === 'kladd') {
      const fylt = fyllResten(mal, u)
      if (JSON.stringify(fylt) !== JSON.stringify(u)) {
        u = fylt
        const ny = fylt
        void (async () => {
          const bilder = await database.get<LaeretidBilde>('laeretid_bilde').query(Q.where('logg_id', logg.id)).fetch()
          const notater = bilder.filter(b => b.notat?.trim())
            .sort((a, b) => (a.tattAt?.getTime() ?? 0) - (b.tattAt?.getTime() ?? 0))
            .map(b => `${klokke(b.tattAt)} ${b.notat!.trim()}`)
          await database.write(async () => { await logg.update(l => { l.utfylling = JSON.stringify(ny); l.innhold = tilTekst(mal, ny, notater) }) })
        })()
      }
    }
    setUtf(u)
    setLastet(true)
  }, [logg, lastet, mal])

  // Samtalen fyller ut malen på en annen skjerm. Hent den inn igjen når vi
  // kommer tilbake — feltene holder ellers på det som sto da skjermen åpnet.
  // Første fokus hopper over: da har lasteeffekten over nettopp satt (og
  // kanskje reparert) utfyllingen, og en ny lesing ville satt den gamle tilbake.
  const forsteFokus = useRef(true)
  useFocusEffect(useCallback(() => {
    if (!logg) return
    if (forsteFokus.current) { forsteFokus.current = false; return }
    setUtf(logg.utfylling ? lesUtfylling(mal, logg.utfylling) : null)
  }, [logg, mal]))

  const skriv = useCallback(async (endre: (l: LaeretidLogg) => void) => {
    if (!logg) return
    await database.write(async () => { await logg.update(endre) })
  }, [logg])

  const sortert = useMemo(() => [...bilder].sort((a, b) => {
    if (a.tattAt && b.tattAt) return a.tattAt.getTime() - b.tattAt.getTime()
    if (a.tattAt) return -1
    if (b.tattAt) return 1
    return a.rekkefolge - b.rekkefolge
  }), [bilder])

  /** Én endring i malen: lagres som utfylling OG som ren tekst (quiz og eksport leser teksten). */
  const endreSeksjon = useCallback((sid: string, verdi: string | string[][]) => {
    const naa = utfRef.current
    if (!naa) return
    const ny = { ...naa, [sid]: verdi }
    setUtf(ny)
    const notater = sortert.filter(b => b.notat?.trim()).map(b => `${klokke(b.tattAt)} ${b.notat!.trim()}`)
    skriv(l => { l.utfylling = JSON.stringify(ny); l.innhold = tilTekst(mal, ny, notater) })
  }, [sortert, skriv, mal])

  const maalVurdert = useMemo(() => belegg.map(r => {
    const maal = finnMaal(kode, r.maalNr)
    const del = maal.deler.find(d => d.id === r.delId)
    if (!del) return null
    const v = vurderBelegg(del, {
      loggId: r.loggId, maalNr: r.maalNr, delId: r.delId, kilde: r.kilde,
      generert: r.generert, utfortSelv: r.utfortSelv, utspurt: r.utspurt,
    })
    return { etikett: maal.etikett, delNavn: del.navn, ...v }
  }).filter(Boolean) as { etikett: string; delNavn: string; holder: boolean; grunn: string }[],
  [belegg, kode])

  const holdende = new Set(maalVurdert.filter(m => m.holder).map(m => m.etikett)).size
  const varsel = varselForLogg(holdende)
  const endring = kanBeOmEndring(logg?.aiEndringerBrukt ?? 0)
  const erKladd = logg?.status === 'kladd'
  const mangel = utf ? mangler(mal, utf) : []
  // Bare det som er FYLT UT sjekkes — malens egne overskrifter («Sluttkontroll og
  // dokumentasjon») er ikke hans ord og skal ikke gi advarsel.
  const advarsler = useMemo(() => {
    if (!erKladd) return []
    const fylt = utf ? Object.values(utf).flat(2).filter(Boolean).join('\n') : logg?.innhold ?? ''
    return fylt ? advarslerFor(fylt) : []
  }, [erKladd, utf, logg?.innhold])

  // Utspørringen. Runde 1 lages med en gang loggen sendes: da er jobben fersk.
  const [lager, setLager] = useState(false)
  const sender = useRef(false)
  const [quizFeil, setQuizFeil] = useState<string | null>(null)
  const aapne = sporsmaal.filter(s => !s.besvartAt).length
  const besvarte = sporsmaal.length - aapne

  const startUtsporing = useCallback(async () => {
    if (!logg || !brukerId || lager) return
    setLager(true)
    setQuizFeil(null)
    const ut = await lagRunde1(logg, brukerId, kode)
    setLager(false)
    if (!ut.ok) { setQuizFeil(ut.grunn); return }
    router.push(`/(app)/laeretid/quiz?logg=${logg.id}` as never)
  }, [logg, brukerId, kode, lager])

  const [lagerPdf, setLagerPdf] = useState(false)
  // Loggen skrives av assistenten; å se hele malen er valgfritt.
  const [visDetaljer, setVisDetaljer] = useState(false)
  const lagPdf = useCallback(async () => {
    if (!logg || !utf || lagerPdf) return
    setLagerPdf(true)
    try {
      const html = loggPdfHtml({
        tittel: logg.tittel?.trim() || 'Logg',
        arbeidsdato: logg.arbeidsdato,
        mal,
        utfylling: utf,
        bilder: await Promise.all(sortert.map(async b => ({
          tid: b.tattAt ? klokke(b.tattAt) : null,
          notat: b.notat?.trim() ?? '',
          // Bildet bakes inn i PDF-en: den skal kunne lastes opp alene.
          src: await bildeDataUri(b),
        }))),
      })
      await delPdf(html, logg.tittel?.trim() || 'Logg')
    } finally {
      setLagerPdf(false)
    }
  }, [logg, utf, mal, sortert, lagerPdf])

  if (!logg) {
    return (
      <View style={{ flex: 1, backgroundColor: lt.hvit, padding: 20, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, color: lt.stille }}>Fant ikke loggen.</Text>
      </View>
    )
  }

  const seksjon = (s: Seksjon) => {
    if (s.slag === 'bilder') {
      return (
        <View style={{ gap: 10 }}>
          {sortert.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
              <BildeIkon size={24} color={lt.svak} strokeWidth={2} />
              <Text style={{ fontSize: 14, color: lt.stille, textAlign: 'center' }}>Ingen bilder ennå.</Text>
            </View>
          ) : sortert.map(b => (
            <View key={b.id} style={{ flexDirection: 'row', gap: 10 }}>
              <LoggMiniatyr bilde={b} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: b.tattAt ? lt.blaMork : lt.svak }}>
                  {b.tattAt ? klokke(b.tattAt) : 'Uten tid'}
                </Text>
                {/* Lagres ordrett. Ingen modell pusser på dette ved fangst. */}
                {/* Ukontrollert: raske tastetrykk skal ikke vente på databasen. */}
                <TextInput
                  defaultValue={b.notat ?? ''}
                  onChangeText={v => { void database.write(async () => { await b.update(r => { r.notat = v }) }) }}
                  placeholder="Hva er dette?"
                  placeholderTextColor={lt.svak}
                  editable={erKladd}
                  autoCorrect={false}
                  multiline
                  style={[feltStil, { paddingVertical: 8 }]}
                />
              </View>
            </View>
          ))}
          {erKladd && (
            <Knapp tekst={sortert.length ? 'Flere bilder' : 'Ta eller hent bilder'} kontur farge="bla"
              onPress={() => router.push(`/(app)/laeretid/logg/bilder?id=${logg.id}` as never)} />
          )}
        </View>
      )
    }
    const verdi = utf?.[s.id]
    if (s.slag === 'tekst') {
      const felt = (
        <TextInput autoCorrect={false}
          value={typeof verdi === 'string' ? verdi : ''}
          onChangeText={v => endreSeksjon(s.id, v)}
          placeholder={s.hjelp}
          placeholderTextColor={lt.svak}
          editable={erKladd}
          multiline
          style={[feltStil, { minHeight: 70 }]}
        />
      )
      if (s.id !== 'utforelse' || !utf || nekFelter(utf).length === 0) return felt
      // Henvisning til forskrifter: boten har pekt, han slår opp og begrunner.
      const nek = nekFelter(utf)
      const rader = (utf[NEK_NOKKEL] as string[][]) ?? []
      return (
        <View style={{ gap: 12 }}>
          {felt}
          <Text style={{ fontSize: 15, fontWeight: '700', color: lt.lillaMork, marginTop: 6 }}>Henvisning til forskrifter</Text>
          {nek.map(f => {
            const i = rader.findIndex(r => r[0] === f.punkt)
            const aapen = !f.begrunnelse.trim()
            return (
              <Kort key={f.punkt} farge={aapen ? 'lilla' : 'gronn'} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={18} color={lt.lillaMork} strokeWidth={2.6} />
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: lt.lillaMork }}>
                    {nekHenvisningstekst(f)}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, color: lt.tekst, lineHeight: 21 }}>{f.hva}</Text>
                <TextInput autoCorrect={false}
                  value={f.begrunnelse}
                  editable={erKladd}
                  onChangeText={v => endreSeksjon(NEK_NOKKEL, rader.map((r, j) => (j === i ? [r[0], r[1], v] : r)))}
                  placeholder="Forklar gjerne med egne ord (valgfritt). Henvisningen holder."
                  placeholderTextColor={lt.svak}
                  multiline
                  style={[feltStil, { minHeight: 60, backgroundColor: lt.hvit }]}
                />
              </Kort>
            )
          })}
        </View>
      )
    }
    return <Tabell s={s} rader={Array.isArray(verdi) ? verdi : []} laast={!erKladd} endre={r => endreSeksjon(s.id, r)} />
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: lt.hvit }}
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 140 }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable
        haptic="light"
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6, marginBottom: 8 }}
      >
        <ChevronLeft size={22} color={lt.stille} strokeWidth={2.4} />
        <Text style={{ fontSize: 16, fontWeight: '600', color: lt.stille }}>Læretid</Text>
      </Pressable>

      <TextInput autoCorrect={false}
        value={logg.tittel ?? ''}
        onChangeText={v => skriv(l => { l.tittel = v })}
        placeholder="Ny logg"
        placeholderTextColor={lt.svak}
        editable={erKladd}
        multiline
        style={{ fontSize: 28, lineHeight: 33, fontWeight: '700', color: lt.tekst, letterSpacing: -0.4, paddingVertical: 0 }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Merke tekst={mal.navn} farge="bla" />
        <Text style={{ fontSize: 14, color: lt.stille }}>{norskDato(logg.arbeidsdato)}{sortert.length ? ` · ${sortert.length} bilder` : ''}</Text>
      </View>
      {varsel && <Text style={{ fontSize: 13, color: lt.oransjeMork, marginTop: 6, fontWeight: '600' }}>{varsel}</Text>}

      {/* ── 1. Før loggen: bilder, egne ord, og én knapp. ─────────────────── */}
      {!utf && erKladd && (
        <>
          <Seksjonstittel>Dagen i bilder</Seksjonstittel>
          {seksjon({ id: 'bilder', tittel: 'Bilder', slag: 'bilder', hjelp: '' })}

          <Knapp tekst="Lag loggen" style={{ marginTop: 20 }}
            ikon={<MessageCircle size={20} color={lt.hvit} strokeWidth={2.8} />}
            onPress={() => router.push(`/(app)/laeretid/logg/samtale?id=${logg.id}` as never)} />
          <Text style={{ fontSize: 13, color: lt.stille, textAlign: 'center', marginTop: 8 }}>
            To korte spørsmål, så fyller assistenten ut hele «{mal.navn}».
          </Text>
        </>
      )}

      {/* ── 2. Loggen er klar: send inn, så quiz. Detaljene er valgfrie. ───── */}
      {utf && erKladd && (
        <Kort farge="gronn" style={{ marginTop: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Boble farge="gronn"><Check size={24} color={lt.hvit} strokeWidth={3.4} /></Boble>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: lt.tekst }}>Loggen er klar</Text>
              <Text style={{ fontSize: 14, color: lt.stille, marginTop: 2 }}>
                {mangel.length === 0 ? 'Hele malen er fylt ut' : 'Nesten ferdig'}{sortert.length ? ` · ${sortert.length} bilder` : ''}.
              </Text>
            </View>
          </View>
          <Knapp
            tekst="Send inn og start quizen"
            disabled={mangel.length > 0}
            venter={lager}
            onPress={async () => {
              // Dobbelttrykk: bare første trykk sender og åpner quizen.
              if (sender.current) return
              sender.current = true
              await skriv(l => { l.status = 'sendt'; l.sendtAt = new Date() })
              await startUtsporing()
              sender.current = false
            }}
          />
          {mangel.length > 0 && (
            <Text style={{ fontSize: 13, color: lt.oransjeMork, fontWeight: '600' }}>
              {mangel.map(m => m.tekst).join(' · ')}
            </Text>
          )}
          <Knapp tekst={visDetaljer ? 'Skjul loggen' : 'Se og rett loggen'} kontur farge="bla"
            onPress={() => setVisDetaljer(v => !v)} />
        </Kort>
      )}

      {/* ── 3. Sendt: quizen er hovedsaken. ─────────────────────────────────── */}
      {!erKladd && (
        <Kort farge="bla" style={{ marginTop: 20, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Boble farge="bla"><BookOpen size={22} color={lt.hvit} strokeWidth={2.6} /></Boble>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: lt.tekst }}>Quiz om jobben</Text>
              <Text style={{ fontSize: 14, color: lt.stille, marginTop: 2 }}>
                {sporsmaal.length === 0
                  ? 'Tre korte spørsmål. De samme sensor stiller.'
                  : aapne > 0
                    ? `${aapne} ${aapne === 1 ? 'spørsmål venter' : 'spørsmål venter'}${besvarte > 0 ? `, ${besvarte} besvart` : ''}.`
                    : `Alle ${besvarte} spørsmål er besvart.`}
              </Text>
            </View>
          </View>
          {quizFeil && <Text style={{ fontSize: 14, color: lt.rodMork, fontWeight: '600' }}>{quizFeil}</Text>}
          {(sporsmaal.length === 0 || aapne > 0) && (
            <Knapp
              tekst={sporsmaal.length === 0 ? 'Start quizen' : 'Fortsett quizen'}
              farge="bla"
              venter={lager}
              onPress={() => sporsmaal.length === 0
                ? startUtsporing()
                : router.push(`/(app)/laeretid/quiz?logg=${logg.id}` as never)}
            />
          )}
        </Kort>
      )}

      {/* PDF-en er det som lastes opp i fagbrev.io. */}
      {utf && (
        <Knapp tekst="Lag PDF til fagbrev.io" kontur farge="lilla" venter={lagerPdf} onPress={lagPdf} style={{ marginTop: 12 }}
          ikon={<FileDown size={20} color={lt.lilla} strokeWidth={2.6} />} />
      )}
      {utf && !erKladd && (
        <Knapp tekst={visDetaljer ? 'Skjul loggen' : 'Se loggen'} kontur farge="bla" style={{ marginTop: 12 }}
          onPress={() => setVisDetaljer(v => !v)} />
      )}

      {/* Eldre logg uten mal-utfylling: vis teksten som den er. */}
      {!utf && !!logg.innhold?.trim() && (
        <>
          <Seksjonstittel>Loggen</Seksjonstittel>
          <Kort><Text style={{ fontSize: 15, color: lt.tekst, lineHeight: 22 }}>{logg.innhold}</Text></Kort>
        </>
      )}

      {/* ── Detaljene: hele malen, til den som vil se eller rette. ─────────── */}
      {utf && visDetaljer && (
        <>
          <Seksjonstittel>Hva gjorde du?</Seksjonstittel>
          <TextInput autoCorrect={false}
            value={instruks}
            onChangeText={v => { setInstruks(v); skriv(l => { l.instruks = v }) }}
            editable={erKladd}
            multiline
            style={[feltStil, { minHeight: 60 }]}
          />
          {mal.seksjoner.map(s => (
            <View key={s.id}>
              <Seksjonstittel>{s.tittel}</Seksjonstittel>
              {seksjon(s)}
            </View>
          ))}
          {erKladd && (
            <Knapp tekst="Fortsett samtalen" kontur farge="bla" style={{ marginTop: 20 }}
              onPress={() => router.push(`/(app)/laeretid/logg/samtale?id=${logg.id}` as never)} />
          )}
          {erKladd && (
            <Text style={{ fontSize: 13, color: lt.stille, marginTop: 8, textAlign: 'center' }}>
              {endring.kan
                ? `${endring.igjen} ${endring.igjen === 1 ? 'omskriving' : 'omskrivinger'} igjen. Du kan alltid rette i feltene selv.`
                : endring.grunn}
            </Text>
          )}
          {advarsler.length > 0 && (
            <Kort farge="oransje" style={{ marginTop: 16, gap: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: lt.oransjeMork }}>Se over dette</Text>
              {advarsler.map(a => <Text key={a} style={{ fontSize: 14, color: lt.tekst, lineHeight: 20 }}>{a}</Text>)}
            </Kort>
          )}
          {maalVurdert.length > 0 && (
            <>
              <Seksjonstittel>Kompetansemål</Seksjonstittel>
              <View style={{ gap: 8 }}>
                {maalVurdert.map((m, i) => (
                  <Kort key={`${m.etikett}-${m.delNavn}-${i}`} style={{ paddingVertical: 12, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: lt.tekst }}>{m.etikett} · {m.delNavn}</Text>
                      <Merke tekst={m.holder ? 'Teller' : 'Etter quiz'} farge={m.holder ? 'gronn' : 'graa'} />
                    </View>
                  </Kort>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  )
}

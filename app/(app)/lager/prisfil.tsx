import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TextInput, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { ChevronLeft, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react-native'
import { Pressable } from '../../../components/pressable'
import { ListCard, SectionHeader, Chip } from '../../../components/ui'
import { base64TilBytes, dekodAnsi, parseEfoNelfo, type ParseResultat } from '../../../lib/pricefile/efo-nelfo'
import { importerPrisfil, prisferskhet, type ImportResultat } from '../../../lib/pricefile/import'
import { colors, spacing, radius, sizes, type as t } from '../../../lib/theme'

const GROSSISTER = ['Onninen', 'Solar', 'Ahlsell', 'Elektroskandia', 'Otra']

function Rad({ etikett, verdi, sterk }: { etikett: string; verdi: string; sterk?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    }}>
      <Text style={sterk ? t.bodyMedium : t.subhead}>{etikett}</Text>
      <Text style={[sterk ? t.bodyMedium : t.subhead, { fontVariant: ['tabular-nums'] }]}>{verdi}</Text>
    </View>
  )
}

export default function PrisfilScreen() {
  const insets = useSafeAreaInsets()
  const [grossist, setGrossist] = useState(GROSSISTER[0])
  const [paslag, setPaslag] = useState('')
  const [jobber, setJobber] = useState(false)
  const [parset, setParset] = useState<ParseResultat | null>(null)
  const [filnavn, setFilnavn] = useState<string | null>(null)
  const [resultat, setResultat] = useState<ImportResultat | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [ferskhet, setFerskhet] = useState<{ grossist: string; sistOppdatert: Date; antall: number }[]>([])

  useEffect(() => { prisferskhet().then(setFerskhet) }, [resultat])

  async function velgFil() {
    setFeil(null); setResultat(null); setParset(null)
    const valg = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (valg.canceled || !valg.assets?.[0]) return
    const fil = valg.assets[0]
    setFilnavn(fil.name)
    setJobber(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(fil.uri, { encoding: FileSystem.EncodingType.Base64 })
      const tekst = dekodAnsi(base64TilBytes(b64))
      const r = parseEfoNelfo(tekst)
      if (r.varer.length === 0) {
        setFeil('Fant ingen varelinjer. Er dette en V4- eller P4-fil fra grossisten?')
      } else {
        setParset(r)
      }
    } catch (e) {
      setFeil(`Kunne ikke lese fila: ${String(e)}`)
    } finally {
      setJobber(false)
    }
  }

  async function importer() {
    if (!parset) return
    setJobber(true)
    try {
      const p = parseFloat(paslag.replace(',', '.'))
      const r = await importerPrisfil(parset, {
        grossist,
        paslagProsent: Number.isFinite(p) && p >= 0 ? p : undefined,
      })
      setResultat(r)
      setParset(null)
    } catch (e) {
      setFeil(`Import feilet: ${String(e)}`)
    } finally {
      setJobber(false)
    }
  }

  function dagerSiden(d: Date): string {
    const n = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (n <= 0) return 'i dag'
    if (n === 1) return 'i går'
    return `${n} dager siden`
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.md, paddingHorizontal: spacing.screen,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={26} color={colors.label} strokeWidth={sizes.lucideStroke} />
        </Pressable>
        <Text style={t.headline}>Prisfil fra grossist</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: spacing.screen + spacing.lg, marginBottom: spacing.xl }}>
          <Text style={t.footnote}>
            EFO/NELFO 4.0 — filnavnet begynner med V4 (varefil) eller P4 (pristilbud).
            Fila inneholder dine egne fremforhandlede priser.
          </Text>
        </View>

        {/* Ferskhet per grossist. En fersk pris sammenlignet mot en tre måneder
            gammel gir feil svar med full selvtillit. */}
        {ferskhet.length > 0 && (
          <>
            <SectionHeader>Sist oppdatert</SectionHeader>
            <ListCard style={{ marginBottom: spacing.xl }}>
              {ferskhet.map((f, i) => (
                <View key={f.grossist} style={{
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
                  borderBottomWidth: i === ferskhet.length - 1 ? 0 : 0.5, borderBottomColor: colors.separator,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={t.body}>{f.grossist}</Text>
                    <Text style={[t.footnote, { marginTop: 1 }]}>{f.antall} varer</Text>
                  </View>
                  <Text style={[t.subhead, {
                    color: (Date.now() - f.sistOppdatert.getTime()) > 60 * 86400000
                      ? colors.warning : colors.secondaryLabel,
                  }]}>
                    {dagerSiden(f.sistOppdatert)}
                  </Text>
                </View>
              ))}
            </ListCard>
          </>
        )}

        <SectionHeader>Grossist</SectionHeader>
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
          paddingHorizontal: spacing.screen, marginBottom: spacing.lg,
        }}>
          {GROSSISTER.map(g => (
            <Chip key={g} label={g} selected={grossist === g} onPress={() => setGrossist(g)} />
          ))}
        </View>

        <ListCard style={{ marginBottom: spacing.lg }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: spacing.md,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={t.body}>Påslag</Text>
              {/* Grossistfila vet hva varen KOSTER oss, ikke hva vi tar for den.
                  Uten påslag blir dekningsbidraget null på hver eneste linje. */}
              <Text style={[t.footnote, { marginTop: 1 }]}>Tomt = behold prisene du alt har satt</Text>
            </View>
            <TextInput
              value={paslag}
              onChangeText={setPaslag}
              placeholder="—"
              placeholderTextColor={colors.tertiaryLabel}
              keyboardType="decimal-pad"
              style={[t.body, { minWidth: 56, textAlign: 'right', fontVariant: ['tabular-nums'] }]}
            />
            <Text style={[t.footnote, { color: colors.tertiaryLabel }]}>%</Text>
          </View>
        </ListCard>

        {!!feil && (
          <ListCard style={{ marginBottom: spacing.lg, borderColor: colors.danger }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg }}>
              <AlertTriangle size={18} color={colors.danger} strokeWidth={sizes.lucideStroke} />
              <Text style={[t.subhead, { flex: 1 }]}>{feil}</Text>
            </View>
          </ListCard>
        )}

        {/* Forhåndsvisning FØR import. Å skrive 30 000 varer først og fortelle
            etterpå er ikke et valg brukeren har tatt. */}
        {parset && (
          <>
            <SectionHeader>{filnavn ?? 'Fil'}</SectionHeader>
            <ListCard style={{ marginBottom: spacing.lg }}>
              <Rad etikett="Selger" verdi={parset.hode.selgerNavn || '—'} />
              <Rad etikett="Type" verdi={parset.hode.filtype === 'vare' ? 'Varefil' : 'Pristilbud'} />
              <Rad etikett="Varelinjer" verdi={String(parset.varer.length)} sterk />
              {parset.avvik.length > 0 && (
                <View style={{
                  flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md, borderTopWidth: 0.5, borderTopColor: colors.separator,
                }}>
                  <AlertTriangle size={17} color={colors.warning} strokeWidth={sizes.lucideStroke} />
                  <Text style={[t.footnote, { flex: 1 }]}>
                    {parset.avvik.length} linjer lot seg ikke tolke. Første: {parset.avvik[0].grunn}
                  </Text>
                </View>
              )}
            </ListCard>
            <Pressable
              haptic="medium"
              onPress={importer}
              disabled={jobber}
              style={{
                height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
                alignItems: 'center', justifyContent: 'center',
                marginHorizontal: spacing.screen, opacity: jobber ? 0.35 : 1,
              }}
            >
              <Text style={[t.headline, { color: colors.ctaLabel }]}>
                Importer {parset.varer.length} varer
              </Text>
            </Pressable>
          </>
        )}

        {resultat && (
          <>
            <SectionHeader>Importert</SectionHeader>
            <ListCard style={{ marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.sm }}>
                <CheckCircle2 size={18} color={colors.success} strokeWidth={sizes.lucideStroke} />
                <Text style={[t.bodyMedium, { flex: 1 }]}>{grossist} er oppdatert</Text>
              </View>
              <Rad etikett="Nye varer" verdi={String(resultat.nye)} />
              <Rad etikett="Oppdaterte" verdi={String(resultat.oppdaterte)} />
              {resultat.utgaatte > 0 && <Rad etikett="Utgått hos grossist" verdi={String(resultat.utgaatte)} />}
              {resultat.utenElnummer > 0 && <Rad etikett="Uten el-nummer, hoppet over" verdi={String(resultat.utenElnummer)} />}
            </ListCard>
          </>
        )}

        {!parset && (
          <Pressable
            haptic="medium"
            onPress={velgFil}
            disabled={jobber}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
              height: sizes.ctaHeight, borderRadius: radius.xl, backgroundColor: colors.cta,
              marginHorizontal: spacing.screen, opacity: jobber ? 0.35 : 1,
            }}
          >
            {jobber
              ? <ActivityIndicator color={colors.ctaLabel} />
              : <Upload size={18} color={colors.ctaLabel} strokeWidth={sizes.lucideStroke} />}
            <Text style={[t.headline, { color: colors.ctaLabel }]}>
              {jobber ? 'Leser fil …' : 'Velg prisfil'}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  )
}

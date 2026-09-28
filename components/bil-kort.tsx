import { useEffect, useState } from 'react'
import { InteractionManager, View } from 'react-native'
import { Q } from '@nozbe/watermelondb'
import { router } from 'expo-router'
import { Text } from './text'
import { Pressable } from './pressable'
import { Bil3D } from './bil-3d'
import { ChoiceSheet, type Valg } from './sheet'
import { database } from '../lib/db'
import { Location } from '../lib/db/models/location'
import { hentKjoretoy, fargeTilHex, type KjoretoyInfo } from '../lib/kjoretoy'
import { bilmodellSlug, hentBilmodellForRegnr } from '../lib/bilmodell'
import { colors, spacing, radius, shadows, type as t } from '../lib/theme'

/**
 * BILEN — Meg-fanens fysiske hjem for lageret (spec 2026-08-29).
 *
 * Regnummeret slås opp hos Vegvesen (edge function `vegvesen`, cachet lokalt)
 * → merke/modell/farge, og 3D-modellen tintes i bilens faktiske registerfarge.
 * Kurert modell fra biblioteket når den finnes, ellers karosseritypen
 * (CC0-pakkene). Ingen silhuett/plassholder mens den lastes (13.09).
 *
 * «Bytt bil» flytter tildelingen: bilen er en `locations`-rad (`type='bil'`)
 * med `assigned_to`, så byttet synkes som alt annet.
 */

function useBiler() {
  const [biler, setBiler] = useState<Location[]>([])
  useEffect(() => {
    const sub = database
      .get<Location>('locations')
      .query(Q.where('type', 'bil'), Q.sortBy('name', Q.asc))
      .observe()
      .subscribe(setBiler)
    return () => sub.unsubscribe()
  }, [])
  return biler
}

async function byttBil(biler: Location[], valgtId: string, userId: string) {
  await database.write(async () => {
    for (const bil of biler) {
      const erValgt = bil.id === valgtId
      const erMin = bil.assignedTo === userId
      if (erValgt && !erMin) await bil.update(b => { b.assignedTo = userId })
      else if (!erValgt && erMin) await bil.update(b => { b.assignedTo = null })
    }
  })
}

/** Karosseritypen fra registeret → riktig silhuett. Varebil er fallback —
 *  det er det en montørbil oftest er. */
type Karosseriform = 'varebil' | 'personbil' | 'pickup'

function karosseriform(karosseri: string | null | undefined): Karosseriform {
  const k = (karosseri ?? '').toLowerCase()
  if (k.includes('pickup') || k.includes('pick-up') || k.includes('lasteplan')) return 'pickup'
  if (k.includes('stasjonsvogn') || k.includes('kombi') || k.includes('sedan')
    || k.includes('kupé') || k.includes('kabriolet') || k.includes('flerbruk')) return 'personbil'
  return 'varebil'
}

/** Skiltet — hvit plate, blå EU-stripe, tabulære tegn. */
function Skilt({ regNr }: { regNr: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignSelf: 'flex-start', marginTop: spacing.xs,
      borderWidth: 1, borderColor: colors.separator, borderRadius: 4, overflow: 'hidden',
      backgroundColor: '#FFFFFF',
    }}>
      <View style={{ width: 6, backgroundColor: '#2A5CAA' }} />
      <Text style={{
        paddingHorizontal: 7, paddingVertical: 2,
        fontSize: 12, fontWeight: '600', letterSpacing: 1.2,
        color: colors.label, fontVariant: ['tabular-nums'],
      }}>
        {regNr.replace(/\s+/g, '').toUpperCase().replace(/^([A-ZÆØÅ]{2})/, '$1 ')}
      </Text>
    </View>
  )
}

export function BilKort({ userId }: { userId: string | null }) {
  const biler = useBiler()
  const [velger, setVelger] = useState(false)
  const [info, setInfo] = useState<KjoretoyInfo | null>(null)
  // 3D er pynt: feiler GL-konteksten eller modellen, tar silhuetten over stille.
  const [vis3d, setVis3d] = useState(true)
  const [klar3d, setKlar3d] = useState(false)
  // GL-kontekst + modell-parsing er tungt. Vent til overgangen er ferdig, så
  // Meg glir inn uten hakk; silhuetten står imens.
  const [tegn3d, setTegn3d] = useState(false)
  useEffect(() => { const h = InteractionManager.runAfterInteractions(() => setTimeout(() => setTegn3d(true), 250)); return () => h.cancel() }, [])
  // Kurert modell fra biblioteket («toyota-proace-verso.glb») når den finnes.
  const [modellUri, setModellUri] = useState<string | null>(null)

  const min = biler.find(b => b.assignedTo === userId) ?? null
  const regNr = min?.regNr ?? null

  // Oppslaget er ferdig når vi vet om det finnes en kurert modell eller ikke.
  // Før det tegnes INGEN bil (Tormod 13.09): en plassholderbil som byttes ut
  // leser som feil bil, ikke som «laster».
  const [oppslagFerdig, setOppslagFerdig] = useState(false)

  useEffect(() => {
    let stopp = false
    setInfo(null)
    setModellUri(null)
    setKlar3d(false)
    setOppslagFerdig(false)
    if (regNr) {
      hentKjoretoy(regNr).then(async i => {
        if (stopp) return
        setInfo(i)
        const slug = bilmodellSlug(i?.merke, i?.modell)
        // Per regnr: samme bil hentes aldri to ganger (lib/bilmodell.ts).
        const uri = slug ? await hentBilmodellForRegnr(regNr, slug, { merke: i?.merke, modell: i?.modell }) : null
        if (stopp) return
        if (uri) setModellUri(uri)
        setOppslagFerdig(true)
      })
    }
    return () => { stopp = true }
  }, [regNr])

  // Ingen biler registrert → plassholder som sier hva som kommer her, og som
  // tar deg rett til «Legg til bil». Et tomt Meg forklarer ingenting.
  if (biler.length === 0) {
    return (
      <Pressable
        haptic="light"
        onPress={() => router.push({ pathname: '/(app)/lager/ny-lokasjon', params: { type: 'bil' } })}
        style={{
          backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.separator, borderRadius: radius.lg,
          padding: spacing.lg, marginBottom: spacing.xl,
        }}
      >
        <Text style={[t.headline]}>Bilen din</Text>
        <Text style={[t.footnote, { marginTop: spacing.xs }]}>
          Skriv inn registreringsnummeret, så henter vi merke, modell og farge fra Vegvesen og
          viser bilen her. Den blir lageret ditt på hjul: uttak og handleliste følger den.
        </Text>
        <Text style={[t.footnote, { marginTop: spacing.md, fontWeight: '600', color: colors.label }]}>Legg til bil</Text>
      </Pressable>
    )
  }

  // Vegvesen gjentar ofte merket i handelsbetegnelsen («AUDI» + «Audi e-tron»)
  // — vis «Audi e-tron», ikke «AUDI Audi e-tron».
  const navn = (() => {
    if (!info?.merke) return min?.name ?? 'Velg bil'
    const merke = info.merke
    const modell = info.modell ?? ''
    if (modell.toLowerCase().startsWith(merke.toLowerCase())) return modell
    return [merke, modell].filter(Boolean).join(' ')
  })()

  const valg: Valg<string>[] = biler.map(b => ({
    verdi: b.id,
    etikett: b.name,
    underetikett: b.regNr ?? undefined,
  }))

  return (
    <View style={{
      backgroundColor: colors.bg, borderRadius: radius.hero,
      borderWidth: 1, borderColor: colors.separator,
      paddingTop: spacing.md, marginBottom: spacing.xl,
      ...shadows.card,
    }}>
      {min ? (
        vis3d ? (
          // Feltet står tomt til bilen faktisk er der: ingen silhuett, ingen
          // karosseri-plassholder mens biblioteket slås opp (13.09).
          <View style={{ height: 150, justifyContent: 'center' }}>
            <View style={{ opacity: klar3d ? 1 : 0 }}>
              {tegn3d && oppslagFerdig && <Bil3D
                key={modellUri ?? 'karosseri'}
                modell={karosseriform(info?.karosseri)}
                uri={modellUri}
                tint={fargeTilHex(info?.farge)}
                onFeil={() => setVis3d(false)}
                onKlar={() => setKlar3d(true)}
              />}
            </View>
          </View>
        ) : (
          // GL feilet: ingen bil, bare navn og skilt under.
          <View style={{ height: spacing.md }} />
        )
      ) : (
        <Text style={[t.footnote, { textAlign: 'center', paddingVertical: spacing.xl }]}>
          Ingen bil er tildelt deg ennå.
          {__DEV__ ? `\nuid:${userId ?? 'NULL'} biler:${biler.length} tildelt:${biler.map(b => b.assignedTo ?? '-').join(',')}` : ''}
        </Text>
      )}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xs,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={[t.headline]} numberOfLines={1}>{navn}</Text>
          {!!regNr && <Skilt regNr={regNr} />}
        </View>
        <Pressable
          haptic="light"
          pressScale={0.95}
          onPress={() => setVelger(true)}
          style={{
            paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
            borderRadius: radius.pill, backgroundColor: colors.fill,
            borderWidth: 1, borderColor: colors.separator,
          }}
        >
          <Text style={[t.footnote, { fontWeight: '600', color: colors.label }]}>
            {min ? 'Bytt bil' : 'Velg bil'}
          </Text>
        </Pressable>
      </View>

      <ChoiceSheet
        synlig={velger}
        tittel="Velg bilen din"
        forklaring="Bilen er lageret ditt på hjul — uttak og handleliste følger den."
        valg={valg}
        valgt={min?.id}
        onVelg={id => {
          setVelger(false)
          if (userId) void byttBil(biler, id, userId)
        }}
        onAvbryt={() => setVelger(false)}
      />
    </View>
  )
}

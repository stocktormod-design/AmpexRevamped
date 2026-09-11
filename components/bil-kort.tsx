import { useEffect, useState } from 'react'
import { InteractionManager, View } from 'react-native'
import Svg, { Path, Rect, Circle, Ellipse } from 'react-native-svg'
import { Q } from '@nozbe/watermelondb'
import { Text } from './text'
import { Pressable } from './pressable'
import { Bil3D } from './bil-3d'
import { ChoiceSheet, type Valg } from './sheet'
import { database } from '../lib/db'
import { Location } from '../lib/db/models/location'
import { hentKjoretoy, fargeTilHex, type KjoretoyInfo } from '../lib/kjoretoy'
import { bilmodellSlug, hentBilmodell } from '../lib/bilmodell'
import { colors, spacing, radius, shadows, type as t } from '../lib/theme'

/**
 * BILEN — Meg-fanens fysiske hjem for lageret (spec 2026-08-29).
 *
 * Regnummeret slås opp hos Vegvesen (edge function `vegvesen`, cachet lokalt)
 * → merke/modell/farge, og silhuetten tintes i bilens faktiske registerfarge.
 * Silhuetten er spec-ark-stilen: én form, glasset skåret ut, myk skygge —
 * 3D-modell per karosseritype (CC0-pakkene) er neste hakk, se
 * memory/bil-oppslag-og-3d.
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

/** Spec-ark-silhuett, tintet i registerfargen. Én form, glasset skåret ut. */
function BilSilhuett({ tint, form }: { tint: string; form: Karosseriform }) {
  const glass = colors.bg
  return (
    <Svg width="100%" height={96} viewBox="0 0 280 92">
      <Ellipse cx={140} cy={84} rx={105} ry={4} fill="rgba(46,40,31,0.15)" />
      {form === 'varebil' && (
        <>
          <Path
            d="M30 78 V32 q0-10 11-11 L168 16 q6-1 11 3 L208 40 q18 2 28 8 q12 5 14 14 l2 8 q1 6-5 6 L229 76 A17 17 0 0 1 195 76 L86 76 A17 17 0 0 1 52 76 L36 76 q-6 0-6-6 z"
            fill={tint}
          />
          <Rect x={58} y={25} width={104} height={13} rx={3} fill={glass} />
          <Path d="M175 21 q4-1 7 2 l20 17 h-27 z" fill={glass} />
          <Path d="M166 76 V27" stroke={glass} strokeWidth={1.5} opacity={0.5} />
        </>
      )}
      {form === 'personbil' && (
        <>
          <Path
            d="M28 76 V60 q0-8 9-10 l20-4 18-16 q5-5 13-5 h74 q9 0 15 6 l17 16 26 5 q12 3 13 12 l1 6 q1 6-5 6 L229 76 A17 17 0 0 1 195 76 L86 76 A17 17 0 0 1 52 76 L34 76 q-6 0-6-6 z"
            fill={tint}
          />
          <Path d="M82 44 96 31 q3-3 8-3 h22 v16 z" fill={glass} />
          <Path d="M134 28 h26 q6 0 10 4 l12 12 h-48 z" fill={glass} />
          <Path d="M133 76 V29" stroke={glass} strokeWidth={1.5} opacity={0.5} />
        </>
      )}
      {form === 'pickup' && (
        <>
          <Path
            d="M28 76 V40 q0-4 5-4 h58 l16-16 q4-4 11-4 h44 q8 0 12 6 l12 16 q28 2 40 7 q11 4 12 12 l1 4 q1 6-5 6 L229 76 A17 17 0 0 1 195 76 L86 76 A17 17 0 0 1 52 76 L34 76 q-6 0-6-6 z"
            fill={tint}
          />
          <Path d="M112 34 124 22 q2-2 6-2 h18 v14 z" fill={glass} />
          <Path d="M152 20 h20 q5 0 8 4 l8 10 h-36 z" fill={glass} />
          <Path d="M92 76 V41" stroke={glass} strokeWidth={1.5} opacity={0.5} />
        </>
      )}
      <Circle cx={69} cy={78} r={12} fill={tint} />
      <Circle cx={69} cy={78} r={4.5} fill={glass} />
      <Circle cx={214} cy={78} r={12} fill={tint} />
      <Circle cx={214} cy={78} r={4.5} fill={glass} />
    </Svg>
  )
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

  useEffect(() => {
    let stopp = false
    setInfo(null)
    setModellUri(null)
    setKlar3d(false)
    if (regNr) {
      hentKjoretoy(regNr).then(async i => {
        if (stopp) return
        setInfo(i)
        const slug = bilmodellSlug(i?.merke, i?.modell)
        if (slug) {
          const uri = await hentBilmodell(slug, { merke: i?.merke, modell: i?.modell })
          if (!stopp && uri) { setKlar3d(false); setModellUri(uri) }
        }
      })
    }
    return () => { stopp = true }
  }, [regNr])

  // Ingen biler registrert → ingenting å vise. Biler legges til i Lager.
  if (biler.length === 0) return null

  // Vegvesen gjentar ofte merket i handelsbetegnelsen («AUDI» + «Audi e-tron»)
  // — vis «Audi e-tron», ikke «AUDI Audi e-tron».
  const navn = (() => {
    if (!info?.merke) return min?.name ?? 'Velg bil'
    const merke = info.merke
    const modell = info.modell ?? ''
    if (modell.toLowerCase().startsWith(merke.toLowerCase())) return modell
    return [merke, modell].filter(Boolean).join(' ')
  })()
  const tint = fargeTilHex(info?.farge) ?? colors.labelMuted

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
          // Silhuetten ligger UNDER 3D-en til første ramme er tegnet — kortet
          // sto tomt i sekundene modellen lastet (og for alltid der GL ikke
          // tegner, f.eks. simulator). Tom plate leser som feil.
          <View style={{ height: 150, justifyContent: 'center' }}>
            {!klar3d && (
              <View style={{ position: 'absolute', left: 0, right: 0, paddingHorizontal: spacing.sm }}>
                <BilSilhuett tint={tint} form={karosseriform(info?.karosseri)} />
              </View>
            )}
            <View style={{ opacity: klar3d ? 1 : 0 }}>
              {tegn3d && <Bil3D
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
          <View style={{ paddingHorizontal: spacing.sm }}>
            <BilSilhuett tint={tint} form={karosseriform(info?.karosseri)} />
          </View>
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

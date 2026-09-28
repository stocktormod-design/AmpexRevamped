import { type ReactNode } from 'react'
import { View, Pressable as RNPressable, type ViewStyle, type StyleProp } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Text } from './text'

/**
 * LÆRETID-UI — lekent og tydelig, på lærlingens premisser (Tormod 27.09.2026).
 *
 * Dette er det ENE stedet i appen som bevisst bryter regel 9 (hvitt og sort):
 * «Det må være Duolingo-aktig. God UI liksom.» Læretid selges til en
 * nittenåring som er lei av skole, ikke til en montør i en kjeller, og hvitt og
 * sort leste som et skjema. Montørflatene står urørt.
 *
 * Det vi tar fra Duolingo: klare, mettede farger med én mørkere tone under
 * (knappen ser trykkbar ut, og SYNKER når du trykker), tykke avrundede kort,
 * fremdriftslinjer, og at hvert svar får en farget tilbakemelding. Det vi ikke
 * tar: streaks, poeng, ligaer og maskoten — se «Læringssløyfa» i docs/LAERLING.md.
 */

export const lt = {
  gronn: '#58CC02',
  gronnMork: '#46A302',
  gronnLys: '#D7FFB8',
  bla: '#1CB0F6',
  blaMork: '#1899D6',
  blaLys: '#DDF4FF',
  oransje: '#FF9600',
  oransjeMork: '#E07F00',
  oransjeLys: '#FFF0D9',
  lilla: '#CE82FF',
  lillaMork: '#A568CC',
  lillaLys: '#F6E8FF',
  rod: '#FF4B4B',
  rodMork: '#EA2B2B',
  rodLys: '#FFDFE0',
  gul: '#FFC800',
  gulMork: '#E6A700',
  tekst: '#3C3C3C',
  stille: '#777777',
  svak: '#AFAFAF',
  kant: '#E5E5E5',
  flate: '#F7F7F7',
  hvit: '#FFFFFF',
}

export type Farge = 'gronn' | 'bla' | 'oransje' | 'lilla' | 'rod' | 'gul'

const PAR: Record<Farge, [string, string]> = {
  gronn: [lt.gronn, lt.gronnMork],
  bla: [lt.bla, lt.blaMork],
  oransje: [lt.oransje, lt.oransjeMork],
  lilla: [lt.lilla, lt.lillaMork],
  rod: [lt.rod, lt.rodMork],
  gul: [lt.gul, lt.gulMork],
}

/**
 * Knappen som synker. Kanten under er fargen i mørkere tone; når du trykker,
 * forsvinner kanten og knappen flytter seg ned like mye. Kun transform og
 * layout på selve trykket — ingen animasjonsløkker (regel 10).
 */
export function Knapp({
  tekst, onPress, farge = 'gronn', kontur = false, disabled = false, venter = false, ikon, style,
}: {
  tekst: string
  onPress?: () => void
  farge?: Farge
  kontur?: boolean
  disabled?: boolean
  venter?: boolean
  ikon?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const [fyll, kant] = PAR[farge]
  const av = disabled || venter
  return (
    <RNPressable
      disabled={av}
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress?.() }}
      style={style}
    >
      {({ pressed }) => (
        <View style={{
          borderRadius: 16,
          paddingVertical: 14,
          paddingHorizontal: 18,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          backgroundColor: av ? lt.kant : kontur ? lt.hvit : fyll,
          borderWidth: kontur ? 2 : 0,
          borderColor: kontur ? lt.kant : 'transparent',
          borderBottomWidth: pressed && !av ? (kontur ? 2 : 0) : 4,
          borderBottomColor: av ? lt.svak : kontur ? lt.kant : kant,
          transform: [{ translateY: pressed && !av ? 4 : 0 }],
          marginBottom: pressed && !av ? 0 : 0,
        }}>
          {ikon}
          <Text style={{
            fontSize: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
            color: av ? lt.svak : kontur ? fyll : lt.hvit,
          }}>
            {venter ? 'Vent litt …' : tekst}
          </Text>
        </View>
      )}
    </RNPressable>
  )
}

/** Kortet: tykk grå kant, tykkere nederst. Trykkbart når det får `onPress`. */
export function Kort({
  children, onPress, farge, style, valgt = false,
}: {
  children: ReactNode
  onPress?: () => void
  /** Farget kort (bakgrunn i lys tone, kant i fargen). */
  farge?: Farge
  valgt?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const lys = farge ? ({ gronn: lt.gronnLys, bla: lt.blaLys, oransje: lt.oransjeLys, lilla: lt.lillaLys, rod: lt.rodLys, gul: '#FFF6D1' } as const)[farge] : lt.hvit
  const kant = valgt ? lt.bla : farge ? PAR[farge][0] : lt.kant
  const innhold = (pressed: boolean) => (
    <View style={[{
      backgroundColor: valgt ? lt.blaLys : lys,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: kant,
      borderBottomWidth: pressed ? 2 : 4,
      padding: 16,
      transform: [{ translateY: pressed ? 2 : 0 }],
    }, style]}>
      {children}
    </View>
  )
  if (!onPress) return innhold(false)
  return (
    <RNPressable onPress={() => { void Haptics.selectionAsync(); onPress() }}>
      {({ pressed }) => innhold(pressed)}
    </RNPressable>
  )
}

/** Fremdriftslinja med blank stripe øverst, som Duolingo sin. */
export function Fremdrift({ andel, farge = 'gronn', hoyde = 16 }: { andel: number; farge?: Farge; hoyde?: number }) {
  const a = Math.max(0, Math.min(1, andel))
  return (
    <View style={{ height: hoyde, borderRadius: hoyde / 2, backgroundColor: lt.kant, overflow: 'hidden' }}>
      {a > 0 && (
        <View style={{ width: `${Math.max(a * 100, 6)}%`, height: '100%', borderRadius: hoyde / 2, backgroundColor: PAR[farge][0] }}>
          <View style={{
            position: 'absolute', top: hoyde * 0.22, left: hoyde * 0.4, right: hoyde * 0.4,
            height: hoyde * 0.22, borderRadius: hoyde, backgroundColor: 'rgba(255,255,255,0.35)',
          }} />
        </View>
      )}
    </View>
  )
}

/** Rund ikonboble i en farge. */
export function Boble({ farge, children, str = 44 }: { farge: Farge; children: ReactNode; str?: number }) {
  return (
    <View style={{
      width: str, height: str, borderRadius: str / 2, backgroundColor: PAR[farge][0],
      borderBottomWidth: 3, borderBottomColor: PAR[farge][1],
      alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </View>
  )
}

/** Liten farget merkelapp (status, mål). */
export function Merke({ tekst, farge }: { tekst: string; farge: Farge | 'graa' }) {
  const bg = farge === 'graa' ? lt.flate : ({ gronn: lt.gronnLys, bla: lt.blaLys, oransje: lt.oransjeLys, lilla: lt.lillaLys, rod: lt.rodLys, gul: '#FFF6D1' } as const)[farge]
  const fg = farge === 'graa' ? lt.stille : PAR[farge][1]
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: fg, letterSpacing: 0.4, textTransform: 'uppercase' }}>{tekst}</Text>
    </View>
  )
}

/** Overskrift i Duolingo-tone: fet, tett, mørk grå — aldri kolsvart. */
export function Tittel({ children, str = 28 }: { children: ReactNode; str?: number }) {
  return <Text style={{ fontSize: str, lineHeight: str * 1.18, fontWeight: '700', color: lt.tekst, letterSpacing: -0.4 }}>{children}</Text>
}

export function Seksjonstittel({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 20, fontWeight: '700', color: lt.tekst, marginTop: 28, marginBottom: 12 }}>{children}</Text>
}

/** «24. september», ikke «2026-09-24». Ingen leser ISO. */
export function norskDato(iso: string | null | undefined): string {
  if (!iso) return 'Uten dato'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long' })
}

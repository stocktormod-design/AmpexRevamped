import { useState } from 'react'
import { View, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Check } from 'lucide-react-native'
import { Text, TextInput } from '../../components/text'
import { Pressable } from '../../components/pressable'
import { supabase } from '../../lib/supabase'
import { useUserRole } from '../../lib/auth-user'
import { ROLLENAVN, type Rolle } from '../../lib/kontor-tilgang'
import { TILBYS } from '../../lib/invitasjon'
import { colors, spacing, radius, sizes, type as t } from '../../lib/theme'

/**
 * Inviter en kollega rett fra telefonen (Tormod 08.11: «admins, installatør osv må
 * kunne invitere, og de blir lagt til i firmaet automatisk»).
 *
 * Firmaet velges aldri her — `inviter-ansatt` legger den nye inn i DITT firma med
 * service_role, og sjekker selv at du får gi rollen du ber om. Listene under er bare
 * hva skjermen tilbyr; sperren står på serveren.
 */
type Utfall = { epost: string; navn: string; status: 'invitert' | 'lagt-til' | 'finnes' | 'avvist'; grunn?: string }

function kvittering(u: Utfall): { ok: boolean; tekst: string } {
  switch (u.status) {
    case 'invitert': return { ok: true, tekst: `Invitasjon sendt til ${u.epost}. ${u.navn.split(' ')[0]} velger passord fra e-posten og logger inn i appen.` }
    case 'lagt-til': return { ok: true, tekst: `${u.navn} hadde allerede en konto og er nå lagt til i firmaet.` }
    case 'finnes': return { ok: true, tekst: `${u.navn} er allerede med i firmaet.` }
    default: return { ok: false, tekst: `Ikke sendt: ${u.grunn ?? 'ukjent feil'}.` }
  }
}

export default function InviterScreen() {
  const insets = useSafeAreaInsets()
  const minRolle = useUserRole()
  const valg = TILBYS[(minRolle ?? '') as Rolle] ?? []
  const [navn, setNavn] = useState('')
  const [epost, setEpost] = useState('')
  const [rolle, setRolle] = useState<Rolle>('montor')
  const [sender, setSender] = useState(false)
  const [svar, setSvar] = useState<{ ok: boolean; tekst: string } | null>(null)

  const gyldig = navn.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(epost.trim())
  const valgtRolle = valg.includes(rolle) ? rolle : valg[valg.length - 1]

  async function send() {
    if (!gyldig || !valgtRolle || sender) return
    setSender(true)
    setSvar(null)
    try {
      const { data, error } = await supabase.functions.invoke('inviter-ansatt', {
        body: { ansatte: [{ navn: navn.trim(), epost: epost.trim().toLowerCase(), rolle: valgtRolle }] },
      })
      if (error) throw error
      if (!data?.ok) { setSvar({ ok: false, tekst: data?.error ?? 'Fikk ikke sendt invitasjonen.' }); return }
      const k = kvittering((data.resultat as Utfall[])[0])
      setSvar(k)
      if (k.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setNavn(''); setEpost('')
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setSvar({ ok: false, tekst: /fetch|network|internet/i.test(m) ? 'Ingen dekning. Invitasjonen sendes ikke uten nett, prøv igjen når du har dekning.' : m })
    } finally {
      setSender(false)
    }
  }

  const felt = { ...t.body, height: 48, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.bg }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.screen, paddingBottom: sizes.tabBar + insets.bottom + spacing.xxl }}>
        <Pressable onPress={() => router.back()} pressScale={0.92} accessibilityLabel="Tilbake"
          style={{ width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={sizes.icon} color={colors.label} strokeWidth={2.2} />
        </Pressable>
        <Text style={[t.title1, { marginTop: spacing.lg }]}>Inviter kollega</Text>
        <Text style={[t.footnote, { marginTop: spacing.xs, marginBottom: spacing.xl }]}>
          De får en e-post, velger passord og havner rett i firmaet ditt.
        </Text>

        {minRolle && valg.length === 0 ? (
          <Text style={t.body}>Rollen din kan ikke invitere. Spør eier, administrator eller installatør.</Text>
        ) : (
          <View style={{ gap: spacing.md }}>
            <TextInput value={navn} onChangeText={setNavn} placeholder="Fullt navn" placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" style={felt} />
            <TextInput value={epost} onChangeText={setEpost} placeholder="E-post" placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress"
              returnKeyType="send" onSubmitEditing={send} style={felt} />

            <Text style={[t.eyebrow, { textTransform: 'uppercase', marginTop: spacing.sm }]}>Rolle</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {valg.map(r => {
                const paa = r === valgtRolle
                return (
                  <Pressable key={r} haptic="light" onPress={() => setRolle(r)}
                    style={{ paddingHorizontal: spacing.lg, height: 36, borderRadius: radius.pill, justifyContent: 'center',
                      backgroundColor: paa ? colors.label : colors.bg, borderWidth: 1, borderColor: paa ? colors.label : colors.separator }}>
                    <Text style={[t.subhead, { fontWeight: '600', color: paa ? colors.bg : colors.label }]}>{ROLLENAVN[r]}</Text>
                  </Pressable>
                )
              })}
            </View>

            {svar && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg,
                backgroundColor: svar.ok ? colors.fill : 'rgba(255,59,48,0.08)', marginTop: spacing.sm }}>
                {svar.ok && <Check size={18} color={colors.label} strokeWidth={2.4} />}
                <Text style={[t.subhead, { flex: 1, color: svar.ok ? colors.label : colors.danger }]}>{svar.tekst}</Text>
              </View>
            )}

            <Pressable haptic="medium" onPress={send} disabled={!gyldig || sender}
              style={{ height: sizes.ctaHeight - 6, borderRadius: radius.xl, backgroundColor: colors.cta, alignItems: 'center', justifyContent: 'center',
                marginTop: spacing.md, opacity: !gyldig || sender ? 0.4 : 1 }}>
              {sender ? <ActivityIndicator color={colors.ctaLabel} /> : <Text style={[t.headline, { color: colors.ctaLabel }]}>Send invitasjon</Text>}
            </Pressable>
            <Text style={[t.caption, { color: colors.secondaryLabel, marginTop: spacing.xs }]}>
              Eier, administrator og regnskapsfører inviteres fra Ampex Kontor.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

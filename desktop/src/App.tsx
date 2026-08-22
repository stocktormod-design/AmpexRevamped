import { kan, rollenavn, type Rettighet } from '@delt/kontor-tilgang'
import { Building2, ClipboardList, Clock, FileSpreadsheet, FileText, FolderKanban, Globe, LayoutGrid, Package, Scan, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '@/auth'
import { erAmpexAdmin } from '@/lib/brukere'
import { AmpexAdmin } from '@/ruter/AmpexAdmin'
import { Firma } from '@/ruter/Firma'
import { Internkontroll } from '@/ruter/Internkontroll'
import { Kunder } from '@/ruter/Kunder'
import { Logginn, NyttPassord } from '@/ruter/Logginn'
import { Ordre } from '@/ruter/Ordre'
import { Oversikt } from '@/ruter/Oversikt'
import { Prisfil } from '@/ruter/Prisfil'
import { Prosjekter } from '@/ruter/Prosjekter'
import { Skjemaer } from '@/ruter/Skjemaer'
import { Tilbud } from '@/ruter/Tilbud'
import { Timer } from '@/ruter/Timer'
import { Skann } from '@/ruter/Skann'
import { Varer } from '@/ruter/Varer'
import { mangler } from '@/supabase'
import { AmpexLogo } from '@/ui/AmpexLogo'
import { Assistent, type Kommando } from '@/ui/Assistent'
import { Beskjed, Knapp, Kort } from '@/ui/kit'

/**
 * Skallet.
 *
 * Formen er NØSTEDE avrundede paneler: grunnen holder appflaten, appflaten
 * holder sidemenyen og innholdet, innholdet holder kortene. Hvert nivå er et
 * verditrinn lysere enn det under, som er det som gjør at de leser som
 * paneler i det hele tatt.
 *
 * Ruting på hash i stedet for et rutebibliotek: appen kjører i én WebView uten
 * adresselinje, og et bibliotek til ville vært 40 kB for å løse `switch`.
 *
 * **Menyen viser bare det rollen faktisk kan bruke.** En regnskapsfører skal
 * ikke se «Prisfiler» og få beskjed om at hun ikke har lov — hun skal ikke se
 * den. Rettighetene ligger i `lib/kontor-tilgang.ts` og er selvtestet.
 *
 * Ctrl+1 … Ctrl+n følger den FILTRERTE menyen, ikke den fulle. Snarveiene står
 * IKKE skrevet i menyen: et hint ved siden av hvert valg er krom som må leses
 * hver gang for å ignoreres, og den som bruker tastatur finner dem uansett.
 * Hovertittelen på merket sier fra om assistenten.
 */

/**
 * Flatene, i den rekkefølgen kontoret jobber i dem.
 *
 * ARBEID er dagen: ordrene som skal gjennom, prosjektene de hører til, tilbudene
 * som ligger ute, og timene som skal på lønn. REGISTER er oppslagsverket bak.
 * KVALITET er internkontrollen og skjemaene. Det finnes ingen egen logg-flate:
 * historikken til en rutine står PÅ rutinen, ikke i et arkiv man må huske at
 * finnes. Se `desktop/src/ui/Historikk.tsx`.
 * FIRMA er oppsettet man rører sjelden.
 */
const RUTER = [
  { id: 'oversikt', navn: 'Oversikt', gruppe: 'Arbeid', ikon: LayoutGrid, rett: 'kontor' as Rettighet, vis: () => <Oversikt /> },
  { id: 'ordre', navn: 'Ordre', gruppe: 'Arbeid', ikon: ClipboardList, rett: 'ordre.les' as Rettighet, vis: () => <Ordre /> },
  { id: 'prosjekt', navn: 'Prosjekter', gruppe: 'Arbeid', ikon: FolderKanban, rett: 'prosjekt.les' as Rettighet, vis: () => <Prosjekter /> },
  { id: 'tilbud', navn: 'Tilbud', gruppe: 'Arbeid', ikon: FileText, rett: 'tilbud.les' as Rettighet, vis: () => <Tilbud /> },
  { id: 'timer', navn: 'Timer', gruppe: 'Arbeid', ikon: Clock, rett: 'timer.les' as Rettighet, vis: () => <Timer /> },
  { id: 'skann', navn: 'Skann', gruppe: 'Arbeid', ikon: Scan, rett: 'skann.les' as Rettighet, vis: () => <Skann /> },

  { id: 'kunder', navn: 'Kunder', gruppe: 'Register', ikon: Users, rett: 'kunder.les' as Rettighet, vis: () => <Kunder /> },
  { id: 'varer', navn: 'Varer', gruppe: 'Register', ikon: Package, rett: 'varer.les' as Rettighet, vis: () => <Varer /> },

  { id: 'ik', navn: 'Internkontroll', gruppe: 'Kvalitet', ikon: ShieldCheck, rett: 'ik.les' as Rettighet, vis: () => <Internkontroll /> },
  { id: 'skjema', navn: 'Skjemaer', gruppe: 'Kvalitet', ikon: FileText, rett: 'skjema.les' as Rettighet, vis: () => <Skjemaer /> },

  { id: 'firma', navn: 'Firma', gruppe: 'Firma', ikon: Building2, rett: 'firma.les' as Rettighet, vis: () => <Firma /> },
  { id: 'prisfil', navn: 'Prisfiler', gruppe: 'Firma', ikon: FileSpreadsheet, rett: 'priser.importer' as Rettighet, vis: () => <Prisfil /> },
] as const

/**
 * Ampex-flata står UTENFOR `RUTER`, og det er ikke en stilistisk detalj.
 *
 * Alt i RUTER styres av `kan(rolle, rett)` — altså av rollen din i DITT firma.
 * Denne ruta tilhører ingen firmaer, og kan derfor ikke ha en `Rettighet`:
 * en rettighet er noe en rolle har, og rollen er per firma. Den styres av
 * `ampex_admins` i stedet, og legges på lista etter filtreringen.
 */
const AMPEX_RUTE = {
  id: 'ampex', navn: 'Ampex', gruppe: 'Ampex', ikon: Globe, vis: () => <AmpexAdmin />,
} as const

type Rute = (typeof RUTER)[number] | typeof AMPEX_RUTE

export function App() {
  const { sesjon, profil, laster, feil, gjenoppretting, loggUt } = useAuth()
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const påHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', påHash)
    return () => window.removeEventListener('hashchange', påHash)
  }, [])

  const [assistent, setAssistent] = useState(false)

  // Spoerres for hver innlogging, ikke bufres. Svaret er nei for alle andre enn
  // et par personer, og en tabell med én policy er billig å spørre.
  const [ampexAdmin, setAmpexAdmin] = useState(false)
  useEffect(() => {
    if (!profil) { setAmpexAdmin(false); return }
    let avbrutt = false
    erAmpexAdmin().then(ja => { if (!avbrutt) setAmpexAdmin(ja) })
    return () => { avbrutt = true }
  }, [profil])

  const synlige: Rute[] = [
    ...RUTER.filter(r => kan(profil?.role, r.rett)),
    ...(ampexAdmin ? [AMPEX_RUTE] : []),
  ]

  useEffect(() => {
    const påTast = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      // Ctrl+K åpner assistenten. Samme inngang som Ampex-merket, uten mus.
      if (e.key.toLowerCase() === 'k') { e.preventDefault(); setAssistent(true); return }
      const i = Number(e.key) - 1
      if (synlige[i]) { e.preventDefault(); window.location.hash = `#/${synlige[i].id}` }
    }
    window.addEventListener('keydown', påTast)
    return () => window.removeEventListener('keydown', påTast)
  }, [synlige])

  if (mangler) {
    return (
      <Sperre tittel="Mangler oppsett">
        <p className="kort-hjelp">
          <code>VITE_SUPABASE_URL</code> og <code>VITE_SUPABASE_ANON_KEY</code> er ikke satt. Kopier{' '}
          <code>desktop/.env.example</code> til <code>desktop/.env</code> og fyll dem inn.
        </p>
      </Sperre>
    )
  }

  // Kom økta fra en e-postlenke — «glemt passord» eller en invitasjon — er den
  // eneste flaten som gjelder den som setter passordet. Sjekken står FØR
  // sesjonssjekken, ellers ville lenka gitt full tilgang uten at passordet ble
  // satt i det hele tatt.
  //
  // Lenka logger inn i to trinn: supabase-js plukker tokenene ut av hash-en, og
  // først da finnes økta. Uten mellomtilstanden her blinker innloggingsskjemaet
  // forbi, og det ser ut som lenka ikke virket.
  if (gjenoppretting) {
    return sesjon ? <NyttPassord /> : <div className="tomt">Åpner lenka …</div>
  }

  if (!sesjon) return <Logginn />
  if (laster) return <div className="tomt">Henter profilen …</div>

  if (feil || !profil) {
    return (
      <div className="logginn">
        <div className="logginn-kort stabel">
          <Beskjed stil="feil">{feil ?? 'Fant ingen profil.'}</Beskjed>
          <Knapp onClick={loggUt}>Logg ut</Knapp>
        </div>
      </div>
    )
  }

  // Ampex-admin slipper forbi rollesperren, og MÅ gjøre det: rollen er noe du
  // har i et firma, og den som oppretter firmaene hører ikke til noe. Uten
  // dette ville den eneste som kan lage kunder stått med «kontoret er ikke for
  // denne rollen» — og `synlige` inneholder da bare Ampex-flata uansett, fordi
  // alle andre ruter filtreres på nettopp rollen.
  if (!ampexAdmin && !kan(profil.role, 'kontor')) {
    return (
      <Sperre tittel="Kontoret er ikke for denne rollen" avslutt={loggUt}>
        <p className="kort-hjelp">
          Du er logget inn som {rollenavn(profil.role).toLowerCase()}. Kontorflaten er for eier,
          administrator, installatør, bas og regnskapsfører. Alt en montør trenger ligger i appen på
          telefonen.
        </p>
      </Sperre>
    )
  }

  // Rollen kan ha mistet en rettighet siden forrige økt. Da skal den falle
  // tilbake til første synlige rute, ikke vise en tom flate.
  const bedt = hash.replace('#/', '')
  const aktiv = synlige.find(r => r.id === bedt) ?? synlige[0]

  if (!aktiv) {
    return (
      <Sperre tittel="Ingen flater å vise" avslutt={loggUt}>
        <p className="kort-hjelp">
          Rollen {rollenavn(profil.role).toLowerCase()} har ingen kontorflater. Det er sannsynligvis
          en feil i rolleoppsettet — be en administrator se på det.
        </p>
      </Sperre>
    )
  }

  const kommandoer: Kommando[] = synlige.map(r => ({
    id: r.id,
    navn: r.navn,
    gruppe: r.gruppe,
    kjor: () => { window.location.hash = `#/${r.id}` },
  }))

  // Gruppene tegnes bare når de har noe i seg. En tom overskrift er verre enn
  // ingen overskrift, og rollen bestemmer hva som blir igjen.
  const grupper: { navn: string; ruter: typeof synlige }[] = []
  for (const r of synlige) {
    const siste = grupper[grupper.length - 1]
    if (siste && siste.navn === r.gruppe) siste.ruter = [...siste.ruter, r]
    else grupper.push({ navn: r.gruppe, ruter: [r] })
  }

  return (
    <div className="skall">
      <div className="skjerm">
        <nav className="rail">
          {/* Merket ER inngangen til assistenten, som i appen. Derfor er det en
              knapp og ikke en dekorasjon. */}
          <button className="merke" onClick={() => setAssistent(true)} title="Assistent (Ctrl+K)">
            <span className="merke-ikon"><AmpexLogo size={22} /></span>
            <span className="merke-navn">Ampex</span>
          </button>
          {/* Gruppene deler høyden mellom seg i forhold til hvor mange valg de
              har, og hvert valg strekker seg innenfor gruppa si. Menyen fyller
              da hele kolonnen uansett om firmaet har fire moduler eller elleve,
              i stedet for å klumpe seg øverst med et tomt felt under. */}
          {grupper.map(g => (
            <div key={g.navn} className="rail-bolk" style={{ flexGrow: g.ruter.length }}>
              <div className="rail-gruppe">{g.navn}</div>
              {g.ruter.map(r => (
                <button
                  key={r.id}
                  className="rail-lenke"
                  aria-current={r.id === aktiv.id ? 'page' : undefined}
                  onClick={() => { window.location.hash = `#/${r.id}` }}
                >
                  <r.ikon size={18} strokeWidth={1.8} />
                  {r.navn}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main className="flate">{aktiv.vis()}</main>
      </div>

      <Assistent apen={assistent} lukk={() => setAssistent(false)} kommandoer={kommandoer} />
    </div>
  )
}

function Sperre({
  tittel,
  avslutt,
  children,
}: {
  tittel: string
  avslutt?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="logginn">
      <div className="logginn-kort stabel">
        <Kort tittel={tittel}>{children}</Kort>
        {avslutt ? <Knapp onClick={avslutt}>Logg ut</Knapp> : null}
      </div>
    </div>
  )
}

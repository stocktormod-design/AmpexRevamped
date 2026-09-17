import { kan, rollenavn, type Rettighet } from '@delt/kontor-tilgang'
import { Building2, Calculator, ClipboardList, Ellipsis, FileText, FlaskConical, FolderKanban, Globe, House, Package, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '@/auth'
import { erAmpexAdmin } from '@/lib/brukere'
import { AmpexAdmin } from '@/ruter/AmpexAdmin'
import { Firma } from '@/ruter/Firma'
import { Internkontroll } from '@/ruter/Internkontroll'
import { InternkontrollV2 } from '@/ruter/InternkontrollV2'
import { Kunder } from '@/ruter/Kunder'
import { Logginn, NyttPassord } from '@/ruter/Logginn'
import { Meg } from '@/ruter/Meg'
import { MinDag } from '@/ruter/MinDag'
import { MineOrdre } from '@/ruter/MineOrdre'
import { Ordre } from '@/ruter/Ordre'
import { Oversikt } from '@/ruter/Oversikt'
import { Prosjekter } from '@/ruter/Prosjekter'
import { Skjemaer } from '@/ruter/Skjemaer'
import { Tilbud } from '@/ruter/Tilbud'
import { Varer } from '@/ruter/Varer'
import { mangler } from '@/supabase'
import { AmpexLogo } from '@/ui/AmpexLogo'
import { Assistent, type Kommando } from '@/ui/Assistent'
import { Chatboble } from '@/ui/Chatboble'
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
 * FIRMA er oppsettet man rører sjelden. MEG er det som gjelder deg selv.
 *
 * **Timer, Skann og Prisfiler står ikke i menyen** (14. september). Flatene
 * finnes fortsatt i `src/ruter/` og kan hentes tilbake ved å legge raden inn
 * igjen; det er knappene som er tatt bort, ikke koden. Dine egne timer ligger
 * på Meg.
 */
const RUTER = [
  { id: 'oversikt', navn: 'Oversikt', gruppe: 'Arbeid', ikon: House, rett: 'kontor' as Rettighet, vis: () => <Oversikt /> },
  { id: 'ordre', navn: 'Ordre', gruppe: 'Arbeid', ikon: ClipboardList, rett: 'ordre.les' as Rettighet, vis: () => <Ordre /> },
  { id: 'prosjekt', navn: 'Prosjekter', gruppe: 'Arbeid', ikon: FolderKanban, rett: 'prosjekt.les' as Rettighet, vis: () => <Prosjekter /> },
  { id: 'tilbud', navn: 'Tilbud', gruppe: 'Arbeid', ikon: Calculator, rett: 'tilbud.les' as Rettighet, vis: () => <Tilbud /> },

  { id: 'kunder', navn: 'Kunder', gruppe: 'Register', ikon: Users, rett: 'kunder.les' as Rettighet, vis: () => <Kunder /> },
  { id: 'varer', navn: 'Varer', gruppe: 'Register', ikon: Package, rett: 'varer.les' as Rettighet, vis: () => <Varer /> },

  { id: 'ik', navn: 'Internkontroll', gruppe: 'Kvalitet', ikon: ShieldCheck, rett: 'ik.les' as Rettighet, vis: () => <Internkontroll /> },
  // PRØVEFLATE (17. september). Tre nivåer: formål → punkt → rutine, med tagger.
  // Skal den bort: slett denne raden, de to importene, src/ruter/InternkontrollV2.tsx,
  // src/lib/ik2-lager.ts og de tre ik2_-tabellene. Ingenting annet peker på den.
  { id: 'ik2', navn: 'Internkontroll v2', gruppe: 'Kvalitet', ikon: FlaskConical, rett: 'ik.les' as Rettighet, vis: () => <InternkontrollV2 /> },
  { id: 'skjema', navn: 'Skjemaer', gruppe: 'Kvalitet', ikon: FileText, rett: 'skjema.les' as Rettighet, vis: () => <Skjemaer /> },

  { id: 'firma', navn: 'Firma', gruppe: 'Firma', ikon: Building2, rett: 'firma.les' as Rettighet, vis: () => <Firma /> },

  { id: 'meg', navn: 'Meg', gruppe: 'Meg', ikon: UserRound, rett: 'kontor' as Rettighet, vis: () => <Meg /> },
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

/**
 * MONTØRFLATENE — en annen app i samme skall.
 *
 * Montøren og lærlingen har ikke kontoret; de har jobben sin. Se `min.dag` i
 * `lib/kontor-tilgang.ts` for hvorfor det er en egen inngang og ikke et
 * svakere kontor.
 *
 * `Meg` er den samme ruta som kontoret bruker, og det er med vilje: egne timer,
 * tema, tofaktor og «slett meg» er de samme spørsmålene uansett hvilken flate
 * du kom fra. Den har ingen rollesperre i seg.
 */
const MONTOR_RUTER = [
  { id: 'hjem', navn: 'Hjem', gruppe: 'Jobb', ikon: House, rett: 'min.dag' as Rettighet, vis: () => <MinDag /> },
  { id: 'mine-ordre', navn: 'Ordre', gruppe: 'Jobb', ikon: ClipboardList, rett: 'min.dag' as Rettighet, vis: () => <MineOrdre /> },
  { id: 'meg', navn: 'Meg', gruppe: 'Meg', ikon: UserRound, rett: 'min.dag' as Rettighet, vis: () => <Meg /> },
] as const

/**
 * Rekkefølgen bunnlinja på telefon plukker fra.
 *
 * Sidemenyen står i den rekkefølgen kontoret JOBBER i flatene, ovenfra og ned,
 * og har plass til alle ni. Bunnlinja har plass til fem, og da er det ikke
 * arbeidsdagen som bestemmer, men hvor ofte en tommel treffer dem. Resten ligger
 * ett trykk unna under «Mer» — ingenting er borte, bare lenger ned.
 *
 * Internkontroll står foran Prosjekter med vilje: det er den flata noen faktisk
 * sitter med på telefon.
 */
const TELEFONORDEN = ['oversikt', 'ordre', 'ik', 'meg'] as const

/** Maks antall knapper i bunnlinja, «Mer» medregnet. Over fem blir de for smale å treffe. */
const BUNNPLASSER = 5

type Rute = (typeof RUTER)[number] | (typeof MONTOR_RUTER)[number] | typeof AMPEX_RUTE

export function App() {
  const { sesjon, profil, laster, feil, gjenoppretting, loggUt } = useAuth()
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const påHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', påHash)
    return () => window.removeEventListener('hashchange', påHash)
  }, [])

  const [assistent, setAssistent] = useState(false)
  const [mer, setMer] = useState(false)

  // Spoerres for hver innlogging, ikke bufres. Svaret er nei for alle andre enn
  // et par personer, og en tabell med én policy er billig å spørre.
  const [ampexAdmin, setAmpexAdmin] = useState(false)
  useEffect(() => {
    if (!profil) { setAmpexAdmin(false); return }
    let avbrutt = false
    erAmpexAdmin().then(ja => { if (!avbrutt) setAmpexAdmin(ja) })
    return () => { avbrutt = true }
  }, [profil])

  // Rollen velger FLATESETT, ikke bare hvilke rader som filtreres bort. En
  // montør er ikke en kontorbruker med færre knapper — han skal ha en annen app.
  const iFelt = kan(profil?.role, 'min.dag')
  const synlige: Rute[] = iFelt
    ? MONTOR_RUTER.filter(r => kan(profil?.role, r.rett))
    : [
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
  // Sperra gjelder den som verken har kontoret eller feltflaten. Montøren og
  // lærlingen slapp tidligere ikke inn i det hele tatt, med beskjed om å bruke
  // appen — den beskjeden holdt ikke for en Android-telefon, som ikke har noen
  // app å bruke. Nå har de `min.dag`.
  if (!ampexAdmin && !kan(profil.role, 'kontor') && !iFelt) {
    return (
      <Sperre tittel="Ingen flate for denne rollen" avslutt={loggUt}>
        <p className="kort-hjelp">
          Du er logget inn som {rollenavn(profil.role).toLowerCase()}, og den rollen har ingen flater
          her. Be en administrator se på rolleoppsettet.
        </p>
      </Sperre>
    )
  }

  // Rollen kan ha mistet en rettighet siden forrige økt. Da skal den falle
  // tilbake til første synlige rute, ikke vise en tom flate.
  // Bare første ledd velger flate. Leddene etter er flatens egne (internkontroll
  // v2 legger kapittel/punkt/rutine der, så tilbake-knappen virker).
  const bedt = hash.replace('#/', '').split('/')[0]
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

  // Bunnlinja på telefon. Får alt plass, slipper «Mer» — en knapp som bare
  // åpner et ark med ingenting nytt i er verre enn ingen knapp.
  const alt_får_plass = synlige.length <= BUNNPLASSER
  const bunn = alt_får_plass
    ? synlige
    : [
        ...TELEFONORDEN.map(id => synlige.find(r => r.id === id)).filter(r => r !== undefined),
        // Har rollen mistet en av de fire, fylles plassen fra menyens egen
        // rekkefølge i stedet for å stå tom.
        ...synlige.filter(r => !TELEFONORDEN.some(id => id === r.id)),
      ].slice(0, BUNNPLASSER - 1)

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

        {/* Bunnlinja erstatter sidemenyen på telefon. Begge tegnes alltid;
            stilarket viser den ene og skjuler den andre. Å bytte mellom dem i
            JS ville betydd en mediespørring i React, en ny tegning ved hver
            rotasjon, og en flimrende meny mens den avgjorde seg. */}
        <nav className="bunnlinje">
          {bunn.map(r => (
            <button
              key={r.id}
              className="bunnknapp"
              aria-current={r.id === aktiv.id ? 'page' : undefined}
              onClick={() => { window.location.hash = `#/${r.id}` }}
            >
              <r.ikon size={22} strokeWidth={1.8} />
              <span>{r.navn}</span>
            </button>
          ))}
          {!alt_får_plass ? (
            <button
              className="bunnknapp"
              aria-expanded={mer}
              // Den er «gjeldende» når du står på en flate som ikke har egen
              // knapp — ellers ser bunnlinja ut som om ingenting er valgt.
              aria-current={bunn.some(r => r.id === aktiv.id) ? undefined : 'page'}
              onClick={() => setMer(true)}
            >
              <Ellipsis size={22} strokeWidth={1.8} />
              <span>Mer</span>
            </button>
          ) : null}
        </nav>
      </div>

      {mer ? (
        <Mer
          grupper={grupper}
          aktiv={aktiv.id}
          lukk={() => setMer(false)}
          gaaTil={id => { window.location.hash = `#/${id}`; setMer(false) }}
          assistent={() => { setMer(false); setAssistent(true) }}
        />
      ) : null}

      <Assistent apen={assistent} lukk={() => setAssistent(false)} kommandoer={kommandoer} />

      {/* Chatten ligger i skallet og følger derfor med på hver flate — det er
          hele poenget: endringsønsket skrives mens flata det gjelder står
          foran deg. Se src/ui/Chatboble.tsx. */}
      <Chatboble />
    </div>
  )
}

/**
 * «Mer»-arket: resten av menyen, gruppert akkurat som sidemenyen.
 *
 * Det er et ark fra bunnen og ikke en skjerm, fordi det er en meny og ikke en
 * flate — du skal se at kontoret fortsatt ligger bak. Bakgrunnen lukker det,
 * som alle ark på en telefon.
 */
function Mer({
  grupper,
  aktiv,
  lukk,
  gaaTil,
  assistent,
}: {
  grupper: { navn: string; ruter: readonly { id: string; navn: string; ikon: typeof House }[] }[]
  aktiv: string
  lukk: () => void
  gaaTil: (id: string) => void
  assistent: () => void
}) {
  useEffect(() => {
    const paaTast = (e: KeyboardEvent) => { if (e.key === 'Escape') lukk() }
    window.addEventListener('keydown', paaTast)
    return () => window.removeEventListener('keydown', paaTast)
  }, [lukk])

  return (
    <div className="ark-bak" onClick={lukk}>
      <div className="ark" onClick={e => e.stopPropagation()} role="dialog" aria-label="Mer">
        <div className="ark-tak" />
        {grupper.map(g => (
          <div key={g.navn} className="ark-bolk">
            <div className="rail-gruppe">{g.navn}</div>
            {g.ruter.map(r => (
              <button
                key={r.id}
                className="ark-lenke"
                aria-current={r.id === aktiv ? 'page' : undefined}
                onClick={() => gaaTil(r.id)}
              >
                <r.ikon size={20} strokeWidth={1.8} />
                {r.navn}
              </button>
            ))}
          </div>
        ))}
        <div className="ark-bolk">
          <div className="rail-gruppe">Assistent</div>
          <button className="ark-lenke" onClick={assistent}>
            <AmpexLogo size={20} />
            Spør Ampex
          </button>
        </div>
      </div>
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

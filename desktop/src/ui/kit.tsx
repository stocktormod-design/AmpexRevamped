import { rollenavn } from '@delt/kontor-tilgang'
import { LogOut } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useAuth } from '@/auth'

/**
 * Kontorets byggeklosser. Bevisst få og bevisst tynne: alt visuelt bor i
 * `styles.css`. En komponent som trenger en farge som ikke finnes der, er en
 * komponent som skal vente på at fargen får et navn.
 */

type KnappStil = 'primar' | 'merke' | 'stille' | 'naken'

export function Knapp({
  stil = 'stille',
  children,
  ...rest
}: { stil?: KnappStil } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`knapp knapp-${stil}`} {...rest}>
      {children}
    </button>
  )
}

/** Rund ikonknapp — verktøyet i hjørnet av et kort, og i toppbaren. */
export function Ikonknapp({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="ikonknapp" {...rest}>
      {children}
    </button>
  )
}

export function Felt({
  etikett,
  hjelp,
  firkant,
  ...rest
}: {
  etikett?: string
  hjelp?: string
  /** Firkantet i stedet for pilleform. Pillen hører til søk, ikke til skjemafelt. */
  firkant?: boolean
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={firkant ? 'felt felt-firkant' : 'felt'}>
      {etikett ? <span className="felt-etikett">{etikett}</span> : null}
      <input className="felt-inn" {...rest} />
      {hjelp ? <span className="felt-hjelp">{hjelp}</span> : null}
    </label>
  )
}

/**
 * Sidehodet: tittel og undertittel til venstre, flatens egne verktøy og
 * brukeren til høyre.
 *
 * Brukeren står her og ikke i en egen toppbar over hele bredden. Det er ikke
 * kosmetikk: en toppbar til ville vært et fjerde vannrett bånd før innholdet
 * begynner, og hvert bånd stjeler høyde fra det man faktisk kom for.
 *
 * Undertittelen er ikke pynt — den forteller hva flaten er TIL.
 */
export function Sidehode({
  tittel,
  under,
  handling,
}: {
  tittel: string
  under?: string
  handling?: ReactNode
}) {
  const { profil, loggUt } = useAuth()
  return (
    <header className="sidehode">
      <div className="sidehode-tekst">
        <h1>{tittel}</h1>
        {under ? <p className="sidehode-under">{under}</p> : null}
      </div>
      <div className="sidehode-hoyre">
        {handling}
        {profil ? (
          <div className="bruker">
            <div className="bruker-merke">{initialer(profil.full_name)}</div>
            <div>
              <div className="bruker-navn">{profil.full_name}</div>
              <div className="bruker-rolle">{rollenavn(profil.role)}</div>
            </div>
          </div>
        ) : null}
        <Ikonknapp onClick={loggUt} title="Logg ut" aria-label="Logg ut">
          <LogOut size={17} strokeWidth={1.8} />
        </Ikonknapp>
      </div>
    </header>
  )
}

export function Kort({
  merkelapp,
  tittel,
  verktoy,
  tett,
  children,
}: {
  merkelapp?: string
  tittel?: ReactNode
  verktoy?: ReactNode
  tett?: boolean
  children?: ReactNode
}) {
  return (
    <section className={tett ? 'kort kort-tett' : 'kort'}>
      {tittel || merkelapp || verktoy ? (
        <div className="kort-hode">
          <div className="kort-hode-tekst">
            {merkelapp ? <div className="kort-merkelapp">{merkelapp}</div> : null}
            {tittel ? <div className="kort-tittel">{tittel}</div> : null}
          </div>
          {verktoy ? <div className="kort-verktoy">{verktoy}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** Alias — flere skjermer sier «panel» om et enkelt kort. */
export function Panel({ tittel, hoyre, children }: { tittel?: ReactNode; hoyre?: ReactNode; children: ReactNode }) {
  return (
    <Kort tittel={tittel} verktoy={hoyre}>
      {children}
    </Kort>
  )
}

type MerkeStil = 'ny' | 'endret' | 'varsel' | 'feil' | 'noytral'

export function Merke({ stil = 'noytral', children }: { stil?: MerkeStil; children: ReactNode }) {
  return <span className={`merkelapp merkelapp-${stil}`}>{children}</span>
}

export function Beskjed({ stil, children }: { stil: 'feil' | 'varsel' | 'ok'; children: ReactNode }) {
  return <div className={`beskjed beskjed-${stil}`}>{children}</div>
}

export type Statistikk = {
  /** Liten etikett over tittelen: «Denne måneden», «Nå». */
  over?: string
  navn: string
  verdi: string | number
  /** Én linje under tallet. Sammenligning, andel, presisering. */
  under?: string
  /** Fremhev underteksten i kobber. Brukes når linja er verdt å se på. */
  aksent?: boolean
}

/**
 * Nøkkeltall med stor talltypografi.
 *
 * Tallet er hovedsaken på kortet, ikke etiketten over det. Seks små etiketter
 * på en rad er en tabell uten kolonner; dette er tall som kan leses på
 * armlengdes avstand, som er slik kontoret faktisk bruker dem.
 */
export function Nokkeltall({ tall }: { tall: Statistikk[] }) {
  return (
    <div className="statrad">
      {tall.map(t => {
        // «ukjent» satt i 42 px halvfet ser ut som et tall og leses som et tall.
        // Ord får sin egen, roligere grad.
        const erTall = /^[−-]?[\d\s .,]+( kr| %|)$/.test(String(t.verdi))
        return (
          <div className="kort" key={t.navn}>
            {t.over ? <div className="kort-merkelapp">{t.over}</div> : null}
            <div className="kort-tittel">{t.navn}</div>
            <div className={erTall ? 'stat-tall' : 'stat-tall stat-tall-ord'}>{t.verdi}</div>
            {t.under ? (
              <div className={t.aksent ? 'stat-under stat-aksent' : 'stat-under'}>{t.under}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function Tomt({ children }: { children: ReactNode }) {
  return <div className="tomt">{children}</div>
}

const KRONER = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ANTALL = new Intl.NumberFormat('nb-NO')

export function kroner(v: number | null | undefined): string {
  return v == null ? '' : KRONER.format(v)
}

export function antall(v: number): string {
  return ANTALL.format(v)
}

/**
 * «1 linje» og «3 linjer». Norsk entall og flertall er billig å få riktig og
 * dyrt å la være: «1 linjer mangler el-nummer» leser som en feil i systemet,
 * ikke som en feil i fila.
 */
export function stk(v: number, ental: string, flertall: string): string {
  return `${antall(v)} ${v === 1 ? ental : flertall}`
}

/** Initialer til brukerpillen. «Tormod Stokke» blir «TS». */
export function initialer(navn: string): string {
  const deler = navn.trim().split(/\s+/).filter(Boolean)
  if (deler.length === 0) return '?'
  if (deler.length === 1) return deler[0].slice(0, 2).toUpperCase()
  return (deler[0][0] + deler[deler.length - 1][0]).toUpperCase()
}

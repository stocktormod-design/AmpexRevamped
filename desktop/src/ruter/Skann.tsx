import { CircleAlert, Monitor, Smartphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  bytes,
  hentSkannkoe,
  nodeOppe,
  STATUSNAVN,
  VENTER_PAA_NAVN,
  type Node,
  type Poolstatus,
  type Skannjobb,
} from '@/lib/skann-lager'
import { Beskjed, Kort, Merke, Sidehode, stk } from '@/ui/kit'
import { Tabell, type Kolonne } from '@/ui/Tabell'

/**
 * Skannekøen sett fra kontoret.
 *
 * Den øverste bolken er hele grunnen til at flata finnes: skann som ligger på
 * en telefon og ikke er lastet opp ennå. De finnes som rader i basen fra det
 * øyeblikket montøren trykker ferdig, nettopp for at kontoret skal se dem —
 * ellers er dokumentasjonen usynlig for alle andre enn den som tok den, helt
 * til han kommer innenfor wifi.
 *
 * Tallene her regnes ikke: køposisjon og anslag eies av
 * `scan_job_queue_position` i databasen, som bruker faktisk brukt tid på
 * fullførte jobber i samme firma.
 */

function dato(s: string | null): string {
  if (!s) return '–'
  return new Date(s).toLocaleString('nb-NO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function statusmerke(j: Skannjobb) {
  if (j.status === 'failed') return <Merke stil="feil">{STATUSNAVN.failed}</Merke>
  if (j.status === 'venter') return <Merke stil="varsel">{STATUSNAVN.venter}</Merke>
  if (j.status === 'running' || j.status === 'claimed') {
    return <Merke stil="ny">{STATUSNAVN[j.status]}</Merke>
  }
  if (j.status === 'done') return <Merke stil="endret">{STATUSNAVN.done}</Merke>
  return <Merke stil="noytral">{STATUSNAVN[j.status]}</Merke>
}

export function Skann() {
  const [data, setData] = useState<Poolstatus | null>(null)
  const [feil, setFeil] = useState<string | null>(null)
  const [laster, setLaster] = useState(true)

  useEffect(() => {
    let avbrutt = false
    const last = () => {
      hentSkannkoe()
        .then(d => { if (!avbrutt) { setData(d); setFeil(null) } })
        .catch(e => { if (!avbrutt) setFeil(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (!avbrutt) setLaster(false) })
    }
    last()
    // En bake tar minutter. Uten oppdatering står fremdriften stille på skjermen
    // mens den beveger seg i basen, og da tror man at noe har hengt seg.
    const t = setInterval(last, 15_000)
    return () => { avbrutt = true; clearInterval(t) }
  }, [])

  const bolker = useMemo(() => {
    const j = data?.jobber ?? []
    return {
      venter: j.filter(x => x.status === 'venter'),
      // Tildelt og bakes hører sammen: begge betyr «en maskin har den nå».
      underveis: j.filter(x => ['queued', 'claimed', 'running'].includes(x.status)),
      ferdig: j.filter(x => x.status === 'done'),
      feilet: j.filter(x => x.status === 'failed'),
    }
  }, [data])

  if (feil) {
    return (
      <>
        <Sidehode tittel="Skann" />
        <Beskjed stil="feil">{feil}</Beskjed>
      </>
    )
  }
  if (laster || !data) {
    return (
      <>
        <Sidehode tittel="Skann" />
        <p className="dempet-mer">Laster …</p>
      </>
    )
  }

  const oppe = data.noder.filter(nodeOppe).length
  const andel = data.tak_per_mnd > 0 ? data.forbruk / data.tak_per_mnd : 0

  return (
    <>
      <Sidehode
        tittel="Skann"
        under={`${stk(oppe, 'maskin', 'maskiner')} klar · ${bytes(data.forbruk)} av ${bytes(data.tak_per_mnd)} brukt siste 30 dager`}
      />

      {/* ── På telefonene ────────────────────────────────────────────────────
          Står øverst fordi det er den eneste bolken kontoret kan gjøre noe med:
          ringe montøren. Resten går av seg selv. */}
      {bolker.venter.length > 0 ? (
        <Kort
          merkelapp="Ikke lastet opp"
          tittel={stk(bolker.venter.length, 'skann ligger på en telefon', 'skann ligger på telefoner')}
        >
          <Tabell
            rader={bolker.venter}
            nokkel={j => j.id}
            kolonner={koloVenter}
            tomTekst="Ingenting ligger og venter."
          />
        </Kort>
      ) : null}

      {bolker.underveis.length > 0 ? (
        <Kort merkelapp="Underveis" tittel={stk(bolker.underveis.length, 'skann', 'skann')}>
          <Tabell rader={bolker.underveis} nokkel={j => j.id} kolonner={koloUnderveis} />
        </Kort>
      ) : null}

      {bolker.feilet.length > 0 ? (
        <Kort merkelapp="Feilet" tittel={stk(bolker.feilet.length, 'skann', 'skann')}>
          <Tabell rader={bolker.feilet} nokkel={j => j.id} kolonner={koloFeilet} />
        </Kort>
      ) : null}

      <Kort merkelapp="Ferdig" tittel={stk(bolker.ferdig.length, 'skann', 'skann')}>
        <Tabell
          rader={bolker.ferdig}
          nokkel={j => j.id}
          kolonner={koloFerdig}
          tomTekst="Ingen ferdige skann ennå."
        />
      </Kort>

      <Kort merkelapp="Bakepool" tittel={stk(data.noder.length, 'maskin', 'maskiner')}>
        {data.noder.length === 0 ? (
          <p className="dempet-mer">
            Ingen maskiner er meldt inn. Uten en egen PC må skannene bakes i Ampex-poolen,
            og det krever at firmaet har slått den på under Firma.
          </p>
        ) : (
          <Tabell rader={data.noder} nokkel={n => n.id} kolonner={koloNoder} />
        )}
        {andel > 0.8 ? (
          <Beskjed stil="varsel">
            {Math.round(andel * 100)} % av kvoten er brukt siste 30 dager. Over taket
            blir nye skann avvist ved opplasting, ikke ved baking.
          </Beskjed>
        ) : null}
      </Kort>
    </>
  )
}

// ── Kolonner ───────────────────────────────────────────────────────────────

const koloVenter: Kolonne<Skannjobb>[] = [
  {
    nokkel: 'hvem',
    navn: 'Tatt av',
    bredde: 'minmax(0,1.4fr)',
    celle: j => (
      <span className="rad">
        <Smartphone size={14} strokeWidth={1.8} className="dempet" />
        {j.tatt_av || 'Ukjent'}
      </span>
    ),
  },
  {
    nokkel: 'grunn',
    navn: 'Hvorfor',
    bredde: 'minmax(0,1.6fr)',
    celle: j => (j.venter_paa ? VENTER_PAA_NAVN[j.venter_paa] ?? j.venter_paa : '–'),
  },
  { nokkel: 'st', navn: 'Størrelse', bredde: '110px', tall: true, celle: j => bytes(j.bundle_bytes) },
  { nokkel: 'ram', navn: 'Rammer', bredde: '90px', tall: true, celle: j => j.frame_count ?? '–' },
  { nokkel: 'nar', navn: 'Skannet', bredde: '150px', celle: j => dato(j.created_at) },
]

const koloUnderveis: Kolonne<Skannjobb>[] = [
  { nokkel: 'status', navn: 'Status', bredde: '120px', celle: statusmerke },
  {
    nokkel: 'frem',
    navn: 'Fremdrift',
    bredde: 'minmax(0,1fr)',
    celle: j =>
      j.status === 'queued' ? <span className="dempet-mer">venter på en maskin</span>
        : `${Math.round((j.progress ?? 0) * 100)} %`,
  },
  {
    nokkel: 'pool',
    navn: 'Pool',
    bredde: '130px',
    // Hvor skannet faktisk bakes er ikke en detalj: 'ampex' betyr at det ligger
    // på en maskin firmaet ikke eier.
    celle: j => (j.pool === 'ampex' ? <Merke stil="varsel">Ampex</Merke> : 'Egen maskin'),
  },
  { nokkel: 'hvem', navn: 'Tatt av', bredde: 'minmax(0,1fr)', celle: j => j.tatt_av || 'Ukjent' },
  { nokkel: 'st', navn: 'Størrelse', bredde: '110px', tall: true, celle: j => bytes(j.uploaded_bytes ?? j.bundle_bytes) },
]

const koloFeilet: Kolonne<Skannjobb>[] = [
  { nokkel: 'hvem', navn: 'Tatt av', bredde: 'minmax(0,1fr)', celle: j => j.tatt_av || 'Ukjent' },
  {
    nokkel: 'feil',
    navn: 'Feil',
    bredde: 'minmax(0,2.4fr)',
    celle: j => (
      <span className="rad" title={j.error ?? ''}>
        <CircleAlert size={14} strokeWidth={1.9} style={{ color: 'var(--rod)', flex: 'none' }} />
        <span className="strekk">{j.error ?? 'ukjent feil'}</span>
      </span>
    ),
  },
  { nokkel: 'nar', navn: 'Skannet', bredde: '150px', celle: j => dato(j.created_at) },
]

const koloFerdig: Kolonne<Skannjobb>[] = [
  { nokkel: 'hvem', navn: 'Tatt av', bredde: 'minmax(0,1fr)', celle: j => j.tatt_av || 'Ukjent' },
  {
    nokkel: 'hva',
    navn: 'Resultat',
    bredde: '140px',
    celle: j => (j.kind === 'begge' ? 'Splat + mesh' : j.kind === 'splat' ? 'Splat' : 'Mesh'),
  },
  {
    nokkel: 'fyll',
    navn: 'Fyllgrad',
    bredde: '100px',
    tall: true,
    // Andel av teksturen som faktisk fikk farge. Lav fyllgrad betyr hull der
    // ingen kamera så flaten — det er en skannefeil, ikke en bakefeil.
    celle: j => (j.filled_fraction != null ? `${Math.round(j.filled_fraction * 100)} %` : '–'),
  },
  {
    nokkel: 'tid',
    navn: 'Baketid',
    bredde: '100px',
    tall: true,
    celle: j => (j.gpu_ms ? `${Math.round(j.gpu_ms / 1000)} s` : '–'),
  },
  {
    nokkel: 'ryddet',
    navn: 'Ryddet',
    bredde: '150px',
    // Både telefonen og R2 skal kvitte seg med rammene. Står det tomt her, ligger
    // et LiDAR-skann av kundens bolig fortsatt i to eksemplarer.
    celle: j => (j.frames_deleted_at ? dato(j.frames_deleted_at) : <span className="dempet-mer">på telefonen ennå</span>),
  },
]

const koloNoder: Kolonne<Node>[] = [
  {
    nokkel: 'navn',
    navn: 'Maskin',
    bredde: 'minmax(0,1.2fr)',
    celle: n => (
      <span className="rad">
        <Monitor size={14} strokeWidth={1.8} className="dempet" />
        {n.name}
      </span>
    ),
  },
  { nokkel: 'gpu', navn: 'Skjermkort', bredde: 'minmax(0,1.4fr)', celle: n => n.gpu_name ?? 'ukjent' },
  { nokkel: 'ver', navn: 'Versjon', bredde: '100px', celle: n => n.worker_version ?? '–' },
  {
    nokkel: 'pool',
    navn: 'Pool',
    bredde: '120px',
    celle: n => (n.is_public ? <Merke stil="varsel">Ampex</Merke> : 'Firma'),
  },
  {
    nokkel: 'st',
    navn: 'Tilstand',
    bredde: '120px',
    celle: n =>
      n.revoked_at ? <Merke stil="feil">Trukket</Merke>
        : nodeOppe(n) ? <Merke stil="endret">Oppe</Merke>
          : <Merke stil="noytral">Nede</Merke>,
  },
  { nokkel: 'puls', navn: 'Sist sett', bredde: '150px', celle: n => dato(n.last_heartbeat_at) },
]

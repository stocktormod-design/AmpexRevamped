import { Q } from '@nozbe/watermelondb'
import { useEffect, useState } from 'react'
import { database } from '../db'
import { Activity } from '../db/models/activity'
import { Customer } from '../db/models/customer'
import { Order } from '../db/models/order'
import { OrderApproval } from '../db/models/order-approval'
import { OrderArchive } from '../db/models/order-archive'
import { OrderDocument } from '../db/models/order-document'
import { OrderExtra } from '../db/models/order-extra'
import { OrderMaterial } from '../db/models/order-material'
import { OrderScan } from '../db/models/order-scan'
import { OrderSignature } from '../db/models/order-signature'
import { TimeEntry } from '../db/models/time-entry'
import { syncQuietly } from '../db/sync'
import { signedR2Url } from '../drawings-storage'
import { supabase } from '../supabase'
import { arkivNokkel, byggPakke, type Arkivinnhold } from './bundle'

/**
 * Frysing: fra levende ordre til uforanderlig arkiv.
 *
 * **Hvorfor dette ikke hører hjemme på en montørtelefon i lengden:** det er en
 * batchjobb med nett, og den bør kjøre av seg selv når en ordre blir fakturert.
 * Foreløpig kjøres den fra appen fordi R2-kanalen (`r2-sign`) allerede finnes
 * der, og fordi én knapp er bedre enn en Edge Function som ikke er skrevet. Når
 * Ampex Desktop finnes, flyttes den dit uendret — `byggPakke` er ren.
 */

export class KanIkkeFryses extends Error {
  constructor(grunn: string) {
    super(grunn)
    this.name = 'KanIkkeFryses'
  }
}

async function samle(order: Order): Promise<Arkivinnhold> {
  const [kunde, materiell, timer, tillegg, dokumenter, signaturer, godkjenninger, skann, aktiviteter] =
    await Promise.all([
      order.customerId
        ? database.get<Customer>('customers').find(order.customerId).catch(() => null)
        : Promise.resolve(null),
      database.get<OrderMaterial>('order_materials').query(Q.where('order_id', order.id)).fetch(),
      database.get<TimeEntry>('time_entries').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderExtra>('order_extras').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderDocument>('order_documents').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderSignature>('order_signatures').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderApproval>('order_approvals').query(Q.where('order_id', order.id)).fetch(),
      database.get<OrderScan>('order_scans').query(Q.where('order_id', order.id)).fetch(),
      database.get<Activity>('activities').query().fetch(),
    ])
  const aktivitetNavn = new Map(aktiviteter.map(a => [a.id, a.name]))

  return {
    ordre: {
      ordrenummer: order.orderNumber,
      tittel: order.title,
      beskrivelse: order.description,
      status: order.status,
      // Adressen fra ORDREN, ikke fra kunderegisteret: jobben ble utført et
      // sted, og det stedet endrer seg ikke om kunden flytter.
      adresse: order.address,
      opprettet: order.createdAt,
      fakturert: order.invoicedAt,
    },
    kunde: kunde
      ? {
          navn: kunde.name, orgnr: kunde.orgNr, epost: kunde.email,
          telefon: kunde.phone, adresse: kunde.postalAddress || null,
        }
      : order.customerName
        ? { navn: order.customerName, orgnr: null, epost: null, telefon: order.customerPhone, adresse: order.address }
        : null,
    materiell: materiell.map(m => ({
      beskrivelse: m.description, antall: m.quantity, enhet: m.unit,
      elnummer: m.elnummer, enhetspris: m.unitPrice,
    })),
    timer: timer.map(t => ({
      dato: t.date, timer: t.hours, person: t.userName,
      aktivitet: t.activityId ? aktivitetNavn.get(t.activityId) ?? null : null,
      // `internalNote` er ALDRI med: den er intern per definisjon, og et arkiv
      // kan bli lest ut i en tvist.
      notat: t.note,
    })),
    tillegg: tillegg.map(e => ({
      tittel: e.title, prising: e.pricing, status: e.status, godkjentAv: e.approvedBy,
    })),
    dokumenter: dokumenter.map(d => ({
      mal: d.templateId, malversjon: d.templateVersion, status: d.status,
      fullfortAv: d.completedBy, fullfortTid: d.completedAt,
      verdier: d.data ? JSON.parse(d.data) : {},
    })),
    signaturer: signaturer.map(s => ({
      formaal: s.purpose, signertAv: s.signerName, tittel: s.signerTitle,
      signertTid: s.signedAt, strok: s.punkter, merknad: s.note,
    })),
    godkjenninger: godkjenninger.map(a => ({
      beslutning: a.beslutning, godkjenner: a.godkjennerNavn,
      besluttetTid: a.besluttetAt, begrunnelse: a.begrunnelse,
    })),
    // Skann og tegninger ligger i R2 fra før — pakken peker på dem i stedet for
    // å kopiere hundrevis av megabyte inn i en JSON-fil.
    vedlegg: skann.map(s => s.scanPath).filter((x): x is string => !!x),
  }
}

/**
 * Fryser én ordre.
 *
 * Rekkefølgen er ikke tilfeldig: pakken lastes opp FØR registeroppføringen
 * skrives. Feiler opplastingen, finnes det ingen rad som lover et arkiv som
 * ikke er der. Motsatt rekkefølge ville gitt en peker til ingenting.
 */
export async function frysOrdre(order: Order): Promise<OrderArchive> {
  if (order.status !== 'fakturert') {
    throw new KanIkkeFryses('Bare fakturerte ordrer arkiveres.')
  }
  const godkjent = await database.get<OrderApproval>('order_approvals')
    .query(Q.where('order_id', order.id), Q.where('beslutning', 'godkjent')).fetchCount()
  if (godkjent === 0) {
    throw new KanIkkeFryses('Ordren mangler faglig godkjenning.')
  }

  const { data: sesjon } = await supabase.auth.getUser()
  const { data: firma } = await supabase.rpc('current_company_id')
  if (typeof firma !== 'string') throw new KanIkkeFryses('Fant ikke firmatilhørighet.')
  // Fristen leses ÉN gang, her. Skrus innstillingen ned senere, gjelder det
  // bare nye pakker — det som er lovet, står.
  const { data: frist } = await supabase.rpc('oppbevaring_til')

  const innhold = await samle(order)
  const pakke = byggPakke(innhold)
  const aar = (order.invoicedAt ?? order.createdAt).getFullYear()
  const nokkel = arkivNokkel(firma, aar, order.orderNumber, pakke.sha256)

  const url = await signedR2Url(nokkel, 'put')
  const svar = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: pakke.json,
  })
  if (!svar.ok) throw new KanIkkeFryses(`Opplasting til arkivet feilet (${svar.status}).`)

  let rad!: OrderArchive
  await database.write(async () => {
    // Eldre pakker for samme ordre soft-slettes: registeret peker alltid på én
    // gjeldende. Den gamle filen blir liggende i R2 — historikken skal ikke
    // forsvinne fordi noen fryste på nytt.
    const gamle = await database.get<OrderArchive>('order_archives')
      .query(Q.where('order_id', order.id)).fetch()
    for (const g of gamle) await g.markAsDeleted()

    rad = await database.get<OrderArchive>('order_archives').create(a => {
      a.orderId = order.id
      a.customerId = order.customerId
      a.customerName = innhold.kunde?.navn ?? order.customerName
      a.orderNumber = order.orderNumber
      a.aar = aar
      a.r2Key = nokkel
      a.sha256 = pakke.sha256
      a.bytes = pakke.bytes
      a.innhold = JSON.stringify(pakke.innhold)
      a.frossetAt = new Date()
      a.frossetAv = sesjon.user?.id ?? null
      a.oppbevaresTil = typeof frist === 'string' ? new Date(frist) : new Date()
    })
  })

  await supabase.rpc('log_audit_event', {
    p_hendelse: 'ordre arkivert',
    p_detaljer: { ordrenummer: order.orderNumber, sha256: pakke.sha256, bytes: pakke.bytes },
  }).then(() => {}, () => {}) // sporet skal aldri blokkere frysingen
  syncQuietly()
  return rad
}

/**
 * Henter pakken ned igjen og kontrollerer at den ikke er endret.
 *
 * Dette er hele grunnen til at hashen lagres. Uten en måte å SJEKKE på er
 * «uforanderlig arkiv» en påstand.
 */
export async function verifiserArkiv(rad: OrderArchive): Promise<{ ok: boolean; sha256: string }> {
  const url = await signedR2Url(rad.r2Key, 'get')
  const svar = await fetch(url)
  if (!svar.ok) throw new Error(`Fant ikke arkivet i R2 (${svar.status}).`)
  const { sha256Hex } = await import('./sha256')
  const sha = sha256Hex(await svar.text())
  return { ok: sha === rad.sha256, sha256: sha }
}

/* ── Lesing: «gamle jobber» ───────────────────────────────────────────────── */

export type Arkivfilter = { customerId?: string | null; aar?: number | null; sok?: string }

export function useArkiv(filter: Arkivfilter = {}): OrderArchive[] {
  const [rader, setRader] = useState<OrderArchive[]>([])
  const nokkel = JSON.stringify(filter)
  useEffect(() => {
    const f: Arkivfilter = JSON.parse(nokkel)
    const klausuler = []
    if (f.customerId) klausuler.push(Q.where('customer_id', f.customerId))
    if (f.aar) klausuler.push(Q.where('aar', f.aar))
    const sub = database.get<OrderArchive>('order_archives')
      .query(...klausuler, Q.sortBy('frosset_at', Q.desc))
      .observe()
      .subscribe(alle => {
        const q = (f.sok ?? '').trim().toLowerCase()
        setRader(!q ? alle : alle.filter(a =>
          (a.customerName ?? '').toLowerCase().includes(q)
          || String(a.orderNumber ?? '').includes(q),
        ))
      })
    return () => sub.unsubscribe()
  }, [nokkel])
  return rader
}

/** Årene det finnes arkiv for, nyeste først — grunnlaget for årsfilteret. */
export function useArkivAar(): number[] {
  const [aar, setAar] = useState<number[]>([])
  useEffect(() => {
    const sub = database.get<OrderArchive>('order_archives')
      .query().observeWithColumns(['aar'])
      .subscribe(rader => setAar([...new Set(rader.map(r => r.aar))].sort((a, b) => b - a)))
    return () => sub.unsubscribe()
  }, [])
  return aar
}

/** Er ordren allerede frosset? Brukes til å vise arkivmerket på ordredetaljen. */
export function useArkivFor(orderId: string | null | undefined): OrderArchive | null {
  const [rad, setRad] = useState<OrderArchive | null>(null)
  useEffect(() => {
    if (!orderId) { setRad(null); return }
    const sub = database.get<OrderArchive>('order_archives')
      .query(Q.where('order_id', orderId)).observe()
      .subscribe(rader => setRad(rader[0] ?? null))
    return () => sub.unsubscribe()
  }, [orderId])
  return rad
}

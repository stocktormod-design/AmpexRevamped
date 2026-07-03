// Delte dato/tid-formattere (nb-NO)

export function formatTime(d: Date | null) {
  return d?.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) ?? null
}

/** «tor. 3. jul. 08:00» — for detaljvisninger */
export function formatDateTime(d: Date | null) {
  if (!d) return null
  const date = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${date} ${formatTime(d)}`
}

/** Kort «siden sist»-format: nå, 12m, 3t, i går, 4d, ellers dato */
export function formatSince(d: Date) {
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'nå'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}t`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'i går'
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
}

/** Seconds → "12 min" / "1h 4min" / "2d" duration string. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '—'
  const totalMinutes = Math.round(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

/** Add `seconds` to now and return "HH:MM" in 24-hour format. */
export function formatEta(secondsFromNow: number): string {
  if (!Number.isFinite(secondsFromNow) || secondsFromNow < 0) return '—'
  const arrival = new Date(Date.now() + secondsFromNow * 1000)
  const hh = String(arrival.getHours()).padStart(2, '0')
  const mm = String(arrival.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

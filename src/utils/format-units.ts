/** Unit formatters used by the rail + sheet UI. */

export type DistanceUnit = 'km' | 'mi'
export type SpeedUnit = 'mps' | 'kph' | 'mph'

const METRES_PER_MILE = 1609.344
const METRES_PER_FOOT = 0.3048

export function formatDistance(metres: number, unit: DistanceUnit = 'mi'): string {
  if (!Number.isFinite(metres)) return '—'
  if (unit === 'mi') {
    if (metres < METRES_PER_FOOT * 1000) {
      // Show feet under 1000ft.
      return `${Math.round(metres / METRES_PER_FOOT)} ft`
    }
    const miles = metres / METRES_PER_MILE
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
  }
  if (metres < 1000) return `${Math.round(metres)} m`
  const km = metres / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatSpeed(mps: number, unit: SpeedUnit = 'mph'): string {
  if (!Number.isFinite(mps)) return '—'
  switch (unit) {
    case 'mps':
      return `${mps.toFixed(1)} m/s`
    case 'kph':
      return `${Math.round(mps * 3.6)} km/h`
    case 'mph':
      return `${Math.round(mps * 2.23694)} mph`
  }
}

/**
 * Navigation math — projection, off-route scoring, ETA helpers.
 *
 * Ported verbatim from SpeedDeck (frontend/src/renderer/src/lib/nav-utils.ts)
 * so behaviour stays identical to the reference implementation. Any
 * behavioural change should be made there first and re-applied here
 * (or vice versa, but keep the two in lockstep).
 *
 * Reference: /tmp/speeddeck/frontend/src/renderer/src/lib/nav-utils.ts
 */

import { haversineDistance } from '@/utils/haversine'

/**
 * Perpendicular distance from a point to a line segment, with the closest point on the segment.
 * All coordinates in degrees (lat/lon). Returns distance in meters.
 */
export function pointToSegmentDistance(
  px: number, py: number, // point (lon, lat)
  ax: number, ay: number, // segment start (lon, lat)
  bx: number, by: number, // segment end (lon, lat)
): { distance: number; projection: [number, number]; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  let t = 0
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
  }

  const projX = ax + t * dx
  const projY = ay + t * dy
  const distance = haversineDistance(py, px, projY, projX)

  return { distance, projection: [projX, projY], t }
}

/**
 * Find the nearest point on a route to the current position.
 * Searches a window around startIndex for efficiency.
 */
export function findNearestRoutePoint(
  lon: number, lat: number,
  coords: number[][], // [[lon, lat], ...]
  startIndex: number = 0,
  windowSize: number = 50,
): { segmentIndex: number; distance: number; projection: [number, number]; t: number } {
  const from = Math.max(0, startIndex - 5)
  const to = Math.min(coords.length - 2, startIndex + windowSize)

  let bestDist = Infinity
  let bestIdx = from
  let bestProj: [number, number] = coords[from] as [number, number]
  let bestT = 0

  for (let i = from; i <= to; i++) {
    const result = pointToSegmentDistance(
      lon, lat,
      coords[i][0], coords[i][1],
      coords[i + 1][0], coords[i + 1][1],
    )
    if (result.distance < bestDist) {
      bestDist = result.distance
      bestIdx = i
      bestProj = result.projection
      bestT = result.t
    }
  }

  return { segmentIndex: bestIdx, distance: bestDist, projection: bestProj, t: bestT }
}

/** Sum haversine distances between consecutive coordinates. */
export function distanceAlongCoords(coords: number[][], fromIdx: number, toIdx: number): number {
  let dist = 0
  for (let i = fromIdx; i < toIdx && i < coords.length - 1; i++) {
    dist += haversineDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
  }
  return dist
}

/**
 * Distance from a projected point (partway along a segment) to a target coordinate index.
 * Uses the interpolation factor `t` (0-1) to compute partial distance on the current segment.
 */
export function distanceAlongCoordsFromProjection(
  coords: number[][], segmentIndex: number, t: number, toIdx: number,
): number {
  if (segmentIndex >= toIdx) return 0

  const segLen = haversineDistance(
    coords[segmentIndex][1], coords[segmentIndex][0],
    coords[segmentIndex + 1][1], coords[segmentIndex + 1][0],
  )
  let dist = (1 - t) * segLen

  for (let i = segmentIndex + 1; i < toIdx && i < coords.length - 1; i++) {
    dist += haversineDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
  }
  return dist
}

/** Map a maneuver type + modifier to a Lucide icon name. */
export function maneuverIcon(type: string, modifier?: string): string {
  if (type === 'depart') return 'Navigation'
  if (type === 'arrive') return 'MapPin'

  switch (modifier) {
    case 'left':         return 'CornerUpLeft'
    case 'slight left':  return 'ArrowUpLeft'
    case 'sharp left':   return 'CornerDownLeft'
    case 'right':        return 'CornerUpRight'
    case 'slight right': return 'ArrowUpRight'
    case 'sharp right':  return 'CornerDownRight'
    case 'uturn':        return 'RefreshCw'
    case 'straight':     return 'ArrowUp'
    default:             return 'ArrowUp'
  }
}

/** Generate human-readable turn instruction text. */
export function maneuverInstruction(type: string, modifier?: string, streetName?: string): string {
  if (type === 'depart') return streetName ? `Head on ${streetName}` : 'Depart'
  if (type === 'arrive') return 'Arrive at destination'

  const direction = modifier
    ? modifier.charAt(0).toUpperCase() + modifier.slice(1)
    : ''

  if (type === 'turn' || type === 'end of road' || type === 'new name') {
    if (streetName) return `${direction} onto ${streetName}`
    return direction || 'Continue'
  }
  if (type === 'merge') return streetName ? `Merge onto ${streetName}` : 'Merge'
  if (type === 'fork') return `Keep ${modifier || 'straight'}${streetName ? ` on ${streetName}` : ''}`
  if (type === 'roundabout' || type === 'rotary') return streetName ? `Take roundabout to ${streetName}` : 'Enter roundabout'
  if (type === 'continue') return streetName ? `Continue on ${streetName}` : 'Continue'

  return streetName ? `${direction} on ${streetName}` : direction || 'Continue'
}

/** Initial bearing from point (lat1, lon1) to (lat2, lon2), in degrees 0-360. */
export function computeBearing(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const toDeg = (r: number): number => (r * 180) / Math.PI

  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Absolute difference between two bearings (0-360), result in 0-180. */
export function angleDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/** Speed-adaptive off-route distance threshold in meters. */
export function speedAdaptiveThreshold(speed: number): number {
  if (speed <= 5)  return 30
  if (speed <= 20) return 30 + (speed - 5)  * (30 / 15)
  if (speed <= 40) return 60 + (speed - 20) * (40 / 20)
  return 100
}

/** HDOP-based multiplier for off-route threshold. */
function hdopFactor(hdop: number | null): number {
  if (hdop === null || hdop <= 1.0) return 1.0
  if (hdop >= 5.0) return 2.0
  return 1.0 + (hdop - 1.0) * (1.0 / 4.0)
}

/**
 * Composite off-route score combining distance + heading divergence,
 * speed-adjusted. Returns score in [0, 1]; > 0.7 means off-route.
 */
export function computeOffRouteScore(opts: {
  distance: number
  heading: number
  routeBearing: number
  speed: number
  hdop: number | null
  distToManeuver: number
}): { score: number; distanceScore: number; headingScore: number; effectiveThreshold: number } {
  const { distance, heading, routeBearing, speed, hdop, distToManeuver } = opts

  const effectiveThreshold = speedAdaptiveThreshold(speed) * hdopFactor(hdop)
  const distanceScore = Math.min(distance / effectiveThreshold, 1)

  let headingScore = 0
  if (speed >= 2.0 && distance > 15) {
    const headingDivergence = angleDifference(heading, routeBearing)
    const headingTolerance = distToManeuver < 100
      ? 90 + (1 - distToManeuver / 100) * 45
      : 90
    headingScore = Math.min(headingDivergence / headingTolerance, 1)
  }

  const distanceWeight = speed < 2.0 ? 1.0 : 0.5
  const headingWeight  = speed < 2.0 ? 0.0 : 0.5
  const score = distanceWeight * distanceScore + headingWeight * headingScore

  return { score, distanceScore, headingScore, effectiveThreshold }
}

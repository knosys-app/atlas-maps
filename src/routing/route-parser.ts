/**
 * Convert a Valhalla `/route` response into the internal `RouteData`
 * shape used by the rail, sheet, map, and nav state machine. The output
 * shape deliberately matches SpeedDeck's OSRM-derived format so the
 * ported nav code works without modification.
 */

import type { ValhallaRouteResponse } from '@/types'
import type { RouteData, RouteStep, RouteProfile, RouteManeuver } from './types'

/** Valhalla maneuver type codes — partial mapping covering the common
 *  cases. Full reference: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuvertype */
const VALHALLA_MANEUVER_TYPE: Record<number, { type: string; modifier?: string }> = {
  1:  { type: 'depart' },
  2:  { type: 'depart', modifier: 'right' },
  3:  { type: 'depart', modifier: 'left' },
  4:  { type: 'arrive' },
  5:  { type: 'arrive', modifier: 'right' },
  6:  { type: 'arrive', modifier: 'left' },
  9:  { type: 'turn', modifier: 'slight right' },
  10: { type: 'turn', modifier: 'right' },
  11: { type: 'turn', modifier: 'sharp right' },
  12: { type: 'turn', modifier: 'uturn' },
  13: { type: 'turn', modifier: 'uturn' },
  14: { type: 'turn', modifier: 'sharp left' },
  15: { type: 'turn', modifier: 'left' },
  16: { type: 'turn', modifier: 'slight left' },
  17: { type: 'continue', modifier: 'straight' },
  19: { type: 'merge' },
  20: { type: 'merge' },
  21: { type: 'fork', modifier: 'right' },
  22: { type: 'fork', modifier: 'straight' },
  23: { type: 'fork', modifier: 'left' },
  26: { type: 'roundabout' },
  27: { type: 'roundabout' },
  37: { type: 'continue' },
}

/** Decode Valhalla's polyline6 encoding (default for newer versions).
 *  Valhalla uses 1e6 precision (Google polyline uses 1e5), so we shift
 *  the factor accordingly. */
function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlon = (result & 1) !== 0 ? ~(result >> 1) : result >> 1
    lon += dlon

    coords.push([lon / 1e6, lat / 1e6])
  }
  return coords
}

/** Project a Valhalla maneuver into the internal `RouteManeuver` shape. */
function projectManeuver(
  m: ValhallaRouteResponse['trip']['legs'][number]['maneuvers'][number],
  shape: [number, number][],
): RouteManeuver {
  const typeInfo = m.type !== undefined ? VALHALLA_MANEUVER_TYPE[m.type] : undefined
  const location = shape[m.begin_shape_index] ?? shape[0] ?? [0, 0]
  return {
    type: typeInfo?.type ?? 'continue',
    modifier: typeInfo?.modifier,
    location,
  }
}

/** Convert kilometres → metres consistently. Valhalla's default unit
 *  is kilometres; `maneuver.length` is in km. */
function kmToMetres(km: number): number {
  return km * 1000
}

export function parseValhallaRoute(
  response: ValhallaRouteResponse,
  profile: RouteProfile,
): RouteData {
  if (!response?.trip || !response.trip.legs?.length) {
    throw new Error('Valhalla response has no trip legs')
  }

  // Concatenate legs for now — Phase 2 only routes A→B, so there's
  // typically a single leg. The shape is per-leg-encoded, so we have to
  // decode then merge.
  const coordinates: [number, number][] = []
  const steps: RouteStep[] = []
  let totalDistance = 0
  let totalDuration = 0

  for (const leg of response.trip.legs) {
    const legCoords = decodePolyline6(leg.shape)
    const offset = coordinates.length
    // Avoid duplicating the join point between consecutive legs.
    if (offset > 0 && legCoords.length > 0) {
      coordinates.push(...legCoords.slice(1))
    } else {
      coordinates.push(...legCoords)
    }
    totalDistance += kmToMetres(leg.summary.length)
    totalDuration += leg.summary.time

    for (let i = 0; i < leg.maneuvers.length; i++) {
      const m = leg.maneuvers[i]
      // Slice the leg's coordinates by the maneuver's shape indices.
      const begin = m.begin_shape_index
      const end = m.end_shape_index
      const stepCoords = legCoords.slice(begin, end + 1) as [number, number][]
      steps.push({
        maneuver: projectManeuver(m, legCoords),
        name: m.street_names?.[0] ?? '',
        distance: kmToMetres(m.length),
        duration: m.time,
        geometry: {
          type: 'LineString',
          coordinates: stepCoords,
        },
        beginShapeIndex: offset + begin,
        endShapeIndex: offset + end,
      })
    }
  }

  return {
    geometry: { type: 'LineString', coordinates },
    distance: totalDistance,
    duration: totalDuration,
    steps,
    profile,
    // Valhalla returns maxspeed in annotations only when explicitly
    // requested with `filter_attributes`. Phase 2 doesn't request them;
    // Phase 3 enables when speed-limit display lands.
    maxspeeds: undefined,
  }
}

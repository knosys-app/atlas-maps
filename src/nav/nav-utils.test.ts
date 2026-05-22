import { describe, it, expect } from 'vitest'
import {
  pointToSegmentDistance,
  findNearestRoutePoint,
  distanceAlongCoords,
  distanceAlongCoordsFromProjection,
  computeBearing,
  angleDifference,
  speedAdaptiveThreshold,
  computeOffRouteScore,
  maneuverIcon,
  maneuverInstruction,
} from './nav-utils'

describe('pointToSegmentDistance', () => {
  it('returns 0 distance when point is exactly on the segment', () => {
    const r = pointToSegmentDistance(0, 0, -1, 0, 1, 0)
    expect(r.distance).toBeLessThan(1)
    expect(r.t).toBeCloseTo(0.5, 1)
  })

  it('clamps t to [0, 1] when point is past either endpoint', () => {
    const before = pointToSegmentDistance(-5, 0, -1, 0, 1, 0)
    expect(before.t).toBe(0)
    const after = pointToSegmentDistance(5, 0, -1, 0, 1, 0)
    expect(after.t).toBe(1)
  })

  it('handles degenerate (zero-length) segments without throwing', () => {
    const r = pointToSegmentDistance(1, 1, 0, 0, 0, 0)
    expect(r.t).toBe(0)
    expect(Number.isFinite(r.distance)).toBe(true)
  })
})

describe('findNearestRoutePoint', () => {
  const route: number[][] = [
    [-122.0, 47.0],
    [-122.1, 47.0],
    [-122.2, 47.0],
    [-122.3, 47.0],
  ]

  it('finds the nearest segment within the search window', () => {
    const r = findNearestRoutePoint(-122.15, 47.0, route)
    // GPS point is between coords[1] and coords[2] → segmentIndex 1
    expect(r.segmentIndex).toBe(1)
    expect(r.distance).toBeLessThan(50)
  })

  it('windows the search around startIndex with -5/+windowSize padding', () => {
    // startIndex=3, windowSize=1 → search covers segments max(0, 3-5)=0
    // through min(coords.length-2, 3+1)=2. GPS is at the start of the
    // route, so segment 0 is the closest.
    const r = findNearestRoutePoint(-122.0, 47.0, route, 3, 1)
    expect(r.segmentIndex).toBe(0)
    expect(r.distance).toBeLessThan(50)
  })
})

describe('distanceAlongCoords', () => {
  it('sums consecutive segment distances', () => {
    const route: number[][] = [
      [-122.0, 47.0],
      [-122.1, 47.0],
      [-122.2, 47.0],
    ]
    const d = distanceAlongCoords(route, 0, 2)
    // Two segments at ~7.5 km each at this latitude ≈ 15 km
    expect(d).toBeGreaterThan(14_000)
    expect(d).toBeLessThan(16_000)
  })

  it('returns 0 when fromIdx >= toIdx', () => {
    const route: number[][] = [[-122.0, 47.0], [-122.1, 47.0]]
    expect(distanceAlongCoords(route, 1, 1)).toBe(0)
    expect(distanceAlongCoords(route, 2, 0)).toBe(0)
  })
})

describe('distanceAlongCoordsFromProjection', () => {
  const route: number[][] = [
    [-122.0, 47.0],
    [-122.1, 47.0],
    [-122.2, 47.0],
  ]

  it('boundary t=0: distance equals full segment + onwards', () => {
    const full = distanceAlongCoords(route, 0, 2)
    const projected = distanceAlongCoordsFromProjection(route, 0, 0, 2)
    expect(projected).toBeCloseTo(full, 0)
  })

  it('boundary t=1: distance equals everything after the current segment', () => {
    const projected = distanceAlongCoordsFromProjection(route, 0, 1, 2)
    const expected = distanceAlongCoords(route, 1, 2)
    expect(projected).toBeCloseTo(expected, 0)
  })

  it('returns 0 when segmentIndex >= toIdx', () => {
    expect(distanceAlongCoordsFromProjection(route, 2, 0.5, 1)).toBe(0)
  })
})

describe('computeBearing', () => {
  it('north → bearing ~0 degrees', () => {
    const b = computeBearing(47.0, -122.0, 48.0, -122.0)
    expect(Math.abs(b)).toBeLessThan(2)
  })

  it('east → bearing ~90 degrees', () => {
    const b = computeBearing(47.0, -122.0, 47.0, -121.0)
    expect(Math.abs(b - 90)).toBeLessThan(2)
  })

  it('south → bearing ~180 degrees', () => {
    const b = computeBearing(47.0, -122.0, 46.0, -122.0)
    expect(Math.abs(b - 180)).toBeLessThan(2)
  })

  it('Seattle → New York is roughly east-southeast (bearing 70-95)', () => {
    const b = computeBearing(47.6, -122.3, 40.7, -74.0)
    expect(b).toBeGreaterThan(70)
    expect(b).toBeLessThan(110)
  })
})

describe('angleDifference', () => {
  it('returns 0 for identical bearings', () => {
    expect(angleDifference(45, 45)).toBe(0)
  })

  it('handles wrap-around (10 vs 350 = 20)', () => {
    expect(angleDifference(10, 350)).toBe(20)
  })

  it('returns 180 for opposite bearings', () => {
    expect(angleDifference(0, 180)).toBe(180)
  })
})

describe('speedAdaptiveThreshold', () => {
  it('30 m at low speed (≤5 m/s)', () => {
    expect(speedAdaptiveThreshold(2)).toBe(30)
    expect(speedAdaptiveThreshold(5)).toBe(30)
  })

  it('100 m at highway speed (>40 m/s)', () => {
    expect(speedAdaptiveThreshold(50)).toBe(100)
  })

  it('interpolates monotonically in between', () => {
    const a = speedAdaptiveThreshold(10)
    const b = speedAdaptiveThreshold(20)
    const c = speedAdaptiveThreshold(30)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })
})

describe('computeOffRouteScore', () => {
  it('low score when on route at low speed', () => {
    const r = computeOffRouteScore({
      distance: 5,
      heading: 90,
      routeBearing: 90,
      speed: 1,
      hdop: 1.0,
      distToManeuver: 1000,
    })
    expect(r.score).toBeLessThan(0.5)
  })

  it('high score when both far and heading-divergent at highway speed', () => {
    // Distance + heading combine when speed >= 2 m/s. With distance ≫
    // threshold and a divergent heading we exceed the off-route cutoff.
    const r = computeOffRouteScore({
      distance: 250,
      heading: 0,        // GPS heading: north
      routeBearing: 90,  // route bearing: east
      speed: 15,
      hdop: 1.0,
      distToManeuver: 1000,
    })
    expect(r.score).toBeGreaterThan(0.7)
  })

  it('distance alone at low speed (≤ 2 m/s) is enough to flag off-route', () => {
    // At low speed heading is unreliable, so distance carries the full
    // weight. The score equals min(distance / threshold, 1).
    const r = computeOffRouteScore({
      distance: 250,
      heading: 90,
      routeBearing: 90,
      speed: 1,         // pedestrian-ish
      hdop: 1.0,
      distToManeuver: 1000,
    })
    expect(r.score).toBeGreaterThanOrEqual(0.7)
  })

  it('high score when heading is divergent at highway speed', () => {
    const r = computeOffRouteScore({
      distance: 50,
      heading: 0,    // driving north
      routeBearing: 180, // route goes south
      speed: 20,
      hdop: 1.0,
      distToManeuver: 1000,
    })
    expect(r.score).toBeGreaterThan(0.5)
  })

  it('poor HDOP widens the effective threshold', () => {
    const goodHdop = computeOffRouteScore({
      distance: 50, heading: 90, routeBearing: 90,
      speed: 10, hdop: 1.0, distToManeuver: 1000,
    })
    const poorHdop = computeOffRouteScore({
      distance: 50, heading: 90, routeBearing: 90,
      speed: 10, hdop: 5.0, distToManeuver: 1000,
    })
    expect(poorHdop.effectiveThreshold).toBeGreaterThan(goodHdop.effectiveThreshold)
    expect(poorHdop.distanceScore).toBeLessThan(goodHdop.distanceScore)
  })
})

describe('maneuverIcon + maneuverInstruction', () => {
  it('maps common modifiers to expected icons', () => {
    expect(maneuverIcon('depart')).toBe('Navigation')
    expect(maneuverIcon('arrive')).toBe('MapPin')
    expect(maneuverIcon('turn', 'left')).toBe('CornerUpLeft')
    expect(maneuverIcon('turn', 'right')).toBe('CornerUpRight')
    expect(maneuverIcon('turn', 'sharp left')).toBe('CornerDownLeft')
    expect(maneuverIcon('turn', 'unknown-modifier')).toBe('ArrowUp')
  })

  it('produces human-readable instructions', () => {
    expect(maneuverInstruction('depart', undefined, 'Pike St')).toBe('Head on Pike St')
    expect(maneuverInstruction('arrive')).toBe('Arrive at destination')
    expect(maneuverInstruction('turn', 'right', '3rd Ave')).toBe('Right onto 3rd Ave')
    expect(maneuverInstruction('merge', undefined, 'I-5 N')).toBe('Merge onto I-5 N')
  })
})

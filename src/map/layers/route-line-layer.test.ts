/**
 * Unit tests for the pure helpers in route-line-layer.
 *
 * `addRouteLineLayer` / `setRouteLineData` / `removeRouteLineLayer`
 * are MapLibre-side effects and are exercised in the MapViewer; the
 * coverage here is for `computeRouteBounds` which is pure math.
 */

import { describe, expect, it } from 'vitest'
import { computeRouteBounds } from './route-line-layer'

describe('computeRouteBounds', () => {
  it('returns null for an empty coord list', () => {
    expect(computeRouteBounds([])).toBeNull()
  })

  it('returns a zero-area box for a single coord', () => {
    // Single-coord routes shouldn't happen in practice, but the
    // helper shouldn't blow up on them — degrades to a point-box
    // which fitBounds handles gracefully.
    expect(computeRouteBounds([[-122.3, 47.6]])).toEqual([
      [-122.3, 47.6],
      [-122.3, 47.6],
    ])
  })

  it('computes the bbox of a two-point line', () => {
    // Seattle → Olympia, roughly. west < east, south < north.
    expect(
      computeRouteBounds([
        [-122.33, 47.6],
        [-122.9, 47.04],
      ]),
    ).toEqual([
      [-122.9, 47.04],
      [-122.33, 47.6],
    ])
  })

  it('honors all four extents across a meandering coord list', () => {
    // A loop that touches the extreme lon/lat in different segments,
    // not adjacent to each other. Catches a "track the previous
    // coord only" off-by-one.
    const coords: [number, number][] = [
      [-122.0, 47.0],
      [-123.0, 47.5], // westmost
      [-121.0, 47.5],
      [-121.5, 48.0], // northmost
      [-121.5, 46.5], // southmost
      [-120.0, 47.0], // eastmost
    ]
    expect(computeRouteBounds(coords)).toEqual([
      [-123.0, 46.5],
      [-120.0, 48.0],
    ])
  })

  it('handles antimeridian-spanning coords as raw lon/lat (no wrap)', () => {
    // No special antimeridian handling — Valhalla routes don't cross
    // 180°/-180° within a single region, so a "wrap-aware" bbox
    // would just be dead code. Documenting the behavior: the bbox
    // is in raw lon/lat space, west < east always.
    const coords: [number, number][] = [
      [179.0, 0.0],
      [-179.0, 0.0],
    ]
    expect(computeRouteBounds(coords)).toEqual([
      [-179.0, 0.0],
      [179.0, 0.0],
    ])
  })
})

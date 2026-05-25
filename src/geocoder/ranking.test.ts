/**
 * Unit tests for ranking + dedupe.
 *
 * Pure-function tests — no SQLite, no network. Covers:
 *   - Importance vs distance tiebreaks
 *   - 10 m radius dedupe preferring openaddresses
 *   - Distinct same-named places (e.g. multiple "Main St") survive
 *   - Name normalization (case + punctuation)
 */

import { describe, expect, it } from 'vitest'
import type { PlaceResult } from './types'
import { dedupe, normalizeName, rankAndLimit } from './ranking'

function row(over: Partial<PlaceResult>): PlaceResult {
  return {
    name: 'Pike Place Market',
    category: 'poi',
    latitude: 47.6097,
    longitude: -122.3422,
    importance: 20,
    source: 'osm',
    distanceM: 0,
    ...over,
  }
}

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('Pike Place Market')).toBe('pike place market')
    expect(normalizeName('Pike Pl. Market')).toBe('pike pl market')
    expect(normalizeName('  PIKE   PLACE   ')).toBe('pike place')
    expect(normalizeName('St. John\'s, NL')).toBe('st john s nl')
  })

  it('preserves unicode letters', () => {
    expect(normalizeName('Café Mocha')).toBe('café mocha')
    expect(normalizeName('Zürich Hauptbahnhof')).toBe('zürich hauptbahnhof')
  })
})

describe('dedupe', () => {
  it('keeps a single row unchanged', () => {
    const rows = [row({ name: 'Pike Place Market' })]
    expect(dedupe(rows)).toEqual(rows)
  })

  it('collapses near-duplicate OSM + openaddresses rows, preferring openaddresses', () => {
    const osmRow = row({
      name: 'Pike Place Market',
      latitude: 47.6097,
      longitude: -122.3422,
      source: 'osm',
    })
    const oaRow = row({
      name: 'Pike Place Market',
      latitude: 47.60971, // ~1 m away
      longitude: -122.3422,
      source: 'openaddresses',
    })
    const result = dedupe([osmRow, oaRow])
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('openaddresses')
  })

  it('preserves distinct same-named places that are far apart', () => {
    // Two Main Streets — one in Seattle, one in Spokane.
    const seattle = row({ name: 'Main St', latitude: 47.6, longitude: -122.3, source: 'osm' })
    const spokane = row({ name: 'Main St', latitude: 47.66, longitude: -117.42, source: 'osm' })
    const result = dedupe([seattle, spokane])
    expect(result).toHaveLength(2)
  })

  it('preserves original input order for kept rows', () => {
    const a = row({ name: 'A Place', latitude: 47.0, longitude: -122.0 })
    const b = row({ name: 'B Place', latitude: 48.0, longitude: -121.0 })
    const c = row({ name: 'C Place', latitude: 49.0, longitude: -120.0 })
    const result = dedupe([c, a, b])
    expect(result.map((r) => r.name)).toEqual(['C Place', 'A Place', 'B Place'])
  })

  it('matches case-insensitively + ignoring punctuation when within radius', () => {
    const a = row({ name: 'Pike St.', latitude: 47.61, longitude: -122.34, source: 'osm' })
    const b = row({ name: 'pike st', latitude: 47.61, longitude: -122.34, source: 'openaddresses' })
    const result = dedupe([a, b])
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('openaddresses')
  })

  it('does not merge rows beyond ~10 m even with identical names', () => {
    // ~50 m apart in latitude (0.00045°).
    const close = row({ name: 'X', latitude: 47.6, longitude: -122.3 })
    const far = row({ name: 'X', latitude: 47.60045, longitude: -122.3 })
    const result = dedupe([close, far])
    expect(result).toHaveLength(2)
  })

  it('prefers higher importance when both rows are same-source', () => {
    const cityA = row({ name: 'Town', latitude: 47.6, longitude: -122.3, importance: 50, source: 'osm' })
    const cityB = row({ name: 'Town', latitude: 47.6, longitude: -122.3, importance: 80, source: 'osm' })
    const result = dedupe([cityA, cityB])
    expect(result).toHaveLength(1)
    expect(result[0].importance).toBe(80)
  })
})

describe('rankAndLimit', () => {
  it('sorts by importance descending', () => {
    const rows = [
      row({ name: 'A', importance: 20 }),
      row({ name: 'B', importance: 100 }),
      row({ name: 'C', importance: 50 }),
    ]
    const result = rankAndLimit(rows, 10)
    expect(result.map((r) => r.name)).toEqual(['B', 'C', 'A'])
  })

  it('breaks importance ties by distance ascending', () => {
    const rows = [
      row({ name: 'Far', importance: 80, distanceM: 5000 }),
      row({ name: 'Near', importance: 80, distanceM: 500 }),
      row({ name: 'Mid', importance: 80, distanceM: 1500 }),
    ]
    const result = rankAndLimit(rows, 10)
    expect(result.map((r) => r.name)).toEqual(['Near', 'Mid', 'Far'])
  })

  it('limits to the requested count', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ name: `r${i}`, importance: 100 - i, distanceM: 0 }),
    )
    expect(rankAndLimit(rows, 10)).toHaveLength(10)
    expect(rankAndLimit(rows, 3)).toHaveLength(3)
  })

  it('does not mutate the input array', () => {
    const rows = [row({ name: 'A', importance: 20 }), row({ name: 'B', importance: 80 })]
    const before = rows.map((r) => r.name).join(',')
    rankAndLimit(rows, 10)
    expect(rows.map((r) => r.name).join(',')).toBe(before)
  })

  it('importance beats distance', () => {
    // A higher-importance result wins even when it's much farther away.
    const farImportant = row({ name: 'Seattle', importance: 100, distanceM: 50_000 })
    const nearTrivial = row({ name: 'Coffee Cart', importance: 20, distanceM: 50 })
    const result = rankAndLimit([nearTrivial, farImportant], 10)
    expect(result[0].name).toBe('Seattle')
  })
})

/**
 * Unit tests for the search orchestrator.
 *
 * Pure JS — no SQLite, no network. The orchestrator's deps are
 * threaded in via `SearchDeps`, so each test passes a fake
 * `PlacesDb` + optional fake `nominatim` and asserts on the
 * orchestrated behaviour:
 *
 *   - Tier 1 short-circuit (FTS returned, no Nominatim call)
 *   - Tier 2 trigger threshold + offline gate
 *   - Tier 3 strip-house-number retry
 *   - Minimum query length, FTS escaping, dedupe-across-tiers
 */

import { describe, expect, it, vi } from 'vitest'
import { search, stripLeadingHouseNumber } from './search'
import type { PlacesDb } from './places-db'
import type { PlaceResult } from './types'

function row(over: Partial<PlaceResult>): PlaceResult {
  return {
    name: 'Pike Place Market',
    category: 'poi',
    latitude: 47.61,
    longitude: -122.34,
    importance: 20,
    source: 'osm',
    distanceM: 0,
    ...over,
  }
}

function fakeDb(rows: PlaceResult[] | ((query: string) => PlaceResult[])): PlacesDb {
  return {
    async ftsSearch(query) {
      const r = typeof rows === 'function' ? rows(query) : rows
      return r
    },
    async close() {},
  }
}

describe('stripLeadingHouseNumber', () => {
  it('strips a leading house number', () => {
    expect(stripLeadingHouseNumber('123 Pike St')).toBe('Pike St')
  })

  it('handles a unit-letter suffix', () => {
    expect(stripLeadingHouseNumber('123A Pike St')).toBe('Pike St')
    expect(stripLeadingHouseNumber('45b Cherry Ln')).toBe('Cherry Ln')
  })

  it('returns the original when there is no leading number', () => {
    expect(stripLeadingHouseNumber('Pike St')).toBe('Pike St')
  })

  it('returns the original when there is only one token (no street to retry against)', () => {
    expect(stripLeadingHouseNumber('123')).toBe('123')
  })

  it('does not strip mid-token digits like "1st Ave"', () => {
    expect(stripLeadingHouseNumber('1st Ave')).toBe('1st Ave')
  })

  it('handles extra whitespace', () => {
    expect(stripLeadingHouseNumber('  123   Pike  St  ')).toBe('Pike St')
  })
})

describe('search()', () => {
  it('returns [] for queries shorter than the minimum length', async () => {
    const ftsSearch = vi.fn().mockResolvedValue([])
    const result = await search({ query: 'a' }, { db: { ftsSearch, close: vi.fn() } })
    expect(result).toEqual([])
    expect(ftsSearch).not.toHaveBeenCalled()
  })

  it('returns [] for empty + whitespace-only queries', async () => {
    const ftsSearch = vi.fn().mockResolvedValue([])
    expect(await search({ query: '' }, { db: { ftsSearch, close: vi.fn() } })).toEqual([])
    expect(await search({ query: '   ' }, { db: { ftsSearch, close: vi.fn() } })).toEqual([])
    expect(ftsSearch).not.toHaveBeenCalled()
  })

  it('returns local FTS results when tier 1 hits the threshold', async () => {
    const local = [
      row({ name: 'Pike Place Market', importance: 80 }),
      row({ name: 'Pike Brewing Co', importance: 50 }),
      row({ name: 'Pike St', category: 'road', importance: 30 }),
    ]
    const nominatim = vi.fn()
    const result = await search(
      { query: 'pike' },
      { db: fakeDb(local), nominatim, isOnline: () => true },
    )
    expect(result.map((r) => r.name)).toEqual([
      'Pike Place Market',
      'Pike Brewing Co',
      'Pike St',
    ])
    expect(nominatim).not.toHaveBeenCalled()
  })

  it('falls back to Nominatim when local hits below the threshold + online', async () => {
    const local = [row({ name: 'Olympic Sculpture Park', importance: 40 })]
    const remote = [row({ name: 'Olympia, WA', source: 'nominatim', importance: 75 })]
    const nominatim = vi.fn().mockResolvedValue(remote)
    const result = await search(
      { query: 'oly' },
      { db: fakeDb(local), nominatim, isOnline: () => true, },
    )
    expect(nominatim).toHaveBeenCalledOnce()
    // Merged + re-ranked: Olympia (75) before Olympic Sculpture (40).
    expect(result.map((r) => r.name)).toEqual(['Olympia, WA', 'Olympic Sculpture Park'])
  })

  it('swallows a thrown Nominatim implementation and still returns tier-1 results', async () => {
    const local = [row({ name: 'X' })]
    const nominatim = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await search(
      { query: 'xy' },
      { db: fakeDb(local), nominatim, isOnline: () => true },
    )
    expect(nominatim).toHaveBeenCalledOnce()
    expect(result.map((r) => r.name)).toEqual(['X'])
  })

  it('dedupes Nominatim hit against tier-1 FTS hit for the same place', async () => {
    // Greptile P2: previously, FTS "Pike Place Market" and Nominatim
    // (which used the full display_name) would land in separate
    // normalizeName buckets and survive dedupe. With Nominatim now
    // using the short name, they collide and collapse to one row.
    const local = [
      row({
        name: 'Pike Place Market',
        latitude: 47.6097,
        longitude: -122.3422,
        source: 'osm',
        importance: 40,
      }),
    ]
    const nominatim = vi.fn().mockResolvedValue([
      row({
        name: 'Pike Place Market', // short name from first comma-segment
        subtitle: 'Belltown, Seattle, King County, Washington, 98101, US',
        latitude: 47.6097,
        longitude: -122.3422,
        source: 'nominatim',
        importance: 60,
      }),
    ])
    const result = await search(
      { query: 'pike place' },
      { db: fakeDb(local), nominatim, isOnline: () => true },
    )
    expect(nominatim).toHaveBeenCalledOnce()
    expect(result).toHaveLength(1)
  })

  it('does not call Nominatim when offline, even if below threshold', async () => {
    const local = [row({ name: 'X' })]
    const nominatim = vi.fn().mockResolvedValue([row({ name: 'Y', source: 'nominatim' })])
    const result = await search(
      { query: 'xy' },
      { db: fakeDb(local), nominatim, isOnline: () => false },
    )
    expect(nominatim).not.toHaveBeenCalled()
    expect(result.map((r) => r.name)).toEqual(['X'])
  })

  it('falls back to stripped-house-number FTS when tier 1 returns nothing', async () => {
    // First FTS call returns empty (for "123 pike st"); retry with "pike st" returns rows.
    const db: PlacesDb = {
      ftsSearch: vi.fn(async (q: string) => {
        if (q.includes('"pike st"')) return [row({ name: 'Pike St', category: 'road' })]
        return []
      }),
      close: vi.fn(),
    }
    const result = await search(
      { query: '123 pike st' },
      { db, nominatim: vi.fn().mockResolvedValue([]), isOnline: () => true },
    )
    expect(result.map((r) => r.name)).toEqual(['Pike St'])
    // Tier 3 must have run — the FTS got called twice (raw query + stripped).
    expect(db.ftsSearch).toHaveBeenCalledTimes(2)
  })

  it('does not run tier 3 when tier 1 returned results', async () => {
    const db: PlacesDb = {
      ftsSearch: vi.fn().mockResolvedValue([row({ name: 'Pike Pl' })]),
      close: vi.fn(),
    }
    await search({ query: '123 pike pl' }, { db, isOnline: () => false })
    expect(db.ftsSearch).toHaveBeenCalledTimes(1)
  })

  it('attaches haversine distance when `near` is provided', async () => {
    const local = [
      row({ name: 'Far', latitude: 47.0, longitude: -120.0 }),
      row({ name: 'Near', latitude: 47.61, longitude: -122.34 }),
    ]
    const result = await search(
      { query: 'place', near: { lat: 47.61, lon: -122.34 } },
      { db: fakeDb(local), isOnline: () => false },
    )
    const near = result.find((r) => r.name === 'Near')
    const far = result.find((r) => r.name === 'Far')
    expect(near?.distanceM).toBeCloseTo(0, 0)
    expect(far?.distanceM).toBeGreaterThan(100_000)
  })

  it('respects the `limit` option', async () => {
    const local = Array.from({ length: 30 }, (_, i) =>
      row({ name: `r${i}`, importance: 100 - i }),
    )
    const result = await search(
      { query: 'pike', limit: 5 },
      { db: fakeDb(local), isOnline: () => false },
    )
    expect(result).toHaveLength(5)
  })

  it('respects a custom `nominatimThreshold`', async () => {
    const local = [
      row({ name: 'A' }),
      row({ name: 'B' }),
      row({ name: 'C' }),
    ]
    const nominatim = vi.fn().mockResolvedValue([])
    // Default threshold is 3 → 3 local hits would skip Nominatim.
    // With threshold=5, 3 hits is below; Nominatim fires.
    await search(
      { query: 'pike', nominatimThreshold: 5 },
      { db: fakeDb(local), nominatim, isOnline: () => true },
    )
    expect(nominatim).toHaveBeenCalledOnce()
  })

  it('escapes double quotes in user input before sending to FTS', async () => {
    const ftsSearch = vi.fn().mockResolvedValue([])
    await search(
      { query: 'pike "fish" market' },
      { db: { ftsSearch, close: vi.fn() }, isOnline: () => false },
    )
    expect(ftsSearch).toHaveBeenCalledWith('"pike ""fish"" market"*', expect.any(Number))
  })
})

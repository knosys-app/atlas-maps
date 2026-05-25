/**
 * Saved store unit tests.
 *
 * Vitest pure-function coverage of `parseDestinations` — the
 * tolerant-parse path that filters out rows with bad shapes. The
 * orchestration methods (`add` / `remove` / `reorder`) aren't unit-
 * tested here because they require an `api` mock + Zustand reset
 * between tests; covered indirectly through the manual smoke flow
 * during slice 3d's search-card wiring.
 */

import { describe, expect, it } from 'vitest'
import { parseDestinations } from './saved-store'

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    name: 'Pike Place Market',
    coordinates: { lat: 47.6097, lon: -122.3422 },
    ownerPluginId: 'knosys-maps',
    createdAt: '2026-05-25T00:00:00Z',
    updatedAt: '2026-05-25T00:00:00Z',
    ...overrides,
  }
}

describe('parseDestinations', () => {
  it('returns [] for a non-array input', () => {
    expect(parseDestinations(null)).toEqual([])
    expect(parseDestinations(undefined)).toEqual([])
    expect(parseDestinations('not an array')).toEqual([])
    expect(parseDestinations({ destinations: [] })).toEqual([])
    expect(parseDestinations(42)).toEqual([])
  })

  it('returns the parsed array when every row is valid', () => {
    const a = valid({ id: 'a' })
    const b = valid({ id: 'b', name: 'Olympia, WA' })
    const result = parseDestinations([a, b])
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('a')
    expect(result[1].name).toBe('Olympia, WA')
  })

  it('drops rows missing required fields', () => {
    const rows = [
      valid({ id: 'good' }),
      valid({ id: '' }),                          // empty id → drop
      valid({ name: '' }),                        // empty name → drop
      { ...valid(), id: 123 },                    // wrong type → drop
      { ...valid(), coordinates: null },          // missing coords → drop
      { ...valid(), coordinates: { lat: 'no', lon: -122 } }, // wrong type → drop
      valid({ id: 'good-2' }),
    ]
    const result = parseDestinations(rows)
    expect(result.map((d) => d.id)).toEqual(['good', 'good-2'])
  })

  it('drops rows with non-finite coordinates', () => {
    const rows = [
      { ...valid(), coordinates: { lat: NaN, lon: -122 } },
      { ...valid(), coordinates: { lat: 47, lon: Infinity } },
      valid({ id: 'ok' }),
    ]
    const result = parseDestinations(rows)
    expect(result.map((d) => d.id)).toEqual(['ok'])
  })

  it('preserves optional `category` / `notes` when present', () => {
    const row = valid({ category: 'poi', notes: 'great fish throw' })
    const [dest] = parseDestinations([row])
    expect(dest.category).toBe('poi')
    expect(dest.notes).toBe('great fish throw')
  })

  it('drops type-wrong optional fields without dropping the row', () => {
    const row = valid({ category: 42, notes: ['not', 'a', 'string'] })
    const [dest] = parseDestinations([row])
    expect(dest).toBeDefined()
    expect(dest.category).toBeUndefined()
    expect(dest.notes).toBeUndefined()
  })
})

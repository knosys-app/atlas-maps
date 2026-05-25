/**
 * Read-only PlacesDb interface + the live implementation that opens
 * the SQLite via `api.db.openSqlite`.
 *
 * The interface is the seam the test suite mocks against; the
 * search orchestrator depends only on `PlacesDb`, not on the
 * api.db handle directly. That keeps unit tests pure (no SQLite, no
 * file IO) while still exercising the same orchestration code that
 * runs in production.
 */

import type { PluginAPI } from '@/types'
import type { PlaceCategory, PlaceResult, PlaceSource } from './types'
import { haversineDistance } from '@/utils/haversine'

/** Test seam. `search.ts` consumes only this interface. */
export interface PlacesDb {
  /** Run an FTS5 prefix search. `query` is the already-escaped FTS
   *  match string (callers escape internal quotes). `limit` caps the
   *  overfetch — typically 100 so dedupe has headroom. */
  ftsSearch(query: string, limit: number): Promise<PlaceResult[]>
  close(): Promise<void>
}

/**
 * Open the per-region geocoder DB. The host's `api.db.openSqlite`
 * sandbox confines the path to the plugin's vault root, so
 * relative paths like `regions/us-wa/places.db` resolve to
 * `vault/PluginData/knosys-maps/regions/us-wa/places.db`.
 */
export async function openPlacesDb(api: PluginAPI, regionId: string): Promise<PlacesDb> {
  const relPath = `regions/${regionId}/places.db`
  const handle = await api.db.openSqlite(relPath, { readonly: true })
  return new SqlitePlacesDb(handle)
}

interface DbRow {
  name: string
  category: string
  latitude: number
  longitude: number
  importance: number
  source: string
}

class SqlitePlacesDb implements PlacesDb {
  constructor(
    private handle: {
      all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
      close(): Promise<void>
    },
  ) {}

  async ftsSearch(query: string, limit: number): Promise<PlaceResult[]> {
    // The query is FTS-escaped + suffixed with `*` for prefix match by
    // the caller in `search.ts`. We send it through directly.
    const rows = await this.handle.all<DbRow>(
      `
      SELECT p.name, p.category, p.latitude, p.longitude, p.importance, p.source
      FROM places_fts
      JOIN places p ON places_fts.rowid = p.rowid
      WHERE places_fts MATCH ?
      LIMIT ?
      `,
      [query, limit],
    )
    return rows.map((r) => ({
      name: r.name,
      category: r.category as PlaceCategory,
      latitude: r.latitude,
      longitude: r.longitude,
      importance: r.importance,
      source: r.source as PlaceSource,
      // Caller fills distance from the search anchor.
      distanceM: 0,
    }))
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/**
 * Escape a user-supplied query for safe interpolation into an FTS5
 * MATCH expression and append the prefix operator. Doubles internal
 * double-quotes per FTS5's quoting rules and wraps the result in
 * `"…"*` so MATCH does a phrase-prefix search.
 */
export function buildFtsMatch(query: string): string {
  const escaped = query.trim().replace(/"/g, '""')
  return `"${escaped}"*`
}

/**
 * Helper exported for callers + tests: attach haversine distance to a
 * row list given an anchor point. Used after `ftsSearch` so the dedupe
 * step can reason about distance without depending on the SQL layer.
 */
export function attachDistance(
  rows: PlaceResult[],
  near: { lat: number; lon: number } | undefined,
): PlaceResult[] {
  if (!near) return rows
  return rows.map((r) => ({
    ...r,
    distanceM: haversineDistance(near.lat, near.lon, r.latitude, r.longitude),
  }))
}

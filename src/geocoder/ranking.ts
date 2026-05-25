/**
 * Result ranking + dedupe — pure functions.
 *
 * Two operations land here, both deliberately split out from
 * `search.ts` so they're testable without a real SQLite DB or
 * network:
 *
 *   1. `dedupe()` — collapses near-duplicate rows between OSM and
 *      OpenAddresses imports. Two rows are considered duplicates when
 *      their normalized names are equal AND they're within ~10 m of
 *      each other. The openaddresses row wins (rooftop-precision
 *      coordinates) so the user lands on the actual building rather
 *      than the centroid of the OSM polygon.
 *
 *   2. `rankAndLimit()` — sorts by `importance DESC` then
 *      `distance ASC`, takes the top N. importance is the static
 *      score baked in at ingest; distance is computed by the caller
 *      (haversine to the user's anchor, 0 when no anchor).
 */

import type { PlaceResult } from './types'

const DEDUPE_RADIUS_M = 10

/**
 * Lowercase, strip punctuation, collapse whitespace. Two rows match
 * when their normalized names are equal — "Pike St" and "pike  st."
 * dedupe to the same key.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Quick approximation of "are these two points within `radiusM`?" using
 * a flat-earth equirectangular approximation. Sufficient for the 10 m
 * dedupe threshold — at 10 m the great-circle vs. flat-earth error is
 * sub-millimetre. Cheaper than `haversineDistance` for the inner loop.
 */
function withinRadius(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  radiusM: number,
): boolean {
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180)
  const dLatM = (b.latitude - a.latitude) * 111_320
  const dLonM = (b.longitude - a.longitude) * 111_320 * Math.cos(latRad)
  const distSq = dLatM * dLatM + dLonM * dLonM
  return distSq <= radiusM * radiusM
}

/**
 * Collapse rows that point at the same physical place. Preserves
 * input order for non-duplicate rows; among duplicates, the first
 * `openaddresses`-sourced row wins (or, if none, the first row
 * encountered).
 *
 * The caller is expected to pass the FTS overfetch (~100 rows). This
 * function returns ≤ input.length rows.
 */
export function dedupe(rows: PlaceResult[]): PlaceResult[] {
  // Group by normalized name. Within each group, pairwise check 10 m
  // radius and merge — the first openaddresses row in the group wins.
  const byName = new Map<string, PlaceResult[]>()
  for (const row of rows) {
    const key = normalizeName(row.name)
    const bucket = byName.get(key) ?? []
    bucket.push(row)
    byName.set(key, bucket)
  }

  const kept = new Set<PlaceResult>()
  for (const bucket of byName.values()) {
    // Walk the bucket; for each row, see if a previously-kept row is
    // within radius. If so, the openaddresses one (current or kept)
    // replaces; otherwise keep both (they're distinct places that
    // happen to share a name, like multiple Main Streets).
    const localKeep: PlaceResult[] = []
    for (const row of bucket) {
      const colliding = localKeep.findIndex((k) => withinRadius(row, k, DEDUPE_RADIUS_M))
      if (colliding < 0) {
        localKeep.push(row)
        continue
      }
      // Existing collision — pick the better source.
      const existing = localKeep[colliding]
      const better = preferRow(row, existing)
      localKeep[colliding] = better
    }
    for (const k of localKeep) kept.add(k)
  }

  // Restore original input ordering so callers downstream of an
  // already-sorted FTS overfetch retain stable behaviour for tests.
  return rows.filter((r) => kept.has(r))
}

function preferRow(a: PlaceResult, b: PlaceResult): PlaceResult {
  // openaddresses (rooftop precision) beats osm.
  if (a.source === 'openaddresses' && b.source !== 'openaddresses') return a
  if (b.source === 'openaddresses' && a.source !== 'openaddresses') return b
  // Same source — break the tie by importance, then by `a` (input order).
  if (a.importance !== b.importance) return a.importance > b.importance ? a : b
  return a
}

/**
 * Sort by importance descending, distance ascending, then return the
 * first `limit`. Pure — operates on the array the caller passed in,
 * doesn't mutate it.
 */
export function rankAndLimit(rows: PlaceResult[], limit: number): PlaceResult[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    if (a.importance !== b.importance) return b.importance - a.importance
    return a.distanceM - b.distanceM
  })
  return copy.slice(0, limit)
}

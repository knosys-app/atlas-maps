/**
 * 3-tier search orchestration.
 *
 * Tier 1 — Local FTS5 (`places.db`):
 *   - Overfetch 100 rows so dedupe has headroom.
 *   - Attach haversine distance from the anchor (or 0 if no anchor).
 *   - Dedupe near-duplicates (10 m) preferring openaddresses rows.
 *   - Rank by importance DESC, distance ASC; take top N.
 *
 * Tier 2 — Nominatim (online):
 *   - Triggered when tier 1 returns fewer than `nominatimThreshold`
 *     rows AND `navigator.onLine` is true.
 *   - Merged in alongside tier 1 results, re-ranked together.
 *   - Best-effort; failures swallowed.
 *
 * Tier 3 — Strip leading house number ("123 Pike St" → "Pike St"):
 *   - Triggered when tier 1 (after dedupe) is still empty AND the
 *     query starts with digits.
 *   - Same FTS pipeline as tier 1; the OpenAddresses-imported address
 *     rows already have the house number in their `name`, so the strip
 *     is for OSM road rows whose `name` is just "Pike St".
 *
 * Test seam: the orchestrator takes its dependencies (places-db,
 * nominatim, isOnline) as named arguments so unit tests can pass
 * fakes without touching SQLite or the network.
 */

import type { SearchOptions, PlaceResult } from './types'
import { attachDistance, buildFtsMatch, type PlacesDb } from './places-db'
import { dedupe, rankAndLimit } from './ranking'

export interface SearchDeps {
  db: PlacesDb
  nominatim?: (query: string, near?: { lat: number; lon: number }) => Promise<PlaceResult[]>
  /** Override for `navigator.onLine`. Tests pass `() => false`. */
  isOnline?: () => boolean
}

const DEFAULT_LIMIT = 10
const DEFAULT_FTS_OVERFETCH = 100
const DEFAULT_NOMINATIM_THRESHOLD = 3
const MIN_QUERY_LENGTH = 2

export async function search(
  opts: SearchOptions,
  deps: SearchDeps,
): Promise<PlaceResult[]> {
  const query = opts.query.trim()
  if (query.length < MIN_QUERY_LENGTH) return []

  const limit = opts.limit ?? DEFAULT_LIMIT
  const nominatimThreshold = opts.nominatimThreshold ?? DEFAULT_NOMINATIM_THRESHOLD
  const isOnline = deps.isOnline ?? (() => typeof navigator !== 'undefined' && navigator.onLine)

  // --- Tier 1: local FTS5
  const ftsRaw = await deps.db.ftsSearch(buildFtsMatch(query), DEFAULT_FTS_OVERFETCH)
  const ftsWithDist = attachDistance(ftsRaw, opts.near)
  const ftsDeduped = dedupe(ftsWithDist)

  // --- Tier 2: Nominatim fallback when local hits below threshold + online
  let merged = ftsDeduped
  if (deps.nominatim && ftsDeduped.length < nominatimThreshold && isOnline()) {
    const remote = await deps.nominatim(query, opts.near)
    if (remote.length > 0) {
      const remoteWithDist = attachDistance(remote, opts.near)
      // Nominatim rows are usually disjoint from FTS rows for the same
      // query (Nominatim returns more international + ambiguous hits),
      // but dedupe across the merged set just in case.
      merged = dedupe([...ftsDeduped, ...remoteWithDist])
    }
  }

  if (merged.length > 0) {
    return rankAndLimit(merged, limit)
  }

  // --- Tier 3: strip leading house number, retry local FTS only
  // (Nominatim already had a shot at the raw query; no point repeating.)
  const stripped = stripLeadingHouseNumber(query)
  if (stripped && stripped !== query) {
    const retryRaw = await deps.db.ftsSearch(buildFtsMatch(stripped), DEFAULT_FTS_OVERFETCH)
    const retryWithDist = attachDistance(retryRaw, opts.near)
    const retryDeduped = dedupe(retryWithDist)
    if (retryDeduped.length > 0) {
      return rankAndLimit(retryDeduped, limit)
    }
  }

  return []
}

/**
 * "123 Pike St" → "Pike St". Returns the original string when there's
 * no leading-number to strip (and `search` treats that as "tier 3
 * doesn't apply"). Multi-token strip only — we don't want to strip
 * trailing zip codes or unit numbers, which often follow the address.
 */
export function stripLeadingHouseNumber(query: string): string {
  const trimmed = query.trim()
  if (trimmed.length === 0) return trimmed
  if (!/^\d/.test(trimmed)) return trimmed
  // First token must be digits-only (possibly with a unit letter, e.g.
  // "123A"). The rest of the query becomes the retry input.
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return trimmed
  if (!/^\d+[A-Za-z]?$/.test(parts[0])) return trimmed
  return parts.slice(1).join(' ')
}

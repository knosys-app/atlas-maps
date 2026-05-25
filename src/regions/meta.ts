/**
 * Region meta.json schema + read helpers.
 *
 * Each installed region writes a `meta.json` to its vault directory
 * recording what was built, when, and against which engine versions.
 * The plugin reads these on hydrate to:
 *   - Populate the installed-regions list in the Settings panel.
 *   - Cross-check `tilesFormatVersion` against the active Valhalla
 *     binary (slice 6b will flag regions as "outdated" when the
 *     engine bumps a major version).
 *   - Sum `byteSize` for the storage-usage indicator.
 *
 * The writer (slice 6b's download-orchestrator) is the only thing
 * that produces meta.json. v3.0 ships only the reader.
 */

import type { PluginAPI } from '@/types'
import { VAULT_PATHS } from '@/constants'

/** Persisted shape — one file per installed region. Version bumps to
 *  this shape get a new top-level `schemaVersion` and a migration in
 *  the read path. */
export interface RegionMeta {
  /** Manifest id (e.g. 'us-washington'). Matches the directory name. */
  regionId: string
  /** ISO timestamp the region was first built / last rebuilt. */
  builtAt: string
  /** Sum of all files under the region directory at build time, in
   *  bytes. Used for the storage-usage indicator without re-walking
   *  the vault on every Settings open. */
  byteSize: number
  /** Bounding box [west, south, east, north] of the region's coverage.
   *  Optional in the read path for backwards compatibility — older
   *  meta.json files predate this field. The orchestrator (slice 6b)
   *  populates it at install time, mirroring `RegionDefinition.bbox`
   *  for manifest regions or the user-drawn polygon for custom-bbox
   *  regions. `regionCenter` in MapsPage prefers this over the
   *  STARTER_REGIONS lookup so custom (non-manifest) region ids can
   *  still route + search. */
  bbox?: [number, number, number, number]
  /** Versions of the various pipeline outputs at build time. Used to
   *  detect when a region is outdated relative to the currently-
   *  installed engine. */
  valhallaVersion: string
  tilesFormatVersion: number
  pmtilesVersion: number
  geocoderVersion: number
  /** When the OpenAddresses street-level import last ran (null if the
   *  region's manifest entry has no openAddressesSource, or the import
   *  failed and the user hasn't retried). The Settings panel surfaces
   *  this as a "Re-import addresses" affordance when null. */
  oaImportedAt?: string | null
  /** Row count of the OpenAddresses portion of `places`, for the
   *  Settings panel's "Addresses: 1.2M rows" line. */
  oaRowCount?: number
}

/** Read meta.json for a single region. Returns null when the file is
 *  missing or unparseable — the caller decides whether to surface the
 *  region as "broken install" or hide it entirely. */
export async function readRegionMeta(
  api: PluginAPI,
  regionId: string,
): Promise<RegionMeta | null> {
  try {
    const raw = await api.vault.readFile(VAULT_PATHS.regionMeta(regionId))
    const parsed = JSON.parse(raw) as unknown
    if (!isValidMeta(parsed)) {
      api.log.warn(`regions: meta.json for ${regionId} failed schema validation`)
      return null
    }
    return parsed
  } catch (err) {
    // Missing-file is expected for half-installed regions or regions
    // whose meta.json hasn't been written yet. Log at debug; don't
    // surface as an error to the user.
    api.log.debug(`regions: no meta.json for ${regionId}`, err)
    return null
  }
}

/** Enumerate region ids by scanning the regions/ subtree. Includes
 *  half-installed regions (directories without meta.json) — the
 *  caller filters those out via `readRegionMeta` returning null. */
export async function listInstalledRegionIds(api: PluginAPI): Promise<string[]> {
  try {
    const entries = await api.vault.listFiles('regions')
    return entries
      .filter((e) => e.isDirectory)
      .map((e) => e.name)
      .sort()
  } catch (err) {
    // No regions/ directory yet — fresh install. Not an error.
    api.log.debug('regions: no regions/ directory in vault', err)
    return []
  }
}

/** Hydrate every meta.json under regions/ in one pass. Returns only
 *  regions that have a valid meta — half-installed entries are
 *  silently filtered out (they'd surface as zombies in the UI). */
export async function listInstalledRegions(api: PluginAPI): Promise<RegionMeta[]> {
  const ids = await listInstalledRegionIds(api)
  // Parallel reads — small N (≤ 50 regions in practice), each is a
  // single vault.readFile. Sequential would multiply latency by N.
  const metas = await Promise.all(ids.map((id) => readRegionMeta(api, id)))
  return metas.filter((m): m is RegionMeta => m !== null)
}

/** Type guard for the persisted shape. Strict enough to catch
 *  field-shape regressions; permissive on optional fields. */
function isValidMeta(value: unknown): value is RegionMeta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.regionId === 'string' &&
    typeof v.builtAt === 'string' &&
    typeof v.byteSize === 'number' &&
    typeof v.valhallaVersion === 'string' &&
    typeof v.tilesFormatVersion === 'number' &&
    typeof v.pmtilesVersion === 'number' &&
    typeof v.geocoderVersion === 'number'
  )
}

/** Format `byteSize` as a human label. The display only needs ~1
 *  decimal of precision; SI prefixes with 1 000-based boundaries
 *  (KB / MB / GB). Matches what macOS Finder + Windows Explorer
 *  show for file sizes — users compare against those, not against
 *  binary kibibyte conventions. */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

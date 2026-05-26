/**
 * Stub region installer — DEV ONLY.
 *
 * Writes a minimal vault layout for a region so the rail/sheet/map
 * chrome can be exercised without the slice 6b download orchestrator
 * (which depends on Phase 1's Valhalla + planetiler binaries — not
 * yet built). The stub:
 *
 *   - Writes `meta.json` with the manifest entry's bbox and dummy
 *     version fields. `meta.bbox` lets the maps-page's `regionCenter`
 *     helper resolve the from anchor for routing input. The dummy
 *     versions ("stub" valhalla, 0 for the integers) won't match
 *     anything the real orchestrator emits so a future real install
 *     overwrites without ambiguity.
 *   - Creates an empty `places.db` with the FTS5 schema so the
 *     geocoder hook opens it without "database unavailable" errors.
 *     Search returns "No matches" rather than failing.
 *   - Does NOT create `tiles/` or `region.pmtiles`. The map canvas
 *     stays blank inside the active region (the empty MapLibre style
 *     still mounts; the rail/sheet/pill render normally). Routing
 *     against a stub region will fail because there are no tiles —
 *     this is documented as a known limitation of the dev path.
 *
 * Use cases:
 *   - Manual smoke-testing the rail/sheet UX shipped in slices 3c,
 *     3c-2, 3c-3 without waiting for binaries.
 *   - Verifying the activeRegionId → chrome-visibility wiring from
 *     slice 6a end-to-end.
 *   - Testing the Settings panel's per-region row affordances.
 *
 * Slice 6b's real installer replaces this entirely. The stub
 * installer surface is gated behind a clearly-marked dev affordance
 * in the Settings panel.
 */

import type { PluginAPI } from '@/types'
import type { RegionDefinition } from '@/data/regions'
import { VAULT_PATHS } from '@/constants'
import type { RegionMeta } from './meta'

/** FTS5 schema mirroring the production geocoder build. Kept inline
 *  rather than imported from `geocoder/schema.sql` because Vite
 *  doesn't include .sql files in plugin builds by default and the
 *  schema is tiny enough to duplicate. `IF NOT EXISTS` clauses make
 *  the call idempotent so re-stub-install doesn't error. */
const PLACES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS places (
    rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    importance  INTEGER DEFAULT 0,
    source      TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(
    name, category, content='places', content_rowid='rowid'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_places_lat_lon ON places(latitude, longitude)`,
]

/** Install a stub region. Idempotent — re-installing overwrites the
 *  meta.json and ensures the empty places.db schema is in place.
 *  Throws on vault / sqlite errors; the caller surfaces those in the
 *  Settings panel's per-row error state. */
export async function installStubRegion(
  api: PluginAPI,
  region: RegionDefinition,
): Promise<void> {
  const meta: RegionMeta = {
    regionId: region.id,
    builtAt: new Date().toISOString(),
    byteSize: 0,
    bbox: region.bbox,
    // "stub" prefix on valhallaVersion is the marker slice 6b's
    // installer checks before refusing to route against — a real
    // route call would fail anyway (no tiles) but failing fast at
    // the orchestrator layer gives a clearer error.
    valhallaVersion: 'stub',
    tilesFormatVersion: 0,
    pmtilesVersion: 0,
    geocoderVersion: 0,
    // No OpenAddresses for stubs — search returns nothing anyway.
    oaImportedAt: null,
  }

  await api.vault.writeFile(
    VAULT_PATHS.regionMeta(region.id),
    JSON.stringify(meta, null, 2),
  )

  // Create the empty geocoder DB so the geocoder hook opens it
  // without "database unavailable" surfacing in the search card.
  // createIfMissing makes the host create the file; we then layer
  // the schema on top. The DB handle is closed in `finally` so a
  // partial-failure path (schema run errors) doesn't leak the
  // SQLite file descriptor.
  const db = await api.db.openSqlite(VAULT_PATHS.regionGeocoder(region.id), {
    createIfMissing: true,
    readonly: false,
  })
  try {
    for (const sql of PLACES_SCHEMA) {
      await db.run(sql)
    }
  } finally {
    await db.close()
  }
}

/** Remove a stub region from the vault. Deletes meta.json + places.db;
 *  best-effort cleanup of any other files at the region's path is
 *  out of scope (the stub doesn't create them). Idempotent — missing
 *  files don't throw. */
export async function uninstallStubRegion(
  api: PluginAPI,
  regionId: string,
): Promise<void> {
  // Both deletes catch their own errors so a missing file (e.g.
  // half-installed stub, or a region the user manually cleaned up
  // outside the plugin) doesn't block the other delete.
  await api.vault.deleteFile(VAULT_PATHS.regionMeta(regionId)).catch((err) => {
    api.log.debug(`stub-uninstall: meta.json delete failed for ${regionId}`, err)
  })
  await api.vault.deleteFile(VAULT_PATHS.regionGeocoder(regionId)).catch((err) => {
    api.log.debug(`stub-uninstall: places.db delete failed for ${regionId}`, err)
  })
}

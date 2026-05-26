/**
 * MapLibre `pmtiles://` protocol registration + per-region binding.
 *
 * Four responsibilities, co-located so the protocol's lifecycle
 * stays observable in one file:
 *
 *   1. `installPmtilesProtocol()` — one-time global registration of
 *      the `pmtiles://` scheme via `maplibregl.addProtocol`. The
 *      pmtiles library's `Protocol` instance routes incoming tile
 *      requests to the right PMTiles instance via the tile-map keyed
 *      by source.getKey().
 *   2. `ensurePmtilesForUrl(api, vaultPath)` — idempotent registration
 *      of a vault-backed PMTiles instance for a specific archive.
 *      Style-config's `pmtiles://${vaultPath}` reference then resolves
 *      against our source rather than the library's default
 *      `FetchSource`, which would HTTP-GET the path as a URL and 404.
 *   3. `releaseUnusedPmtiles(keepVaultPath)` — evict every registered
 *      archive except the one given. Called by MapViewer after a
 *      region switch so the previous region's cached ArrayBuffer can
 *      be GC'd. Without this, switching A→B→C accumulates 150-450 MB
 *      in the renderer heap with no release path.
 *   4. `evictPmtilesForUrl(vaultPath)` — single-target eviction.
 *      Slice 6b's uninstall flow calls this when a region is deleted
 *      so the bytes aren't pinned for the rest of the session.
 *
 * Eviction policy is "keep only the active archive." Switching back
 * to a previously-loaded archive re-reads it from vault (~hundreds of
 * ms for a state-sized PMTiles). A future slice can swap this for an
 * LRU(N) once `api.vault.readFileBytesRange` lands and per-tile reads
 * are cheap enough that whole-archive caching becomes pure
 * optimization.
 */

import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import type { PluginAPI } from '@/types'
import { VaultPmtilesSource } from './vault-pmtiles-source'

let protocol: Protocol | null = null
// Map<vaultPath, PMTiles> rather than a Set so eviction can drop the
// PMTiles reference (the source + its cached ArrayBuffer become GC-
// eligible once both our map and the pmtiles Protocol's internal
// `tiles` map release their entries).
const registered = new Map<string, PMTiles>()

/** Register the `pmtiles://` MapLibre protocol once for the renderer's
 *  lifetime. Subsequent calls no-op. Idempotency lets every MapViewer
 *  mount call this without coordinating across instances. */
export function installPmtilesProtocol(): void {
  if (protocol) return
  protocol = new Protocol()
  // `protocol.tile` matches MapLibre's AddProtocolAction signature
  // (the pmtiles library exposes both v3 callback-style and v4
  // promise-style under the same name; MapLibre 5.x picks v4).
  maplibregl.addProtocol('pmtiles', protocol.tile)
}

/** Ensure a vault-backed PMTiles instance is registered for
 *  `vaultPath`. Safe to call before each setStyle that references
 *  this archive; duplicate calls dedupe via the module-scoped Set.
 *
 *  The PMTiles instance lazily reads its archive on first tile
 *  request — calling this function doesn't trigger any I/O on its
 *  own; only the eventual style load drives the actual vault read. */
export function ensurePmtilesForUrl(api: PluginAPI, vaultPath: string): void {
  installPmtilesProtocol()
  if (registered.has(vaultPath)) return
  const source = new VaultPmtilesSource(api, vaultPath)
  const pmtiles = new PMTiles(source)
  // `protocol` was set by `installPmtilesProtocol` above — non-null
  // assert here is safe because installPmtilesProtocol either sets
  // it or it was already set on an earlier call.
  protocol!.add(pmtiles)
  registered.set(vaultPath, pmtiles)
}

/** Drop a single registered archive. Used by slice 6b's region
 *  uninstall path. Safe to call for an unregistered path (no-op). */
export function evictPmtilesForUrl(vaultPath: string): void {
  registered.delete(vaultPath)
  // The pmtiles Protocol's internal `tiles` Map keys off
  // `source.getKey()`, which we set to the vault path. Delete from
  // there too so the PMTiles instance is unreachable from both
  // sides — without this, the buffer stays pinned via the Protocol.
  protocol?.tiles.delete(vaultPath)
}

/** Evict every registered archive except `keepVaultPath`. Pass null
 *  to evict ALL. Called by MapViewer after a region switch so the
 *  previous active archive's ~50-150 MB ArrayBuffer becomes GC-
 *  eligible. Without this, switching A→B→C accumulates roughly the
 *  sum of all three archives in the renderer heap with no release. */
export function releaseUnusedPmtiles(keepVaultPath: string | null): void {
  // Snapshot the keys before iterating — deleting from the live Map
  // mid-iteration would be undefined behavior under the iterator
  // protocol. `Array.from(registered.keys())` materializes the
  // current key set so we can mutate the Map safely as we go.
  for (const path of Array.from(registered.keys())) {
    if (path !== keepVaultPath) evictPmtilesForUrl(path)
  }
}

/** Test seam — wipes the module-scoped state so unit tests can
 *  exercise installPmtilesProtocol / ensurePmtilesForUrl without the
 *  prior test's registrations bleeding through. Not called from
 *  production code. */
export function _resetPmtilesProtocolForTests(): void {
  protocol = null
  registered.clear()
}

/**
 * MapLibre `pmtiles://` protocol registration + per-region binding.
 *
 * Two responsibilities, intentionally co-located so the protocol's
 * lifecycle stays observable in one file:
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
 *
 * Both functions are safe to call from multiple components (MapViewer
 * registers the protocol on mount; ensurePmtilesForUrl runs before
 * every setStyle that includes a non-null pmtilesUrl). The dedupe
 * sets keep idempotency cheap.
 *
 * No removal path yet — the pmtiles `Protocol` class doesn't expose
 * `remove`, and PMTiles instances are tiny next to their cached
 * source buffers. Slice 6b's uninstall flow may extend this to evict
 * the source's `bufferPromise` to drop the in-memory archive when a
 * region is deleted; the protocol entry itself stays harmlessly.
 */

import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import type { PluginAPI } from '@/types'
import { VaultPmtilesSource } from './vault-pmtiles-source'

let protocol: Protocol | null = null
const registered = new Set<string>()

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
  registered.add(vaultPath)
}

/** Test seam — wipes the module-scoped state so unit tests can
 *  exercise installPmtilesProtocol / ensurePmtilesForUrl without the
 *  prior test's registrations bleeding through. Not called from
 *  production code. */
export function _resetPmtilesProtocolForTests(): void {
  protocol = null
  registered.clear()
}

/**
 * Vault-backed PMTiles `Source` — memory-cached for v3.0.
 *
 * Implements the `Source` interface from the `pmtiles` package so a
 * PMTiles instance can serve byte ranges from a vault-resident file.
 * The pmtiles library uses range reads heavily (header + root
 * directory + tile data); without a range surface in the host's
 * `api.vault`, this implementation reads the entire file into memory
 * once on first access and slices into the cached `ArrayBuffer`
 * for subsequent `getBytes` calls.
 *
 * Trade-off: state-sized PMTiles (~50-150 MB) sit happily in the
 * renderer heap. Country / continent-sized archives (1-3 GB) would
 * push the renderer toward an OOM. The host change to expose
 * `api.vault.readFileBytesRange(path, offset, length)` is tracked as
 * a follow-up; once it lands, this source can be retrofitted to do
 * true range reads with minimal LRU caching of recently-accessed
 * directory blocks.
 *
 * Lifecycle: instances are owned by `cached-pmtiles-protocol.ts`,
 * created lazily per region, and kept alive for the plugin's
 * activate cycle. No explicit cleanup yet — the pmtiles `Protocol`
 * class doesn't expose a remove() and PMTiles instances are cheap
 * relative to the cached buffers. Slice 6b's uninstall flow will
 * extend this with a remove-on-region-delete path.
 */

import type { Source, RangeResponse } from 'pmtiles'
import type { PluginAPI } from '@/types'

export class VaultPmtilesSource implements Source {
  /**
   * Cached ArrayBuffer promise. Resolved on first `getBytes` call;
   * cleared on read failure so a subsequent call can retry. The
   * promise (not the resolved buffer) lets concurrent `getBytes`
   * during the initial load share a single vault read instead of
   * each issuing their own.
   */
  private bufferPromise: Promise<ArrayBuffer> | null = null

  constructor(
    private readonly api: PluginAPI,
    private readonly vaultPath: string,
  ) {}

  /** Stable key for the pmtiles Protocol's tile map. The
   *  `pmtiles://${vaultPath}` URL in style-config.ts strips the
   *  prefix and looks up the source by this key. */
  getKey(): string {
    return this.vaultPath
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<RangeResponse> {
    if (!this.bufferPromise) {
      this.bufferPromise = this.api.vault.readFileBytes(this.vaultPath)
    }

    let buffer: ArrayBuffer
    try {
      buffer = await this.bufferPromise
    } catch (err) {
      // Clear the cached promise so a retry (e.g. region just
      // finished installing) can re-fetch. Without this, every
      // subsequent getBytes would return the same rejected promise
      // and the map would stay broken even after the file appears.
      this.bufferPromise = null
      throw err
    }

    // pmtiles passes the AbortSignal so a viewport change can cancel
    // mid-flight tile requests. We've already paid the whole-file
    // read; the per-slice work is synchronous, but honor the signal
    // anyway so MapLibre's internal cancellation semantics line up.
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    // Slice into a fresh ArrayBuffer rather than returning a typed-
    // array view over the cached buffer. PMTiles' callers transfer
    // the data into the WebGL worker for tile decoding; transferring
    // a view that pins the entire archive buffer would inflate
    // worker memory by the full archive size on every tile.
    return { data: buffer.slice(offset, offset + length) }
  }
}

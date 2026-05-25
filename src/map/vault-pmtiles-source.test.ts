/**
 * Unit tests for VaultPmtilesSource.
 *
 * The vault-backed source caches the first read into memory and
 * slices on subsequent requests; tests cover the cache + slice + abort
 * + error-retry contract. We mock `api.vault.readFileBytes` with a
 * spy so the test suite doesn't touch real I/O.
 */

import { describe, expect, it, vi } from 'vitest'
import { VaultPmtilesSource } from './vault-pmtiles-source'
import type { PluginAPI } from '@/types'

/** Build a minimal PluginAPI stand-in with a controllable
 *  `vault.readFileBytes`. The other surfaces aren't touched by
 *  VaultPmtilesSource so we leave them undefined under a cast. */
function mockApi(readBytes: (relPath: string) => Promise<ArrayBuffer>): PluginAPI {
  return {
    vault: { readFileBytes: readBytes },
  } as unknown as PluginAPI
}

/** ArrayBuffer with bytes 0..n-1 — predictable per-byte values so
 *  slice asserts can read the actual offset back as the byte value. */
function rangeBuffer(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n)
  const view = new Uint8Array(buf)
  for (let i = 0; i < n; i++) view[i] = i % 256
  return buf
}

describe('VaultPmtilesSource', () => {
  it('getKey returns the vault path', () => {
    const src = new VaultPmtilesSource(
      mockApi(async () => new ArrayBuffer(0)),
      'regions/us-washington/region.pmtiles',
    )
    expect(src.getKey()).toBe('regions/us-washington/region.pmtiles')
  })

  it('reads the underlying file once and serves slices from cache', async () => {
    const readSpy = vi.fn(async () => rangeBuffer(256))
    const src = new VaultPmtilesSource(mockApi(readSpy), 'r/x.pmtiles')

    const a = await src.getBytes(0, 16)
    const b = await src.getBytes(64, 16)
    const c = await src.getBytes(0, 16) // overlap with `a`

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(a.data)[0]).toBe(0)
    expect(new Uint8Array(a.data)[15]).toBe(15)
    expect(new Uint8Array(b.data)[0]).toBe(64)
    expect(new Uint8Array(c.data)[0]).toBe(0)
  })

  it('shares the in-flight read promise across concurrent calls', async () => {
    // Two getBytes calls fired before the read resolves should both
    // see the same vault call — otherwise the buffer would be read
    // twice on tile-storm scenarios (MapLibre requests N tiles in
    // parallel on first render).
    const readSpy = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          setTimeout(() => resolve(rangeBuffer(256)), 10)
        }),
    )
    const src = new VaultPmtilesSource(mockApi(readSpy), 'r/x.pmtiles')

    const [a, b] = await Promise.all([src.getBytes(0, 8), src.getBytes(8, 8)])

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(a.data).length).toBe(8)
    expect(new Uint8Array(b.data)[0]).toBe(8)
  })

  it('clears the cached promise on read failure so a retry can succeed', async () => {
    let attempts = 0
    const readSpy = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw new Error('vault unavailable')
      return rangeBuffer(64)
    })
    const src = new VaultPmtilesSource(mockApi(readSpy), 'r/x.pmtiles')

    await expect(src.getBytes(0, 8)).rejects.toThrow('vault unavailable')
    // Second call should not be permanently rejected.
    const ok = await src.getBytes(0, 8)
    expect(new Uint8Array(ok.data)[0]).toBe(0)
    expect(readSpy).toHaveBeenCalledTimes(2)
  })

  it('honors an aborted signal after the buffer is cached', async () => {
    const src = new VaultPmtilesSource(
      mockApi(async () => rangeBuffer(32)),
      'r/x.pmtiles',
    )
    // Prime the cache.
    await src.getBytes(0, 4)

    const controller = new AbortController()
    controller.abort()
    await expect(src.getBytes(0, 4, controller.signal)).rejects.toThrow(/abort/i)
  })

  it('returns an independent ArrayBuffer per slice (no shared view)', async () => {
    // pmtiles transfers tile data to workers; transferring a view
    // that pins the whole archive would inflate worker memory. The
    // implementation must `.slice()` to produce a fresh ArrayBuffer.
    const src = new VaultPmtilesSource(
      mockApi(async () => rangeBuffer(64)),
      'r/x.pmtiles',
    )
    const first = await src.getBytes(0, 8)
    const second = await src.getBytes(0, 8)
    expect(first.data).not.toBe(second.data)
  })
})

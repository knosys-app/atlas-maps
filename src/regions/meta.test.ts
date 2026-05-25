/**
 * Unit tests for the pure helpers in meta.ts.
 *
 * `readRegionMeta` / `listInstalledRegions` go through `api.vault.*`
 * and are exercised in slice 6b's orchestrator integration. The
 * coverage here is for `formatBytes` — used by the Settings panel
 * to display per-region size + total storage usage.
 */

import { describe, expect, it } from 'vitest'
import { formatBytes } from './meta'

describe('formatBytes', () => {
  it('returns raw bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('switches to KB at 1024 with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('switches to MB at 1 MiB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(712 * 1024 * 1024)).toBe('712.0 MB')
  })

  it('switches to GB at 1 GiB with two decimals', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    // 1.2 GB region (~typical US state)
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe('1.20 GB')
    // Boundary just below GB — should stay in MB
    expect(formatBytes(1023 * 1024 * 1024)).toBe('1023.0 MB')
  })

  it('handles edge inputs without crashing', () => {
    // Negative bytes shouldn't happen in practice (meta.byteSize is
    // always positive), but the helper is forgiving — falls into the
    // first branch since -1 < 1024.
    expect(formatBytes(-1)).toBe('-1 B')
  })
})

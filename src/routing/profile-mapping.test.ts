import { describe, it, expect } from 'vitest'
import { speedAdaptiveBearingTolerance, uiProfileToValhalla } from './profile-mapping'

describe('uiProfileToValhalla', () => {
  it('maps driving → auto', () => {
    expect(uiProfileToValhalla('driving')).toBe('auto')
  })

  it('passes through bicycle + pedestrian unchanged', () => {
    expect(uiProfileToValhalla('bicycle')).toBe('bicycle')
    expect(uiProfileToValhalla('pedestrian')).toBe('pedestrian')
  })
})

describe('speedAdaptiveBearingTolerance', () => {
  it('returns 180 below the low-speed floor (< 2 m/s)', () => {
    expect(speedAdaptiveBearingTolerance(0)).toBe(180)
    expect(speedAdaptiveBearingTolerance(1)).toBe(180)
    expect(speedAdaptiveBearingTolerance(1.9)).toBe(180)
  })

  it('returns 180 when speed is undefined', () => {
    expect(speedAdaptiveBearingTolerance(undefined)).toBe(180)
  })

  it('is continuous at the 2 m/s boundary — no discontinuity', () => {
    // Pre-fix, this was 90° here. Post-fix, the ramp starts at 180°.
    expect(speedAdaptiveBearingTolerance(2.0)).toBe(180)
  })

  it('interpolates linearly between 2 m/s (180°) and 25 m/s (30°)', () => {
    // Midpoint: 13.5 m/s should land at 105° (midway between 180 and 30).
    expect(speedAdaptiveBearingTolerance(13.5)).toBe(105)
  })

  it('clamps to 30° at + above highway speed (≥ 25 m/s)', () => {
    expect(speedAdaptiveBearingTolerance(25)).toBe(30)
    expect(speedAdaptiveBearingTolerance(50)).toBe(30)
  })

  it('decreases monotonically as speed increases', () => {
    const samples = [2, 5, 10, 15, 20, 25]
    const tolerances = samples.map(speedAdaptiveBearingTolerance)
    for (let i = 1; i < tolerances.length; i++) {
      expect(tolerances[i]).toBeLessThanOrEqual(tolerances[i - 1])
    }
  })
})

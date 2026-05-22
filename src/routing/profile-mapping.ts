import type { RouteProfile } from './types'

/** UI profile name → Valhalla `costing` model name. */
export function uiProfileToValhalla(profile: RouteProfile): 'auto' | 'bicycle' | 'pedestrian' {
  if (profile === 'driving') return 'auto'
  return profile
}

/** Speed-adaptive bearing tolerance, ported from SpeedDeck's
 *  `_bearing_range`. At low speed, GPS heading is noisy + the driver
 *  can turn freely → wide tolerance. At highway speed → narrow tolerance
 *  so we don't generate a U-turn from minor heading wiggle. */
export function speedAdaptiveBearingTolerance(speedMps: number | undefined): number {
  if (speedMps === undefined || speedMps < 2.0) return 180
  if (speedMps >= 25.0) return 30
  // Linear interpolation between 2 m/s (90°) and 25 m/s (30°).
  const t = (speedMps - 2.0) / (25.0 - 2.0)
  return Math.round(90 - t * (90 - 30))
}

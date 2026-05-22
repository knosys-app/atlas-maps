import type { RouteProfile } from './types'

/** UI profile name → Valhalla `costing` model name. */
export function uiProfileToValhalla(profile: RouteProfile): 'auto' | 'bicycle' | 'pedestrian' {
  if (profile === 'driving') return 'auto'
  return profile
}

/** Speed-adaptive bearing tolerance, ported from SpeedDeck's
 *  `_bearing_range`. At low speed, GPS heading is noisy + the driver
 *  can turn freely → wide tolerance. At highway speed → narrow tolerance
 *  so we don't generate a U-turn from minor heading wiggle.
 *
 *  The curve is continuous: 180° below 2 m/s, linearly down to 30° at
 *  25 m/s, then flat at 30° above. (An earlier version started the
 *  ramp at 90° which produced a 90° jump at exactly 2 m/s — at walking
 *  pace, where GPS heading is still noisy, the abrupt tightening
 *  produced spurious Valhalla "no route" failures that the router's
 *  fallback then had to absorb.) */
export function speedAdaptiveBearingTolerance(speedMps: number | undefined): number {
  if (speedMps === undefined || speedMps < 2.0) return 180
  if (speedMps >= 25.0) return 30
  // Linear interpolation between 2 m/s (180°) and 25 m/s (30°).
  const t = (speedMps - 2.0) / (25.0 - 2.0)
  return Math.round(180 - t * (180 - 30))
}

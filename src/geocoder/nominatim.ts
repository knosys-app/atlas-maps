/**
 * Online Nominatim fallback.
 *
 * Used by `search.ts` when local FTS5 returns fewer than the configured
 * threshold (default 3) AND `navigator.onLine` is true. Goes through
 * `api.network.fetch` so the request runs in the main process — bypasses
 * renderer CORS and lets us set a custom User-Agent (Nominatim's usage
 * policy requires identifying the caller).
 *
 * Returns at most ~10 results. Errors are caught + swallowed by the
 * orchestrator; the fallback is best-effort, not authoritative.
 */

import type { PluginAPI } from '@/types'
import type { PlaceResult } from './types'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'Knosys-Maps/3.0 (+https://github.com/knosys-app/atlas-maps)'

interface NominatimRow {
  display_name?: string
  lat?: string
  lon?: string
  importance?: number
  /** Top-level OSM category — `place`, `highway`, `amenity`, etc. */
  class?: string
  /** OSM tag value — `city`, `town`, `road`, etc. */
  type?: string
}

/**
 * Issue a single Nominatim query. Maps the response into `PlaceResult`
 * shape so the orchestrator can merge with FTS rows uniformly.
 */
export async function nominatimSearch(
  api: PluginAPI,
  query: string,
  near?: { lat: number; lon: number },
): Promise<PlaceResult[]> {
  if (!api.network?.fetch) {
    // Older host without api.network — quietly skip the fallback.
    return []
  }

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '10',
    addressdetails: '0',
  })
  if (near) {
    // Nominatim's `viewbox` biases results toward an area. Use a ~0.5°
    // square around the anchor; loose enough to find nearby cities,
    // tight enough that we don't get global noise.
    const left = near.lon - 0.5
    const right = near.lon + 0.5
    const top = near.lat + 0.5
    const bottom = near.lat - 0.5
    params.set('viewbox', `${left},${top},${right},${bottom}`)
    params.set('bounded', '0') // soft hint, not a hard filter
  }

  const url = `${ENDPOINT}?${params.toString()}`
  let res
  try {
    res = await api.network.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      timeoutMs: 5_000,
    })
  } catch (err) {
    api.log.warn('geocoder: nominatim fetch failed', err)
    return []
  }

  if (res.status < 200 || res.status >= 300) {
    api.log.warn(`geocoder: nominatim ${res.status}`)
    return []
  }

  let rows: NominatimRow[]
  try {
    const text = new TextDecoder('utf-8').decode(res.body)
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      // Nominatim sometimes returns a 200 with an object envelope
      // (error wrapper, rate-limit hint). The `as` cast wouldn't
      // catch this, and the subsequent `flatMap` would throw past
      // the try/catch — propagating the rejection up into the
      // search orchestrator and breaking tier-3 fallback. Treat
      // non-array bodies the same as parse failure: log + return [].
      api.log.warn('geocoder: nominatim returned non-array body')
      return []
    }
    rows = parsed as NominatimRow[]
  } catch (err) {
    api.log.warn('geocoder: nominatim body parse failed', err)
    return []
  }

  return rows.flatMap((row) => mapRow(row)).slice(0, 10)
}

function mapRow(row: NominatimRow): PlaceResult[] {
  if (!row.display_name || !row.lat || !row.lon) return []
  const lat = Number.parseFloat(row.lat)
  const lon = Number.parseFloat(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []

  // Split the display_name into "<place name>, <address tail>". The
  // place name is what FTS rows use, so cross-tier dedupe collapses
  // tier-1 (local) + tier-2 (Nominatim) hits for the same physical
  // place. The address tail becomes a subtitle for the UI.
  const segments = row.display_name.split(',').map((s) => s.trim()).filter(Boolean)
  const name = segments[0] ?? row.display_name
  const subtitle = segments.length > 1 ? segments.slice(1).join(', ') : undefined

  return [
    {
      name,
      subtitle,
      category: mapCategory(row),
      latitude: lat,
      longitude: lon,
      importance: Math.round((row.importance ?? 0.15) * 100),
      source: 'nominatim',
      distanceM: 0,
    },
  ]
}

function mapCategory(row: NominatimRow): PlaceResult['category'] {
  const cls = row.class
  const type = row.type
  if (cls === 'place') {
    if (type === 'city') return 'city'
    if (type === 'town') return 'town'
    if (type === 'village') return 'village'
    if (type === 'hamlet') return 'hamlet'
    if (type === 'suburb') return 'suburb'
    if (type === 'neighbourhood') return 'neighbourhood'
  }
  if (cls === 'highway') return 'road'
  if (cls === 'amenity' || cls === 'shop' || cls === 'tourism') return 'poi'
  return 'poi'
}

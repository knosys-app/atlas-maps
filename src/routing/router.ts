/**
 * Plugin-side routing wrapper.
 *
 * Builds the Valhalla request (with speed-adaptive bearing constraint
 * on the origin), calls `api.routing.route` against the active engine
 * handle, parses the response into the internal `RouteData` shape, and
 * caches the last few requests so the rail doesn't recompute on
 * incidental rerenders.
 */

import type { PluginAPI, ValhallaRouteRequest, ValhallaRouteResponse } from '@/types'
import type { RouteCalcInput, RouteData } from './types'
import { parseValhallaRoute } from './route-parser'
import { uiProfileToValhalla, speedAdaptiveBearingTolerance } from './profile-mapping'

interface CacheEntry {
  key: string
  data: RouteData
}

const CACHE_LIMIT = 5
const cache: CacheEntry[] = []

function cacheKey(input: RouteCalcInput): string {
  // Round to ~100m so trivial GPS drift on the origin doesn't bust cache.
  const round = (v: number) => Math.round(v * 1000) / 1000
  return [
    input.profile,
    round(input.fromLat),
    round(input.fromLon),
    round(input.toLat),
    round(input.toLon),
  ].join('|')
}

function cacheGet(key: string): RouteData | null {
  const idx = cache.findIndex((e) => e.key === key)
  if (idx === -1) return null
  // Touch (move to end) for LRU semantics.
  const [hit] = cache.splice(idx, 1)
  cache.push(hit)
  return hit.data
}

function cachePut(key: string, data: RouteData): void {
  cache.push({ key, data })
  while (cache.length > CACHE_LIMIT) cache.shift()
}

/** Build a Valhalla request body. Origin gets a bearing+tolerance
 *  constraint derived from current speed; destination is unconstrained. */
function buildRequest(input: RouteCalcInput): ValhallaRouteRequest {
  const heading = input.headingDeg
  const tolerance = speedAdaptiveBearingTolerance(input.speedMps)
  return {
    locations: [
      {
        lat: input.fromLat,
        lon: input.fromLon,
        type: 'break',
        ...(heading !== undefined && Number.isFinite(heading)
          ? { heading, heading_tolerance: tolerance }
          : {}),
      },
      {
        lat: input.toLat,
        lon: input.toLon,
        type: 'break',
      },
    ],
    costing: uiProfileToValhalla(input.profile),
    directions_options: {
      units: input.units ?? 'miles',
    },
  }
}

/**
 * Calculate a route. Falls back to an unconstrained request on Valhalla
 * empty-result errors (matches SpeedDeck behaviour — bearing constraints
 * occasionally over-restrict on dual-carriageways).
 */
export async function calculateRoute(
  api: PluginAPI,
  handleId: string,
  input: RouteCalcInput,
): Promise<RouteData> {
  if (!api.routing) {
    throw new Error('Plugin lacks routing:engine permission')
  }
  const key = cacheKey(input)
  const cached = cacheGet(key)
  if (cached) return cached

  const tryRequest = async (request: ValhallaRouteRequest): Promise<ValhallaRouteResponse> => {
    return api.routing!.route(handleId, request)
  }

  let response: ValhallaRouteResponse
  try {
    response = await tryRequest(buildRequest(input))
  } catch (err) {
    // Bearing constraint can produce "no route found" — strip the
    // heading and retry once before surfacing the error.
    if (input.headingDeg !== undefined) {
      const fallback = buildRequest({ ...input, headingDeg: undefined, speedMps: undefined })
      response = await tryRequest(fallback)
    } else {
      throw err
    }
  }

  const parsed = parseValhallaRoute(response, input.profile)
  cachePut(key, parsed)
  return parsed
}

/** Drop every cached route. Call when the active region changes (the
 *  underlying graph changed, so cached responses are stale). */
export function clearRouteCache(): void {
  cache.length = 0
}

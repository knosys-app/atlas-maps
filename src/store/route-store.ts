/**
 * Route preview store — Zustand.
 *
 * Holds the currently-previewed route (active destination + parsed
 * `RouteData`). Drives the Briefing card, Sheet/Steps tab, Plan Pill,
 * and (slice 3c-2+) the map's route-line layer.
 *
 * The store owns the routing engine lifecycle for the preview path —
 * `setPreview` calls `ensureEngineRunning` (Phase 0 host API) before
 * dispatching `calculateRoute`. The engine starts lazily on first
 * preview, so the per-route latency includes a one-time engine boot
 * if no route has been requested yet for the active region.
 *
 * Cancellation: a `generation` counter is bumped on every `setPreview`
 * call. A slow route resolve checks the counter before committing —
 * if a newer preview started while the old one was in-flight, the old
 * resolve is dropped on the floor. Same shape as the geocoder hook.
 */

import { create } from 'zustand'
import type { PluginAPI } from '@/types'
import type { RouteData, RouteProfile } from '@/routing/types'
import type { SearchSuggestion } from '@/rail/search-card'
import { calculateRoute } from '@/routing/router'
import { ensureEngineRunning } from '@/routing/engine'

export interface RoutePreview {
  destination: SearchSuggestion
  /** `null` while the route is still being calculated; populated when
   *  `calculateRoute` resolves. Briefing / Steps read this. */
  route: RouteData | null
}

interface RouteStore {
  preview: RoutePreview | null
  loading: boolean
  error: string | null
  /**
   * Calculate a route from `from` → `destination` and store it. Cancels
   * any in-flight previous preview via the generation counter.
   *
   * @param from  Origin lat/lon (caller computes — region center
   *              today, GPS in v3.1).
   * @param profile  Routing profile to use (driving / bicycle /
   *                 pedestrian).
   */
  setPreview(
    api: PluginAPI,
    regionId: string,
    from: { lat: number; lon: number },
    profile: RouteProfile,
    destination: SearchSuggestion,
  ): Promise<void>
  clearPreview(): void
}

/**
 * Module-scoped monotonic counter. Same pattern as the saved store's
 * `mutationGen` and the geocoder's `requestIdRef`. Lives outside the
 * store so the latest value is observable regardless of which render
 * is reading it.
 */
let generation = 0

export const useRouteStore = create<RouteStore>((set) => ({
  preview: null,
  loading: false,
  error: null,

  async setPreview(api, regionId, from, profile, destination) {
    const myGen = ++generation
    // Optimistic: show the destination + a loading state while the
    // route calculates. The Briefing card's `preview` is null at this
    // stage (no RouteData yet), so it renders nothing; the Plan Pill
    // shows the destination name with no chip.
    set({
      preview: { destination, route: null },
      loading: true,
      error: null,
    })

    try {
      const handleId = await ensureEngineRunning(api, regionId)
      if (myGen !== generation) return
      const route = await calculateRoute(api, handleId, {
        fromLat: from.lat,
        fromLon: from.lon,
        toLat: destination.lat,
        toLon: destination.lon,
        profile,
      })
      if (myGen !== generation) return
      set({
        preview: { destination, route },
        loading: false,
        error: null,
      })
    } catch (err) {
      if (myGen !== generation) return
      api.log.warn('route: preview failed', err)
      // Keep the destination in the preview so the user sees what they
      // were trying to navigate to, but with an error surface. The
      // Plan Pill stays in preview state; Briefing / Steps fall back
      // to their empty states because `preview.route` is still null.
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Route unavailable',
      })
    }
  },

  clearPreview() {
    // Bump the generation so any in-flight `setPreview` is dropped.
    generation++
    set({ preview: null, loading: false, error: null })
  },
}))

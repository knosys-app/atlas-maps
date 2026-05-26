/**
 * MapLibre canvas — slim port of flight-planner's MapViewer.
 *
 * Drops aviation-specific layers (airports / navaids / airspace /
 * runways / route line) — those land in later slices on top of this
 * foundation. v3.0 keeps the canvas as a generic MapLibre host:
 *
 *   - Initialize a MapLibre map at the saved viewport (or the default
 *     US-centered view).
 *   - Mount the basic NavigationControl + ScaleControl.
 *   - Save viewport on `moveend` / `zoomend` so re-entering the route
 *     restores the last camera.
 *   - Hot-swap the style on theme change (system / Knosys appearance
 *     toggle) without remounting the canvas.
 *
 * The `pmtilesUrl` prop drives the active style. When null (no region
 * installed) the canvas mounts with an empty style — MapLibre renders
 * nothing, and the parent overlays `EmptyState` to fill the void.
 *
 * Per-region PMTiles are served via the `pmtiles://` protocol
 * registered in `cached-pmtiles-protocol.ts`. The vault-backed source
 * reads the full archive into memory on first access (50–150 MB for
 * state-sized regions) and slices for subsequent tile requests. After
 * a region switch the MapViewer calls `releaseUnusedPmtiles` to drop
 * the previous archive's cached buffer so memory stays bounded across
 * a region-switching session. True per-tile range reads are a
 * follow-up once `api.vault.readFileBytesRange` lands; until then,
 * whole-archive caching is the pragmatic surface.
 */

import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import maplibregl, { type Map as MaplibreMap } from 'maplibre-gl'
import type { PluginAPI } from '@/types'
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  DEFAULT_MAP_BEARING,
  DEFAULT_MAP_PITCH,
} from '@/constants'
import { ensureMaplibreWorker } from './maplibre-worker-setup'
import { buildPlanetStyle, currentMapTheme } from './style-config'
import { loadViewport, saveViewport } from '@/store/viewport-store'
import {
  addRouteLineLayer,
  setRouteLineData,
  computeRouteBounds,
  ROUTE_LINE_MAIN_LAYER_ID,
  type RouteLineGeometry,
} from './layers/route-line-layer'
import {
  installPmtilesProtocol,
  ensurePmtilesForUrl,
  releaseUnusedPmtiles,
} from './cached-pmtiles-protocol'

export interface MapViewerProps {
  api: PluginAPI
  /** Active region's id (used as the per-region viewport key). Null
   *  means "no region active"; the canvas still mounts but uses the
   *  global viewport key. */
  regionId: string | null
  /** Vault path to the active region's PMTiles archive. Null when no
   *  region is installed; renders an empty MapLibre canvas. */
  pmtilesUrl: string | null
  /** GeoJSON LineString of the currently-previewed route, or null
   *  when there's no active preview. Sourced from
   *  `route.preview?.route?.geometry`. */
  routeGeometry: RouteLineGeometry | null
}

export const MapViewer: FC<MapViewerProps> = ({ api, regionId, pmtilesUrl, routeGeometry }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  // Latest regionId / pmtilesUrl — read inside the mount IIFE + the
  // throttled save handler so we always pick up the current values
  // even when they change during the async `loadViewport` window. The
  // closures wouldn't see prop updates that arrive before the map
  // instance exists (the hot-swap effect below short-circuits while
  // `mapRef.current` is still null), so without the ref the map
  // would mount with whatever the props were at React-mount time and
  // any concurrent activate would be silently lost.
  const regionIdRef = useRef(regionId)
  regionIdRef.current = regionId
  const pmtilesUrlRef = useRef(pmtilesUrl)
  pmtilesUrlRef.current = pmtilesUrl
  // Route geometry tracked via ref so the `style.load` permanent
  // handler (registered once at mount) can always read the current
  // value without stale-closure issues. Same pattern as regionId /
  // pmtilesUrl above.
  const routeGeometryRef = useRef(routeGeometry)
  routeGeometryRef.current = routeGeometry
  // Previous route geometry used to detect null → present transitions
  // for the bounds-fit. Updated by both the `load` handler (covers
  // the case where a route is already set when the map mounts) and
  // the routeGeometry useEffect below.
  const prevRouteRef = useRef<RouteLineGeometry | null>(null)

  // Mount MapLibre once. The map instance lives for the lifetime of
  // the MapViewer component; style + tile source swaps happen through
  // `setStyle()` rather than recreating the map.
  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    ensureMaplibreWorker()
    // Register the `pmtiles://` protocol before any style references
    // it. Idempotent — subsequent MapViewer mounts (HMR, route
    // re-entry) hit the no-op fast path inside.
    installPmtilesProtocol()

    ;(async () => {
      const saved = await loadViewport(api, regionIdRef.current)
      if (cancelled || !containerRef.current) return

      const theme = currentMapTheme()
      // Use the ref, not the captured prop — `pmtilesUrl` may have
      // changed during `await loadViewport`. The hot-swap effect's
      // `mapRef.current` null-check would otherwise drop the update.
      const initialPmtiles = pmtilesUrlRef.current
      if (initialPmtiles) {
        // Bind the vault-backed PMTiles source to this URL before
        // the style references it. Without this, MapLibre would
        // construct a default FetchSource that HTTP-GETs the path
        // as a URL — 404 against our vault scheme.
        ensurePmtilesForUrl(api, initialPmtiles)
      }
      const style = buildPlanetStyle(initialPmtiles, theme)

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: saved?.center ?? DEFAULT_MAP_CENTER,
        zoom: saved?.zoom ?? DEFAULT_MAP_ZOOM,
        bearing: saved?.bearing ?? DEFAULT_MAP_BEARING,
        pitch: saved?.pitch ?? DEFAULT_MAP_PITCH,
        // Renderer-side attribution. The style itself carries source
        // attribution; this control renders the attribution UI.
        attributionControl: { compact: true },
      })

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
      map.addControl(
        new maplibregl.ScaleControl({ maxWidth: 120, unit: 'imperial' }),
        'bottom-left',
      )

      // Save viewport on idle, debounced. `idle` fires after every
      // pan / zoom / rotate / tilt — without back-pressure we'd hit
      // `api.storage.set` dozens of times per minute on active use.
      // 500 ms trailing debounce preserves the "capture before
      // session-end close" intent while collapsing redundant writes.
      let saveTimer: ReturnType<typeof setTimeout> | null = null
      map.on('idle', () => {
        if (saveTimer !== null) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          const center = map.getCenter()
          void saveViewport(api, regionIdRef.current, {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch(),
          })
        }, 500)
      })

      // Re-add the route layer on every style load. `style.load`
      // fires after the initial mount AND after every setStyle call
      // (theme switch, region swap). setStyle wipes non-style
      // sources + layers, so the route line vanishes without this
      // permanent listener. addRouteLineLayer is idempotent so the
      // initial-load case doesn't double-add.
      map.on('style.load', () => {
        addRouteLineLayer(map)
        setRouteLineData(map, routeGeometryRef.current)
      })

      // Initial bounds-fit. Covers the case where a route is already
      // previewed when the map mounts (e.g. user navigates away
      // mid-route + comes back). Subsequent route transitions are
      // handled by the useEffect below — this handler is one-shot,
      // and seeds prevRouteRef so the effect's first run doesn't
      // double-fit.
      map.once('load', () => {
        const g = routeGeometryRef.current
        prevRouteRef.current = g
        if (g && g.coordinates.length > 0) {
          const bounds = computeRouteBounds(g.coordinates)
          if (bounds) {
            map.fitBounds(bounds, { padding: 80, duration: 800 })
          }
        }
      })

      mapRef.current = map
    })()

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Mount-only: we deliberately don't re-run on api/regionId changes
    // (style swaps happen in the effect below; the map instance is
    // reused). eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hot-swap the style when the pmtiles URL changes — region activated,
  // region switched, region uninstalled. MapLibre's `setStyle` preserves
  // the camera and re-paints with the new sources.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (pmtilesUrl) {
      // Bind the vault source for the new URL before setStyle hits
      // the PMTiles protocol handler. ensurePmtilesForUrl is
      // idempotent — repeat calls with the same URL no-op.
      ensurePmtilesForUrl(api, pmtilesUrl)
    }
    const theme = currentMapTheme()
    map.setStyle(buildPlanetStyle(pmtilesUrl, theme))
    // Drop any previously-registered archives so a region-switch
    // session (A → B → C) doesn't accumulate every visited archive's
    // ~50-150 MB buffer in the renderer heap. Switching back to a
    // dropped archive re-reads it; cheap relative to leaking memory.
    // The current pmtilesUrl is preserved (or null when no region is
    // active, which evicts everything).
    releaseUnusedPmtiles(pmtilesUrl)
  }, [api, pmtilesUrl])

  // Push route-line geometry updates after the map exists. Skips when
  // the layer hasn't been added yet (initial-load hasn't fired) — in
  // that case the `style.load` handler in the mount IIFE picks up
  // `routeGeometryRef.current` and writes the latest value when the
  // style finishes loading, so nothing's lost.
  //
  // Bounds-fit only on null → present transitions. This relies on a
  // contract with `route-store.ts`: `setPreview` sets
  // `preview.route = null` synchronously before its `await`, so every
  // route change is observed by this effect as `geometry → null` →
  // `geometry → new`. A direct A → B transition without the null pass
  // would skip the fit and leave the camera stuck on A's viewport —
  // verify that contract holds if the store's optimistic-update
  // pattern ever changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!map.getLayer(ROUTE_LINE_MAIN_LAYER_ID)) {
      // Don't touch prevRouteRef here. The `load` handler decides
      // whether the initial fit fires based on the value at load
      // time; if we updated prevRouteRef before load, a null→A→B
      // sequence that all lands pre-load would lose the fit.
      return
    }
    setRouteLineData(map, routeGeometry)
    if (
      routeGeometry &&
      !prevRouteRef.current &&
      routeGeometry.coordinates.length > 0
    ) {
      const bounds = computeRouteBounds(routeGeometry.coordinates)
      if (bounds) {
        map.fitBounds(bounds, { padding: 80, duration: 800 })
      }
    }
    prevRouteRef.current = routeGeometry
  }, [routeGeometry])

  // React to system / Knosys appearance changes. Re-runs the theme
  // resolver and swaps the style flavor without dropping the camera.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const mq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null

    const handler = () => {
      const m = mapRef.current
      if (!m) return
      if (pmtilesUrl) {
        // Same ensure-before-setStyle as the pmtilesUrl effect — a
        // theme change still routes through setStyle, which will
        // request tiles via the pmtiles protocol once the new style
        // loads. Idempotent registrations skip re-binding.
        ensurePmtilesForUrl(api, pmtilesUrl)
      }
      m.setStyle(buildPlanetStyle(pmtilesUrl, currentMapTheme()))
    }
    mq?.addEventListener('change', handler)

    // Knosys' ThemeProvider toggles `<html class="dark">` directly,
    // which doesn't fire the matchMedia event. Watch the html element
    // for class / data-theme mutations.
    const obs = new MutationObserver(handler)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    return () => {
      mq?.removeEventListener('change', handler)
      obs.disconnect()
    }
  }, [api, pmtilesUrl])

  return (
    <div
      ref={containerRef}
      className="kmaps-map-container"
      style={{ width: '100%', height: '100%' }}
    />
  )
}

/**
 * Route-line MapLibre layer.
 *
 * Renders the currently-previewed route as a two-layer line stack
 * (white casing + accent main) on the MapLibre canvas. Apple Maps
 * shape: thick blue main line with a softer white outline, line caps
 * + joins rounded, width scaled by zoom.
 *
 * The source is a single GeoJSONSource ID; both line layers share it
 * so a `setData` update redraws both at once. `setRouteLineData(map,
 * null)` clears the line without tearing down the layers — the
 * MapViewer keeps the layer mounted across route transitions and
 * just swaps the geometry.
 *
 * `addRouteLineLayer` is idempotent: if the source already exists
 * (e.g. caller racing against a `style.load` re-add) it bails. That
 * makes the function safe to call from both the initial load and
 * every subsequent setStyle invalidation.
 */

import type { Map as MaplibreMap, LngLatBoundsLike } from 'maplibre-gl'

export const ROUTE_LINE_SOURCE_ID = 'kmaps-route'
export const ROUTE_LINE_CASING_LAYER_ID = 'kmaps-route-casing'
export const ROUTE_LINE_MAIN_LAYER_ID = 'kmaps-route-main'

/** Minimal LineString shape — matches `RouteData.geometry` so the
 *  route store can be passed in directly without a wrapper. */
export interface RouteLineGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

// Source data MapLibre expects when the route is cleared. Using an
// empty LineString rather than removing the source keeps the layer
// mounted across route transitions — cheap rebinds vs. add/remove
// thrash, and avoids visual blink when transitioning between two
// routes back-to-back.
const EMPTY_GEOMETRY: RouteLineGeometry = {
  type: 'LineString',
  coordinates: [],
}

/** Add the route-line source + the casing + main layers. Idempotent
 *  — calling on a map that already has the source bails.
 *
 *  Both layers insert BEFORE the first symbol layer in the active
 *  style so road names, POI labels, and place names stay legible on
 *  top of the route ribbon. With the v3.0 empty style (no symbols
 *  yet — slice 6 brings real PMTiles styles), `firstSymbolId` is
 *  undefined and MapLibre falls back to "add on top," matching the
 *  prior behavior. */
export function addRouteLineLayer(map: MaplibreMap): void {
  if (map.getSource(ROUTE_LINE_SOURCE_ID)) return

  map.addSource(ROUTE_LINE_SOURCE_ID, {
    type: 'geojson',
    data: EMPTY_GEOMETRY as unknown as GeoJSON.Geometry,
  })

  // Find the first symbol layer in the current style — labels for
  // roads / POIs / places live in symbol layers. Inserting our
  // lines BEFORE this layer keeps labels rendering on top of the
  // ribbon. Undefined when the style has no symbol layers (e.g.
  // the v3.0 empty style); addLayer treats undefined as "add on
  // top," preserving the prior behavior.
  const firstSymbolId = map
    .getStyle()
    ?.layers?.find((l) => l.type === 'symbol')?.id

  // Casing — slightly wider, near-white, soft opacity. Sits behind
  // the main line so the route reads as a haloed ribbon rather than
  // a flat stripe. Width interpolated by zoom — narrower far out,
  // beefier when the user zooms in to inspect maneuvers.
  map.addLayer(
    {
      id: ROUTE_LINE_CASING_LAYER_ID,
      type: 'line',
      source: ROUTE_LINE_SOURCE_ID,
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.85,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          4,
          14,
          10,
          18,
          14,
        ],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    },
    firstSymbolId,
  )

  // Main — SF system blue (the kmaps accent). Hard-coded RGB rather
  // than `rgb(var(--kmaps-accent))` because MapLibre renders to a
  // WebGL canvas which doesn't resolve CSS variables. Matches the
  // light + dark accent (10 132 255 ≈ 0A84FF), within ~2 units of
  // either — close enough that the route reads as system-blue under
  // both themes.
  map.addLayer(
    {
      id: ROUTE_LINE_MAIN_LAYER_ID,
      type: 'line',
      source: ROUTE_LINE_SOURCE_ID,
      paint: {
        'line-color': '#0A84FF',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          2.5,
          14,
          6,
          18,
          9,
        ],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    },
    firstSymbolId,
  )
}

/** Update the route-line geometry. Pass `null` to clear (the layer
 *  stays mounted; only the source data is reset to an empty
 *  LineString). No-ops if the source hasn't been added yet — the
 *  caller's next `addRouteLineLayer` cycle will pick up the latest
 *  data via the geometry ref pattern in MapViewer. */
export function setRouteLineData(
  map: MaplibreMap,
  geometry: RouteLineGeometry | null,
): void {
  const src = map.getSource(ROUTE_LINE_SOURCE_ID)
  if (!src) return
  // MapLibre's GeoJSONSource has a `setData` method, but the union
  // type returned by `getSource` doesn't narrow on the source kind
  // we added. Cast through unknown rather than re-declaring the
  // type — the contract is "we added a geojson source under this
  // id" and the cast is local to this module.
  const geoSrc = src as unknown as { setData: (d: GeoJSON.Geometry) => void }
  geoSrc.setData(
    (geometry ?? EMPTY_GEOMETRY) as unknown as GeoJSON.Geometry,
  )
}

/** Tear down the route-line layers + source. Used on plugin
 *  shutdown / hot-reload; the MapViewer's normal cleanup path
 *  drops the map instance which removes layers implicitly, so
 *  this is mostly a defensive surface. */
export function removeRouteLineLayer(map: MaplibreMap): void {
  if (map.getLayer(ROUTE_LINE_MAIN_LAYER_ID)) {
    map.removeLayer(ROUTE_LINE_MAIN_LAYER_ID)
  }
  if (map.getLayer(ROUTE_LINE_CASING_LAYER_ID)) {
    map.removeLayer(ROUTE_LINE_CASING_LAYER_ID)
  }
  if (map.getSource(ROUTE_LINE_SOURCE_ID)) {
    map.removeSource(ROUTE_LINE_SOURCE_ID)
  }
}

/** Compute the lat/lon bounding box of a coord list. Returns null
 *  for empty input so callers can short-circuit a fit without
 *  branching on length themselves. */
export function computeRouteBounds(
  coords: readonly [number, number][],
): LngLatBoundsLike | null {
  if (coords.length === 0) return null
  let west = coords[0][0]
  let east = coords[0][0]
  let south = coords[0][1]
  let north = coords[0][1]
  for (let i = 1; i < coords.length; i++) {
    const [lon, lat] = coords[i]
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return [
    [west, south],
    [east, north],
  ]
}

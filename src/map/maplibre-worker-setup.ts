/**
 * MapLibre worker setup.
 *
 * Ported verbatim from `/tmp/flight-planner/src/map/maplibre-worker-setup.ts`.
 *
 * MapLibre normally spawns its rendering web worker from a separate JS
 * URL. Under the Knosys plugin sandbox the plugin's code runs through
 * `new Function()` with no module path resolution — there's no usable
 * worker URL to give MapLibre. Build a Blob URL from the inlined worker
 * source (Vite injects it via the `?raw` import) and hand that URL to
 * MapLibre instead. The host's CSP allows `worker-src 'self' blob:`.
 *
 * Idempotent: subsequent calls are no-ops because MapLibre stores the
 * URL globally and re-spawning the worker isn't necessary.
 */

import maplibregl from 'maplibre-gl'
import workerSource from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?raw'

let registered = false

export function ensureMaplibreWorker(): void {
  if (registered) return
  const blob = new Blob([workerSource], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  maplibregl.setWorkerUrl(url)
  registered = true
}

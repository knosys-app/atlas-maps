/**
 * knosys-maps v3 — entry point.
 *
 * `activate(api, shared)` is the standard Knosys plugin hook. The plugin
 * registers its primary route + sidebar item; the host's runtime
 * injects React, KDL primitives, and lucide icons via `Shared`.
 */

import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline'
import pluginCss from './styles.css?inline'
import type {
  PluginAPI,
  SharedDependencies,
  PluginRoute,
  PluginSidebarItem,
  PluginSettingsPanel,
} from './types'
import { PLUGIN_ID, PLUGIN_VERSION, MAPS_ROUTE_PATH, SIDEBAR_ORDER } from './constants'
import { createMapsPage } from './shell/maps-page'
import { createRegionManagerUi } from './regions/region-manager-ui'
import { STARTER_REGION_COUNT } from './data/regions'
import { installEngineIfMissing, stopActiveEngine, subscribeEngineDeaths } from './routing/engine'

let pluginApi: PluginAPI | null = null
let injectedStyleEl: HTMLStyleElement | null = null
let engineDeathsUnsub: (() => void) | null = null

/** Knosys host injects React + UI primitives via Shared; we stash the
 *  api so non-React modules (routing/, regions/) can call back into it. */
export function getPluginApi(): PluginAPI {
  if (!pluginApi) throw new Error('knosys-maps not activated yet')
  return pluginApi
}

/** Inject MapLibre's stylesheet + the plugin's own design tokens. We
 *  scope the plugin styles under `.kmaps-root` so they never leak into
 *  the host or other plugins. */
function injectStyles(): void {
  if (injectedStyleEl) return
  injectedStyleEl = document.createElement('style')
  injectedStyleEl.setAttribute('data-plugin', PLUGIN_ID)
  // Order matters: MapLibre's stylesheet first, then plugin tokens so
  // the .kmaps-root variables override any conflicting MapLibre defaults.
  injectedStyleEl.textContent = `${maplibreCss}\n${pluginCss}`
  document.head.appendChild(injectedStyleEl)
}

function removeStyles(): void {
  if (injectedStyleEl) {
    injectedStyleEl.remove()
    injectedStyleEl = null
  }
}

export async function activate(api: PluginAPI, shared: SharedDependencies): Promise<void> {
  pluginApi = api
  api.log.info(`knosys-maps v${PLUGIN_VERSION} activating — ${STARTER_REGION_COUNT} starter regions available`)
  injectStyles()

  // Build the page component lazily with the host-injected Shared deps
  // baked into its closure. Same factory pattern flight-planner uses —
  // freezes the host's shadcn primitives + lucide icons at activate
  // time so child components don't need to thread Shared via props.
  const MapsPage = createMapsPage(api, shared)
  const route: PluginRoute = {
    path: MAPS_ROUTE_PATH,
    component: MapsPage,
  }
  api.ui.registerRoute(route)

  const sidebar: PluginSidebarItem = {
    id: 'maps',
    title: 'Maps',
    icon: 'Map',
    route: MAPS_ROUTE_PATH,
    order: SIDEBAR_ORDER,
  }
  api.ui.registerSidebarItem(sidebar)

  // Register the Regions Settings panel. The host mounts this inside
  // its Settings modal so users can view installed regions + switch
  // active region without needing to visit /maps first. v3.0 is
  // read-only; slice 6b adds the install/delete flow.
  const RegionManagerUi = createRegionManagerUi(api, shared)
  const settingsPanel: PluginSettingsPanel = {
    id: 'maps-regions',
    component: RegionManagerUi,
    title: 'Maps Regions',
    order: 100,
  }
  api.ui.registerSettingsPanel(settingsPanel)

  // Subscribe to engine-death broadcasts so the routing wrapper drops
  // its cached handle and respawns on next route call.
  engineDeathsUnsub = subscribeEngineDeaths(api)

  // Best-effort pre-warm of the engine binary. Non-blocking — if it
  // fails (e.g. binaries-manifest 404), the next user-driven region
  // install will surface a clearer error in-flow.
  installEngineIfMissing(api).catch((err) => {
    api.log.warn('Engine pre-warm failed (non-fatal):', err)
  })
}

export async function deactivate(): Promise<void> {
  if (engineDeathsUnsub) {
    engineDeathsUnsub()
    engineDeathsUnsub = null
  }
  // Stop the active Valhalla engine before clearing the api reference.
  // The host's `closeAllRoutingHandlesForPlugin` also tears down handles
  // on plugin disable, but routing/engine.ts holds module-level state
  // (`activeEngine`) that would otherwise point at a dead handle on a
  // mid-session re-enable — until the next `listHandles` reconciles.
  // Calling `stopActiveEngine` keeps our local view consistent and
  // avoids the small window where a stale handle id would be passed to
  // a still-warm route call.
  if (pluginApi) {
    await stopActiveEngine(pluginApi).catch((err) => {
      pluginApi?.log.warn('stopActiveEngine on deactivate failed (non-fatal):', err)
    })
  }
  removeStyles()
  pluginApi = null
}

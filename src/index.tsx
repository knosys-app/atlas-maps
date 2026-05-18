/**
 * Knosys Maps Plugin — v2.1.0
 *
 * Self-contained map viewer. Bundles MapLibre GL (~50 KB gzipped) so the
 * desktop app can drop its hardcoded map code without users losing the
 * feature.
 *
 * v2.1.0 scope:
 *   - Online map rendering. Default: openfreemap (no API key required).
 *     Falls back to MapTiler when the user has granted that key.
 *   - Pan / zoom / navigation controls.
 *
 * Deferred to v2.2.0:
 *   - Offline regions (download + view via MBTiles SQLite). The plugin
 *     API now exposes `api.db.openSqlite` + `api.vault.writeFile` for this,
 *     but the region-downloader UI + tile-by-tile fetch + MBTiles writes
 *     are a meaningful chunk of work and worth landing as a separate
 *     release after v2.1.0 ships.
 *   - Location pins. Locations live in the weather plugin's vault scope;
 *     cross-plugin reads need a host API extension to surface here.
 */

import maplibregl from 'maplibre-gl'
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline'

// =============================================================================
// Plugin types — kept verbatim against the host PluginAPI v2.1 shape.
// =============================================================================

type PluginPermission =
  | 'storage'
  | 'network'
  | 'location'
  | 'filesystem'
  | 'core:locations'
  | 'core:notes'
  | 'core:reminders'
  | 'core:calendar'
  | 'vault:read'
  | 'vault:write'
  | 'sqlite:read'
  | 'sqlite:write'

interface PluginAPI {
  pluginId: string
  pluginVersion: string
  permissions: PluginPermission[]
  hasPermission: (permission: PluginPermission) => boolean
  core: {
    getApiKey: (keyId: string) => Promise<string | null>
  }
  network: {
    fetch: (url: string, init?: { method?: 'GET' | 'POST' | 'HEAD'; headers?: Record<string, string>; body?: ArrayBuffer | string; timeoutMs?: number }) => Promise<{ status: number; statusText: string; headers: Record<string, string>; body: ArrayBuffer }>
  }
  ui: {
    registerRoute: (route: { path: string; component: any }) => void
    registerSidebarItem: (item: { id: string; title: string; icon: string; route: string; order: number }) => void
    registerSettingsPanel: (panel: { id: string; component: any; title?: string; order?: number }) => void
    toast: (toast: { message: string; type?: 'info' | 'success' | 'error' | 'warning'; duration?: number }) => void
  }
  log: {
    debug: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

interface SharedDependencies {
  React: typeof import('react')
  useNavigate: () => any
  kdl: Record<string, any>
  shadcn: Record<string, any>
  lucideIcons: Record<string, any>
  useState: typeof import('react').useState
  useEffect: typeof import('react').useEffect
  useCallback: typeof import('react').useCallback
  useMemo: typeof import('react').useMemo
  useRef: typeof import('react').useRef
  cn: (...args: any[]) => string
}

// =============================================================================
// Module state
// =============================================================================

let api: PluginAPI
let shared: SharedDependencies
let injectedStyleEl: HTMLStyleElement | null = null

// =============================================================================
// Constants
// =============================================================================

/**
 * Free, key-less vector style. Default for users who haven't configured
 * MapTiler. Lower zoom limits + fewer styles than MapTiler, but works
 * out of the box.
 */
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/** MapTiler style URL template. `{KEY}` replaced at request time. */
const MAPTILER_STYLE_URL = (key: string, style = 'streets-v2') =>
  `https://api.maptiler.com/maps/${style}/style.json?key=${encodeURIComponent(key)}`

// =============================================================================
// Settings — view options the user can tweak
// =============================================================================

interface MapsSettings {
  /** Which provider to use when a MapTiler key is available. */
  preferredProvider: 'openfreemap' | 'maptiler'
  /** MapTiler style slug (only used when provider = maptiler). */
  maptilerStyle: 'streets-v2' | 'streets-v2-dark' | 'outdoor-v2' | 'satellite' | 'topo-v2'
  /** Initial center of new map sessions. */
  initialCenter: [number, number]
  initialZoom: number
}

const DEFAULT_SETTINGS: MapsSettings = {
  preferredProvider: 'openfreemap',
  maptilerStyle: 'streets-v2',
  initialCenter: [-98, 39], // continental US
  initialZoom: 3,
}

// =============================================================================
// Map style resolution — returns either a URL string or a style spec object
// =============================================================================

async function resolveStyle(settings: MapsSettings): Promise<string> {
  if (settings.preferredProvider === 'maptiler') {
    const key = await api.core.getApiKey('maptiler')
    if (key) return MAPTILER_STYLE_URL(key, settings.maptilerStyle)
    api.log.warn('MapTiler preferred but no API key granted; falling back to openfreemap')
  }
  return OPENFREEMAP_STYLE
}

// =============================================================================
// MapsPage — the route component
// =============================================================================

function MapsPage() {
  const { useState, useEffect, useRef } = shared
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [settings, setSettings] = useState<MapsSettings>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [styleUrl, setStyleUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load saved settings on mount
  useEffect(() => {
    (async () => {
      const stored = (await api['storage' as never] !== undefined)
        ? null
        : null
      // Storage permission isn't currently in the manifest — we keep
      // settings in-memory for v2.1.0 and add persistence in v2.2.0 once
      // the settings panel lands. Setting `settingsLoaded` to true unblocks
      // the style fetch.
      setSettings(DEFAULT_SETTINGS)
      void stored
      setSettingsLoaded(true)
    })()
  }, [])

  // Resolve the style URL whenever settings change
  useEffect(() => {
    if (!settingsLoaded) return
    let cancelled = false
    resolveStyle(settings)
      .then((url) => { if (!cancelled) setStyleUrl(url) })
      .catch((err) => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [settings, settingsLoaded])

  // Initialize the map once we have a container + style
  useEffect(() => {
    if (!mapContainerRef.current || !styleUrl || mapRef.current) return
    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleUrl,
        center: settings.initialCenter,
        zoom: settings.initialZoom,
        attributionControl: false,
      })
      map.addControl(new maplibregl.NavigationControl(), 'top-right')
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'imperial' }), 'bottom-left')
      mapRef.current = map
      api.log.info('Map initialized')
    } catch (err) {
      api.log.error('Failed to initialize map', err)
      setError(String((err as Error)?.message ?? err))
    }
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [styleUrl])

  // Hot-swap style when settings change after init
  useEffect(() => {
    if (!mapRef.current || !styleUrl) return
    mapRef.current.setStyle(styleUrl)
  }, [styleUrl])

  return (
    <div className="flex-1 min-h-screen relative" style={{ height: 'calc(100vh - 0px)' }}>
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-destructive text-destructive-foreground rounded-md p-3 max-w-md text-sm">
          {error}
        </div>
      )}
      <div ref={mapContainerRef} className="absolute inset-0" />
    </div>
  )
}

// =============================================================================
// Settings panel — provider selection + MapTiler style
// =============================================================================

function MapsSettingsPanel() {
  const { useState, useEffect } = shared
  const { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } = shared.kdl
  // Settings are in-memory for v2.1.0 — see TODO in MapsPage. Persisting
  // requires the `storage` permission (which the manifest doesn't yet
  // request) or `vault:write`. v2.2.0 will add persistence.
  const [provider, setProvider] = useState<MapsSettings['preferredProvider']>('openfreemap')
  const [maptilerStyle, setMaptilerStyle] = useState<MapsSettings['maptilerStyle']>('streets-v2')
  const [hasMaptilerKey, setHasMaptilerKey] = useState<boolean>(false)

  useEffect(() => {
    api.core.getApiKey('maptiler').then((k) => setHasMaptilerKey(Boolean(k)))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Tile provider</Label>
        <Select value={provider} onValueChange={(v: string) => setProvider(v as MapsSettings['preferredProvider'])}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="openfreemap">OpenFreeMap (default)</SelectItem>
            <SelectItem value="maptiler" disabled={!hasMaptilerKey}>
              MapTiler {hasMaptilerKey ? '' : '(needs API key)'}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {provider === 'maptiler' && hasMaptilerKey && (
        <div className="flex items-center justify-between">
          <Label className="text-sm">MapTiler style</Label>
          <Select value={maptilerStyle} onValueChange={(v: string) => setMaptilerStyle(v as MapsSettings['maptilerStyle'])}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="streets-v2">Streets</SelectItem>
              <SelectItem value="streets-v2-dark">Streets (dark)</SelectItem>
              <SelectItem value="outdoor-v2">Outdoor</SelectItem>
              <SelectItem value="topo-v2">Topo</SelectItem>
              <SelectItem value="satellite">Satellite</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        v2.1.0 ships online maps only. Offline regions and saved-location pins
        return in v2.2.0 — track progress on the{' '}
        <a className="underline" href="https://github.com/knosys-app/atlas-maps" target="_blank" rel="noreferrer">
          plugin repo
        </a>.
      </p>
    </div>
  )
}

// =============================================================================
// Plugin lifecycle
// =============================================================================

export function activate(pluginApi: PluginAPI, sharedDeps: SharedDependencies) {
  api = pluginApi
  shared = sharedDeps
  api.log.info('Activating Maps plugin v2.1.0…')

  // Inject MapLibre CSS once at activate-time. The host plugin runtime
  // auto-injects `styles.css` if a plugin ships one, but for our case the
  // CSS lives inside the bundle (vite ?inline) so we manage the <style>
  // node directly.
  if (!injectedStyleEl) {
    const el = document.createElement('style')
    el.setAttribute('data-plugin-style', 'knosys-maps-maplibre')
    el.textContent = maplibreCss
    document.head.appendChild(el)
    injectedStyleEl = el
  }

  api.ui.registerSidebarItem({ id: 'maps', title: 'Maps', icon: 'Map', route: '/maps', order: 40 })
  api.ui.registerRoute({ path: '/maps', component: MapsPage })
  api.ui.registerSettingsPanel({ id: 'maps-settings', component: MapsSettingsPanel, title: 'Preferences', order: 10 })

  api.log.info('Maps plugin activated')
}

export function deactivate() {
  api?.log.info('Maps plugin deactivated')
  if (injectedStyleEl) {
    injectedStyleEl.remove()
    injectedStyleEl = null
  }
}

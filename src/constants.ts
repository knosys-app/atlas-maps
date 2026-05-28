/** Single source of truth for paths, route IDs, and other constants. */

export const PLUGIN_ID = 'knosys-maps'
export const PLUGIN_VERSION = '3.0.0'

/** Renderer-facing route the plugin mounts under. */
export const MAPS_ROUTE_PATH = '/maps'

/** Sidebar ordering relative to first-party items (lower = earlier). */
export const SIDEBAR_ORDER = 70

/** Engine pinning. The host's binaries manifest resolves this range to
 *  the latest compatible patch. Bump when a Valhalla format change
 *  invalidates existing region tiles. */
export const REQUIRED_VALHALLA_VERSION = '^3.5.0'

/** Vault-relative paths the plugin owns. All under
 *  `vault/PluginData/knosys-maps/`. */
export const VAULT_PATHS = {
  /** Per-region root: tiles/, region.pmtiles, places.db, meta.json */
  region: (regionId: string) => `regions/${regionId}`,
  regionMeta: (regionId: string) => `regions/${regionId}/meta.json`,
  regionTiles: (regionId: string) => `regions/${regionId}/tiles`,
  regionPmtiles: (regionId: string) => `regions/${regionId}/region.pmtiles`,
  regionGeocoder: (regionId: string) => `regions/${regionId}/places.db`,
  regionPbf: (regionId: string) => `regions/${regionId}/source.osm.pbf`,
  /** Route + trip history. */
  history: 'routes/history.db',
  /** Cross-plugin destinations (consumed by other plugins via core:destinations). */
  destinations: 'destinations.json',
  /** Plugin settings. */
  settings: 'settings.json',
} as const

/** Settings keys (used with api.storage.* for ephemeral values). */
export const SETTINGS_KEYS = {
  activeRegionId: 'maps.active-region-id',
  defaultProfile: 'maps.default-profile',
  units: 'maps.units',
  voiceOn: 'maps.voice-on',
  gpsSource: 'maps.gps-source',
  /** Whether the user has dismissed the "Install your first region"
   *  card. Persists across sessions; users can still install regions
   *  via Settings → Plugins → Knosys Maps → Regions. */
  emptyStateDismissed: 'maps.empty-state-dismissed',
} as const

/** Default MapLibre camera when no per-region viewport is stored. The
 *  US-centered view is a reasonable default for the starter region set
 *  (51 US states + Canada / Europe / APAC); regions install their own
 *  fitBounds when the user activates them. */
export const DEFAULT_MAP_CENTER: [number, number] = [-98.5, 39.5]
export const DEFAULT_MAP_ZOOM = 3
export const DEFAULT_MAP_BEARING = 0
export const DEFAULT_MAP_PITCH = 0

/** Attribution shown in the bottom-right corner of the map. The
 *  Protomaps + OSM line is required by both projects' licenses; the
 *  Knosys credit is courtesy. */
export const MAP_ATTRIBUTION =
  '© <a href="https://protomaps.com">Protomaps</a> · ' +
  '© <a href="https://openstreetmap.org/copyright">OSM</a>'

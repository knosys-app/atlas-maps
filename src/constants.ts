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
} as const

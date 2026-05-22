/**
 * Local mirror of the Knosys host PluginAPI v3 surface — kept verbatim
 * against `apps/desktop/src/types/plugins.ts` so the plugin doesn't have
 * to share a types package with the host. When the host bumps the API,
 * mirror the diff here.
 *
 * The plugin receives a `PluginAPIv3` at activation (since manifest
 * declares `knosysApi: 3`); we type it as `PluginAPI` here and use the
 * `?.routing` / `?.gps` / `?.spotlight` optional accessors guarded by
 * permission checks done by the host runtime.
 */

import type { ComponentType } from 'react'

// ---- Permissions ----

export type PluginPermission =
  | 'storage'
  | 'network'
  | 'vault:read'
  | 'vault:write'
  | 'sqlite:read'
  | 'sqlite:write'
  | 'routing:engine'
  | 'gps:read'
  | 'gps:list-devices'
  | 'spotlight:provider'
  | 'core:destinations'
  // Other host permissions we don't use but the union includes
  | 'location'
  | 'filesystem'
  | 'core:locations'
  | 'core:notes'
  | 'core:reminders'
  | 'core:calendar'

// ---- Core ----

export interface Destination {
  id: string
  name: string
  coordinates: { lat: number; lon: number }
  category?: string
  notes?: string
  ownerPluginId: string
  createdAt: string
  updatedAt: string
}

export interface PluginCoreAPI {
  getApiKey(keyId: string): Promise<string | null>
  getVaultPath(): Promise<string>
  getDestinations?(): Promise<Destination[]>
  onDestinationsChanged?(cb: (destinations: Destination[]) => void): () => void
}

// ---- Storage ----

export interface PluginStorageAPI {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

// ---- Network ----

export interface PluginNetworkFetchInit {
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  body?: ArrayBuffer | string
  timeoutMs?: number
}

export interface PluginNetworkFetchResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: ArrayBuffer
}

export interface PluginNetworkAPI {
  fetch(url: string, init?: PluginNetworkFetchInit): Promise<PluginNetworkFetchResponse>
}

// ---- Vault ----

export interface PluginVaultAPI {
  readFile(relPath: string): Promise<string>
  readFileBytes(relPath: string): Promise<ArrayBuffer>
  writeFile(relPath: string, contents: string | ArrayBuffer): Promise<void>
  deleteFile(relPath: string): Promise<void>
  listFiles(relPath?: string): Promise<Array<{ name: string; isDirectory: boolean; size: number }>>
  exists(relPath: string): Promise<boolean>
}

// ---- DB ----

export interface PluginDbHandle {
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>
  close(): Promise<void>
}

export interface PluginDbAPI {
  openSqlite(
    relPath: string,
    opts?: { readonly?: boolean; createIfMissing?: boolean },
  ): Promise<PluginDbHandle>
}

// ---- UI ----

export interface PluginRoute {
  path: string
  component: ComponentType<unknown>
}

export interface PluginSidebarItem {
  id: string
  title: string
  icon: string
  route: string
  order: number
}

export interface PluginWidget {
  id: string
  title: string
  component: ComponentType<unknown>
  defaultSize: 'small' | 'medium' | 'large'
}

export interface PluginSettingsPanel {
  id: string
  component: ComponentType<unknown>
  title?: string
  order?: number
}

export interface PluginToast {
  message: string
  type?: 'info' | 'success' | 'error' | 'warning'
  duration?: number
}

export interface PluginUIAPI {
  registerRoute(route: PluginRoute): void
  registerSidebarItem(item: PluginSidebarItem): void
  registerWidget(widget: PluginWidget): void
  registerSettingsPanel(panel: PluginSettingsPanel): void
  toast(toast: PluginToast): void
}

// ---- Routing (v3) ----

export interface RoutingEngineHandle {
  id: string
  version: string
  diagnosticPort?: number
}

export interface InstallEngineOptions {
  source: 'valhalla'
  version: string
}

export interface InstallEngineResult {
  binPath: string
  version: string
}

export interface StartEngineOptions {
  tileDir: string
  env?: Record<string, string>
  memoryLimitMb?: number
}

export interface RoutingProgressEvent {
  phase: string
  percent?: number
  message?: string
  bytesProcessed?: number
  bytesTotal?: number
}

export interface BuildTilesOptions {
  pbfPath: string
  outDir: string
  profile: 'auto' | 'bicycle' | 'pedestrian' | 'multimodal'
  onProgress?: (event: RoutingProgressEvent) => void
}

export interface BuildGeocoderOptions {
  pbfPath: string
  outputPath: string
  openAddressesPath?: string
  onProgress?: (event: RoutingProgressEvent) => void
}

export interface ValhallaRouteRequest {
  locations: Array<{
    lat: number
    lon: number
    type?: 'break' | 'through' | 'via' | 'break_through'
    heading?: number
    heading_tolerance?: number
  }>
  costing: 'auto' | 'bicycle' | 'pedestrian' | 'multimodal' | 'truck'
  costing_options?: Record<string, unknown>
  directions_options?: { units?: 'kilometers' | 'miles'; language?: string }
}

export interface ValhallaRouteResponse {
  trip: {
    legs: Array<{
      shape: string
      maneuvers: Array<{
        instruction: string
        length: number
        time: number
        begin_shape_index: number
        end_shape_index: number
        type?: number
        street_names?: string[]
      }>
      summary: { length: number; time: number }
    }>
    status: number
    units: string
  }
}

export interface PluginRoutingAPI {
  installEngine(opts: InstallEngineOptions): Promise<InstallEngineResult>
  startEngine(opts: StartEngineOptions): Promise<RoutingEngineHandle>
  route(handleId: string, req: ValhallaRouteRequest): Promise<ValhallaRouteResponse>
  stopEngine(handleId: string): Promise<void>
  buildTiles(opts: BuildTilesOptions): Promise<void>
  buildGeocoder(opts: BuildGeocoderOptions): Promise<void>
  listHandles(): Promise<RoutingEngineHandle[]>
  onEngineDied(listener: (event: { handleId: string; exitCode: number | null; stderrTail?: string }) => void): () => void
}

// ---- GPS (v3) ----

export type GpsSource = 'browser' | 'serial' | 'mock' | 'auto'

export interface GpsFix {
  lat: number
  lon: number
  headingDeg?: number
  speedMps?: number
  hdop?: number
  altitudeM?: number
  satellites?: number
  fixedAt: number
  source: Exclude<GpsSource, 'auto'>
}

export interface GpsDevice {
  deviceId: string
  label: string
  vendorId?: string
  productId?: string
  isAllowed: boolean
}

export interface GpsSubscribeOptions {
  source: GpsSource
  deviceId?: string
  fixturePath?: string
  rate?: number
}

export interface PluginGpsAPI {
  subscribe(opts: GpsSubscribeOptions, listener: (fix: GpsFix) => void): () => void
  listDevices(): Promise<GpsDevice[]>
}

// ---- Spotlight (v3) ----

export interface SpotlightProviderResult {
  id: string
  title: string
  subtitle?: string
  icon?: string
  action:
    | { kind: 'navigate'; route: string }
    | { kind: 'callback'; handlerId: string }
}

export interface SpotlightProvider {
  id: string
  label: string
  defaultIcon?: string
  search(query: string, opts: { signal: AbortSignal }): Promise<SpotlightProviderResult[]>
  onSelect?(handlerId: string): void | Promise<void>
}

export interface PluginSpotlightAPI {
  registerProvider(provider: SpotlightProvider): () => void
}

// ---- Theme + lifecycle + logging ----

export interface PluginThemeAPI {
  readonly mode: 'light' | 'dark'
  readonly accent: string
  subscribe(listener: (state: { mode: 'light' | 'dark'; accent: string }) => void): () => void
}

export interface PluginLoggerAPI {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export type PluginLifecycleEvent = 'enabled' | 'disabled' | 'theme:changed' | 'accent:changed' | 'vault:changed'

// ---- Aggregate API ----

export interface PluginAPI {
  pluginId: string
  pluginVersion: string
  permissions: PluginPermission[]
  hasPermission(permission: PluginPermission): boolean
  storage: PluginStorageAPI
  core: PluginCoreAPI
  network: PluginNetworkAPI
  ui: PluginUIAPI
  vault: PluginVaultAPI
  db: PluginDbAPI
  theme: PluginThemeAPI
  log: PluginLoggerAPI
  on(event: PluginLifecycleEvent, listener: () => void): () => void
  // v3 — present when permission is declared
  routing?: PluginRoutingAPI
  gps?: PluginGpsAPI
  spotlight?: PluginSpotlightAPI
}

// ---- Shared dependencies ----

export interface SharedDependencies {
  React: typeof import('react')
  useNavigate: () => (opts: { to: string; search?: Record<string, unknown> }) => void
  hooks: {
    useAppData: () => unknown
  }
  kdl: Record<string, ComponentType<unknown>> & {
    cn: (...args: unknown[]) => string
  }
  shadcn: Record<string, ComponentType<unknown>>
  lucideIcons: Record<string, ComponentType<{ className?: string }>>
  useState: typeof import('react').useState
  useEffect: typeof import('react').useEffect
  useCallback: typeof import('react').useCallback
  useMemo: typeof import('react').useMemo
  useRef: typeof import('react').useRef
  cn: (...args: unknown[]) => string
  dateFns: Record<string, (...args: unknown[]) => unknown>
}

export interface PluginModule {
  activate: (api: PluginAPI, shared: SharedDependencies) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}

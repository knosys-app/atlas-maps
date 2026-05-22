/**
 * Routing engine lifecycle.
 *
 * Wraps `api.routing.installEngine` + `startEngine` + `stopEngine` so
 * the rest of the plugin sees a simple `ensureRunning(regionId)`
 * surface. Stores the active handle in a module-level singleton — Phase
 * 2 expects one running engine per plugin (the host caps at 3 anyway).
 */

import type { PluginAPI } from '@/types'
import { REQUIRED_VALHALLA_VERSION, VAULT_PATHS } from '@/constants'

interface EngineState {
  handleId: string
  regionId: string
  version: string
}

let activeEngine: EngineState | null = null

/** Pre-flight: download Valhalla binaries if not already cached. Idempotent. */
export async function installEngineIfMissing(
  api: PluginAPI,
  onProgress?: (phase: string, percent?: number, message?: string) => void,
): Promise<void> {
  if (!api.routing) throw new Error('Plugin lacks routing:engine permission')
  await api.routing.installEngine({
    source: 'valhalla',
    version: REQUIRED_VALHALLA_VERSION,
  })
  onProgress?.('engine-ready', 100, 'Valhalla installed')
}

/**
 * Ensure a routing engine is running against the given region's tiles.
 * Stops any existing engine bound to a different region first.
 */
export async function ensureEngineRunning(
  api: PluginAPI,
  regionId: string,
): Promise<string> {
  if (!api.routing) throw new Error('Plugin lacks routing:engine permission')
  if (activeEngine && activeEngine.regionId === regionId) {
    // Verify the host still knows about this handle — it may have crashed
    // and been removed from the registry behind our back.
    const handles = await api.routing.listHandles()
    if (handles.some((h) => h.id === activeEngine!.handleId)) {
      return activeEngine.handleId
    }
    activeEngine = null
  }
  if (activeEngine) {
    await api.routing.stopEngine(activeEngine.handleId).catch(() => {})
    activeEngine = null
  }
  const handle = await api.routing.startEngine({
    tileDir: `${VAULT_PATHS.region(regionId)}/tiles`,
  })
  activeEngine = {
    handleId: handle.id,
    regionId,
    version: handle.version,
  }
  return handle.id
}

export function getActiveHandleId(): string | null {
  return activeEngine?.handleId ?? null
}

export async function stopActiveEngine(api: PluginAPI): Promise<void> {
  if (!activeEngine || !api.routing) return
  await api.routing.stopEngine(activeEngine.handleId).catch(() => {})
  activeEngine = null
}

/** Subscribe to engine-death broadcasts — clears local state so the
 *  next route call respawns rather than reusing a dead handle. */
export function subscribeEngineDeaths(api: PluginAPI): () => void {
  if (!api.routing) return () => {}
  return api.routing.onEngineDied((event) => {
    if (activeEngine?.handleId === event.handleId) {
      activeEngine = null
    }
  })
}

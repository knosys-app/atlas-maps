/**
 * Per-region viewport persistence.
 *
 * MapLibre's camera (center + zoom + bearing + pitch) is saved
 * per-region so switching back to a region restores the user's last
 * view. Persisted via `api.storage.*` under namespaced keys.
 *
 * Not a Zustand store — the viewport is read at mount time + written
 * on map idle, not subscribed to by other components. A plain
 * load/save module keeps the surface small.
 */

import type { PluginAPI } from '@/types'

export interface ViewportSnapshot {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

function storageKey(regionId: string | null): string {
  return regionId ? `viewport:${regionId}` : 'viewport:global'
}

export async function loadViewport(
  api: PluginAPI,
  regionId: string | null,
): Promise<ViewportSnapshot | null> {
  try {
    return await api.storage.get<ViewportSnapshot>(storageKey(regionId))
  } catch (err) {
    api.log.warn('viewport: load failed', err)
    return null
  }
}

export async function saveViewport(
  api: PluginAPI,
  regionId: string | null,
  snapshot: ViewportSnapshot,
): Promise<void> {
  try {
    await api.storage.set(storageKey(regionId), snapshot)
  } catch (err) {
    api.log.warn('viewport: save failed', err)
  }
}

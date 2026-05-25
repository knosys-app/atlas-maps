/**
 * Settings store — Zustand.
 *
 * Holds the user-facing settings that drive the chrome (profile picker,
 * map style, units). Persisted via `api.storage.*` so settings survive
 * across plugin restarts.
 *
 * The store is intentionally small in this slice — only what the Layers
 * menu needs. Future slices add region defaults, voice preferences, GPS
 * source selection, etc.
 */

import { create } from 'zustand'
import type { PluginAPI } from '@/types'

export type RoutingProfile = 'auto' | 'bicycle' | 'pedestrian'
export type MapStyle = 'light' | 'dark' | 'auto'
export type DistanceUnits = 'kilometers' | 'miles'

export interface MapsSettings {
  profile: RoutingProfile
  mapStyle: MapStyle
  units: DistanceUnits
}

export const DEFAULT_SETTINGS: MapsSettings = {
  profile: 'auto',
  mapStyle: 'auto',
  units: 'miles',
}

const STORAGE_KEY = 'settings:v1'

interface SettingsStore extends MapsSettings {
  /** True once the persisted settings have been loaded from `api.storage`.
   *  Components can use this to avoid flashing default values during
   *  hydration. */
  hydrated: boolean
  hydrate(api: PluginAPI): Promise<void>
  update(api: PluginAPI, patch: Partial<MapsSettings>): Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  async hydrate(api: PluginAPI) {
    if (get().hydrated) return
    try {
      const stored = await api.storage.get<MapsSettings>(STORAGE_KEY)
      if (stored) {
        // Merge in defaults to tolerate forward-compatible storage schemas
        // — if we add a new setting field, missing values fall back rather
        // than rejecting the whole blob.
        set({ ...DEFAULT_SETTINGS, ...stored, hydrated: true })
      } else {
        set({ hydrated: true })
      }
    } catch (err) {
      api.log.warn('settings: hydrate failed', err)
      set({ hydrated: true })
    }
  },

  async update(api: PluginAPI, patch: Partial<MapsSettings>) {
    // Optimistic update: apply the patch immediately so the chrome
    // responds without waiting for the IPC. On persist failure we roll
    // back to the prior snapshot so the in-session state can't diverge
    // from what reloads next session — otherwise the user would see
    // their choice silently revert on restart.
    const prev: MapsSettings = {
      profile: get().profile,
      mapStyle: get().mapStyle,
      units: get().units,
    }
    const next: MapsSettings = { ...prev, ...patch }
    set(next)
    try {
      await api.storage.set(STORAGE_KEY, next)
    } catch (err) {
      api.log.warn('settings: persist failed, rolling back', err)
      set(prev)
    }
  },
}))

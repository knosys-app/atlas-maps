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
    // Snapshot the value of each persisted field BEFORE the async read
    // so we can detect updates that arrived in-flight. A user who opens
    // the Layers popover and toggles a setting before `api.storage.get`
    // resolves would otherwise see their choice silently revert when
    // hydrate's terminal `set` overwrites with the (now stale) read.
    // The user's `update` already persisted the change to storage, so
    // their value is the authoritative one even though our `get` was
    // dispatched too early to see it.
    const before: MapsSettings = {
      profile: get().profile,
      mapStyle: get().mapStyle,
      units: get().units,
    }
    try {
      const stored = await api.storage.get<MapsSettings>(STORAGE_KEY)
      // Functional `set` so we read the CURRENT state (which may have
      // drifted from `before` due to an in-flight `update`). Build the
      // hydrated value from defaults + stored, then restore any field
      // that drifted — those are the writes we'd otherwise clobber.
      set((current) => {
        // Defaults underlie everything (tolerates forward-compatible
        // schemas: missing fields in `stored` fall back rather than
        // rejecting the whole blob). Then per-field rebase: any field
        // that changed between the pre-await snapshot and now wins
        // over the stored read, because `update` already persisted it.
        const base: MapsSettings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
        return {
          profile: current.profile !== before.profile ? current.profile : base.profile,
          mapStyle: current.mapStyle !== before.mapStyle ? current.mapStyle : base.mapStyle,
          units: current.units !== before.units ? current.units : base.units,
          hydrated: true,
        }
      })
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

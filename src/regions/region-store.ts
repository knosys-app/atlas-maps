/**
 * Region store — Zustand.
 *
 * Tracks installed regions + the currently-active one. v3.0 is read-
 * only (hydrate scans the vault, no install/delete actions yet —
 * those land with slice 6b's download-orchestrator). The active id is
 * exposed so `MapsPage` can drive its `hasActiveRegion` gate from
 * real state instead of the hardcoded `useState<string | null>(null)`.
 *
 * Active id is persisted via `api.storage` (namespaced plugin
 * key-value) rather than the vault because it's a primitive opt
 * setting, not a file other plugins consume. Vault writes would also
 * trigger destinations-proxy `fs.watch` traffic for no benefit.
 *
 * Hydrate guards against double-fire via the `hydrated` flag (same
 * pattern as `settings-store`). The validate-active step drops a
 * stale `activeRegionId` that points at a region deleted while the
 * plugin was disabled — the in-memory active stays null in that case,
 * not pointing at a non-existent region.
 */

import { create } from 'zustand'
import type { PluginAPI } from '@/types'
import { SETTINGS_KEYS } from '@/constants'
import { listInstalledRegions, type RegionMeta } from './meta'

/**
 * In-flight hydrate promise. Concurrent callers (MapsPage + the
 * Settings panel mounting in the same React commit, or StrictMode
 * double-invoking effects) need to share a single vault+storage
 * read — without this, both pass the `if (get().hydrated) return`
 * guard before either reaches `set({ hydrated: true })`, and the
 * losing `set()` clobbers the winner's freshest installed list.
 *
 * Module-scoped because the store is a singleton; the promise
 * outlives any single component's lifecycle. Cleared in the
 * promise's `finally` so a subsequent hydrate (after a manual
 * vault refresh, slice 6b) can re-run.
 */
let inFlightHydrate: Promise<void> | null = null

interface RegionStore {
  /** Installed regions discovered by scanning the vault. Sorted by
   *  regionId for deterministic UI ordering — the Settings panel's
   *  default order matches the manifest sort. */
  installed: RegionMeta[]
  /** Currently-active region id. Null = no region active (rail +
   *  sheet hidden in `MapsPage`). Validated on hydrate against
   *  `installed` — stale ids from prior sessions get cleared. */
  activeRegionId: string | null
  /** True after the first hydrate settles. Drives the "no regions
   *  yet" empty state vs. the loading skeleton in the Settings
   *  panel. */
  hydrated: boolean
  hydrate(api: PluginAPI): Promise<void>
  setActive(api: PluginAPI, regionId: string | null): Promise<void>
}

export const useRegionStore = create<RegionStore>((set, get) => ({
  installed: [],
  activeRegionId: null,
  hydrated: false,

  async hydrate(api: PluginAPI) {
    // Fast-path: already settled.
    if (get().hydrated) return
    // Concurrent-path: a hydrate is already in flight — wait for
    // its result rather than starting a parallel read that would
    // double-count vault traffic and race the `set` on resolution.
    if (inFlightHydrate) return inFlightHydrate

    inFlightHydrate = (async () => {
      try {
        // Two reads in parallel — they don't depend on each other and
        // both are cheap.
        const [installed, savedActive] = await Promise.all([
          listInstalledRegions(api),
          api.storage.get<string>(SETTINGS_KEYS.activeRegionId),
        ])

        // Validate the persisted active id. If it points at a region
        // that no longer exists (deleted while disabled, or vault
        // path changed), drop it rather than letting the rail render
        // against a phantom id. Clear the storage value too so we
        // don't repeat the validation on every activate.
        const activeStillExists =
          savedActive !== null && installed.some((r) => r.regionId === savedActive)
        const activeRegionId = activeStillExists ? savedActive : null

        if (savedActive !== null && !activeStillExists) {
          api.log.info(
            `regions: clearing stale activeRegionId "${savedActive}" (not in installed list)`,
          )
          await api.storage.delete(SETTINGS_KEYS.activeRegionId).catch(() => {
            // Non-fatal — the in-memory state is right; worst case the
            // stale key sits in storage and re-runs the validation
            // next activate.
          })
        }

        set({
          installed,
          activeRegionId,
          hydrated: true,
        })
      } catch (err) {
        // Hard failures (vault unavailable, JSON corrupt) drop us to
        // an empty installed list. The Settings panel renders its
        // empty state and the user can still browse the chrome.
        api.log.warn('regions: hydrate failed', err)
        set({ installed: [], activeRegionId: null, hydrated: true })
      } finally {
        // Clear the in-flight slot so a subsequent hydrate (e.g.
        // post-install refresh in slice 6b) can run fresh. The
        // `hydrated` flag still gates the fast path for the common
        // already-settled case.
        inFlightHydrate = null
      }
    })()

    return inFlightHydrate
  },

  async setActive(api: PluginAPI, regionId: string | null) {
    // Validate against the installed list. setActive('non-existent')
    // would otherwise put the store in a bad state where the rail
    // mounts against a region with no places.db / no PMTiles.
    if (regionId !== null) {
      const exists = get().installed.some((r) => r.regionId === regionId)
      if (!exists) {
        api.log.warn(`regions: setActive(${regionId}) rejected — not installed`)
        return
      }
    }

    // Optimistic write — update in-memory first so the rail flips
    // open immediately, then persist. On persist failure we keep
    // the in-memory change (it's a primitive opt; consistent UI
    // beats consistent storage), log the warning. Next activate's
    // hydrate will resync from the saved value if needed.
    set({ activeRegionId: regionId })
    try {
      if (regionId === null) {
        await api.storage.delete(SETTINGS_KEYS.activeRegionId)
      } else {
        await api.storage.set(SETTINGS_KEYS.activeRegionId, regionId)
      }
    } catch (err) {
      api.log.warn('regions: setActive persist failed', err)
    }
  },
}))

/**
 * Saved destinations store — Zustand.
 *
 * Holds the user's pinned destinations and is the SINGLE WRITER of
 * `vault/PluginData/knosys-maps/destinations.json`. That file is the
 * artefact other plugins read via `api.core.getDestinations()` (the
 * `core:destinations` permission gate), so the JSON shape MUST stay
 * stable — the host's destinations proxy validates each entry against
 * the `Destination` type defined in `@/types`.
 *
 * Persistence is via `api.vault.writeFile` rather than `api.storage`
 * because the file needs to be readable from other plugins through
 * the destinations proxy. `api.storage` is namespaced + opaque;
 * `api.vault` exposes the file at a known path so the proxy can
 * `fs.watch` it for change broadcasts.
 *
 * Optimistic update + rollback pattern matches `settings-store.ts`:
 * mutate in-memory immediately, persist asynchronously, revert to
 * the prior snapshot on persist failure so the in-session state
 * can't diverge from what reloads next session.
 */

import { create } from 'zustand'
import type { Destination, PluginAPI } from '@/types'
import { PLUGIN_ID, VAULT_PATHS } from '@/constants'

/**
 * Monotonic counter bumped at the start of every mutation (add /
 * remove / reorder). `hydrate` snapshots it before its async vault
 * read and compares after — any change means a mutation interleaved
 * with the read and the in-memory state is authoritative (the mutator
 * already persisted to vault before this read resolved, OR is about
 * to). The previous length-based check missed the "remove emptied
 * the list" case because an empty in-memory list is indistinguishable
 * from the pre-hydrate initial state.
 *
 * Module-scoped, not store state — Zustand's snapshot semantics
 * would freeze the value at render time, but the gen counter needs
 * to reflect the latest mutation regardless of which render observed
 * it. Module scope is fine because the store itself is a singleton.
 */
let mutationGen = 0

interface SavedStore {
  destinations: Destination[]
  /** True after the first vault read settles — drives skeleton vs.
   *  rendered list in consumers. */
  hydrated: boolean
  hydrate(api: PluginAPI): Promise<void>
  /** Append a new destination. `id` + `ownerPluginId` + timestamps
   *  fill in automatically; the caller supplies the bits they know. */
  add(
    api: PluginAPI,
    seed: {
      name: string
      coordinates: { lat: number; lon: number }
      category?: string
      notes?: string
    },
  ): Promise<Destination>
  remove(api: PluginAPI, id: string): Promise<void>
  /** Move a destination from `fromIndex` to `toIndex`. Used by the
   *  Saved card's @dnd-kit drag-reorder handler. */
  reorder(api: PluginAPI, fromIndex: number, toIndex: number): Promise<void>
}

export const useSavedStore = create<SavedStore>((set, get) => ({
  destinations: [],
  hydrated: false,

  async hydrate(api: PluginAPI) {
    if (get().hydrated) return
    // Snapshot the mutation generation BEFORE the async read so any
    // add / remove / reorder that runs while we're awaiting will be
    // detectable on the other side. A length-based check (the
    // previous approach) missed the case where `remove` cleared the
    // last destination during a read — the empty in-memory list was
    // indistinguishable from the pre-hydrate initial state, so the
    // stale vault contents un-deleted the row.
    const startGen = mutationGen
    try {
      const exists = await api.vault.exists(VAULT_PATHS.destinations)
      if (!exists) {
        set({ hydrated: true })
        return
      }
      const text = await api.vault.readFile(VAULT_PATHS.destinations)
      const parsed: unknown = JSON.parse(text)
      const destinations = parseDestinations(parsed)
      // Functional set so the gen check is atomic with respect to
      // any mutation that races the read resolve.
      set((current) => {
        if (mutationGen !== startGen) {
          // A mutation ran during the await — its optimistic set is
          // already in `current` AND it persisted (or is persisting)
          // its own value to vault. Either way the in-memory state
          // is authoritative; the stored snapshot we just read is
          // stale relative to the mutator.
          return { ...current, hydrated: true }
        }
        return { destinations, hydrated: true }
      })
    } catch (err) {
      api.log.warn('saved: hydrate failed', err)
      set({ hydrated: true })
    }
  },

  async add(api, seed) {
    const now = new Date().toISOString()
    const dest: Destination = {
      id: cryptoRandomId(),
      name: seed.name,
      coordinates: seed.coordinates,
      category: seed.category,
      notes: seed.notes,
      ownerPluginId: PLUGIN_ID,
      createdAt: now,
      updatedAt: now,
    }
    const prev = get().destinations
    mutationGen++
    set({ destinations: [...prev, dest] })
    try {
      await persist(api, get().destinations)
    } catch (err) {
      api.log.warn('saved: add persist failed, rolling back', err)
      set({ destinations: prev })
      // Re-throw after rollback so callers don't act on a ghost
      // entry. If slice 3d's Save CTA navigated to Briefing using
      // the returned `dest`, the user would land on an entry that
      // doesn't exist in either the in-memory store or the vault.
      throw err
    }
    return dest
  },

  async remove(api, id) {
    const prev = get().destinations
    const next = prev.filter((d) => d.id !== id)
    if (next.length === prev.length) return // no-op; id not found
    mutationGen++
    set({ destinations: next })
    try {
      await persist(api, next)
    } catch (err) {
      api.log.warn('saved: remove persist failed, rolling back', err)
      set({ destinations: prev })
    }
  },

  async reorder(api, fromIndex, toIndex) {
    const prev = get().destinations
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || fromIndex >= prev.length) return
    if (toIndex < 0 || toIndex >= prev.length) return
    const next = [...prev]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    mutationGen++
    set({ destinations: next })
    try {
      await persist(api, next)
    } catch (err) {
      api.log.warn('saved: reorder persist failed, rolling back', err)
      set({ destinations: prev })
    }
  },
}))

async function persist(api: PluginAPI, destinations: Destination[]): Promise<void> {
  const text = JSON.stringify(destinations, null, 2)
  await api.vault.writeFile(VAULT_PATHS.destinations, text)
}

/**
 * Tolerant parse of the destinations.json blob. Filters out rows
 * whose shape doesn't match the `Destination` contract — the host's
 * destinations proxy does the same validation, so anything that
 * survives here will also survive the cross-plugin read.
 *
 * Exported for unit tests.
 */
export function parseDestinations(parsed: unknown): Destination[] {
  if (!Array.isArray(parsed)) return []
  const out: Destination[] = []
  for (const raw of parsed) {
    const d = parseDestination(raw)
    if (d) out.push(d)
  }
  return out
}

function parseDestination(raw: unknown): Destination | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0) return null
  if (typeof r.name !== 'string' || r.name.length === 0) return null
  const coords = r.coordinates as Record<string, unknown> | null | undefined
  if (!coords || typeof coords !== 'object') return null
  if (typeof coords.lat !== 'number' || typeof coords.lon !== 'number') return null
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null
  if (typeof r.ownerPluginId !== 'string') return null
  if (typeof r.createdAt !== 'string') return null
  if (typeof r.updatedAt !== 'string') return null
  return {
    id: r.id,
    name: r.name,
    coordinates: { lat: coords.lat, lon: coords.lon },
    category: typeof r.category === 'string' ? r.category : undefined,
    notes: typeof r.notes === 'string' ? r.notes : undefined,
    ownerPluginId: r.ownerPluginId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function cryptoRandomId(): string {
  // Prefer crypto.randomUUID when available (modern browsers, electron).
  // Fall back to a Math.random hex string for test environments that
  // don't expose the global crypto object.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

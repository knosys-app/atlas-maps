/**
 * useGeocoder — Search card hook.
 *
 * Manages opening / closing the per-region `places.db` and runs the
 * 3-tier search orchestrator against it whenever the user types.
 *
 *   - The DB handle is opened once per regionId via
 *     `api.db.openSqlite`. When `regionId` changes (region switched
 *     or uninstalled), the previous handle is closed and a fresh
 *     one opens against the new region.
 *   - The query is debounced (250 ms) so each keystroke doesn't fire
 *     an IPC + FTS5 round-trip. Matches the flight-planner pattern.
 *   - Each issued search carries an abort token; if a newer query
 *     starts while an older one is in-flight, the older result is
 *     dropped on arrival. Prevents race conditions where slow
 *     responses overwrite faster newer ones.
 *
 * Failure shape:
 *   - DB open errors: return empty results + `error` populated.
 *   - Search errors: ditto.
 *   - Network failures inside Nominatim: swallowed by `nominatimSearch`
 *     itself; surfaces as fewer results, not as a hook-level error.
 */

import { useEffect, useRef, useState } from 'react'
import type { PluginAPI } from '@/types'
import { search } from '@/geocoder/search'
import type { PlaceResult } from '@/geocoder/types'
import { openPlacesDb, type PlacesDb } from '@/geocoder/places-db'
import { nominatimSearch } from '@/geocoder/nominatim'

const SEARCH_DEBOUNCE_MS = 250
const MIN_QUERY_LENGTH = 2

export interface UseGeocoderState {
  results: PlaceResult[]
  loading: boolean
  error: string | null
}

export interface UseGeocoderOptions {
  api: PluginAPI
  /** Active region id. Drives which `places.db` is open. Null → no
   *  region, so the hook short-circuits and returns empty. */
  regionId: string | null
  query: string
  /** Optional anchor for distance ranking. The geocoder's importance-
   *  first ordering uses haversine distance as a tiebreak. */
  near?: { lat: number; lon: number }
}

export function useGeocoder(opts: UseGeocoderOptions): UseGeocoderState {
  const { api, regionId, query, near } = opts
  const [state, setState] = useState<UseGeocoderState>({
    results: [],
    loading: false,
    error: null,
  })

  const dbRef = useRef<PlacesDb | null>(null)
  const dbRegionRef = useRef<string | null>(null)
  // Monotonic id for the latest issued search; a stale response
  // checks this before committing its results so newer responses
  // always win.
  const requestIdRef = useRef(0)
  // Bumps every time `openPlacesDb` resolves successfully. The
  // search effect depends on it so a query that lands during an
  // in-flight DB open (set itself to loading + bailed) re-runs
  // once the DB is ready — without this, `dbRef.current = next`
  // would be a silent ref mutation and the search effect would
  // never wake up, leaving the row stuck in `loading: true`.
  const [dbVersion, setDbVersion] = useState(0)

  // Open / close the DB on region change. Closing the previous DB
  // matters because each handle holds an open SQLite connection in
  // the main process; leaking them would keep file handles open
  // until plugin deactivate.
  useEffect(() => {
    let cancelled = false

    if (regionId === null) {
      // Region went away — close any open DB and reset state.
      const prev = dbRef.current
      dbRef.current = null
      dbRegionRef.current = null
      void prev?.close()
      setState({ results: [], loading: false, error: null })
      return
    }

    if (dbRegionRef.current === regionId) return // already open

    // Null the DB ref SYNCHRONOUSLY so any in-flight search timer
    // that fires during the async `openPlacesDb` below sees a missing
    // DB and short-circuits — rather than searching against the
    // previous region's still-pointed handle. Also clear the result
    // list so the user doesn't briefly see entries from the previous
    // region while the new DB opens.
    //
    // Bump `requestIdRef` too: invalidates any `search()` that's
    // already past the timer + into its `await` — by the time it
    // resolves with results from the OLD region's db, its captured
    // `myId` no longer matches `requestIdRef.current` and the
    // staleness guard inside the search effect drops it. Without
    // this bump the only thing keeping a stale result out of state
    // is the next user-typed query (which bumps the id on its way),
    // and during the open window between region change and the
    // next keystroke a stale resolve would commit.
    const prev = dbRef.current
    dbRef.current = null
    dbRegionRef.current = null
    requestIdRef.current += 1
    setState({ results: [], loading: false, error: null })

    ;(async () => {
      try {
        const next = await openPlacesDb(api, regionId)
        if (cancelled) {
          void next.close()
          return
        }
        dbRef.current = next
        dbRegionRef.current = regionId
        // Bump the version state so the search effect re-runs and
        // can now see the opened DB. Without this, a query that
        // landed while the DB was opening would stay stuck in
        // loading because nothing else would trigger a re-render.
        setDbVersion((v) => v + 1)
        void prev?.close()
      } catch (err) {
        if (cancelled) return
        api.log.warn(`geocoder: failed to open places.db for ${regionId}`, err)
        setState({ results: [], loading: false, error: 'Region database unavailable' })
        // Close the old handle on the failure path too — we already
        // committed to abandoning it when the region changed.
        void prev?.close()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [api, regionId])

  // Close the DB on unmount. The region-change effect handles the
  // common case; this catches the unmount path explicitly.
  useEffect(() => {
    return () => {
      const db = dbRef.current
      dbRef.current = null
      dbRegionRef.current = null
      void db?.close()
    }
  }, [])

  // Debounced search. Each query bumps `requestIdRef`; only the
  // most recent in-flight request commits its results to state.
  //
  // Deps include `regionId` so a mid-query region change tears down
  // the in-flight debounce timer (via the cleanup) before it can
  // fire against the wrong handle. The timer reads `dbRef.current`
  // INSIDE the callback rather than capturing it before — combined
  // with the region-change effect nulling `dbRef` synchronously,
  // this means a timer that does sneak through finds `db === null`
  // and short-circuits.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setState({ results: [], loading: false, error: null })
      return
    }

    if (regionId === null || dbRef.current === null) {
      // Either no region active, or the new region's DB is still
      // opening. Show a loading state until the DB resolves; the
      // open-success path bumps `dbVersion`, which is in this
      // effect's deps below — that's what wakes the effect back
      // up so the query can actually dispatch.
      setState((s) => ({ ...s, loading: regionId !== null }))
      return
    }

    requestIdRef.current += 1
    const myId = requestIdRef.current
    setState((s) => ({ ...s, loading: true }))

    const timer = setTimeout(() => {
      void (async () => {
        const db = dbRef.current
        if (!db) {
          // DB swapped out during the debounce window — abandon
          // this request without touching state (a newer one will
          // fire when the new DB opens).
          return
        }
        try {
          const results = await search(
            { query: trimmed, near },
            {
              db,
              nominatim: (q, n) => nominatimSearch(api, q, n),
            },
          )
          if (requestIdRef.current !== myId) return // a newer query started
          setState({ results, loading: false, error: null })
        } catch (err) {
          if (requestIdRef.current !== myId) return
          api.log.warn('geocoder: search failed', err)
          setState({ results: [], loading: false, error: 'Search failed' })
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [api, regionId, query, near?.lat, near?.lon, dbVersion])

  return state
}

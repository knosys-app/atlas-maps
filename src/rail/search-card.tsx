/**
 * Search card — destination geocoder input.
 *
 * Live in this slice (3d):
 *   - Local FTS5 prefix search via `useGeocoder` against the active
 *     region's `places.db` (slice 5 reader; slice 6 builder).
 *   - Online Nominatim fallback when local hits < threshold AND
 *     `navigator.onLine`.
 *   - Strip-house-number tier-3 retry.
 *   - Per-row Save action that calls `saved.add(api, …)` from the
 *     slice 3b saved-store. Errors from the persist path surface
 *     inline (caught from the re-throw added in PR #7 round 2).
 *   - Per-row Navigate action will land with slice 3c (Route card +
 *     route parser); the result row already wires `onSelectDestination`
 *     for the parent.
 *
 * Only mounted when at least one region is installed (`maps-page.tsx`
 * gates the entire rail behind `hasActiveRegion`).
 */

import { useState } from 'react'
import type { FC } from 'react'
import type { SharedDependencies, PluginAPI } from '@/types'
import { useGeocoder } from '@/hooks/use-geocoder'
import type { PlaceResult, PlaceCategory } from '@/geocoder/types'
import { useSavedStore } from '@/store/saved-store'

export interface SearchSuggestion {
  id: string
  name: string
  subtitle?: string
  lat: number
  lon: number
}

export interface SearchCardProps {
  api: PluginAPI
  /** Drives which region's `places.db` the hook opens. */
  regionId: string | null
  /** Optional anchor for distance-ranked tiebreaks. */
  near?: { lat: number; lon: number }
  onSelectDestination?: (s: SearchSuggestion) => void
}

export function createSearchCard(Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Input } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Search, Star, MapPin, Building, Home, Route } = icons

  // Map result category → Lucide icon component. POI / address / road
  // categories use distinct icons so the user can spot what kind of
  // hit they're looking at; place levels (city / town / village) all
  // collapse to MapPin since the type distinction isn't actionable.
  function iconFor(category: PlaceCategory): FC<{ className?: string; style?: object }> | null {
    switch (category) {
      case 'address':
        return Home ?? MapPin ?? null
      case 'poi':
        return Building ?? MapPin ?? null
      case 'road':
        return Route ?? MapPin ?? null
      default:
        return MapPin ?? null
    }
  }

  const SearchCard: FC<SearchCardProps> = ({ api, regionId, near, onSelectDestination }) => {
    const [query, setQuery] = useState('')
    const { results, loading, error } = useGeocoder({ api, regionId, query, near })
    const savedAdd = useSavedStore((s) => s.add)
    // Track per-row save failures as a Set so concurrent failures on
    // different rows don't clobber each other's red highlight. A
    // success path on a row clears that row's id from the Set;
    // failure on another row leaves both highlighted independently.
    const [saveErrorIds, setSaveErrorIds] = useState<Set<string>>(() => new Set())
    // Track which rows have a save in flight so a rapid double-click
    // can't fire two `saved.add` calls in parallel. `saved.add`
    // generates a fresh `cryptoRandomId` per call, so without this
    // guard two parallel calls would each commit a separate entry
    // and the user would end up with duplicates.
    const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())

    const handleSelect = (r: PlaceResult) => {
      onSelectDestination?.({
        id: stableId(r),
        name: r.name,
        subtitle: r.subtitle,
        lat: r.latitude,
        lon: r.longitude,
      })
    }

    const handleSave = async (r: PlaceResult) => {
      const id = stableId(r)
      // Drop redundant clicks while this row's save is in flight.
      // The button is also disabled via `disabled={savingIds.has(id)}`
      // below, but checking here too defends against synthesized
      // click events that bypass the disabled attribute (e.g. some
      // keyboard accessibility wrappers).
      if (savingIds.has(id)) return
      // Clear THIS row's prior error (if any) on retry — leave other
      // rows' errors intact.
      setSaveErrorIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      try {
        await savedAdd(api, {
          name: r.name,
          coordinates: { lat: r.latitude, lon: r.longitude },
          category: r.category,
        })
      } catch {
        // saved-store re-throws on persist failure (PR #7 round 2);
        // mark this row's Save button as failed so the user sees
        // their click did NOT take effect. Other rows' error state
        // is unchanged.
        setSaveErrorIds((prev) => {
          const next = new Set(prev)
          next.add(id)
          return next
        })
      } finally {
        setSavingIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }

    const showResults = query.trim().length >= 2
    const showLoading = showResults && loading && results.length === 0

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: '50%',
              left: 10,
              transform: 'translateY(-50%)',
              color: 'rgb(var(--kmaps-fg-muted))',
              pointerEvents: 'none',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            {Search ? <Search className="w-4 h-4" /> : null}
          </div>
          <Input
            type="text"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Search a destination"
            aria-label="Destination search"
            style={{ paddingLeft: 34 }}
          />
        </div>

        {showResults ? (
          <ResultsPanel
            results={results}
            loading={showLoading}
            error={error}
            iconFor={iconFor}
            Star={Star}
            saveErrorIds={saveErrorIds}
            savingIds={savingIds}
            onSelect={handleSelect}
            onSave={handleSave}
          />
        ) : null}
      </div>
    )
  }

  return SearchCard
}

interface ResultsPanelProps {
  results: PlaceResult[]
  loading: boolean
  error: string | null
  iconFor: (c: PlaceCategory) => FC<{ className?: string; style?: object }> | null
  Star?: FC<{ className?: string; style?: object }>
  saveErrorIds: Set<string>
  savingIds: Set<string>
  onSelect: (r: PlaceResult) => void
  onSave: (r: PlaceResult) => void
}

const ResultsPanel: FC<ResultsPanelProps> = ({
  results,
  loading,
  error,
  iconFor,
  Star,
  saveErrorIds,
  savingIds,
  onSelect,
  onSave,
}) => {
  if (error) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          borderRadius: 'var(--kmaps-r-sm)',
          background: 'rgb(var(--kmaps-danger) / 0.08)',
          padding: '6px 10px',
          color: 'rgb(var(--kmaps-danger))',
          fontSize: 12,
        }}
      >
        {error}
      </div>
    )
  }

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          borderRadius: 'var(--kmaps-r-sm)',
          background: 'rgb(var(--kmaps-fg) / 0.04)',
          padding: '6px 10px',
          color: 'rgb(var(--kmaps-fg-muted))',
          fontSize: 12,
        }}
      >
        Searching…
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          borderRadius: 'var(--kmaps-r-sm)',
          background: 'rgb(var(--kmaps-fg) / 0.04)',
          padding: '6px 10px',
          color: 'rgb(var(--kmaps-fg-muted))',
          fontSize: 12,
        }}
      >
        No matches
      </div>
    )
  }

  return (
    // Native `<ul>`/`<li>` semantics (role=list / role=listitem) rather
    // than role="listbox"/option — these rows are one-shot navigation
    // items, not a selection target. The listbox contract requires
    // tracking a selected option via aria-selected, which doesn't fit
    // a "click to set destination" UX. The buttons inside each row
    // provide native keyboard accessibility.
    <ul
      aria-label="Search suggestions"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {results.map((r) => {
        const id = stableId(r)
        const Icon = iconFor(r.category)
        const failed = saveErrorIds.has(id)
        const saving = savingIds.has(id)
        return (
          <li
            key={id}
            style={{
              display: 'grid',
              gridTemplateColumns: '20px 1fr 28px',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 'var(--kmaps-r-sm)',
            }}
          >
            <span aria-hidden style={{ display: 'grid', placeItems: 'center' }}>
              {Icon ? (
                <Icon
                  className="w-4 h-4"
                  style={{ color: 'rgb(var(--kmaps-fg-muted))' }}
                />
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => onSelect(r)}
              style={{
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.name}
              </span>
              {r.subtitle ? (
                <span
                  style={{
                    fontSize: 11,
                    color: 'rgb(var(--kmaps-fg-muted))',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.subtitle}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => onSave(r)}
              disabled={saving}
              aria-busy={saving || undefined}
              aria-label={`Save ${r.name}`}
              title={
                saving
                  ? 'Saving…'
                  : failed
                  ? 'Save failed — try again'
                  : 'Save destination'
              }
              style={{
                width: 24,
                height: 24,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: failed
                  ? 'rgb(var(--kmaps-danger))'
                  : 'rgb(var(--kmaps-fg-muted))',
                cursor: saving ? 'progress' : 'pointer',
                borderRadius: 'var(--kmaps-r-sm)',
                display: 'grid',
                placeItems: 'center',
                opacity: saving ? 0.4 : failed ? 1 : 0.7,
              }}
              onMouseEnter={(e) => {
                if (!failed && !saving) e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                if (!failed && !saving) e.currentTarget.style.opacity = '0.7'
              }}
              onFocus={(e) => {
                if (!failed && !saving) e.currentTarget.style.opacity = '1'
              }}
              onBlur={(e) => {
                if (!failed && !saving) e.currentTarget.style.opacity = '0.7'
              }}
            >
              {Star ? <Star className="w-4 h-4" /> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Stable identifier for a `PlaceResult`. The geocoder doesn't carry
 *  one (FTS rows return without `rowid` in the projection), so we
 *  derive an id from coordinates + name + source. Coordinates
 *  uniquely identify the row across reruns; name + source guards
 *  against the same lat/lon hosting multiple POIs. */
function stableId(r: PlaceResult): string {
  return `${r.source}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}:${r.name}`
}

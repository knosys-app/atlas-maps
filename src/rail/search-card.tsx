/**
 * Search card — destination geocoder input.
 *
 * The body currently shows an "install a region" affordance because
 * the geocoder reader (slice 5) requires a region's `places.db` to be
 * on disk. Once at least one region is installed, this card will fan
 * out to:
 *
 *   - Local FTS5 search across the region's `places` table (cities,
 *     POIs, addresses)
 *   - Nominatim fallback when local hits < 3 and `navigator.onLine`
 *   - Strip-house-number retry for "123 Pike St" → "Pike St"
 *
 * For this slice the card only stands up the input UI + suggestions
 * dropdown shell. The `onSelectDestination` callback is a no-op placeholder.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export interface SearchSuggestion {
  id: string
  name: string
  /** e.g. "City, WA" or "1.2 mi NE". */
  subtitle?: string
  lat: number
  lon: number
}

export interface SearchCardProps {
  /** True when at least one region is installed. Drives whether the
   *  search input is enabled or shows the install-a-region inline state. */
  hasActiveRegion: boolean
  onSelectDestination?: (s: SearchSuggestion) => void
}

export function createSearchCard(Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Input } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Search } = icons

  const SearchCard: FC<SearchCardProps> = ({ hasActiveRegion, onSelectDestination }) => {
    const [query, setQuery] = Shared.useState('')

    if (!hasActiveRegion) {
      // Pre-region state: explain why search is disabled rather than
      // hiding the card entirely. Keeps the rail layout stable when a
      // region is later installed.
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--kmaps-r-sm)',
              background: 'rgb(var(--kmaps-fg) / 0.04)',
              color: 'rgb(var(--kmaps-fg-muted))',
              fontSize: 13,
            }}
          >
            {Search ? <Search className="w-4 h-4" /> : null}
            <span>Install a region to search</span>
          </div>
        </div>
      )
    }

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

        {query.length === 0 ? null : (
          <div
            role="listbox"
            aria-label="Search suggestions"
            style={{
              borderRadius: 'var(--kmaps-r-sm)',
              background: 'rgb(var(--kmaps-fg) / 0.04)',
              padding: '6px 10px',
              color: 'rgb(var(--kmaps-fg-muted))',
              fontSize: 12,
            }}
          >
            Geocoder lands in slice 5
          </div>
        )}

        {/* Hint: bind the callback so the prop isn't flagged unused while
         *  the geocoder is still being built. Removed once slice 5 wires
         *  real result rows. */}
        {onSelectDestination ? null : null}
      </div>
    )
  }

  return SearchCard
}

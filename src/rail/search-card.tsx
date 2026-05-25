/**
 * Search card — destination geocoder input.
 *
 * Only mounted when at least one region is installed (`maps-page.tsx`
 * gates the entire rail behind `hasActiveRegion`), so the card itself
 * doesn't carry a defensive branch for the pre-region case — the outer
 * gate is authoritative. Removed in response to Greptile flagging the
 * inner branch as dead code.
 *
 * Backend status: the 3-tier search (FTS5 → Nominatim → strip-#) and
 * the result list rendering land with slice 5 once the geocoder
 * reader is wired. For now this is the input shell + a status
 * placeholder when the user has typed something.
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
  onSelectDestination?: (s: SearchSuggestion) => void
}

export function createSearchCard(Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Input } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Search } = icons

  // onSelectDestination is exposed in props so slice 5 can wire it
  // without changing the contract; not yet referenced in render.

  const SearchCard: FC<SearchCardProps> = () => {
    const [query, setQuery] = Shared.useState('')

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
          // Until the geocoder lands, this is a status placeholder.
          // Once slice 5 wires real suggestions the container becomes
          // a `role="listbox"` containing `role="option"` children —
          // ARIA requires that pairing, so we don't pre-emptively
          // claim "listbox" with no options inside.
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
            Geocoder lands in slice 5
          </div>
        )}
      </div>
    )
  }

  return SearchCard
}

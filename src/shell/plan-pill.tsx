/**
 * Floating Plan Pill — top-center.
 *
 * Maps-domain content (vs. flight-planner's plan-name + ICAO chip):
 *   - Idle: "Search a destination" placeholder + Search icon
 *   - Previewing a route: destination name + distance/ETA chip + menu
 *   - Navigating (v3.1): destination + ETA chip
 *
 * The pill itself is purely presentational here. The dropdown menu hosts
 * route-level actions (Clear route, Save destination, Share location).
 * Share codecs (GPX / KML / GeoJSON) land with the destinations slice.
 *
 * Structure ported from `/tmp/flight-planner/src/components/shell/
 * plan-pill.tsx` (`createPlanPill(Shared)` factory pattern). atlas-maps'
 * `SharedDependencies` keeps the host's namespaces (`shadcn` / `kdl` /
 * `lucideIcons` are siblings) — unlike flight-planner which flattens
 * at activate, so the destructuring shape here is different.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export interface RoutePreview {
  destinationName: string
  /** Pre-formatted distance string (e.g. "12.4 mi" or "20 km"). */
  distanceLabel: string
  /** Pre-formatted ETA / duration (e.g. "18 min"). */
  etaLabel: string
}

export interface PlanPillProps {
  /** Current route preview, if any. Null in idle state. */
  preview: RoutePreview | null
  /** Opens the search rail (v3.1 will scroll/focus the search input). */
  onSearchClick: () => void
  /** Clear the current route preview (returns the pill to idle). */
  onClearRoute: () => void
  /** Save the current route's destination (no-op until destinations slice). */
  onSaveDestination?: () => void
}

export function createPlanPill(Shared: SharedDependencies) {
  // Resolve shadcn primitives from the host's UI bundle. Treat the
  // namespace map as `Record<string, ComponentType<any>>` so destructuring
  // works without per-component typings. Same compromise flight-planner
  // makes — the host UI shape is a runtime contract; static typing of
  // every primitive's prop shape is more friction than it's worth.
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } = shadcn
  // Lucide's host-provided typings only declare `className` — accepting
  // `style` works at runtime (lucide-react SVGs forward unknown props),
  // but TS sees the narrow declared shape. Re-typing as
  // `Record<string, FC<any>>` matches flight-planner's pragmatic cast.
  const icons = Shared.lucideIcons as Record<string, FC<any>>
  const { MoreHorizontal, Search, Star, X, Navigation } = icons

  const PlanPill: FC<PlanPillProps> = ({
    preview,
    onSearchClick,
    onClearRoute,
    onSaveDestination,
  }) => {
    if (!preview) {
      // Idle state: pill collapses to a tappable search target.
      return (
        <button
          type="button"
          className="kmaps-pill kmaps-surface-thick"
          onClick={onSearchClick}
          aria-label="Search a destination"
          style={{
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
            letterSpacing: '-0.011em',
          }}
        >
          {Search ? (
            <Search
              className="w-4 h-4"
              style={{ color: 'rgb(var(--kmaps-fg-muted))' }}
            />
          ) : null}
          <span className="kmaps-pill-placeholder">Search a destination</span>
        </button>
      )
    }

    // Previewing a route: show destination + chip + action menu.
    return (
      <div className="kmaps-pill kmaps-surface-thick">
        {Navigation ? (
          <Navigation
            className="w-4 h-4"
            style={{ color: 'rgb(var(--kmaps-accent))' }}
          />
        ) : null}
        <span style={{ letterSpacing: '-0.011em' }}>{preview.destinationName}</span>
        <span className="kmaps-pill-chip">
          {preview.distanceLabel}
          {preview.etaLabel ? ` · ${preview.etaLabel}` : ''}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Route menu"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
              }}
            >
              {MoreHorizontal ? <MoreHorizontal className="w-4 h-4" /> : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="kmaps-scope"
            style={{ minWidth: 220 }}
          >
            {onSaveDestination ? (
              <>
                <DropdownMenuItem onSelect={onSaveDestination}>
                  {Star ? <Star className="w-4 h-4 mr-2" /> : null}
                  Save destination
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              onSelect={onClearRoute}
              style={{ color: 'rgb(var(--kmaps-danger))' }}
            >
              {X ? <X className="w-4 h-4 mr-2" /> : null}
              Clear route
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return PlanPill
}

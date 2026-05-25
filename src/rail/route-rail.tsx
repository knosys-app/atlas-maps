/**
 * Route Rail — left-side card stack (340 px wide).
 *
 * Ported structurally from flight-planner's `PlanRail` + `RailSection`.
 * Provides:
 *   - A glass-surface aside that renders against the chrome layer
 *   - A scrolling card stack with a fade-in stagger animation
 *   - A generic `RailSection` card with optional title + collapse
 *
 * Drag-reorder for the Saved card is intentionally deferred — v3.0
 * doesn't need it for the search → save → drive flow, and it adds
 * @dnd-kit binding code that's better landed once the Saved card body
 * exists. Lands in slice 3b.
 *
 * `RouteRail` exposes children as a slot. The composing component
 * (MapsPage) decides which cards to render and in what order.
 */

import type { FC, ReactNode } from 'react'
import type { SharedDependencies } from '@/types'

export interface RailSectionProps {
  title?: string
  /** Optional right-aligned content in the header (e.g. an action button). */
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** When false the card title is rendered but the chevron + click-to-
   *  collapse behavior is suppressed. */
  collapsible?: boolean
}

export function createRouteRail(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { ChevronDown } = icons

  // RailSection is a thin presentational wrapper. Card bodies own their
  // own internal state; this only handles the card chrome.
  const RailSection: FC<RailSectionProps> = ({
    title,
    action,
    children,
    defaultOpen = true,
    collapsible = true,
  }) => {
    const [open, setOpen] = useShared(Shared, defaultOpen)
    const effectiveOpen = collapsible ? open : true

    const headerStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: 0,
      background: 'none',
      border: 'none',
      color: 'inherit',
    } as const

    return (
      <section className="kmaps-rail-card">
        {title ? (
          <div className="kmaps-rail-card-header">
            {collapsible ? (
              <button
                type="button"
                className="kmaps-label-caps"
                onClick={() => setOpen(!open)}
                style={{ ...headerStyle, cursor: 'pointer' }}
              >
                {ChevronDown ? (
                  <ChevronDown
                    className="w-3 h-3"
                    style={{
                      transition: 'transform 180ms var(--kmaps-spring-b)',
                      transform: effectiveOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                  />
                ) : null}
                {title}
              </button>
            ) : (
              // Static labels render as a `<span>` rather than a
              // `<button disabled>` — disabled buttons are non-focusable
              // and announced as "dimmed" by screen readers, which is
              // semantically wrong for a non-interactive title.
              <span className="kmaps-label-caps" style={headerStyle}>
                {title}
              </span>
            )}
            {action ?? null}
          </div>
        ) : null}
        {effectiveOpen ? <div>{children}</div> : null}
      </section>
    )
  }

  const RouteRail: FC<{ children: ReactNode }> = ({ children }) => (
    <aside className="kmaps-rail kmaps-surface-thin" aria-label="Route planning rail">
      <div className="kmaps-rail-scroll kmaps-stagger">{children}</div>
    </aside>
  )

  return { RouteRail, RailSection }
}

// Shared's `useState` is bound at factory time; this helper keeps the
// RailSection body terse without losing the closure-Shared pattern.
function useShared<T>(Shared: SharedDependencies, initial: T) {
  return Shared.useState(initial)
}

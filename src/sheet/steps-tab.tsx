/**
 * Steps tab — turn-by-turn maneuver list.
 *
 * Renders the maneuver list parsed from the active route (when one
 * exists) or an empty state otherwise. The route data flows in via
 * the `steps` prop so this component is purely presentational and
 * doesn't care where the route came from — the parent wires it.
 *
 * v3.0 scope: list view only. Per-step tap to fly the map to that
 * maneuver lands with the map-route-line layer slice (slice 3c or
 * later). The "estimated time to step" column lands with live ETA
 * in v3.1.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export interface RouteStep {
  /** 0-based maneuver index along the route. */
  index: number
  /** Verbatim maneuver instruction (e.g. "Turn right onto Pike St"). */
  instruction: string
  /** Pre-formatted distance until this maneuver (e.g. "0.4 mi"). */
  distanceLabel: string
  /** Pre-formatted duration to this maneuver (e.g. "1 min"). */
  durationLabel: string
  /** Optional category icon hint — 'turn-left' / 'turn-right' /
   *  'straight' / 'arrive' / etc. The icon component is looked up
   *  by the parent via Shared.lucideIcons. */
  iconName?: string
}

export interface StepsTabProps {
  steps: RouteStep[] | null
  /** Fly the map to the given step. Click handler on each row. */
  onSelectStep?: (step: RouteStep) => void
}

export function createStepsTab(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Navigation, MapPin } = icons

  const StepsTab: FC<StepsTabProps> = ({ steps, onSelectStep }) => {
    if (steps === null) {
      return (
        <div className="kmaps-sheet-empty">
          {Navigation ? (
            <Navigation
              className="w-6 h-6"
              style={{ color: 'rgb(var(--kmaps-fg-muted))', opacity: 0.6 }}
            />
          ) : null}
          <span>Plan a route to see turn-by-turn directions</span>
        </div>
      )
    }

    if (steps.length === 0) {
      // Route exists but had no maneuvers (e.g. start == end). Distinct
      // empty state from the no-route case so the user knows something
      // is loaded vs. nothing planned.
      return (
        <div className="kmaps-sheet-empty">
          {MapPin ? (
            <MapPin
              className="w-6 h-6"
              style={{ color: 'rgb(var(--kmaps-fg-muted))', opacity: 0.6 }}
            />
          ) : null}
          <span>No turns on this route</span>
        </div>
      )
    }

    return (
      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {steps.map((step) => (
          <li key={step.index}>
            <button
              type="button"
              onClick={() => onSelectStep?.(step)}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '28px 1fr auto',
                alignItems: 'baseline',
                gap: 10,
                padding: '10px 8px',
                borderRadius: 'var(--kmaps-r-sm)',
                border: '1px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                color: 'inherit',
                textAlign: 'left',
                font: 'inherit',
                transition: 'background var(--kmaps-dur-base) ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgb(var(--kmaps-fg) / 0.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <StepIcon Shared={Shared} iconName={step.iconName} />
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as const,
                }}
              >
                {step.instruction}
              </span>
              <span
                style={{
                  fontFamily: 'var(--kmaps-font-mono)',
                  fontSize: 11,
                  color: 'rgb(var(--kmaps-fg-muted))',
                  whiteSpace: 'nowrap',
                }}
              >
                {step.distanceLabel}
              </span>
            </button>
          </li>
        ))}
      </ol>
    )
  }

  return StepsTab
}

const StepIcon: FC<{ Shared: SharedDependencies; iconName?: string }> = ({ Shared, iconName }) => {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  // Map a maneuver hint to a Lucide icon. The full mapping lives with
  // the route parser; here we just resolve the icon component or
  // fall back to a generic arrow.
  const Component =
    (iconName ? icons[iconName] : undefined) ?? icons.ArrowUpRight ?? icons.Navigation
  if (!Component) return <span aria-hidden style={{ width: 18, height: 18 }} />
  return (
    <Component
      className="w-[18px] h-[18px]"
      style={{ color: 'rgb(var(--kmaps-accent))' }}
    />
  )
}

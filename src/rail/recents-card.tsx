/**
 * Recents card — last N completed routes.
 *
 * Stands up the empty state for now. The full implementation lands
 * with `history-store.ts` (slice 4 alongside the Steps tab, since
 * Steps and Recents share the route-completed event) and queries the
 * `routes/history.db` SQLite that the host writes on each nav
 * completion.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export interface RecentRoute {
  id: string
  destinationName: string
  /** Pre-formatted (e.g. "Yesterday · 12.4 mi"). */
  subtitle: string
  /** ISO timestamp; controls sort order in the parent. */
  completedAt: string
}

export interface RecentsCardProps {
  recents: RecentRoute[]
  onSelectRecent?: (route: RecentRoute) => void
}

export function createRecentsCard(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { History } = icons

  const RecentsCard: FC<RecentsCardProps> = ({ recents, onSelectRecent }) => {
    if (recents.length === 0) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            color: 'rgb(var(--kmaps-fg-muted))',
            fontSize: 13,
          }}
        >
          {History ? <History className="w-4 h-4" /> : null}
          <span>No recent routes</span>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recents.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectRecent?.(r)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '8px 10px',
              borderRadius: 'var(--kmaps-r-sm)',
              border: '1px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              color: 'inherit',
              textAlign: 'left',
              font: 'inherit',
              transition: 'background var(--kmaps-dur-base) ease',
            }}
            // Apply highlight on hover AND keyboard focus so Tab-
            // navigating users see the same visual indicator as
            // pointer users (WCAG 2.4.7 Focus Visible).
            onMouseEnter={highlightRow}
            onMouseLeave={resetRow}
            onFocus={highlightRow}
            onBlur={resetRow}
          >
            <span style={{ fontSize: 13, fontWeight: 500 }}>{r.destinationName}</span>
            <span
              style={{
                fontSize: 11,
                color: 'rgb(var(--kmaps-fg-muted))',
                fontFamily: 'var(--kmaps-font-mono)',
              }}
            >
              {r.subtitle}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return RecentsCard
}

function highlightRow(e: React.SyntheticEvent<HTMLButtonElement>): void {
  e.currentTarget.style.background = 'rgb(var(--kmaps-fg) / 0.06)'
}

function resetRow(e: React.SyntheticEvent<HTMLButtonElement>): void {
  e.currentTarget.style.background = 'transparent'
}

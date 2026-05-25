/**
 * Profile tab — elevation chart placeholder for v3.0.
 *
 * Stands up the tab body shell with an explanatory empty state. The
 * full elevation chart (terrain DEM samples along the route shape +
 * speed-limit ribbon + the SpeedDeck-style scrubber that drives a map
 * cursor) lands with v3.1+ once GPS / live nav data is available.
 *
 * Returns the same empty-state shape as Steps so the sheet feels
 * consistent across tabs.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export function createProfileTab(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Mountain, TrendingUp } = icons
  const Icon = Mountain ?? TrendingUp

  const ProfileTab: FC = () => (
    <div className="kmaps-sheet-empty">
      {Icon ? (
        <Icon
          className="w-6 h-6"
          style={{ color: 'rgb(var(--kmaps-fg-muted))', opacity: 0.6 }}
        />
      ) : null}
      <span>Elevation profile lands with v3.1 live navigation</span>
    </div>
  )

  return ProfileTab
}

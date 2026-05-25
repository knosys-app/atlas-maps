/**
 * Briefing card — route summary at the top of the rail.
 *
 * Renders the active route preview as a hero with distance + duration
 * headline, profile chip, and a quick-action footer. Returns null when
 * there's no active preview so the rail collapses gracefully.
 *
 * Styling matches `.kmaps-briefing-*` selectors in styles.css —
 * radial-gradient hero, large tabular-numeric headline, mono subtitle.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'

export interface BriefingPreview {
  /** Where the user is going. */
  destinationName: string
  /** Pre-formatted total distance (e.g. "12.4 mi"). */
  distanceLabel: string
  /** Pre-formatted duration (e.g. "18 min"). */
  durationLabel: string
  /** Routing profile chip — "Driving", "Cycling", "Walking". */
  profileLabel: string
  /** Optional warning chip (e.g. "Toll road"). */
  warningLabel?: string
}

export interface BriefingCardProps {
  preview: BriefingPreview | null
  onSavePin?: () => void
  onShareRoute?: () => void
}

export function createBriefingCard(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { MapPin, Share2, Star } = icons

  const BriefingCard: FC<BriefingCardProps> = ({ preview, onSavePin, onShareRoute }) => {
    if (!preview) return null

    return (
      <div className="kmaps-briefing">
        <div className="kmaps-briefing-eyebrow">
          {MapPin ? <MapPin className="w-3 h-3" /> : null}
          {preview.destinationName}
        </div>
        <div className="kmaps-briefing-headline">
          {preview.distanceLabel} · {preview.durationLabel}
        </div>
        <div className="kmaps-briefing-sub">{preview.profileLabel}</div>
        <div className="kmaps-briefing-chips">
          <span className="kmaps-chip kmaps-chip-accent">{preview.profileLabel}</span>
          {preview.warningLabel ? (
            <span className="kmaps-chip kmaps-chip-warn">{preview.warningLabel}</span>
          ) : null}
          {onSavePin ? (
            <button type="button" className="kmaps-chip" onClick={onSavePin}>
              {Star ? <Star className="w-3 h-3" /> : null}
              Save
            </button>
          ) : null}
          {onShareRoute ? (
            <button type="button" className="kmaps-chip" onClick={onShareRoute}>
              {Share2 ? <Share2 className="w-3 h-3" /> : null}
              Share
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return BriefingCard
}

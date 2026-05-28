/**
 * Empty state shown when no region is installed.
 *
 * Two surface modes:
 *   - `backdrop` — full-bleed gradient + tint behind the card. Used
 *     when no online basemap is rendering (offline, or online but
 *     the user disabled the fallback). Looks like a designed empty
 *     state rather than a blank canvas.
 *   - `card-only` — just the floating glass card, no full-bleed
 *     overlay. Used when an online basemap is showing underneath so
 *     the user can see their geography while still being prompted
 *     to install an offline region.
 *
 * Styling matches the kmaps design language — glass surface, SF font
 * stack, accent CTA. Lives outside the chrome overlay so it can't be
 * tabbed past or hidden by the pill / layers button.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'
import { STARTER_REGION_COUNT } from '@/data/regions'

export interface EmptyStateProps {
  /** Opens the regions panel in Settings (lands with slice 6). */
  onInstallRegion: () => void
  /** Surface treatment. Defaults to `backdrop` (legacy behavior).
   *  Pass `card-only` when an online basemap is rendering underneath
   *  — the floating card stays but the gradient overlay drops so the
   *  user can see geographic context. */
  surface?: 'backdrop' | 'card-only'
}

export function createEmptyState(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { MapPin, Download } = icons

  const EmptyState: FC<EmptyStateProps> = ({ onInstallRegion, surface = 'backdrop' }) => (
    <div
      role="region"
      aria-label="No region installed"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // `backdrop`: subtle radial gradient over a translucent tint
        // so the empty state reads as "designed backdrop" rather than
        // a flat error screen.
        // `card-only`: transparent — the MapViewer's online basemap
        // shows through and the floating card is the only chrome.
        background:
          surface === 'backdrop'
            ? 'radial-gradient(120% 80% at 20% 0%, rgb(var(--kmaps-accent) / 0.10) 0%, transparent 60%), ' +
              'radial-gradient(80% 60% at 90% 100%, rgb(var(--kmaps-accent) / 0.06) 0%, transparent 60%), ' +
              'rgb(var(--kmaps-surface-tint) / 0.4)'
            : 'transparent',
        // card-only must let the user pan/click on the map outside
        // the card. The card itself re-enables pointer events below.
        pointerEvents: surface === 'card-only' ? 'none' : 'auto',
        zIndex: 0,
      }}
    >
      <div
        className="kmaps-surface-thick"
        style={{
          maxWidth: 360,
          padding: 28,
          borderRadius: 'var(--kmaps-r-lg)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'auto',
          gap: 14,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgb(var(--kmaps-accent) / 0.14)',
            color: 'rgb(var(--kmaps-accent))',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {MapPin ? <MapPin className="w-7 h-7" /> : null}
        </div>
        <div
          style={{
            fontFamily: 'var(--kmaps-font-display)',
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: 'rgb(var(--kmaps-fg))',
          }}
        >
          Install your first region
        </div>
        <p
          style={{
            margin: 0,
            color: 'rgb(var(--kmaps-fg-muted))',
            fontSize: 13.5,
            lineHeight: 1.45,
          }}
        >
          Knosys Maps works fully offline once you download a region. Pick
          a state or country to get the map tiles, routing graph, and
          street-level address index.
        </p>
        <button
          type="button"
          onClick={onInstallRegion}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            border: 'none',
            borderRadius: 999,
            background: 'rgb(var(--kmaps-accent))',
            color: 'rgb(var(--kmaps-accent-ink))',
            fontFamily: 'var(--kmaps-font-display)',
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
            boxShadow: '0 6px 14px rgb(var(--kmaps-accent) / 0.35)',
            transition: 'transform var(--kmaps-dur-base) var(--kmaps-spring-b)',
          }}
        >
          {Download ? <Download className="w-4 h-4" /> : null}
          Browse {STARTER_REGION_COUNT} regions
        </button>
        <div
          style={{
            fontSize: 11,
            color: 'rgb(var(--kmaps-fg-muted))',
            fontFamily: 'var(--kmaps-font-mono)',
            marginTop: 4,
          }}
        >
          A typical US state is ~700 MB to 1.2 GB
        </div>
      </div>
    </div>
  )

  return EmptyState
}

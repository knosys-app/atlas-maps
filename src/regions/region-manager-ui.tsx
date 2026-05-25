/**
 * Region manager Settings sub-panel.
 *
 * Read-only listing of installed regions + storage-usage indicator.
 * Mounted inside the host's Settings modal via
 * `api.ui.registerSettingsPanel({ id: 'maps-regions', component })`.
 *
 * v3.0 surfaces:
 *   - The list of regions discovered by `region-store.hydrate`
 *     (each renders with byteSize, built-at relative timestamp, and
 *     "addresses" row count when OpenAddresses was imported).
 *   - An "active" affordance per row — clicking marks that region as
 *     active so the rail + sheet + map switch to it.
 *   - The "Install region" CTA, disabled with a tooltip pointing at
 *     slice 6b. The surface needs to be discoverable now so users
 *     know what's coming.
 *
 * Delete is gated to slice 6b alongside install — without the
 * orchestrator there's no way to reinstall a deleted region, so we
 * don't ship a one-way-only destructive affordance.
 */

import type { FC } from 'react'
import type { PluginAPI, SharedDependencies } from '@/types'
import { useRegionStore } from './region-store'
import { formatBytes, type RegionMeta } from './meta'

export function createRegionManagerUi(api: PluginAPI, Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Button } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Map: MapIcon, Trash2, Download, CheckCircle2, Circle, AlertCircle } = icons

  const RegionManagerUi: FC<unknown> = () => {
    const regions = useRegionStore()

    // Hydrate on first mount. The maps-page also calls hydrate, but
    // the Settings panel may open before the user has visited /maps,
    // in which case the store is still empty. `hydrate` is guarded
    // against double-fire by the `hydrated` flag.
    Shared.useEffect(() => {
      void regions.hydrate(api)
    }, [])

    const totalBytes = regions.installed.reduce((acc, r) => acc + r.byteSize, 0)
    const hasRegions = regions.installed.length > 0

    return (
      <div className="kmaps-root" style={{ padding: 16, minHeight: 320 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--kmaps-font-display)',
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.011em',
              margin: 0,
            }}
          >
            Regions
          </h2>
          <span
            style={{
              fontFamily: 'var(--kmaps-font-mono)',
              fontSize: 12,
              color: 'rgb(var(--kmaps-fg-muted))',
            }}
          >
            {hasRegions
              ? `${formatBytes(totalBytes)} · ${regions.installed.length} region${regions.installed.length === 1 ? '' : 's'}`
              : '0 regions'}
          </span>
        </header>

        {!regions.hydrated ? (
          <RegionsSkeleton />
        ) : hasRegions ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {regions.installed.map((meta) => (
              <RegionRow
                key={meta.regionId}
                meta={meta}
                isActive={regions.activeRegionId === meta.regionId}
                onActivate={() => void regions.setActive(api, meta.regionId)}
                CheckCircle2={CheckCircle2}
                Circle={Circle}
                Trash2={Trash2}
                AlertCircle={AlertCircle}
              />
            ))}
          </ul>
        ) : (
          <EmptyState MapIcon={MapIcon} />
        )}

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgb(var(--kmaps-hairline))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{ fontSize: 12, color: 'rgb(var(--kmaps-fg-muted))' }}
          >
            Region downloads ship with v3.0.0 (offline build pipeline).
          </span>
          <Button
            type="button"
            disabled
            aria-disabled="true"
            title="Region downloads land in slice 6b (Valhalla binaries + planetiler pipeline)"
            style={{ pointerEvents: 'auto' }}
          >
            {Download ? <Download className="w-4 h-4" /> : null}
            <span style={{ marginLeft: 6 }}>Install a region</span>
          </Button>
        </div>
      </div>
    )
  }

  return RegionManagerUi
}

interface RegionRowProps {
  meta: RegionMeta
  isActive: boolean
  onActivate: () => void
  CheckCircle2?: FC<{ className?: string; style?: object }>
  Circle?: FC<{ className?: string; style?: object }>
  Trash2?: FC<{ className?: string; style?: object }>
  AlertCircle?: FC<{ className?: string; style?: object }>
}

const RegionRow: FC<RegionRowProps> = ({
  meta,
  isActive,
  onActivate,
  CheckCircle2,
  Circle,
  Trash2,
  AlertCircle,
}) => {
  const ActiveIcon = isActive ? CheckCircle2 : Circle
  const oaMissing = !meta.oaImportedAt
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr auto auto',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 'var(--kmaps-r-sm)',
        border: '1px solid rgb(var(--kmaps-hairline))',
        background: isActive
          ? 'rgb(var(--kmaps-accent) / 0.06)'
          : 'rgb(var(--kmaps-surface-tint) / 0.5)',
      }}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-label={isActive ? `${meta.regionId} is active` : `Make ${meta.regionId} active`}
        aria-pressed={isActive}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: isActive
            ? 'rgb(var(--kmaps-accent))'
            : 'rgb(var(--kmaps-fg-muted))',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {ActiveIcon ? <ActiveIcon className="w-5 h-5" /> : null}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.regionId}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'rgb(var(--kmaps-fg-muted))',
            fontFamily: 'var(--kmaps-font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Built {relativeTime(meta.builtAt)}</span>
          {meta.oaRowCount ? (
            <>
              <span aria-hidden>·</span>
              <span>{formatRowCount(meta.oaRowCount)} addresses</span>
            </>
          ) : oaMissing ? (
            <>
              <span aria-hidden>·</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  color: 'rgb(var(--kmaps-warn))',
                }}
                title="OpenAddresses import didn't run for this region — addresses may be sparse"
              >
                {AlertCircle ? <AlertCircle className="w-3 h-3" /> : null}
                <span>OSM addresses only</span>
              </span>
            </>
          ) : null}
        </span>
      </div>
      <span
        style={{
          fontSize: 12,
          fontFamily: 'var(--kmaps-font-mono)',
          color: 'rgb(var(--kmaps-fg-muted))',
        }}
      >
        {formatBytes(meta.byteSize)}
      </span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={`Delete ${meta.regionId}`}
        title="Region delete arrives in slice 6b (paired with re-install affordance)"
        style={{
          width: 28,
          height: 28,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'rgb(var(--kmaps-fg-faint))',
          cursor: 'not-allowed',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--kmaps-r-sm)',
        }}
      >
        {Trash2 ? <Trash2 className="w-4 h-4" /> : null}
      </button>
    </li>
  )
}

interface EmptyStateProps {
  MapIcon?: FC<{ className?: string; style?: object }>
}

const EmptyState: FC<EmptyStateProps> = ({ MapIcon }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      gap: 8,
      borderRadius: 'var(--kmaps-r-md)',
      background: 'rgb(var(--kmaps-fg) / 0.03)',
      border: '1px dashed rgb(var(--kmaps-hairline))',
      color: 'rgb(var(--kmaps-fg-muted))',
      textAlign: 'center',
    }}
  >
    {MapIcon ? (
      <MapIcon className="w-6 h-6" style={{ color: 'rgb(var(--kmaps-fg-faint))' }} />
    ) : null}
    <span style={{ fontSize: 14, fontWeight: 500, color: 'rgb(var(--kmaps-fg))' }}>
      No regions installed yet
    </span>
    <span style={{ fontSize: 12, maxWidth: 320 }}>
      A region bundles offline routing tiles, vector map tiles, and an address
      geocoder. You'll be able to install regions once the v3.0.0 build pipeline
      lands.
    </span>
  </div>
)

const RegionsSkeleton: FC = () => (
  <div
    role="status"
    aria-live="polite"
    style={{
      padding: 24,
      borderRadius: 'var(--kmaps-r-md)',
      background: 'rgb(var(--kmaps-fg) / 0.04)',
      color: 'rgb(var(--kmaps-fg-muted))',
      fontSize: 13,
      textAlign: 'center',
    }}
  >
    Scanning vault for regions…
  </div>
)

/** Build a coarse "X days ago" string from an ISO timestamp. Returns
 *  raw date when older than ~6 months to avoid "215 days ago"
 *  awkwardness. Resilient to invalid input — falls back to the raw
 *  string so a malformed timestamp doesn't crash the panel. */
function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const deltaMs = Date.now() - t
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 6) return `${months} month${months === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString()
}

/** Format an OpenAddresses row count as a human label. Targets the
 *  Settings panel's per-row meta line — single decimal for k / M
 *  prefixes since the values are estimates anyway. */
function formatRowCount(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

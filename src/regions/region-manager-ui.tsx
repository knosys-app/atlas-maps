/**
 * Region manager Settings sub-panel.
 *
 * Listing of installed regions + storage usage + the dev-mode stub
 * installer affordance. Mounted via
 * `api.ui.registerSettingsPanel({ id: 'maps-regions', component })`.
 *
 * v3.0 surfaces:
 *   - Region list with byteSize, built-at, OA row count (or "OSM
 *     addresses only" warning when oaImportedAt is null).
 *   - Per-row Active toggle (radio-style; one active at a time).
 *   - Per-row Delete — enabled for stub regions (marker:
 *     `valhallaVersion === 'stub'`). Real regions still surface a
 *     disabled delete pointing at slice 6b's uninstall flow because
 *     a one-way delete of a multi-GB build would be regret-inducing.
 *   - Install popover with a search + STARTER_REGIONS picker. Every
 *     install in v3.0 is a **stub install** (writes meta.json + an
 *     empty places.db; no tiles, no PMTiles). Clearly labeled as
 *     dev-only — slice 6b's real orchestrator replaces this path.
 */

import { useMemo, useState } from 'react'
import type { FC } from 'react'
import type { PluginAPI, SharedDependencies } from '@/types'
import { useRegionStore } from './region-store'
import { formatBytes, type RegionMeta } from './meta'
import { STARTER_REGIONS } from '@/data/regions'
import type { RegionDefinition } from '@/data/regions'
import { installStubRegion, uninstallStubRegion } from './stub-installer'

export function createRegionManagerUi(api: PluginAPI, Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Button, Input, Popover, PopoverTrigger, PopoverContent } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Map: MapIcon, Trash2, Download, CheckCircle2, Circle, AlertCircle, Search } = icons

  const RegionManagerUi: FC<unknown> = () => {
    const regions = useRegionStore()

    // Hydrate on first mount. The maps-page also calls hydrate, but
    // the Settings panel may open before the user has visited /maps,
    // in which case the store is still empty. `hydrate` is guarded
    // against double-fire by the `hydrated` flag.
    Shared.useEffect(() => {
      void regions.hydrate(api)
    }, [])

    // In-flight install/uninstall ids. Both as Sets so concurrent
    // operations on different rows don't clobber each other — same
    // pattern the SearchCard uses for save buttons.
    const [installingIds, setInstallingIds] = useState<Set<string>>(() => new Set())
    const [uninstallingIds, setUninstallingIds] = useState<Set<string>>(() => new Set())
    const [installError, setInstallError] = useState<string | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    const handleStubInstall = async (region: RegionDefinition) => {
      // Drop redundant clicks while this region's install is in
      // flight. Button below is also `disabled` while installing;
      // both checks defend against synthesized click events.
      if (installingIds.has(region.id)) return
      setInstallingIds((prev) => new Set(prev).add(region.id))
      setInstallError(null)
      try {
        await installStubRegion(api, region)
        await regions.refreshInstalled(api)
        setPickerOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        api.log.warn(`stub-install: ${region.id} failed`, err)
        setInstallError(`${region.displayName}: ${message}`)
      } finally {
        setInstallingIds((prev) => {
          const next = new Set(prev)
          next.delete(region.id)
          return next
        })
      }
    }

    const handleUninstall = async (meta: RegionMeta) => {
      if (uninstallingIds.has(meta.regionId)) return
      setUninstallingIds((prev) => new Set(prev).add(meta.regionId))
      try {
        await uninstallStubRegion(api, meta.regionId)
        await regions.refreshInstalled(api)
      } catch (err) {
        api.log.warn(`stub-uninstall: ${meta.regionId} failed`, err)
      } finally {
        setUninstallingIds((prev) => {
          const next = new Set(prev)
          next.delete(meta.regionId)
          return next
        })
      }
    }

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
                isUninstalling={uninstallingIds.has(meta.regionId)}
                onActivate={() => void regions.setActive(api, meta.regionId)}
                onUninstall={() => void handleUninstall(meta)}
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
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {installError ? (
            <div
              role="alert"
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--kmaps-r-sm)',
                background: 'rgb(var(--kmaps-danger) / 0.08)',
                color: 'rgb(var(--kmaps-danger))',
                fontSize: 12,
              }}
            >
              {installError}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span
              style={{ fontSize: 12, color: 'rgb(var(--kmaps-fg-muted))' }}
            >
              Dev: stub install writes meta.json + an empty places.db.
              Real install pipeline lands in slice 6b.
            </span>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button type="button">
                  {Download ? <Download className="w-4 h-4" /> : null}
                  <span style={{ marginLeft: 6 }}>Install a region</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="kmaps-scope"
                style={{ width: 360, maxHeight: 420, padding: 0 }}
              >
                <RegionPicker
                  installingIds={installingIds}
                  installedIds={
                    new Set(regions.installed.map((r) => r.regionId))
                  }
                  onPick={handleStubInstall}
                  Input={Input}
                  Search={Search}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    )
  }

  return RegionManagerUi
}

interface RegionPickerProps {
  installingIds: Set<string>
  installedIds: Set<string>
  onPick: (region: RegionDefinition) => void
  Input: FC<any>
  Search?: FC<{ className?: string; style?: object }>
}

const RegionPicker: FC<RegionPickerProps> = ({
  installingIds,
  installedIds,
  onPick,
  Input,
  Search,
}) => {
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  // Filter the 76-entry STARTER_REGIONS by displayName + id. Done
  // inline (no useGeocoder) — the manifest is small enough that
  // filtering on every keystroke is fine.
  const filtered = useMemo(() => {
    if (!trimmed) return STARTER_REGIONS
    return STARTER_REGIONS.filter(
      (r) =>
        r.displayName.toLowerCase().includes(trimmed) ||
        r.id.toLowerCase().includes(trimmed),
    )
  }, [trimmed])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          padding: 10,
          borderBottom: '1px solid rgb(var(--kmaps-hairline))',
          position: 'relative',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: '50%',
            left: 18,
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setQuery(e.target.value)
          }
          placeholder="Search regions"
          aria-label="Filter regions"
          autoFocus
          style={{ paddingLeft: 34 }}
        />
      </div>
      <ul
        aria-label="Regions"
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          overflowY: 'auto',
          maxHeight: 340,
        }}
      >
        {filtered.length === 0 ? (
          <li
            role="status"
            aria-live="polite"
            style={{
              padding: '12px 14px',
              fontSize: 12,
              color: 'rgb(var(--kmaps-fg-muted))',
            }}
          >
            No matches
          </li>
        ) : (
          filtered.map((r) => {
            const installing = installingIds.has(r.id)
            const alreadyInstalled = installedIds.has(r.id)
            const disabled = installing || alreadyInstalled
            return (
              <li key={r.id} style={{ display: 'block' }}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  disabled={disabled}
                  aria-busy={installing || undefined}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 14px',
                    background: 'transparent',
                    border: 'none',
                    color: alreadyInstalled
                      ? 'rgb(var(--kmaps-fg-faint))'
                      : 'inherit',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    font: 'inherit',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled) {
                      e.currentTarget.style.background =
                        'rgb(var(--kmaps-fg) / 0.05)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {r.displayName}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgb(var(--kmaps-fg-muted))',
                      fontFamily: 'var(--kmaps-font-mono)',
                    }}
                  >
                    {alreadyInstalled
                      ? 'Installed'
                      : installing
                      ? 'Installing…'
                      : r.id}
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

interface RegionRowProps {
  meta: RegionMeta
  isActive: boolean
  isUninstalling: boolean
  onActivate: () => void
  onUninstall: () => void
  CheckCircle2?: FC<{ className?: string; style?: object }>
  Circle?: FC<{ className?: string; style?: object }>
  Trash2?: FC<{ className?: string; style?: object }>
  AlertCircle?: FC<{ className?: string; style?: object }>
}

const RegionRow: FC<RegionRowProps> = ({
  meta,
  isActive,
  isUninstalling,
  onActivate,
  onUninstall,
  CheckCircle2,
  Circle,
  Trash2,
  AlertCircle,
}) => {
  // Only stub installs (marker: valhallaVersion === 'stub') can be
  // deleted in v3.0 — uninstallStubRegion just removes meta.json
  // + the empty places.db. Real regions (slice 6b) write multi-GB
  // tiles + PMTiles that don't have a corresponding install path
  // yet, so a one-way delete would be regret-inducing. Tooltip
  // explains.
  const isStub = meta.valhallaVersion === 'stub'
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
          {meta.oaRowCount != null ? (
            // `!= null` rather than truthy so `oaRowCount = 0` (an
            // import that ran but produced zero rows) renders as
            // "0 addresses" instead of falling through to the
            // missing-import warning. The distinguishing signal is
            // `oaImportedAt`, not the count.
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
        onClick={isStub && !isUninstalling ? onUninstall : undefined}
        disabled={!isStub || isUninstalling}
        aria-disabled={!isStub || isUninstalling || undefined}
        aria-busy={isUninstalling || undefined}
        aria-label={`Delete ${meta.regionId}`}
        title={
          isStub
            ? isUninstalling
              ? 'Uninstalling…'
              : 'Remove stub region (meta.json + empty places.db)'
            : 'Delete arrives in slice 6b for real regions (paired with the install pipeline)'
        }
        style={{
          width: 28,
          height: 28,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: isStub
            ? isUninstalling
              ? 'rgb(var(--kmaps-fg-faint))'
              : 'rgb(var(--kmaps-fg-muted))'
            : 'rgb(var(--kmaps-fg-faint))',
          cursor: !isStub || isUninstalling ? 'not-allowed' : 'pointer',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--kmaps-r-sm)',
          opacity: isUninstalling ? 0.4 : 1,
        }}
        onMouseEnter={(e) => {
          if (isStub && !isUninstalling) {
            e.currentTarget.style.color = 'rgb(var(--kmaps-danger))'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = isStub
            ? 'rgb(var(--kmaps-fg-muted))'
            : 'rgb(var(--kmaps-fg-faint))'
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

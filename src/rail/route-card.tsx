/**
 * Route card — explicit from/to inputs with swap + recalc.
 *
 * Replaces the implicit "from = active region's bbox center" wiring
 * in slice 3c by giving the user a visible affordance to set the
 * origin, swap endpoints, and re-trigger calculation (e.g. after a
 * profile change in Layers).
 *
 * Layout (Apple/Google Maps shape):
 *
 *   ┌──────────────────────────────┐  ┌─┐
 *   │ 📍 From: Region center        │  │⇅│
 *   └──────────────────────────────┘  │ │
 *   ┌──────────────────────────────┐  │ │
 *   │ 📌 To:   Pike Place Market    │  │ │
 *   └──────────────────────────────┘  └─┘
 *   [Use my location · disabled]
 *   [ Recalculate route ]
 *
 * Editing model:
 *   - One useGeocoder hook drives the suggestions panel, parameterised
 *     by whichever field is currently being edited.
 *   - Click an input → that field becomes editable, draft initialised
 *     to the current name. Type → suggestions populate. Click a
 *     suggestion → commit + close. Click outside the card → revert.
 *   - Focus-within tracking (relatedTarget check on blur) avoids the
 *     blur-vs-click-on-suggestion race without setTimeout.
 *
 * "Use my location" is a v3.1 GPS feature — present as a disabled
 * affordance so the surface is discoverable, with a tooltip pointing
 * to the release.
 */

import { useRef, useState } from 'react'
import type { FC } from 'react'
import type { SharedDependencies, PluginAPI } from '@/types'
import { useGeocoder } from '@/hooks/use-geocoder'
import type { PlaceResult, PlaceCategory } from '@/geocoder/types'
import type { SearchSuggestion } from '@/rail/search-card'

export interface RouteFromPoint {
  name: string
  lat: number
  lon: number
}

export interface RouteCardProps {
  api: PluginAPI
  /** Drives which region's `places.db` the suggestions hook opens. */
  regionId: string | null
  /** Resolved "from" point (explicit user-set value or the implicit
   *  region-center default). Always rendered in the From input. */
  from: RouteFromPoint | null
  /** Resolved "to" point — mirrors `route.preview?.destination`. */
  to: SearchSuggestion | null
  /** True when `from` represents an explicit user choice; false when
   *  it's the implicit region-center fallback. Drives the placeholder
   *  copy and the visibility of the clear affordance. */
  fromIsExplicit: boolean
  /** Set the From endpoint. Pass null to return to the region-center
   *  default. */
  onChangeFrom: (point: RouteFromPoint | null) => void
  /** Set the To endpoint. */
  onChangeTo: (dest: SearchSuggestion) => void
  /** Swap From and To, then recalculate. The composing component
   *  knows how to translate the current `to` (which is a
   *  SearchSuggestion) and `from` (a RouteFromPoint) so this card
   *  doesn't have to reason about the asymmetric shapes. */
  onSwap: () => void
  /** Re-trigger `route.setPreview` with the current From + To. */
  onRecalc: () => void
}

export function createRouteCard(Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Input } = shadcn
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Navigation, MapPin, Home, Building, Route, ArrowUpDown, RefreshCw, Crosshair } = icons

  function iconFor(category: PlaceCategory): FC<{ className?: string; style?: object }> | null {
    switch (category) {
      case 'address':
        return Home ?? MapPin ?? null
      case 'poi':
        return Building ?? MapPin ?? null
      case 'road':
        return Route ?? MapPin ?? null
      default:
        return MapPin ?? null
    }
  }

  interface EndpointFieldProps {
    label: string
    value: string
    placeholder: string
    isEditing: boolean
    iconWhenIdle?: FC<{ className?: string; style?: object }>
    ariaLabel: string
    onFocus: () => void
    onChange: (v: string) => void
    onClear?: () => void
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
    style?: React.CSSProperties
  }

  // Inner row component for From + To. Closes over `Input` (host
  // shadcn primitive) so it doesn't need to re-resolve on every
  // render. Lives inside the factory rather than at module top level
  // because it depends on the per-activate `Shared.shadcn` snapshot.
  const EndpointField: FC<EndpointFieldProps> = ({
    label,
    value,
    placeholder,
    isEditing,
    iconWhenIdle,
    ariaLabel,
    onFocus,
    onChange,
    onClear,
    onKeyDown,
    style,
  }) => {
    const Icon = iconWhenIdle
    return (
      <div style={{ position: 'relative', ...style }}>
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
          {Icon ? <Icon className="w-4 h-4" /> : null}
        </div>
        <Input
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onFocus={onFocus}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          style={{
            paddingLeft: 34,
            paddingRight: onClear ? 32 : 10,
            fontWeight: isEditing ? 400 : 500,
          }}
        />
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            title="Reset to region center"
            style={{
              position: 'absolute',
              top: '50%',
              right: 4,
              transform: 'translateY(-50%)',
              width: 24,
              height: 24,
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'rgb(var(--kmaps-fg-muted))',
              cursor: 'pointer',
              borderRadius: 'var(--kmaps-r-sm)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    )
  }

  const RouteCard: FC<RouteCardProps> = ({
    api,
    regionId,
    from,
    to,
    fromIsExplicit,
    onChangeFrom,
    onChangeTo,
    onSwap,
    onRecalc,
  }) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    // Which field is currently being edited. While editing, the input
    // displays `draft` (live query string) and the suggestions panel
    // is mounted under the inputs. `null` = not editing, inputs show
    // their resolved value via `from?.name` / `to?.name`.
    const [editingField, setEditingField] = useState<'from' | 'to' | null>(null)
    const [fromDraft, setFromDraft] = useState('')
    const [toDraft, setToDraft] = useState('')

    // Active query for useGeocoder — populated only when editing, so
    // a closed card doesn't run unnecessary FTS queries.
    const activeDraft =
      editingField === 'from' ? fromDraft : editingField === 'to' ? toDraft : ''
    const { results, loading, error } = useGeocoder({
      api,
      regionId,
      query: activeDraft,
    })

    const startEditing = (field: 'from' | 'to') => {
      setEditingField(field)
      if (field === 'from') {
        // Seed the draft with the current name so the user can edit-
        // in-place rather than retype. If the from is the implicit
        // region-center default, start empty so the user isn't
        // editing a placeholder string.
        setFromDraft(fromIsExplicit ? from?.name ?? '' : '')
      } else {
        setToDraft(to?.name ?? '')
      }
    }

    const commitFrom = (r: PlaceResult) => {
      onChangeFrom({ name: r.name, lat: r.latitude, lon: r.longitude })
      setEditingField(null)
      setFromDraft('')
    }

    const commitTo = (r: PlaceResult) => {
      onChangeTo({
        id: stableId(r),
        name: r.name,
        subtitle: r.subtitle,
        lat: r.latitude,
        lon: r.longitude,
      })
      setEditingField(null)
      setToDraft('')
    }

    const cancelEditing = () => {
      setEditingField(null)
      setFromDraft('')
      setToDraft('')
    }

    // Focus-within blur detection. When focus leaves the card entirely
    // (relatedTarget is not inside the container), cancel any in-flight
    // edit. Clicks on suggestion buttons keep relatedTarget inside the
    // container so they fire `commitX` before this teardown.
    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null
      if (next && containerRef.current && containerRef.current.contains(next)) {
        return
      }
      cancelEditing()
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditing()
        e.currentTarget.blur()
      } else if (e.key === 'Enter' && results.length > 0) {
        // Commit the first suggestion. Standard keyboard search UX —
        // type, then Enter to pick the top match without reaching for
        // the mouse. Only fires when there's something to commit so
        // an empty Enter doesn't accidentally swap state.
        e.preventDefault()
        const first = results[0]
        if (editingField === 'from') commitFrom(first)
        else if (editingField === 'to') commitTo(first)
      }
    }

    const fromValue = editingField === 'from' ? fromDraft : from?.name ?? ''
    const toValue = editingField === 'to' ? toDraft : to?.name ?? ''
    const fromPlaceholder = fromIsExplicit ? '' : 'Region center'
    const canSwap = from !== null && to !== null
    const canRecalc = from !== null && to !== null
    // Show the "Clear from" affordance only when the from is an
    // explicit override — clicking it returns to the region-center
    // default. Hidden in the implicit case since there's nothing to
    // clear.
    const showClearFrom = fromIsExplicit

    return (
      <div
        ref={containerRef}
        onBlur={handleBlur}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gridTemplateRows: 'auto auto',
            columnGap: 8,
            rowGap: 6,
            alignItems: 'stretch',
          }}
        >
          <EndpointField
            label="From"
            value={fromValue}
            placeholder={fromPlaceholder}
            isEditing={editingField === 'from'}
            iconWhenIdle={Navigation}
            ariaLabel="Origin"
            onFocus={() => startEditing('from')}
            onChange={setFromDraft}
            onClear={showClearFrom ? () => onChangeFrom(null) : undefined}
            onKeyDown={handleKeyDown}
            style={{ gridRow: 1, gridColumn: 1 }}
          />
          <EndpointField
            label="To"
            value={toValue}
            placeholder="Tap to search"
            isEditing={editingField === 'to'}
            iconWhenIdle={MapPin}
            ariaLabel="Destination"
            onFocus={() => startEditing('to')}
            onChange={setToDraft}
            onKeyDown={handleKeyDown}
            style={{ gridRow: 2, gridColumn: 1 }}
          />
          <button
            type="button"
            onClick={onSwap}
            disabled={!canSwap}
            aria-label="Swap from and to"
            title="Swap from and to"
            style={{
              gridRow: '1 / -1',
              gridColumn: 2,
              width: 36,
              padding: 0,
              borderRadius: 'var(--kmaps-r-sm)',
              border: '1px solid rgb(var(--kmaps-hairline))',
              background: 'transparent',
              color: canSwap
                ? 'rgb(var(--kmaps-fg))'
                : 'rgb(var(--kmaps-fg-faint))',
              cursor: canSwap ? 'pointer' : 'not-allowed',
              display: 'grid',
              placeItems: 'center',
              transition: 'background var(--kmaps-dur-quick) ease',
            }}
            onMouseEnter={(e) => {
              if (canSwap) {
                e.currentTarget.style.background = 'rgb(var(--kmaps-fg) / 0.06)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {ArrowUpDown ? <ArrowUpDown className="w-4 h-4" /> : null}
          </button>
        </div>

        {editingField !== null ? (
          <ResultsPanel
            results={results}
            loading={loading}
            error={error}
            iconFor={iconFor}
            onSelect={editingField === 'from' ? commitFrom : commitTo}
          />
        ) : null}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Live location lands in v3.1 (GPS provider integration)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 999,
              fontSize: 11,
              border: 'none',
              background: 'rgb(var(--kmaps-fg) / 0.05)',
              color: 'rgb(var(--kmaps-fg-faint))',
              cursor: 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            {Crosshair ? <Crosshair className="w-3 h-3" /> : null}
            Use my location
          </button>
        </div>

        <button
          type="button"
          onClick={onRecalc}
          disabled={!canRecalc}
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--kmaps-r-sm)',
            border: 'none',
            background: canRecalc
              ? 'rgb(var(--kmaps-accent))'
              : 'rgb(var(--kmaps-fg) / 0.08)',
            color: canRecalc
              ? 'rgb(var(--kmaps-accent-ink))'
              : 'rgb(var(--kmaps-fg-faint))',
            cursor: canRecalc ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {RefreshCw ? <RefreshCw className="w-4 h-4" /> : null}
          Recalculate route
        </button>
      </div>
    )
  }

  return RouteCard
}

interface ResultsPanelProps {
  results: PlaceResult[]
  loading: boolean
  error: string | null
  iconFor: (c: PlaceCategory) => FC<{ className?: string; style?: object }> | null
  onSelect: (r: PlaceResult) => void
}

const ResultsPanel: FC<ResultsPanelProps> = ({ results, loading, error, iconFor, onSelect }) => {
  if (error) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          borderRadius: 'var(--kmaps-r-sm)',
          background: 'rgb(var(--kmaps-danger) / 0.08)',
          padding: '6px 10px',
          color: 'rgb(var(--kmaps-danger))',
          fontSize: 12,
        }}
      >
        {error}
      </div>
    )
  }

  if (loading) {
    return (
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
        Searching…
      </div>
    )
  }

  if (results.length === 0) {
    return (
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
        Type to search
      </div>
    )
  }

  return (
    <ul
      aria-label="Suggestions"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxHeight: 240,
        overflowY: 'auto',
      }}
    >
      {results.map((r) => {
        const id = stableId(r)
        const Icon = iconFor(r.category)
        return (
          <li key={id} style={{ display: 'block' }}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                width: '100%',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--kmaps-r-sm)',
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgb(var(--kmaps-fg) / 0.06)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              onFocus={(e) => {
                e.currentTarget.style.background = 'rgb(var(--kmaps-fg) / 0.06)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span aria-hidden style={{ display: 'grid', placeItems: 'center' }}>
                {Icon ? (
                  <Icon
                    className="w-4 h-4"
                    style={{ color: 'rgb(var(--kmaps-fg-muted))' }}
                  />
                ) : null}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </span>
                {r.subtitle ? (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgb(var(--kmaps-fg-muted))',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.subtitle}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function stableId(r: PlaceResult): string {
  return `${r.source}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}:${r.name}`
}

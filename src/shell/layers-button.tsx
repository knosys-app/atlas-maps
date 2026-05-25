/**
 * Top-right Layers / Settings button.
 *
 * Maps-domain content (vs. flight-planner's airports/navaids/airspace +
 * obstacle DB management):
 *   - Routing profile picker: Auto / Bicycle / Pedestrian
 *   - Map style picker: Light / Dark / Auto
 *   - Distance units: mi / km
 *   - (later slices) Voice on/off, GPS source picker
 *
 * Structure ported from `/tmp/flight-planner/src/components/shell/
 * layers-button.tsx` — same `createLayersButton(Shared)` factory, same
 * popover surface, same row layout. Just different rows.
 */

import type { FC } from 'react'
import type { SharedDependencies } from '@/types'
import type {
  DistanceUnits,
  MapStyle,
  MapsSettings,
  RoutingProfile,
} from '@/store/settings-store'

export interface LayersButtonProps {
  settings: MapsSettings
  onSettingsChange: (patch: Partial<MapsSettings>) => Promise<void> | void
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

const PROFILE_OPTIONS: Array<SegmentedOption<RoutingProfile>> = [
  { value: 'auto', label: 'Driving' },
  { value: 'bicycle', label: 'Cycling' },
  { value: 'pedestrian', label: 'Walking' },
]

const STYLE_OPTIONS: Array<SegmentedOption<MapStyle>> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
]

const UNITS_OPTIONS: Array<SegmentedOption<DistanceUnits>> = [
  { value: 'miles', label: 'mi' },
  { value: 'kilometers', label: 'km' },
]

export function createLayersButton(Shared: SharedDependencies) {
  const shadcn = Shared.shadcn as Record<string, FC<any>>
  const { Popover, PopoverContent, PopoverTrigger } = shadcn
  const { Layers } = Shared.lucideIcons

  function Segmented<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<SegmentedOption<T>>
    value: T
    onChange: (next: T) => void
    ariaLabel: string
  }): JSX.Element {
    return (
      <div
        className="kmaps-segmented"
        role="radiogroup"
        aria-label={ariaLabel}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={opt.value === value}
            data-active={opt.value === value ? 'true' : 'false'}
            className="kmaps-segmented-option"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  const LayersButton: FC<LayersButtonProps> = ({ settings, onSettingsChange }) => {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Map settings"
            className="kmaps-layers-btn kmaps-surface-thick"
          >
            {Layers ? <Layers className="w-5 h-5" /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="kmaps-surface-thick kmaps-layers-menu kmaps-scope"
          style={{ padding: 6 }}
        >
          <div className="kmaps-label-caps" style={{ padding: '6px 12px 6px' }}>
            Routing
          </div>
          <div style={{ padding: '0 8px 6px' }}>
            <Segmented
              options={PROFILE_OPTIONS}
              value={settings.profile}
              onChange={(next) => void onSettingsChange({ profile: next })}
              ariaLabel="Routing profile"
            />
          </div>

          <div
            style={{
              borderTop: '1px solid rgb(var(--kmaps-hairline))',
              margin: '6px 8px',
            }}
          />

          <div className="kmaps-label-caps" style={{ padding: '6px 12px 6px' }}>
            Map style
          </div>
          <div style={{ padding: '0 8px 6px' }}>
            <Segmented
              options={STYLE_OPTIONS}
              value={settings.mapStyle}
              onChange={(next) => void onSettingsChange({ mapStyle: next })}
              ariaLabel="Map style"
            />
          </div>

          <div
            style={{
              borderTop: '1px solid rgb(var(--kmaps-hairline))',
              margin: '6px 8px',
            }}
          />

          <div className="kmaps-label-caps" style={{ padding: '6px 12px 6px' }}>
            Units
          </div>
          <div style={{ padding: '0 8px 8px' }}>
            <Segmented
              options={UNITS_OPTIONS}
              value={settings.units}
              onChange={(next) => void onSettingsChange({ units: next })}
              ariaLabel="Distance units"
            />
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  return LayersButton
}

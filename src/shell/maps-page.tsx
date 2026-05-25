/**
 * MapsPage — top-level component the host mounts at `/maps`.
 *
 * Composes the shell layout: full-bleed map placeholder + chrome overlay
 * (Plan Pill top-center, Layers button top-right). Rail (search /
 * briefing / saved / recents) and Sheet (Steps tab + others) land in
 * follow-on slices.
 *
 * This is a factory because Plan Pill / Layers Button need the host-
 * injected `SharedDependencies` (shadcn primitives + lucide icons). The
 * factory closure freezes those at activate time; the returned
 * `MapsPage` is the actual component the route mounts.
 */

import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import type { PluginAPI, SharedDependencies } from '@/types'
import { STARTER_REGION_COUNT } from '@/data/regions'
import { installEngineIfMissing } from '@/routing/engine'
import { useSettingsStore } from '@/store/settings-store'
import { MapsShell } from './maps-shell'
import { createPlanPill } from './plan-pill'
import { createLayersButton } from './layers-button'

export function createMapsPage(
  api: PluginAPI,
  Shared: SharedDependencies,
): ComponentType<unknown> {
  const PlanPill = createPlanPill(Shared)
  const LayersButton = createLayersButton(Shared)

  const MapsPage: ComponentType<unknown> = () => {
    const settings = useSettingsStore()
    const [engineReady, setEngineReady] = useState<boolean | null>(null)
    const [engineError, setEngineError] = useState<string | null>(null)
    const [enginePhase, setEnginePhase] = useState<string>('')

    // Hydrate persisted settings on mount. The store guards against
    // double-hydration, so a fast re-render won't refire the IPC.
    useEffect(() => {
      void settings.hydrate(api)
    }, [])

    // Pre-warm the routing engine. Non-fatal failure — the user can still
    // browse the chrome, just can't route until binaries are available.
    useEffect(() => {
      let cancelled = false
      ;(async () => {
        try {
          await installEngineIfMissing(api, (phase, _percent, message) => {
            if (cancelled) return
            setEnginePhase(message ? `${phase}: ${message}` : phase)
          })
          if (!cancelled) setEngineReady(true)
        } catch (err) {
          if (cancelled) return
          setEngineReady(false)
          setEngineError((err as Error).message)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [])

    const onSettingsChange = (patch: Partial<typeof settings>) =>
      settings.update(api, patch)

    // The map slot stays a placeholder until the MapLibre viewer lands in
    // the next slice. The placeholder uses a soft gradient so the chrome
    // overlays are still visible against something other than pure
    // background — easier to tune spacing during the port.
    const mapPlaceholder = (
      <div
        className="kmaps-map-container"
        style={{
          background:
            'radial-gradient(120% 100% at 20% 0%, rgb(var(--kmaps-accent) / 0.12), transparent 60%), rgb(var(--kmaps-surface-tint) / 0.4)',
        }}
        aria-label="Map (renders here once the viewer slice lands)"
      >
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            color: 'rgb(var(--kmaps-fg-muted))',
            fontFamily: 'var(--kmaps-font-mono)',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          <div>
            <strong style={{ color: 'rgb(var(--kmaps-fg))' }}>
              {STARTER_REGION_COUNT}
            </strong>{' '}
            regions available
          </div>
          {engineReady === null ? <div>engine: {enginePhase || 'checking…'}</div> : null}
          {engineReady === true ? (
            <div style={{ color: 'rgb(var(--kmaps-success))' }}>
              engine: ready
            </div>
          ) : null}
          {engineReady === false ? (
            <div style={{ color: 'rgb(var(--kmaps-danger))' }}>
              engine: {engineError ?? 'unavailable'}
            </div>
          ) : null}
          <div style={{ opacity: 0.7 }}>
            map viewer + PMTiles render here (next slice)
          </div>
        </div>
      </div>
    )

    return (
      <MapsShell map={mapPlaceholder}>
        <PlanPill
          preview={null}
          onSearchClick={() => {
            // Rail isn't built yet; this is a no-op until the search card
            // lands. Logging gives us a confirmation hook during smoke.
            api.log.info('PlanPill search clicked (rail not yet wired)')
          }}
          onClearRoute={() => {
            // No route to clear yet.
          }}
        />
        <LayersButton
          settings={{
            profile: settings.profile,
            mapStyle: settings.mapStyle,
            units: settings.units,
          }}
          onSettingsChange={onSettingsChange}
        />
      </MapsShell>
    )
  }

  return MapsPage
}

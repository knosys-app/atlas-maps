/**
 * MapsPage — top-level component the host mounts at `/maps`.
 *
 * Composes the shell layout: full-bleed MapLibre canvas (or the
 * "install a region" empty state) + chrome overlay (Plan Pill top-
 * center, Layers button top-right). Rail (search / briefing / saved /
 * recents) and Sheet (Steps tab + others) land in follow-on slices.
 *
 * This is a factory because Plan Pill / Layers Button / Empty State
 * need the host-injected `SharedDependencies` (shadcn primitives +
 * lucide icons). The factory closure freezes those at activate time;
 * the returned `MapsPage` is the actual component the route mounts.
 *
 * Active-region wiring is deferred to slice 6 (region orchestrator).
 * For now `pmtilesUrl` is always `null` so the MapViewer mounts the
 * MapLibre canvas with an empty style and `EmptyState` is overlaid on
 * top with the install-a-region CTA.
 */

import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import type { PluginAPI, SharedDependencies } from '@/types'
import { installEngineIfMissing } from '@/routing/engine'
import { useSettingsStore, type MapsSettings } from '@/store/settings-store'
import { MapViewer } from '@/map/map-viewer'
import { createEmptyState } from '@/map/empty-state'
import { createRouteRail } from '@/rail/route-rail'
import { createSearchCard } from '@/rail/search-card'
import { createRecentsCard, type RecentRoute } from '@/rail/recents-card'
import { createBriefingCard, type BriefingPreview } from '@/rail/briefing-card'
import { createSavedCard } from '@/rail/saved-card'
import { useSavedStore } from '@/store/saved-store'
import { MapsSheet, type SheetDetent, type SheetTab } from '@/sheet/maps-sheet'
import { createStepsTab, type RouteStep } from '@/sheet/steps-tab'
import { createProfileTab } from '@/sheet/profile-tab'
import { MapsShell } from './maps-shell'
import { createPlanPill } from './plan-pill'
import { createLayersButton } from './layers-button'

export function createMapsPage(
  api: PluginAPI,
  Shared: SharedDependencies,
): ComponentType<unknown> {
  const PlanPill = createPlanPill(Shared)
  const LayersButton = createLayersButton(Shared)
  const EmptyState = createEmptyState(Shared)
  const { RouteRail, RailSection } = createRouteRail(Shared)
  const SearchCard = createSearchCard(Shared)
  const RecentsCard = createRecentsCard(Shared)
  const BriefingCard = createBriefingCard(Shared)
  const SavedCard = createSavedCard(Shared)
  const StepsTab = createStepsTab(Shared)
  const ProfileTab = createProfileTab(Shared)

  const MapsPage: ComponentType<unknown> = () => {
    const settings = useSettingsStore()
    // Region state stub until slice 6 wires real region detection.
    // Holding it here means the slice 6 change is local to MapsPage.
    const [activeRegionId] = useState<string | null>(null)
    const [pmtilesUrl] = useState<string | null>(null)
    // Engine pre-warm status lives in refs rather than React state
    // because nothing in the render body currently reads it — using
    // state would schedule a re-render of MapsPage (and therefore
    // MapViewer / EmptyState / the chrome) on every progress event
    // for no UI benefit. Once an engine-status UI lands these can
    // convert to state and drive whichever component displays them.
    const engineReadyRef = useRef<boolean | null>(null)
    const engineErrorRef = useRef<string | null>(null)
    const enginePhaseRef = useRef<string>('')

    const saved = useSavedStore()

    // Hydrate persisted settings + saved destinations on mount. Each
    // store guards against double-hydration so a fast re-render won't
    // refire the underlying IPC.
    useEffect(() => {
      void settings.hydrate(api)
      void saved.hydrate(api)
    }, [])

    // Pre-warm the routing engine. Non-fatal failure — the user can
    // still browse the chrome / empty state, just can't route until
    // binaries are available.
    useEffect(() => {
      let cancelled = false
      ;(async () => {
        try {
          await installEngineIfMissing(api, (phase, _percent, message) => {
            if (cancelled) return
            enginePhaseRef.current = message ? `${phase}: ${message}` : phase
          })
          if (!cancelled) engineReadyRef.current = true
        } catch (err) {
          if (cancelled) return
          engineReadyRef.current = false
          engineErrorRef.current = (err as Error).message
        }
      })()
      return () => {
        cancelled = true
      }
    }, [])

    // Narrowing to `Partial<MapsSettings>` (not `Partial<typeof settings>`)
    // — the bound store object also carries `hydrated` / `hydrate` /
    // `update`, which are not valid update patches.
    const onSettingsChange = (patch: Partial<MapsSettings>) =>
      settings.update(api, patch)

    const handleInstallRegion = () => {
      // Settings → Regions panel doesn't exist yet (lands with slice 6).
      // Log so the click is observable during smoke testing.
      api.log.info('EmptyState install-region click (regions panel not yet wired)')
    }

    // Compose the map layer. The MapViewer mounts MapLibre with the
    // active region's PMTiles (null until slice 6). The EmptyState
    // overlays the canvas whenever no region is active — covers both
    // the fresh-install case and the "all regions deleted" case.
    const mapLayer = (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <MapViewer api={api} regionId={activeRegionId} pmtilesUrl={pmtilesUrl} />
        {activeRegionId === null ? (
          <EmptyState onInstallRegion={handleInstallRegion} />
        ) : null}
      </div>
    )

    // Route preview is null until slice 3+ wires real routing — Briefing
    // returns null on null preview, so the rail starts with Search +
    // Recents only. Recents will populate from history-store in a
    // follow-on slice.
    const briefingPreview: BriefingPreview | null = null
    const recents: RecentRoute[] = []
    const hasActiveRegion = activeRegionId !== null

    // Sheet state. Controlled component, lives here so a future
    // "Open Steps on route preview" effect can call `setSheetDetent`
    // / `setSheetTab` directly. Initial detent is `peek` so the sheet
    // starts collapsed and the user opts in by dragging or tapping
    // the handle.
    const [sheetDetent, setSheetDetent] = useState<SheetDetent>('peek')
    const [sheetTab, setSheetTab] = useState<SheetTab>('steps')
    // Step list comes from the parsed route. Null = no route, so the
    // Steps tab shows its "Plan a route…" empty state. Slice 3c wires
    // the route parser into this state.
    const routeSteps: RouteStep[] | null = null

    return (
      <MapsShell map={mapLayer}>
        <PlanPill
          preview={null}
          onSearchClick={() => {
            // No-op: search input lives in the rail's SearchCard now.
            // Future v3.1+ may auto-focus that input from here.
            api.log.info('PlanPill search clicked')
          }}
          onClearRoute={() => {
            // No route to clear yet.
          }}
        />

        {/* Rail + Sheet hidden until at least one region is installed.
         *  The empty state owns the screen pre-install (Apple Maps
         *  progressive-reveal pattern); rail + sheet appear once the
         *  user has a region they can search / route against. */}
        {hasActiveRegion ? (
          <>
            <RouteRail>
              <BriefingCard preview={briefingPreview} />
              <RailSection title="Search">
                <SearchCard
                  api={api}
                  regionId={activeRegionId}
                  onSelectDestination={(s) => {
                    // Slice 3c will use this to set the route preview
                    // + open the sheet to half. For now log the click
                    // so the wiring is observable during smoke.
                    api.log.info(`SearchCard select: ${s.name} (${s.lat}, ${s.lon})`)
                  }}
                />
              </RailSection>
              <RailSection title="Saved">
                <SavedCard
                  destinations={saved.destinations}
                  onReorder={(from, to) => void saved.reorder(api, from, to)}
                  onRemove={(id) => void saved.remove(api, id)}
                />
              </RailSection>
              <RailSection title="Recents">
                <RecentsCard recents={recents} />
              </RailSection>
            </RouteRail>

            <MapsSheet
              detent={sheetDetent}
              onDetentChange={setSheetDetent}
              tab={sheetTab}
              onTabChange={setSheetTab}
              steps={<StepsTab steps={routeSteps} />}
              profile={<ProfileTab />}
            />
          </>
        ) : null}

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

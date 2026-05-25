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
import { useRouteStore } from '@/store/route-store'
import { STARTER_REGIONS } from '@/data/regions'
import { toDisplayStep } from '@/routing/step-display'
import type { RouteProfile } from '@/routing/types'
import { formatDistance, type DistanceUnit } from '@/utils/format-units'
import { formatDuration } from '@/utils/format-duration'
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
    const route = useRouteStore()

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

    const recents: RecentRoute[] = []
    const hasActiveRegion = activeRegionId !== null

    // Sheet state. Controlled component, lives here so route previews
    // can programmatically open the sheet via `setSheetDetent`.
    // Initial detent is `peek` so the sheet starts collapsed and the
    // user opts in by dragging the handle until a route preview lands.
    const [sheetDetent, setSheetDetent] = useState<SheetDetent>('peek')
    const [sheetTab, setSheetTab] = useState<SheetTab>('steps')

    // Format helpers bound to the active settings. The Briefing card
    // + Steps tab consume pre-formatted strings rather than raw
    // metres/seconds so the rail never sees unit-conversion logic.
    const distanceUnit: DistanceUnit = settings.units === 'kilometers' ? 'km' : 'mi'
    const fmtDistance = (m: number) => formatDistance(m, distanceUnit)
    const fmtDuration = (s: number) => formatDuration(s)

    // Map the routing-side `RouteData` into the UI-facing shapes the
    // rail + sheet expect. `route.preview?.route` is null while the
    // route calculates — Briefing returns null in that state, the Plan
    // Pill still shows the destination name, and Steps falls back to
    // its empty state.
    const routeData = route.preview?.route ?? null
    const briefingPreview: BriefingPreview | null = routeData
      ? {
          destinationName: route.preview!.destination.name,
          distanceLabel: fmtDistance(routeData.distance),
          durationLabel: fmtDuration(routeData.duration),
          profileLabel: profileLabel(settings.profile),
        }
      : null
    const routeSteps: RouteStep[] | null = routeData
      ? routeData.steps.map((s, i) => toDisplayStep(s, i, fmtDistance, fmtDuration))
      : null

    // Auto-open the sheet to `half` when a route preview lands so the
    // user can immediately see the Steps tab. Only fires on the
    // null→present transition; subsequent route updates (e.g. profile
    // change recalc) don't bounce the sheet open if the user has
    // already chosen a detent.
    const lastPreviewIdRef = useRef<string | null>(null)
    useEffect(() => {
      const previewId = route.preview?.destination.id ?? null
      if (previewId !== null && previewId !== lastPreviewIdRef.current) {
        setSheetTab('steps')
        setSheetDetent((d) => (d === 'peek' ? 'half' : d))
      }
      lastPreviewIdRef.current = previewId
    }, [route.preview?.destination.id])

    // Wire SearchCard selection → route store preview. The "from"
    // anchor is the active region's bbox center for v3.0; v3.1's GPS
    // slice will swap in the live fix.
    const handleSelectDestination = (s: import('@/rail/search-card').SearchSuggestion) => {
      if (!activeRegionId) return
      const region = STARTER_REGIONS.find((r) => r.id === activeRegionId)
      if (!region) {
        api.log.warn(`route: no region definition for ${activeRegionId}`)
        return
      }
      const [west, south, east, north] = region.bbox
      const from = { lat: (south + north) / 2, lon: (west + east) / 2 }
      const profile = settingsProfileToRoute(settings.profile)
      void route.setPreview(api, activeRegionId, from, profile, s)
    }

    return (
      <MapsShell map={mapLayer}>
        <PlanPill
          preview={
            route.preview
              ? {
                  destinationName: route.preview.destination.name,
                  // While the route is calculating (`routeData === null`)
                  // show "Calculating…" instead of distance/duration so
                  // the chip doesn't read as a stale value.
                  distanceLabel: routeData ? fmtDistance(routeData.distance) : 'Calculating…',
                  etaLabel: routeData ? fmtDuration(routeData.duration) : '',
                }
              : null
          }
          onSearchClick={() => {
            // No-op: search input lives in the rail's SearchCard now.
            // Future v3.1+ may auto-focus that input from here.
            api.log.info('PlanPill search clicked')
          }}
          onClearRoute={() => {
            route.clearPreview()
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
                  onSelectDestination={handleSelectDestination}
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

/** Map the settings store's profile name to the routing store's
 *  profile name. The settings store uses `auto` / `bicycle` /
 *  `pedestrian` (mirroring Valhalla's costing model naming); the
 *  routing layer normalises to `driving` for the same case. */
function settingsProfileToRoute(profile: MapsSettings['profile']): RouteProfile {
  switch (profile) {
    case 'bicycle':
      return 'bicycle'
    case 'pedestrian':
      return 'pedestrian'
    default:
      return 'driving'
  }
}

/** User-facing profile label for the Briefing card's chip row. */
function profileLabel(profile: MapsSettings['profile']): string {
  switch (profile) {
    case 'bicycle':
      return 'Cycling'
    case 'pedestrian':
      return 'Walking'
    default:
      return 'Driving'
  }
}

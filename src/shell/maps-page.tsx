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
import { createSearchCard, type SearchSuggestion } from '@/rail/search-card'
import { createRecentsCard, type RecentRoute } from '@/rail/recents-card'
import { createBriefingCard, type BriefingPreview } from '@/rail/briefing-card'
import { createSavedCard } from '@/rail/saved-card'
import { createRouteCard, type RouteFromPoint } from '@/rail/route-card'
import { useSavedStore } from '@/store/saved-store'
import { useRouteStore } from '@/store/route-store'
import { useRegionStore } from '@/regions/region-store'
import type { RegionMeta } from '@/regions/meta'
import { VAULT_PATHS } from '@/constants'
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
  const RouteCard = createRouteCard(Shared)
  const StepsTab = createStepsTab(Shared)
  const ProfileTab = createProfileTab(Shared)

  const MapsPage: ComponentType<unknown> = () => {
    const settings = useSettingsStore()
    const regions = useRegionStore()
    // Active region drives the rail/sheet visibility gate, which
    // region's places.db the geocoder opens, AND which PMTiles
    // archive the MapViewer renders. Sourced from the region store
    // which hydrates from the vault on mount (slice 6a) and gains
    // install/delete actions in slice 6b.
    const activeRegionId = regions.activeRegionId
    // Vault-relative path to the active region's PMTiles archive,
    // resolved by the `pmtiles://` protocol handler (slice 2b's
    // cached-pmtiles-protocol). Null when no region is active so
    // the MapViewer mounts with an empty style and EmptyState
    // overlays the canvas. The string MUST be vault-relative so the
    // host's `api.vault.readFileBytes` accepts it.
    const pmtilesUrl =
      activeRegionId !== null ? VAULT_PATHS.regionPmtiles(activeRegionId) : null
    // Engine pre-warm status lives in refs rather than React state
    // because nothing in the render body currently reads it — using
    // state would schedule a re-render of MapsPage (and therefore
    // MapViewer / EmptyState / the chrome) on every progress event
    // for no UI benefit. Once an engine-status UI lands these can
    // convert to state and drive whichever component displays them.
    const engineReadyRef = useRef<boolean | null>(null)
    const engineErrorRef = useRef<string | null>(null)
    const enginePhaseRef = useRef<string>('')

    // Track navigator.onLine so the EmptyState can drop its full-bleed
    // backdrop and let the MapViewer's online basemap show through.
    // The MapViewer manages its own onLineRef for style decisions, but
    // the EmptyState's `surface` prop needs to react on render. SSR
    // guard: treat unknown as online so first paint matches the most
    // common case.
    const [isOnline, setIsOnline] = useState<boolean>(
      typeof navigator === 'undefined' ? true : navigator.onLine,
    )
    useEffect(() => {
      if (typeof window === 'undefined') return
      const onOnline = () => setIsOnline(true)
      const onOffline = () => setIsOnline(false)
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      return () => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      }
    }, [])

    const saved = useSavedStore()
    const route = useRouteStore()

    // Hydrate persisted settings + saved destinations + installed
    // regions on mount. Each store guards against double-hydration so
    // a fast re-render won't refire the underlying IPC. The Settings
    // panel also hydrates the region store independently — whichever
    // mounts first wins, the other call no-ops.
    useEffect(() => {
      void settings.hydrate(api)
      void saved.hydrate(api)
      void regions.hydrate(api)
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
    // active region's PMTiles (null until slice 6) and the route-line
    // GeoJSON source driven by the current preview. The EmptyState
    // overlays the canvas whenever no region is active — covers both
    // the fresh-install case and the "all regions deleted" case.
    const routeGeometry = route.preview?.route?.geometry ?? null
    const mapLayer = (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <MapViewer
          api={api}
          regionId={activeRegionId}
          pmtilesUrl={pmtilesUrl}
          routeGeometry={routeGeometry}
        />
        {activeRegionId === null ? (
          <EmptyState
            onInstallRegion={handleInstallRegion}
            surface={isOnline ? 'card-only' : 'backdrop'}
          />
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

    // Explicit "from" override. When null, the resolved from defaults
    // to the active region's bbox center (the v3.0 stand-in for the
    // live GPS fix that arrives in v3.1). When set, the user has
    // chosen a specific origin via the Route card.
    const [fromOverride, setFromOverride] = useState<RouteFromPoint | null>(null)

    // Resolve the from anchor. Returns null when there's no active
    // region (and therefore no fallback center either). Memo-less —
    // this is a synchronous derivation of a couple of cheap fields,
    // and a memo would just hide the dependencies.
    const resolveFrom = (): RouteFromPoint | null => {
      if (fromOverride) return fromOverride
      return regionCenter(activeRegionId, api, regions.installed)
    }

    const resolvedFrom = resolveFrom()

    // Wire SearchCard selection → route store preview. Uses the
    // currently-resolved from (override if set, otherwise region
    // center). v3.1's GPS slice will swap the implicit fallback in
    // for the live fix.
    const handleSelectDestination = (s: SearchSuggestion) => {
      if (!activeRegionId || !resolvedFrom) return
      const profile = settingsProfileToRoute(settings.profile)
      void route.setPreview(api, activeRegionId, resolvedFrom, profile, s)
    }

    // Route card → set the explicit from override. If a destination
    // is already previewed, retrigger calculation against the new
    // origin so the user sees the route update immediately.
    const handleChangeFrom = (point: RouteFromPoint | null) => {
      setFromOverride(point)
      const dest = route.preview?.destination
      if (!dest || !activeRegionId) return
      // Recompute the effective from with the NEW override applied —
      // can't use the stale `resolvedFrom` above because `setFromOverride`
      // is async. If the user cleared the override (point === null),
      // `regionCenter()` provides the fallback. If `regionCenter` also
      // returns null (no region match), there's nothing to recalc
      // against so bail.
      const effectiveFrom = point ?? regionCenter(activeRegionId, api, regions.installed)
      if (!effectiveFrom) return
      const profile = settingsProfileToRoute(settings.profile)
      void route.setPreview(api, activeRegionId, effectiveFrom, profile, dest)
    }

    // Route card → set destination. Same wiring as the SearchCard path
    // — both entry points funnel through `handleSelectDestination` so a
    // future divergence (e.g. extra validation for Route-card-entered
    // destinations) can't accidentally apply to one path and miss the
    // other.
    const handleChangeTo = handleSelectDestination

    // Route card → swap from + to and recalculate. The destination
    // becomes the new from; the old from becomes the destination.
    const handleSwap = () => {
      const dest = route.preview?.destination
      if (!dest || !resolvedFrom || !activeRegionId) return
      // Synthesise a SearchSuggestion for the old from. The id is
      // deterministic from the coords so a subsequent swap-back
      // doesn't bounce the auto-open-sheet effect (which keys off
      // destination.id transitions).
      const newDest: SearchSuggestion = {
        id: `from:${resolvedFrom.lat.toFixed(5)},${resolvedFrom.lon.toFixed(5)}`,
        name: resolvedFrom.name,
        lat: resolvedFrom.lat,
        lon: resolvedFrom.lon,
      }
      const newFrom: RouteFromPoint = {
        name: dest.name,
        lat: dest.lat,
        lon: dest.lon,
      }
      setFromOverride(newFrom)
      const profile = settingsProfileToRoute(settings.profile)
      void route.setPreview(api, activeRegionId, newFrom, profile, newDest)
    }

    // Route card → retrigger calculation with the existing from + to.
    // Useful after a profile change in Layers — the calculated route
    // doesn't auto-refresh, so this is the user's affordance.
    const handleRecalc = () => {
      const dest = route.preview?.destination
      if (!dest || !resolvedFrom || !activeRegionId) return
      const profile = settingsProfileToRoute(settings.profile)
      void route.setPreview(api, activeRegionId, resolvedFrom, profile, dest)
    }

    return (
      <MapsShell map={mapLayer}>
        <PlanPill
          preview={
            route.preview
              ? {
                  destinationName: route.preview.destination.name,
                  // Three states for the chip:
                  //   - routeData present → "12.4 mi · 18 min"
                  //   - error present (calculate failed) → "Unavailable"
                  //   - otherwise calculation in-flight → "Calculating…"
                  // The pill's chip suppresses the " · etaLabel" tail
                  // when etaLabel is empty, so error + loading states
                  // render without a trailing separator.
                  distanceLabel: routeData
                    ? fmtDistance(routeData.distance)
                    : route.error
                    ? 'Unavailable'
                    : 'Calculating…',
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
              <RailSection title="Route">
                <RouteCard
                  api={api}
                  regionId={activeRegionId}
                  from={resolvedFrom}
                  to={route.preview?.destination ?? null}
                  fromIsExplicit={fromOverride !== null}
                  onChangeFrom={handleChangeFrom}
                  onChangeTo={handleChangeTo}
                  onSwap={handleSwap}
                  onRecalc={handleRecalc}
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

/** Region-center fallback "from" point. The v3.0 stand-in for the
 *  live GPS fix that arrives in v3.1.
 *
 *  Resolution order:
 *    1. Installed-region `meta.bbox` (set by the orchestrator at
 *       install time for both manifest + custom-bbox regions). This
 *       is the path that lets non-manifest region ids — including
 *       the slice 6a manual-drop testing path — route correctly.
 *    2. STARTER_REGIONS lookup (matches the canonical manifest id).
 *       Falls through for older meta.json files that predate the
 *       bbox field.
 *    3. null — logs a warning so the silent-fail case is at least
 *       observable in the plugin log. */
function regionCenter(
  regionId: string | null,
  api: PluginAPI,
  installed: RegionMeta[],
): RouteFromPoint | null {
  if (!regionId) return null

  const meta = installed.find((m) => m.regionId === regionId)
  if (meta?.bbox) {
    const [west, south, east, north] = meta.bbox
    return {
      name: 'Region center',
      lat: (south + north) / 2,
      lon: (west + east) / 2,
    }
  }

  const region = STARTER_REGIONS.find((r) => r.id === regionId)
  if (!region) {
    api.log.warn(
      `route: region "${regionId}" not in STARTER_REGIONS and meta.bbox missing — routing disabled`,
    )
    return null
  }
  const [west, south, east, north] = region.bbox
  return {
    name: 'Region center',
    lat: (south + north) / 2,
    lon: (west + east) / 2,
  }
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

# Atlas Maps v3 — Offline Mapping, Routing & Live Navigation

> Status: PLAN — not yet implementing.
> Branch: `claude/atlas-maps-overhaul-plan-QvG1J`
> Target version: `3.0.0` (breaking rewrite; new minor identity within the `knosys-maps` plugin id).

---

## 1. Vision

Atlas Maps v3 turns the current online-tile viewer into an **offline-first, region-aware mapping & routing plugin** for Knosys. The user has a Steam Deck running Knosys in the car. They've downloaded the region they're in. With no internet they can:

1. Pan a real map of their region with smooth interaction.
2. Type a partial address or place name and get suggestions from a local gazetteer.
3. Pick A → … → B waypoints and get a turn-by-turn route for **driving, cycling, walking, motorcycle, scooter, truck, bus**, with cost summaries.
4. Tap "Start" and follow the route live: GPS dot tracks them, the map auto-rotates / pans, and the next turn is always visible.
5. Export the plan, share it, or re-load it later.

There is **no fallback to online** in any of these flows. Online is a download channel, not a runtime dependency.

---

## 2. What we're rewriting and why

The current plugin (v2.1.0, ~1.1 MB `main.js`, single `src/index.tsx`) is a thin MapLibre wrapper over MapTiler / OpenFreeMap. It needs the internet to do anything useful, has no addresses, no routing, no live navigation, and no concept of regions. The manifest description literally says `Offline regions return in v2.2.0.` — we're going to deliver that and far more in a single coordinated rewrite.

v3 is **not** a refactor of v2's source. We start from a clean `src/` tree and lift patterns (PMTiles cache, region downloader, design tokens, store helpers, registration scaffold) **by copy-paste-then-edit** from `knosys-flight-planner`, which already solves most of the offline-data and Knosys-plugin-shape problems for aviation and gives us a proven template to fork.

### Why a clean rewrite vs. incremental
- The data model changes: today the plugin has no persistent state of meaning. v3 needs region records, gazetteer DBs, routing graphs, saved plans, live nav sessions.
- The UI shell changes: today it's a single fullscreen map; v3 needs a sidebar/drawer for planning, a settings panel, a region manager, a navigation HUD.
- The runtime topology changes: today everything is in-renderer; v3 needs a long-lived background process (Valhalla) talking over a local socket.
- The manifest compat range must move past `< 3.0.0` because v3 depends on **new Knosys host APIs** (see §4) that don't exist in 2.x cores.

A v3.0.0 major bump signals the break cleanly. v2.x stays on the registry for users still on Knosys 2.x cores.

---

## 3. Architecture overview

```
┌─────────────────────────────── Knosys host (Electron) ───────────────────────────────┐
│                                                                                       │
│  ┌────────────── Plugin renderer (atlas-maps main.js, IIFE) ───────────────┐         │
│  │                                                                          │         │
│  │   React tree                                                             │         │
│  │   ├── <MapShell>          MapLibre GL canvas + PMTiles protocol          │         │
│  │   ├── <PlannerDrawer>     waypoint list, mode picker, route summary      │         │
│  │   ├── <SearchBar>         debounced FTS5 queries → gazetteer worker      │         │
│  │   ├── <NavigationHUD>     live follow, next-turn card, ETA               │         │
│  │   ├── <RegionManager>     list / download / delete regions               │         │
│  │   └── <SettingsPanel>     units, default mode, GPS source, tile style    │         │
│  │                                                                          │         │
│  │   Web Workers                                                            │         │
│  │   ├── gazetteer.worker.ts   owns sql.js / wa-sqlite over OPFS .db files  │         │
│  │   ├── tile-cache.worker.ts  PMTiles range reads from OPFS                │         │
│  │   └── valhalla-client.ts    routing-engine RPC client (HTTP over UDS)    │         │
│  │                                                                          │         │
│  │   Zustand stores                                                         │         │
│  │   ├── regions, plans, settings, navSession                               │         │
│  └─────────────────────────────────────┬────────────────────────────────────┘         │
│                                        │                                              │
│                  api.process.spawn  ◄──┘                                              │
│                                        │                                              │
│  ┌──────── child process: valhalla_service (native, per-OS binary) ────────┐         │
│  │   embeds Valhalla; reads tiles from {vault}/atlas-maps/routing/{region}/ │         │
│  │   listens on a UNIX domain socket (or named pipe on Windows)             │         │
│  │   speaks Valhalla's existing HTTP API (route, locate, isochrone, …)      │         │
│  └──────────────────────────────────────────────────────────────────────────┘         │
│                                                                                       │
│  Vault layout                                                                         │
│    {vault}/atlas-maps/                                                                │
│      basemap/                                                                         │
│        worldwide-low.pmtiles            (always present after first run)              │
│        regions/{region-id}/tiles.pmtiles                                              │
│      routing/                                                                         │
│        regions/{region-id}/valhalla_tiles/                                            │
│      gazetteer/                                                                       │
│        regions/{region-id}/places.db    (SQLite + FTS5)                               │
│      plans/{plan-id}.json                                                             │
│      nav-history/{session-id}.gpx                                                     │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Three subsystems, three data folders, three workers. Everything regional is scoped under `regions/{region-id}/` so a region is one atomic unit to download, version, validate, or delete.

---

## 4. Phase 0 — Host-API dependency audit (BLOCKS Phase 6+)

Routing-as-subprocess and live GPS are the two features that **don't fit the current Knosys plugin API v2 surface**. Before we commit code for them we surface the gaps and either negotiate the additions with the Knosys core team or build local shims.

### 4.1 Gap inventory

| Capability we need | What v2 host exposes today | Gap |
|---|---|---|
| Spawn a long-lived child process bundled with the plugin | `api.network.fetch` only | **MISSING** — need `api.process.spawn(cmd, args, opts)` returning a handle with `kill`, `onExit`, `stdio` streams. |
| Talk to that child over local IPC | nothing | **MISSING** — need either `api.process.connect(socketPath)` returning a duplex stream, or accept the child binding a TCP loopback port chosen at spawn time. |
| Ship per-OS binaries inside the plugin package | `package.json` files allowlist | **WORKS** — can list `bin/linux-x64/valhalla_service` etc., but bundle size becomes ~30–60 MB per platform. We'll need at least one OS at install time; plan a post-install download for others. |
| Resolve `{vault}` path from native child | `api.core.locations.vault` (renderer-side) | **PARTIAL** — host must pass the vault path to `spawn` as an arg or env var. Confirm `spawn(..., {env, cwd})` is supported. |
| Direct OPFS access from worker | works in renderer | **WORKS** — `sql.js` / `wa-sqlite` over OPFS is fine for the gazetteer. |
| GPS / location stream | `'location'` permission listed in atlas-maps source enums; semantics unclear | **NEEDS CONFIRMATION** — is `api.location.watch(callback)` exposed? If only `navigator.geolocation` is whitelisted via the permission flag, that's enough for phone-class GPS but no hardware feed. |
| External serial GPS (USB dongle, NMEA over `/dev/ttyUSB0`) | nothing | **MISSING** — need either Web Serial whitelisting or a new `api.serial.open(path, baud)`. Tracked as Phase 7, *not* required for v3.0.0. |

### 4.2 Deliverable for Phase 0

A short design memo (`plans/host-api-asks.md`) we open as an issue against the Knosys core repo with three concrete asks:
1. **`api.process.spawn`** with the shape above. Required for v3.
2. **Confirmation that `api.location.watch` exists and what it returns** (lat/lon/heading/speed/accuracy?). Required for v3.
3. **`api.serial.*` as a follow-up** (not v3-blocking).

If `api.process.spawn` is rejected outright, we fall back to:
- **Plan B**: rebuild Valhalla as WASM and run it in a worker (4–5× slower, larger renderer bundle, no per-OS binaries needed). We'd ship v3.0.0 on Plan B and migrate to native in v3.1 if the host API later lands.

Phase 0 ends when we have a yes/no on `api.process.spawn`. Plan A is the default; everything downstream assumes it.

---

## 5. Phase 1 — Foundation rewrite (rebrand + lift patterns)

### 5.1 Repo restructure

Current:
```
src/
  index.tsx          (single 12 KB file)
```

Target (mirrors `knosys-flight-planner`):
```
src/
  app/                       top-level React shells
    AtlasShell.tsx
    routes.tsx
  components/                presentational
    map/, planner/, search/, nav/, regions/, settings/
  features/                  domain logic per feature
    regions/                 download / verify / delete state machine
    geocoding/               worker, FTS5 queries, ranking
    routing/                 valhalla client, mode profiles, request builders
    navigation/              follow camera, turn detector, GPX writer
    plans/                   CRUD on saved plans
  workers/
    gazetteer.worker.ts
    tile-cache.worker.ts
  lib/
    pluginApi.ts             v2 host → flat shim (lifted from flight-planner types.ts)
    units.ts, time.ts, log.ts, opfs.ts
  styles/
    tokens.css               atm-* tokens (renamed from kfp-*)
  index.tsx                  registration entrypoint
  types.ts                   shared domain types
```

### 5.2 Design system port

Lift `kfp-*` CSS custom properties from flight-planner → rename to `atm-*`. Same scale, same colors, same component primitives (`<Card>`, `<Sheet>`, `<Tabs>`, `<Toast>`). Strip aviation-specific bits (chart strip backgrounds, sectional palettes). The point is visual coherence across both first-party plugins, so they feel like one product.

### 5.3 Build pipeline

Keep Vite. Update `vite.config.ts` to:
- Multiple entry points (worker bundles).
- Output workers as separate ES modules.
- Inline the registration entrypoint into `main.js` IIFE per Knosys plugin format.

Add to `package.json`:
- `zustand`, `pmtiles`, `@mapbox/polyline`, `sql.js` (or `wa-sqlite`), `comlink`, `proj4`, `lucide-react`, `date-fns`.

### 5.4 Manifest changes

```jsonc
{
  "knosysApi": 2,
  "id": "knosys-maps",
  "version": "3.0.0",
  "compat": { "knosys": ">=2.5.0 <4.0.0" },   // bumped — needs api.process.spawn
  "permissions": [
    "network",            // for region downloads only
    "location",           // for navigator.geolocation
    "vault:read",
    "vault:write",
    "sqlite:read",        // gazetteer
    "sqlite:write",       // gazetteer index build
    "process:spawn"       // NEW — gated on Phase 0 outcome
  ],
  "requiredApiKeys": []   // online tile keys go away entirely
}
```

Keep `knosys-maps` as the plugin id so the registry treats v3 as an upgrade-in-place of v2.

### 5.5 Deliverable

- New `src/` skeleton compiles and registers a single route showing an empty `<AtlasShell>` with the new tokens.
- v2 functionality is **gone** — no MapTiler, no OpenFreeMap, no online style. The map area is intentionally blank with an "Add a region to begin" empty state.
- Manifest published as a v3.0.0-alpha.1 prerelease.

---

## 6. Phase 2 — Offline tile system

### 6.1 Decision: nothing bundled

Per project decision: the plugin ships zero tile data. First-run experience is a one-screen wizard: *"Atlas Maps needs at least one region. Pick one to download."*

This keeps the plugin package small (~5 MB without binaries, ~40 MB with the one bundled-OS Valhalla binary in Phase 4), and avoids any default region being wrong for any given user.

### 6.2 Region model

A **region** is a versioned bundle of three artifacts that always download/delete together:

```ts
type Region = {
  id: string;                          // "us-west", "europe-de-bavaria"
  name: string;                        // "US West Coast"
  bbox: [number, number, number, number];
  sizeBytes: { tiles: number; routing: number; gazetteer: number };
  artifactUrls: { tiles: string; routing: string; gazetteer: string };
  artifactChecksums: { tiles: string; routing: string; gazetteer: string };
  dataDate: string;                    // ISO date of OSM extract
  schemaVersion: number;               // bump invalidates older regions
  installedAt?: string;
  state: 'available' | 'downloading' | 'verifying' | 'installed' | 'corrupt';
};
```

Region catalog lives at a CDN URL configured in settings (default: `https://atlas-maps.knosys.app/regions/index.json`, swappable to self-host). The catalog is fetched fresh whenever the Region Manager opens; installed regions are tracked in plugin storage.

### 6.3 Downloader

State machine: `idle → resolving → downloading(tiles) → downloading(routing) → downloading(gazetteer) → verifying → installed | error`. Resumable: each artifact downloads in chunks with `Range:` requests, progress persisted to plugin storage every 1 MB. On `verifying`, SHA-256 hashes are compared against the catalog. On mismatch, we move the file to `*.corrupt` and surface a retry button.

OPFS is the storage target. Each region's three artifacts live at the paths shown in §3. Atomic install: download to `regions/{id}/.staging/` and `rename` to `regions/{id}/` only after all three verify.

### 6.4 Tile rendering

MapLibre GL + PMTiles. PMTiles protocol handler is registered globally on plugin init; it reads byte ranges from OPFS files via the `tile-cache.worker.ts` worker (workers can do OPFS sync access; renderer can't always). Style JSON for the basemap is bundled in the plugin (small, ~30 KB), references `pmtiles://{regionId}` URLs that the protocol handler resolves to the right OPFS file based on the active region.

Active region is whichever region's bbox contains the map center; if multiple, prefer the most recently used. If none, the map shows a low-zoom worldwide fallback layer — also a PMTiles file, **also part of the first region the user downloads** (we ship a shared "world overview" tile pack alongside the first regional download, ~15 MB, so users always have *some* context map).

### 6.5 Deliverable

- First-run wizard appears when no regions are installed.
- Region Manager lists catalog regions with size, date, install state.
- Downloading shows a progress bar and is resumable across plugin reloads.
- After a successful install, the map shows real PMTiles tiles for that region offline.
- Deletion frees disk and removes the region from state cleanly.

---

## 7. Phase 3 — Offline geocoding (addresses & places)

### 7.1 Data shape

Per region: one SQLite file (`places.db`) with FTS5. Schema:

```sql
CREATE TABLE places (
  id INTEGER PRIMARY KEY,
  name TEXT,
  kind TEXT,           -- 'address' | 'poi' | 'street' | 'admin' | 'natural'
  housenumber TEXT,
  street TEXT,
  city TEXT,
  state TEXT,
  postcode TEXT,
  country TEXT,
  lat REAL, lon REAL,
  importance REAL       -- 0..1, pre-computed; higher = ranks higher
);
CREATE VIRTUAL TABLE places_fts USING fts5(
  name, street, city, state, postcode, country,
  content='places', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2"
);
-- triggers to keep fts in sync
```

The DB is built **offline by us** from OSM extracts (Nominatim's data pipeline, or simpler: a custom pipeline that pulls `addr:*` tags and admin polygons). It ships as a static artifact in the region bundle. The plugin never writes to it at runtime, only reads.

### 7.2 Query path

Search bar → debounce 150ms → `comlink` call to `gazetteer.worker.ts` → FTS5 `MATCH` query with prefix expansion (`"main st*"`) → join back to `places` → rank by `bm25 * importance` + distance to map center → top 10 results.

Worker holds the SQLite connection open across queries. Multiple region DBs can be attached simultaneously via `ATTACH DATABASE` — searches union across all installed regions, results tagged with their region.

### 7.3 Reverse geocoding

Long-press on map → closest-place query in the worker. Uses a precomputed R*Tree index on `(lat, lon)` for sub-millisecond nearest-neighbor.

### 7.4 Deliverable

- Typing `"123 main"` shows ranked address suggestions in <50ms for a continental-scale region.
- Selecting a result drops a marker, opens a card with full address, "Add to route" / "Set start" / "Set end" actions.
- Long-press on map yields a reverse-geocoded card with the nearest address.

---

## 8. Phase 4 — Offline routing (Valhalla subprocess)

### 8.1 Modes

Valhalla's mode list, of which we surface:

| Mode | Valhalla `costing` | Notes |
|---|---|---|
| Drive | `auto` | default |
| Drive (truck) | `truck` | adds height/weight params |
| Drive (bus) | `bus` | transit-prefers but still road |
| Drive (taxi) | `taxi` | HOV-friendly |
| Motorcycle | `motorcycle` | |
| Scooter | `motor_scooter` | avoids motorways |
| Bicycle | `bicycle` | sub-modes: road/hybrid/mountain |
| Walk | `pedestrian` | |
| Multimodal | `multimodal` | walking + transit (deferred to v3.1) |

Mode picker is a horizontal chip strip in the planner drawer. Per-mode options (e.g. bike type, avoid tolls/highways) live behind an "Options" expander.

### 8.2 Subprocess lifecycle

Plugin init does **not** auto-spawn Valhalla. Lazy spawn on first routing request:

```
user picks A & B
  → routing/index.ts ensure_running()
    → if not running: api.process.spawn('bin/{platform}/valhalla_service',
                                       ['--port=0', '--config=...'],
                                       {env: {VAULT: api.core.locations.vault}})
    → child writes its bound port to stdout
    → wait for "listening on :{port}" line, capture port
  → POST http://127.0.0.1:{port}/route with Valhalla JSON request
  → render response
```

Health check: GET `/status` every 30s while routing UI is open. If the child dies, we mark the engine "stopped" and respawn on next request.

Shutdown: when the plugin unmounts (Knosys closes the route), we call `handle.kill('SIGTERM')` with a 5s timeout before `SIGKILL`.

### 8.3 Binary distribution

Plugin package ships **one** binary by default (the host's OS, detected at install time by the Knosys registry — if registry can't, we ship Linux x64 since Steam Deck is the primary target). Other platforms get a post-install download via `api.network.fetch` from a CDN URL listed in the manifest, gated by a permissions prompt:

> *Atlas Maps needs to download the routing engine for macOS-arm64 (~40 MB). Continue?*

Each binary is SHA-256 verified before being marked executable.

Build provenance: Valhalla is built in a GitHub Actions matrix from a known tag, statically linked, stripped. Binaries are signed (ad-hoc on macOS, optional Authenticode on Windows). Hashes are published in the release notes.

### 8.4 Routing UI

Planner drawer states:
- **Empty**: prompt to tap the map or use search.
- **One stop**: show "set start" or "set end" toggle.
- **Two+ stops**: show route summary (distance, time, cost), expandable to per-leg detail. Drag-handle to reorder. Per-stop "X" to remove.
- **Calculating**: spinner with cancel button.
- **Error**: human-readable mapping of Valhalla error codes (no route, off-network, point unreachable).

Route geometry is decoded from Valhalla's polyline6 → drawn as a MapLibre `line` layer with a 1px white casing under a 4px primary stroke. Waypoint markers are numbered.

### 8.5 Deliverable

- Pick two points → in <300ms get a drawn route with summary text.
- Switch modes → route recomputes.
- Add a middle waypoint by tap-dragging the line → route updates.
- Reorder, delete, save.
- Works fully offline once the region is installed.

---

## 9. Phase 5 — Plans (save / load / share / export)

### 9.1 Plan format

```ts
type Plan = {
  id: string;
  name: string;
  mode: RoutingMode;
  options: ModeOptions;
  waypoints: Array<{
    lat: number; lon: number;
    label?: string;
    placeId?: string;            // gazetteer reference if from search
  }>;
  computed?: {
    geometryPolyline6: string;
    summary: { distanceM: number; timeS: number; legs: LegSummary[] };
    computedAt: string;
    valhallaVersion: string;
    regionId: string;
  };
  createdAt: string;
  updatedAt: string;
};
```

Stored as JSON files at `{vault}/atlas-maps/plans/{id}.json`. The plan list view is a virtualized list backed by `api.storage` index keys for fast enumeration.

### 9.2 Exports

- **GPX** — route + waypoints, opens in any GPS app.
- **KML** — for Google Earth / sharing.
- **Knosys plan codec** — JSON exactly as above; another atlas-maps install can import.

Exports go through `api.core.locations.vault` and a host-provided save-as dialog if available; otherwise drop into `{vault}/atlas-maps/exports/`.

### 9.3 Deliverable

- Save current plan with a name.
- Load a saved plan, see it rendered on the map.
- Export to GPX/KML to a file the user can find outside Knosys.

---

## 10. Phase 6 — Live navigation

### 10.1 Scope (v3.0.0)

Per project decision: **live follow + next-turn card. No voice. No re-routing on off-course (deferred).**

### 10.2 Position source

- Default: `navigator.geolocation.watchPosition` (works on phones with Knosys mobile, works on Steam Deck if a USB GPS dongle's driver presents itself as Location Services — typically not the case on Linux, so on Steam Deck we expect Phase 7 to be the real story).
- Settings has a "GPS source" dropdown: `Automatic`, `System (geolocation)`, `External (serial)` — the last is disabled until Phase 7.

### 10.3 Navigation HUD

Compact card at top of map when nav is active:
- Distance to next maneuver (big).
- Maneuver icon (arrow shape from Valhalla `maneuver.type`).
- Street name from Valhalla's `maneuver.street_names`.
- ETA + remaining distance (small).
- "End" button.

The map is in **follow mode**: camera pitch ~50°, zoom ~17, rotation = bearing from GPS heading (with a low-pass filter to avoid jitter). The user can pan to break follow; a "Recenter" button appears.

### 10.4 Maneuver detection

Valhalla returns maneuvers as an ordered list per leg with `begin_shape_index` / `end_shape_index` into the polyline. The follow worker projects the current GPS point onto the polyline, finds the current `shape_index`, and:
- Looks up the current maneuver (the one whose range contains the index).
- Computes distance along the polyline to the next maneuver's start.
- Updates HUD at 4Hz.

### 10.5 Off-route handling (v3.0)

If projection distance to the polyline exceeds 50m for >5s, show a banner: *"Off route — recompute?"*. Tapping it kicks a fresh route request from current GPS to the original destination, keeping intermediate waypoints. Auto-reroute is **off** by default to avoid annoying behavior on the highway; setting toggle lives in Settings.

### 10.6 Nav history

Each session logs a GPX track to `{vault}/atlas-maps/nav-history/{session-id}.gpx`. Settings has a "Privacy" section to disable or auto-delete after N days.

### 10.7 Deliverable

- Hit "Start" on a route → map enters follow mode → next-turn card updates as you move.
- Pan to break follow, recenter to resume.
- "End" stops the session and offers to save the GPX.

---

## 11. Phase 7 — External GPS hardware (DEFERRED, gated on host API)

Not part of v3.0.0. Tracked in `plans/host-api-asks.md` as the third ask. Once `api.serial.open` lands in a future Knosys core release, we add:

- Settings: pick `/dev/ttyUSB0` (or COM port) and baud.
- Worker: parses NMEA 0183 `$GPRMC` / `$GPGGA` sentences into the same position event shape as `geolocation`.
- Documented dongle list (u-blox, BU-353, etc.) known to work.

Ship as v3.1.0.

---

## 12. Phase 8 — Settings, dashboard widget, polish

### 12.1 Settings panel sections

1. **Regions** — open Region Manager.
2. **Defaults** — default mode, units (km/mi, m/ft), 12h/24h time.
3. **Navigation** — follow zoom, auto-reroute on/off, history retention.
4. **GPS** — source picker (system / external when Phase 7 lands).
5. **Privacy** — clear search history, clear nav history.
6. **Storage** — used disk per region with "delete" buttons.
7. **About** — version, Valhalla version, OSM data dates per region, attribution links.

Registered via `api.ui.registerSettingsPanel`.

### 12.2 Dashboard widget

A small "Atlas Maps" widget for the Knosys dashboard (`api.ui.registerWidget`):
- Shows the last saved plan's preview.
- "Resume" button if a nav session was interrupted.
- Region storage usage indicator.

### 12.3 Sidebar item

Registered via `api.ui.registerSidebarItem`: map icon, label "Atlas Maps", click routes to `/atlas-maps`.

---

## 13. Phase 9 — Release & migration

### 13.1 Migration from v2

There's almost nothing to migrate — v2 stored no plans. We:
1. Wipe all `api.storage` keys under the plugin's namespace (announce in release notes).
2. Remove the v2 `requiredApiKeys.maptiler` entry; if a user had a MapTiler key stored, surface a one-time toast: *"Atlas Maps no longer needs your MapTiler key — you can revoke it from your account."*
3. The very first run after upgrade lands on the first-run wizard.

### 13.2 Release cadence

- `3.0.0-alpha.1`: Phase 1 done.
- `3.0.0-alpha.2`: Phase 2 done (region download works).
- `3.0.0-alpha.3`: Phase 3 done (search works).
- `3.0.0-beta.1`: Phase 4 done (routing works) — first wide test.
- `3.0.0-beta.2`: Phase 5 done.
- `3.0.0-rc.1`: Phase 6 done — full happy path works.
- `3.0.0`: after a beta soak with regions covering at least Pacific Northwest, Germany, and Japan exercising different OSM density profiles.
- `3.1.0`: Phase 7 — external GPS.

### 13.3 Distribution surfaces

- GitHub Releases — source + binary artifacts (one OS bundled, others fetched post-install).
- Knosys plugin registry submission — manifest pointing at the GitHub release.
- A separate `atlas-maps-regions` repo / CDN hosting the region catalog and artifacts. Catalog versioning is independent from plugin versioning.

---

## 14. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `api.process.spawn` is rejected by Knosys core | Medium | High | Plan B: Valhalla-WASM in worker. Code paths are abstracted behind a `RoutingEngine` interface so the swap is mechanical. |
| Region artifact sizes are bigger than users tolerate (e.g. continental US ~5GB routing tiles) | High | Medium | Sub-divide large countries into multiple regions (US-West, US-Midwest, etc.). Compress tilesets with `mbtiles → pmtiles` deflate. Show size up-front in catalog. |
| Per-OS binary signing/notarization friction (macOS Gatekeeper, Windows SmartScreen) | High | Medium | First release: Linux only (Steam Deck target). macOS/Windows in 3.0.1 with proper signing pipeline. |
| OSM extract licensing/attribution requirements | Low | Low | Always-visible "© OpenStreetMap contributors, Valhalla" attribution. Region catalog page links to per-region data dates. |
| Gazetteer DB build pipeline becomes a maintenance burden | Medium | Medium | Either: (a) reuse community Nominatim extracts; (b) script the build in GitHub Actions on a monthly cadence and version-pin to OSM PBF dates. |
| Long-lived subprocess leaks memory across hours of use | Medium | Medium | `/status` endpoint includes RSS; auto-restart engine if it crosses a threshold (e.g. 1.5 GB). |
| Steam Deck has no system GPS, so Phase 6 demos poorly on the target device | High | High | Set expectation in docs that Steam Deck users need Phase 7 (external dongle) for real driving use; v3.0 demos on a phone/laptop. |
| Vite worker bundling breaks Knosys's IIFE plugin format | Medium | Medium | Spike this in Phase 1 specifically — workers as inline blob URLs or as separately-listed `files` in the manifest. Confirm before Phase 3. |

---

## 15. Open questions to resolve before Phase 4

1. **Worker delivery inside Knosys plugins**: can workers be separate files alongside `main.js`, or must they be inlined as blob URLs? Affects bundle structure and source maps.
2. **Catalog URL governance**: who owns `atlas-maps.knosys.app`? Need a place to publish regions before the first alpha that downloads anything.
3. **Region naming taxonomy**: ISO-3166-2 subdivisions? Custom curated list? Affects URLs, persistence keys, i18n.
4. **Gazetteer build owner**: who runs the monthly OSM → SQLite pipeline? Tied to (2).
5. **Telemetry**: do we want any (anonymous, opt-in) error reporting from Valhalla crashes? Knosys host probably has its own telemetry surface to plug into.

---

## 16. What this branch (`claude/atlas-maps-overhaul-plan-QvG1J`) ships

**This branch ships only the plan.** No source changes. Once approved:

1. Open the host-API design memo issue against the Knosys core repo (Phase 0).
2. Branch `claude/atlas-maps-v3-phase-1` from `main`, do the foundation rewrite there.
3. One branch per phase, each landing into `main` behind a `v3` feature flag that ungates the new UI only when `manifest.version` is a `3.x` build.

Phase 1 starts the moment Phase 0 returns a thumbs-up (or thumbs-down with Plan B confirmed).

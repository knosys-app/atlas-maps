# Knosys Maps

Offline driving navigation plugin for [Knosys](https://github.com/knosys-app). Per-region map tiles + offline routing + FTS5 address search, with optional voice and live turn-by-turn coming in v3.1+.

## Status

**v3.0 — Pre-release.** The UI shell is feature-complete (rail / sheet / route preview / saved destinations / region settings). The download pipeline that fetches OpenStreetMap data and builds per-region Valhalla tiles + PMTiles + geocoder lands in slice 6b, paired with the cross-platform binaries from [`knosys-app/valhalla-builds`](https://github.com/knosys-app) (Phase 1).

Available now in dev builds:
- Map shell + chrome (Plan Pill, Layers menu, Rail, Sheet)
- Region Settings panel with stub install (writes meta.json + empty FTS5 db)
- Saved destinations with drag-reorder
- Cross-plugin destinations consumer via `core:destinations`
- Routing engine wrapper (calls fail without Phase 1 binaries)

## Install

Open Knosys → **Settings → Plugins → Browse Store** → search "Maps" → Install.

Sideload (dev) and per-change verification are also supported via the in-tree `npm run release` script — see [CONTRIBUTING](#contributing) below.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Plugin settings (active region, units, profile). |
| `network` | Geofabrik PBF downloads + Nominatim fallback. |
| `vault:read` / `vault:write` | Per-region tile + database storage under `vault/PluginData/knosys-maps/`. |
| `sqlite:read` / `sqlite:write` | FTS5 places.db + route history.db. |
| `routing:engine` | Valhalla subprocess sandbox (Phase 0.2). |

v3.1+ adds `gps:read`, `gps:list-devices`, `spotlight:provider`.

## Contributing

```bash
npm install
npm run build       # → main.js
npm test            # vitest unit suite
npm run typecheck
```

### Cutting a release

`npm run release` automates the per-change publish flow:

1. Bumps version to `3.0.0-alpha.N` (auto-increments from latest existing tag).
2. Builds + tarballs the dist files.
3. Tags `v3.0.0-alpha.N` and pushes.
4. `gh release create` with auto-generated notes from `git log` since the previous tag.
5. Clones [`knosys-app/community-plugins`](https://github.com/knosys-app/community-plugins), patches `index.json` with the new version + sha256, opens a draft PR.

`npm run release:dry-run` runs everything except remote side effects.

## License

MIT — see [LICENSE](./LICENSE).

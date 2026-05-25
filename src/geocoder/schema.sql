-- Geocoder schema (read-only from the plugin's perspective).
--
-- The host builds this database during region install (slice 6's
-- `api.routing.buildGeocoder` call). The plugin opens it via
-- `api.db.openSqlite('regions/{regionId}/places.db', { readonly: true })`
-- and runs FTS5 prefix queries through it.
--
-- A SINGLE `places` table holds rows from BOTH sources (OSM names +
-- OpenAddresses street-level rooftops). Duplicates between the two are
-- intentionally allowed at insert time; query-side dedupe in
-- `ranking.ts` collapses them by name-normalized-equality within ~10 m,
-- preferring the openaddresses row (better lat/lon precision).
--
-- This file is reference documentation, not executable by the plugin —
-- the host runs the CREATE statements in its build-geocoder pipeline.
-- Kept here so the contract is visible alongside the reader code.

CREATE TABLE IF NOT EXISTS places (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,             -- "123 Main St, Seattle" or "Pike Place Market"
  category    TEXT NOT NULL,             -- 'city' | 'town' | 'village' | 'hamlet' |
                                          --  'suburb' | 'neighbourhood' |
                                          --  'poi' | 'road' | 'address'
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  importance  INTEGER NOT NULL DEFAULT 0, -- city=100, town=80, village=60,
                                          --  neighbourhood/suburb=50,
                                          --  hamlet=40, road=30, poi=20,
                                          --  address=10
  source      TEXT NOT NULL               -- 'osm' | 'openaddresses'
);

-- FTS5 over the `name` column (and `category` for category-filtered
-- search later). Uses `content='places'` so the FTS index references
-- the base table; `content_rowid='rowid'` ties them together.
CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(
  name,
  category,
  content='places',
  content_rowid='rowid'
);

CREATE INDEX IF NOT EXISTS idx_places_lat_lon
  ON places(latitude, longitude);

-- Triggers to keep FTS in sync. The host's insert path is the only
-- writer; these triggers exist so the table can be repopulated
-- in-place during a re-import without rebuilding the FTS index.
CREATE TRIGGER IF NOT EXISTS places_ai
  AFTER INSERT ON places
  BEGIN
    INSERT INTO places_fts (rowid, name, category)
    VALUES (new.rowid, new.name, new.category);
  END;

CREATE TRIGGER IF NOT EXISTS places_ad
  AFTER DELETE ON places
  BEGIN
    INSERT INTO places_fts (places_fts, rowid, name, category)
    VALUES ('delete', old.rowid, old.name, old.category);
  END;

CREATE TRIGGER IF NOT EXISTS places_au
  AFTER UPDATE ON places
  BEGIN
    INSERT INTO places_fts (places_fts, rowid, name, category)
    VALUES ('delete', old.rowid, old.name, old.category);
    INSERT INTO places_fts (rowid, name, category)
    VALUES (new.rowid, new.name, new.category);
  END;

/**
 * Geocoder type contracts.
 *
 * Aligned with the schema in `schema.sql` and the host-side ingestion
 * pipeline (slice 6 builds the DB; this module reads from it).
 */

/** Row category. Used for icon selection + importance scoring. */
export type PlaceCategory =
  | 'city'
  | 'town'
  | 'village'
  | 'hamlet'
  | 'suburb'
  | 'neighbourhood'
  | 'poi'
  | 'road'
  | 'address'

/** Source of the row. Drives dedupe scoring: openaddresses rows have
 *  rooftop-precision lat/lon; OSM rows are coarser. When two rows have
 *  the same normalized name within 10 m, prefer openaddresses. */
export type PlaceSource = 'osm' | 'openaddresses' | 'nominatim'

/** A single geocoder result. */
export interface PlaceResult {
  name: string
  category: PlaceCategory
  latitude: number
  longitude: number
  /** Static importance score. City=100, town=80, village=60, neighbourhood/
   *  suburb=50, hamlet=40, road=30, poi=20, address=10. Nominatim fills
   *  ~15 for online results. */
  importance: number
  source: PlaceSource
  /** Distance from the search anchor (m). 0 when no anchor was supplied. */
  distanceM: number
}

/** Options for a single search call. */
export interface SearchOptions {
  /** User input. Trimmed + FTS-escaped internally. */
  query: string
  /** Where the user is right now (or the map center). Drives the
   *  haversine tiebreak. Omit for "no anchor" — distance defaults to 0. */
  near?: { lat: number; lon: number }
  /** Max results returned. */
  limit?: number
  /** Override for the Nominatim fallback threshold. The orchestrator
   *  falls back when local hits are below this number AND
   *  `navigator.onLine` is true. */
  nominatimThreshold?: number
}

/**
 * Internal route shape used by the rail, sheet, and nav state machine.
 *
 * Deliberately mirrors SpeedDeck's OSRM-derived shape so the ported
 * `nav-utils.ts` and `nav-store.ts` work 1:1. `route-parser.ts` converts
 * Valhalla's response into this shape; nothing downstream needs to know
 * about Valhalla-specific fields.
 */

export type RouteProfile = 'driving' | 'bicycle' | 'pedestrian'

export interface RouteManeuver {
  type: string             // 'depart' | 'turn' | 'arrive' | 'merge' | 'fork' | ...
  modifier?: string        // 'left' | 'right' | 'slight left' | ...
  location: [number, number] // [lon, lat]
  bearingBefore?: number
  bearingAfter?: number
}

export interface RouteStep {
  maneuver: RouteManeuver
  name: string             // street name
  distance: number         // metres along this step
  duration: number         // seconds along this step
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
  /** Index range within the parent leg's full geometry that this step
   *  occupies. Used by the nav state machine to map GPS fixes → step. */
  beginShapeIndex: number
  endShapeIndex: number
}

export interface RouteData {
  /** Encoded as a GeoJSON LineString for direct MapLibre rendering. */
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
  /** Total distance in metres. */
  distance: number
  /** Total duration in seconds. */
  duration: number
  steps: RouteStep[]
  /** Per-coordinate maxspeed in km/h (null = unknown). Same length as
   *  `geometry.coordinates`. */
  maxspeeds?: Array<number | null>
  /** Profile that produced this route (driving / bicycle / pedestrian). */
  profile: RouteProfile
}

export interface RouteCalcInput {
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  profile: RouteProfile
  /** Current GPS heading in degrees, used to constrain the origin. */
  headingDeg?: number
  /** Current GPS speed in m/s. Wider bearing tolerance at low speed. */
  speedMps?: number
  /** Override units in Valhalla response (defaults to plugin setting). */
  units?: 'kilometers' | 'miles'
}

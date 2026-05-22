/**
 * Curated starter region manifest — 76 regions covering all 50 US
 * states + DC, 5 Canadian provinces, 15 European countries / regions
 * (UK is split into England / Scotland / Wales), and 5 APAC entries.
 * Mirrors SpeedDeck's regions.py format.
 *
 * Per the plan (Phase 2.6), every US state ships with an
 * `openAddressesSource` so step 7 of the region pipeline imports
 * street-level address coverage. Other regions get OSM-only geocoder
 * data; OA support can be added per-entry later.
 *
 * The plugin also fetches an updated `regions.json` at runtime from
 * `https://raw.githubusercontent.com/knosys-app/atlas-maps/main/regions.json`;
 * runtime fetch takes precedence if its `version` is newer. This file
 * is the offline fallback.
 *
 * Estimated sizes are rough — tied to a 2025 Geofabrik snapshot.
 * Phase 2's CI weekly job updates them.
 */

export interface RegionDefinition {
  id: string
  displayName: string
  geofabrikUrl: string
  md5Url: string
  /** [west, south, east, north] in WGS84 decimal degrees. */
  bbox: [number, number, number, number]
  estimatedSizes: {
    pbfMb: number
    tilesMb: number
    geocoderMb: number
    pmtilesMb: number
    /** Sum during build, including transient PBF. */
    peakDiskMb: number
  }
  parentRegion?: string
  countryCode: string
  state?: string
  /** OpenAddresses batch-API source (resolved to a download URL at install time). */
  openAddressesSource?: string
  lastVerified: string
  geofabrikRefreshDay: number
}

/** Helper to keep the literal table compact. */
function us(
  state: string,
  displayName: string,
  bbox: [number, number, number, number],
  sizes: RegionDefinition['estimatedSizes'],
  slug: string = state.toLowerCase().replace(/ /g, '-'),
): RegionDefinition {
  const geofabrikUrl = `https://download.geofabrik.de/north-america/us/${slug}-latest.osm.pbf`
  return {
    id: `us-${slug}`,
    displayName: `${displayName}, USA`,
    geofabrikUrl,
    md5Url: `${geofabrikUrl}.md5`,
    bbox,
    estimatedSizes: sizes,
    parentRegion: 'north-america',
    countryCode: 'US',
    state,
    openAddressesSource: `us/${state.toLowerCase()}/statewide`,
    lastVerified: '2026-05-21',
    geofabrikRefreshDay: 1, // Monday
  }
}

/** Compact size profile presets. Tweak per-region as benchmarks come in. */
const SIZE_SMALL  = { pbfMb: 80,   tilesMb: 80,   geocoderMb: 120,  pmtilesMb: 25,  peakDiskMb: 600 }
const SIZE_MED    = { pbfMb: 200,  tilesMb: 200,  geocoderMb: 250,  pmtilesMb: 50,  peakDiskMb: 1200 }
const SIZE_LARGE  = { pbfMb: 400,  tilesMb: 400,  geocoderMb: 500,  pmtilesMb: 80,  peakDiskMb: 2200 }
const SIZE_XLARGE = { pbfMb: 800,  tilesMb: 600,  geocoderMb: 800,  pmtilesMb: 120, peakDiskMb: 3500 }

// ---- US states + DC (51 entries) ----

const US_STATES: RegionDefinition[] = [
  us('AL', 'Alabama',         [-88.5, 30.2, -84.9, 35.1], SIZE_MED,   'alabama'),
  us('AK', 'Alaska',          [-180.0, 51.2, -129.0, 71.5], SIZE_LARGE, 'alaska'),
  us('AZ', 'Arizona',         [-114.8, 31.3, -109.0, 37.0], SIZE_MED,   'arizona'),
  us('AR', 'Arkansas',        [-94.6, 33.0, -89.6, 36.5], SIZE_MED,   'arkansas'),
  us('CA', 'California',      [-124.4, 32.5, -114.1, 42.0], SIZE_XLARGE, 'california'),
  us('CO', 'Colorado',        [-109.1, 36.9, -102.0, 41.0], SIZE_MED,   'colorado'),
  us('CT', 'Connecticut',     [-73.7, 40.9, -71.8, 42.1], SIZE_SMALL, 'connecticut'),
  us('DE', 'Delaware',        [-75.8, 38.4, -75.0, 39.8], SIZE_SMALL, 'delaware'),
  us('DC', 'District of Columbia', [-77.2, 38.8, -76.9, 39.0], SIZE_SMALL, 'district-of-columbia'),
  us('FL', 'Florida',         [-87.6, 24.4, -80.0, 31.0], SIZE_LARGE, 'florida'),
  us('GA', 'Georgia',         [-85.6, 30.4, -80.8, 35.0], SIZE_MED,   'georgia'),
  us('HI', 'Hawaii',          [-160.6, 18.9, -154.8, 22.2], SIZE_SMALL, 'hawaii'),
  us('ID', 'Idaho',           [-117.2, 41.9, -111.0, 49.0], SIZE_MED,   'idaho'),
  us('IL', 'Illinois',        [-91.5, 36.9, -87.0, 42.5], SIZE_LARGE, 'illinois'),
  us('IN', 'Indiana',         [-88.1, 37.8, -84.8, 41.8], SIZE_MED,   'indiana'),
  us('IA', 'Iowa',            [-96.6, 40.4, -90.1, 43.5], SIZE_MED,   'iowa'),
  us('KS', 'Kansas',          [-102.1, 36.9, -94.6, 40.0], SIZE_MED,   'kansas'),
  us('KY', 'Kentucky',        [-89.6, 36.5, -81.9, 39.1], SIZE_MED,   'kentucky'),
  us('LA', 'Louisiana',       [-94.1, 28.9, -88.8, 33.0], SIZE_MED,   'louisiana'),
  us('ME', 'Maine',           [-71.1, 43.0, -66.9, 47.5], SIZE_MED,   'maine'),
  us('MD', 'Maryland',        [-79.5, 37.9, -75.0, 39.7], SIZE_MED,   'maryland'),
  us('MA', 'Massachusetts',   [-73.5, 41.2, -69.9, 42.9], SIZE_MED,   'massachusetts'),
  us('MI', 'Michigan',        [-90.4, 41.7, -82.4, 48.3], SIZE_LARGE, 'michigan'),
  us('MN', 'Minnesota',       [-97.3, 43.5, -89.5, 49.4], SIZE_MED,   'minnesota'),
  us('MS', 'Mississippi',     [-91.7, 30.2, -88.1, 35.0], SIZE_MED,   'mississippi'),
  us('MO', 'Missouri',        [-95.8, 35.9, -89.1, 40.7], SIZE_MED,   'missouri'),
  us('MT', 'Montana',         [-116.1, 44.4, -104.0, 49.0], SIZE_MED,   'montana'),
  us('NE', 'Nebraska',        [-104.1, 40.0, -95.3, 43.0], SIZE_MED,   'nebraska'),
  us('NV', 'Nevada',          [-120.0, 35.0, -114.0, 42.0], SIZE_MED,   'nevada'),
  us('NH', 'New Hampshire',   [-72.6, 42.7, -70.6, 45.4], SIZE_SMALL, 'new-hampshire'),
  us('NJ', 'New Jersey',      [-75.6, 38.9, -73.9, 41.4], SIZE_MED,   'new-jersey'),
  us('NM', 'New Mexico',      [-109.1, 31.3, -103.0, 37.0], SIZE_MED,   'new-mexico'),
  us('NY', 'New York',        [-79.8, 40.5, -71.9, 45.0], SIZE_LARGE, 'new-york'),
  us('NC', 'North Carolina',  [-84.4, 33.8, -75.5, 36.6], SIZE_MED,   'north-carolina'),
  us('ND', 'North Dakota',    [-104.1, 45.9, -96.5, 49.0], SIZE_MED,   'north-dakota'),
  us('OH', 'Ohio',            [-84.9, 38.4, -80.5, 41.9], SIZE_LARGE, 'ohio'),
  us('OK', 'Oklahoma',        [-103.0, 33.6, -94.4, 37.0], SIZE_MED,   'oklahoma'),
  us('OR', 'Oregon',          [-124.6, 41.9, -116.5, 46.3], SIZE_MED,   'oregon'),
  us('PA', 'Pennsylvania',    [-80.5, 39.7, -74.7, 42.3], SIZE_LARGE, 'pennsylvania'),
  us('RI', 'Rhode Island',    [-71.9, 41.1, -71.1, 42.0], SIZE_SMALL, 'rhode-island'),
  us('SC', 'South Carolina',  [-83.4, 32.0, -78.5, 35.2], SIZE_MED,   'south-carolina'),
  us('SD', 'South Dakota',    [-104.1, 42.5, -96.4, 45.9], SIZE_MED,   'south-dakota'),
  us('TN', 'Tennessee',       [-90.3, 34.9, -81.6, 36.7], SIZE_MED,   'tennessee'),
  us('TX', 'Texas',           [-106.7, 25.8, -93.5, 36.5], SIZE_XLARGE, 'texas'),
  us('UT', 'Utah',            [-114.1, 36.9, -109.0, 42.0], SIZE_MED,   'utah'),
  us('VT', 'Vermont',         [-73.5, 42.7, -71.4, 45.0], SIZE_SMALL, 'vermont'),
  us('VA', 'Virginia',        [-83.7, 36.5, -75.2, 39.5], SIZE_MED,   'virginia'),
  us('WA', 'Washington',      [-124.8, 45.5, -116.9, 49.0], SIZE_MED,   'washington'),
  us('WV', 'West Virginia',   [-82.7, 37.2, -77.7, 40.6], SIZE_MED,   'west-virginia'),
  us('WI', 'Wisconsin',       [-92.9, 42.4, -86.2, 47.1], SIZE_MED,   'wisconsin'),
  us('WY', 'Wyoming',         [-111.1, 40.9, -104.0, 45.0], SIZE_MED,   'wyoming'),
]

// ---- Canada (5 provinces) ----

const CANADA: RegionDefinition[] = [
  {
    id: 'ca-bc', displayName: 'British Columbia, Canada',
    geofabrikUrl: 'https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf.md5',
    bbox: [-139.1, 48.3, -114.0, 60.0], estimatedSizes: SIZE_LARGE,
    parentRegion: 'north-america', countryCode: 'CA', state: 'BC',
    openAddressesSource: 'ca/bc/statewide',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 1,
  },
  {
    id: 'ca-ab', displayName: 'Alberta, Canada',
    geofabrikUrl: 'https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf.md5',
    bbox: [-120.0, 49.0, -110.0, 60.0], estimatedSizes: SIZE_MED,
    parentRegion: 'north-america', countryCode: 'CA', state: 'AB',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 1,
  },
  {
    id: 'ca-on', displayName: 'Ontario, Canada',
    geofabrikUrl: 'https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf.md5',
    bbox: [-95.2, 41.7, -74.3, 56.9], estimatedSizes: SIZE_LARGE,
    parentRegion: 'north-america', countryCode: 'CA', state: 'ON',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 1,
  },
  {
    id: 'ca-qc', displayName: 'Quebec, Canada',
    geofabrikUrl: 'https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/north-america/canada/quebec-latest.osm.pbf.md5',
    bbox: [-79.8, 45.0, -57.1, 62.6], estimatedSizes: SIZE_LARGE,
    parentRegion: 'north-america', countryCode: 'CA', state: 'QC',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 1,
  },
  {
    id: 'ca-ns', displayName: 'Nova Scotia, Canada',
    geofabrikUrl: 'https://download.geofabrik.de/north-america/canada/nova-scotia-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/north-america/canada/nova-scotia-latest.osm.pbf.md5',
    bbox: [-66.4, 43.4, -59.7, 47.0], estimatedSizes: SIZE_SMALL,
    parentRegion: 'north-america', countryCode: 'CA', state: 'NS',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 1,
  },
]

// ---- Europe (15) + APAC (5) — helpers for compact entries ----

function eu(slug: string, displayName: string, bbox: [number, number, number, number], sizes: RegionDefinition['estimatedSizes'], countryCode: string): RegionDefinition {
  const url = `https://download.geofabrik.de/europe/${slug}-latest.osm.pbf`
  return {
    id: `eu-${slug}`,
    displayName,
    geofabrikUrl: url,
    md5Url: `${url}.md5`,
    bbox, estimatedSizes: sizes,
    parentRegion: 'europe', countryCode,
    lastVerified: '2026-05-21', geofabrikRefreshDay: 2,
  }
}

const EUROPE: RegionDefinition[] = [
  eu('great-britain/england',  'England, UK',     [-6.4,  49.9,  1.8,  55.8], SIZE_LARGE,  'GB'),
  eu('great-britain/scotland', 'Scotland, UK',    [-8.7,  54.6, -0.7,  60.9], SIZE_MED,    'GB'),
  eu('great-britain/wales',    'Wales, UK',       [-5.4,  51.3, -2.6,  53.5], SIZE_SMALL,  'GB'),
  eu('ireland-and-northern-ireland', 'Ireland',   [-10.7, 51.4, -5.4,  55.5], SIZE_MED,    'IE'),
  eu('germany',                'Germany',         [ 5.9,  47.3, 15.0,  55.1], SIZE_XLARGE, 'DE'),
  eu('france',                 'France',          [-5.2,  41.3,  9.6,  51.1], SIZE_XLARGE, 'FR'),
  eu('spain',                  'Spain',           [-9.4,  35.9,  4.4,  43.8], SIZE_LARGE,  'ES'),
  eu('portugal',               'Portugal',        [-9.5,  36.9, -6.2,  42.2], SIZE_MED,    'PT'),
  eu('italy',                  'Italy',           [ 6.6,  35.5, 18.5,  47.1], SIZE_LARGE,  'IT'),
  eu('netherlands',            'Netherlands',     [ 3.4,  50.8,  7.2,  53.5], SIZE_MED,    'NL'),
  eu('belgium',                'Belgium',         [ 2.5,  49.5,  6.4,  51.5], SIZE_MED,    'BE'),
  eu('switzerland',            'Switzerland',     [ 5.9,  45.8, 10.5,  47.8], SIZE_MED,    'CH'),
  eu('austria',                'Austria',         [ 9.5,  46.4, 17.2,  49.0], SIZE_MED,    'AT'),
  eu('norway',                 'Norway',          [ 4.6,  57.9, 31.2,  71.2], SIZE_MED,    'NO'),
  eu('sweden',                 'Sweden',          [10.9,  55.3, 24.2,  69.1], SIZE_MED,    'SE'),
]

const APAC: RegionDefinition[] = [
  {
    id: 'au-vic', displayName: 'Victoria, Australia',
    geofabrikUrl: 'https://download.geofabrik.de/australia-oceania/australia/victoria-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/australia-oceania/australia/victoria-latest.osm.pbf.md5',
    bbox: [140.9, -39.2, 150.0, -33.9], estimatedSizes: SIZE_MED,
    parentRegion: 'oceania', countryCode: 'AU', state: 'VIC',
    openAddressesSource: 'au/vic/statewide',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 3,
  },
  {
    id: 'au-nsw', displayName: 'New South Wales, Australia',
    geofabrikUrl: 'https://download.geofabrik.de/australia-oceania/australia/new-south-wales-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/australia-oceania/australia/new-south-wales-latest.osm.pbf.md5',
    bbox: [140.9, -37.5, 153.6, -28.2], estimatedSizes: SIZE_LARGE,
    parentRegion: 'oceania', countryCode: 'AU', state: 'NSW',
    openAddressesSource: 'au/nsw/statewide',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 3,
  },
  {
    id: 'au-qld', displayName: 'Queensland, Australia',
    geofabrikUrl: 'https://download.geofabrik.de/australia-oceania/australia/queensland-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/australia-oceania/australia/queensland-latest.osm.pbf.md5',
    bbox: [137.9, -29.2, 153.6, -10.4], estimatedSizes: SIZE_LARGE,
    parentRegion: 'oceania', countryCode: 'AU', state: 'QLD',
    openAddressesSource: 'au/qld/statewide',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 3,
  },
  {
    id: 'jp-kanto', displayName: 'Kanto, Japan',
    geofabrikUrl: 'https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf.md5',
    bbox: [138.5, 34.9, 141.0, 37.2], estimatedSizes: SIZE_LARGE,
    parentRegion: 'asia', countryCode: 'JP',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 4,
  },
  {
    id: 'nz', displayName: 'New Zealand',
    geofabrikUrl: 'https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf',
    md5Url: 'https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf.md5',
    bbox: [165.7, -47.3, 178.6, -34.0], estimatedSizes: SIZE_MED,
    parentRegion: 'oceania', countryCode: 'NZ',
    lastVerified: '2026-05-21', geofabrikRefreshDay: 3,
  },
]

/** All starter regions, in display order: US → Canada → Europe → APAC. */
export const STARTER_REGIONS: RegionDefinition[] = [
  ...US_STATES,
  ...CANADA,
  ...EUROPE,
  ...APAC,
]

/** Quick lookup by id. */
export function findRegion(id: string): RegionDefinition | undefined {
  return STARTER_REGIONS.find((r) => r.id === id)
}

/** Total starter-list count, exposed for tests + diag. */
export const STARTER_REGION_COUNT = STARTER_REGIONS.length

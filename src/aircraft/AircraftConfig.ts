/**
 * AircraftConfig
 * Central registry mapping aircraft type strings to display properties.
 *
 * All icon sizes are at "detail" zoom (≥13).  Sizes are proportional to real
 * wingspans so that an A380 renders visibly larger than a 737 etc.
 *
 * Wingspan reference (approximate, ft):
 *   737 / A320 : 117    B767 : 156    B787 : 197
 *   B777       : 212    A350 : 213    B747 : 224    A380 : 262
 *
 * Base unit: 737 = 24 px wide.  All others scale proportionally.
 */

export interface AircraftDisplayConfig {
  /** Filename inside /src/images/ */
  imageFile: string;
  /**
   * Reference icon pixel width — used only as aspect-ratio source.
   * Actual rendered size is computed from real wingspan at map scale.
   */
  iconWidth: number;
  /** Reference icon pixel height (aspect-ratio partner to iconWidth) */
  iconHeight: number;
  /** Real-world wingspan in metres — used for map-scale rendering */
  wingspanMetres: number;
  /** Human-readable label */
  label: string;
  /** Broad category used for gate / wake separation logic */
  category: 'narrowbody' | 'widebody' | 'super';
}

// ── Canonical type keys ────────────────────────────────────────────
// Map every variant / ICAO code / raw string we might see in JSON
// → one of the eight supported canonical keys.
const TYPE_ALIASES: Record<string, string> = {
  // 737 variants
  'B737': 'B737', '737': 'B737',
  'B737-700': 'B737', 'B737-800': 'B737', 'B737-900': 'B737',
  'B737 MAX 8': 'B737', 'B737MAX8': 'B737',
  'B738': 'B737', 'B39M': 'B737', 'B38M': 'B737',

  // 747 variants
  'B747': 'B747', '747': 'B747',
  'B747-400': 'B747', 'B747-8': 'B747',
  'B744': 'B747', 'B748': 'B747',

  // 767 variants
  'B767': 'B767', '767': 'B767',
  'B767-300': 'B767', 'B767-300ER': 'B767',
  'B763': 'B767',
  // Treat 757 as 767 (no 757 image; similar silhouette / cat)
  'B757': 'B767', 'B757-200': 'B767', 'B752': 'B767',

  // 777 variants
  'B777': 'B777', '777': 'B777',
  'B777-200': 'B777', 'B777-200ER': 'B777',
  'B777-300': 'B777', 'B777-300ER': 'B777',
  'B77W': 'B777', 'B772': 'B777', 'B773': 'B777',

  // 787 variants
  'B787': 'B787', '787': 'B787',
  'B787-8': 'B787', 'B787-9': 'B787', 'B787-10': 'B787',
  'B788': 'B787', 'B789': 'B787',

  // A320 family (A318 / A319 / A320 / A321 / A220)
  'A320': 'A320',
  'A318': 'A320', 'A319': 'A320', 'A321': 'A320',
  'A220': 'A320', 'A220-100': 'A320', 'A220-300': 'A320',
  'A20N': 'A320', 'A21N': 'A320',
  // Treat regional jets as narrowbody A320 fallback (no CRJ / E-jet image)
  'CRJ-700': 'A320', 'CRJ-900': 'A320', 'CRJ700': 'A320',
  'E175': 'A320', 'E170': 'A320', 'E190': 'A320',

  // A350 variants
  'A350': 'A350',
  'A350-900': 'A350', 'A350-1000': 'A350',
  'A359': 'A350', 'A35K': 'A350',

  // A380
  'A380': 'A380',
  'A380-800': 'A380',
  'A388': 'A380',
};

// ── Display configs per canonical key ────────────────────────────
// iconWidth / iconHeight are aspect-ratio sources taken from the PNG geometry.
// wingspanMetres drives the actual rendered size on the map.
export const AIRCRAFT_DISPLAY: Record<string, AircraftDisplayConfig> = {
  B737: { imageFile: '737.png',  iconWidth: 24, iconHeight: 28, wingspanMetres:  35.8, label: 'Boeing 737',  category: 'narrowbody' },
  B747: { imageFile: '747.png',  iconWidth: 46, iconHeight: 50, wingspanMetres:  68.4, label: 'Boeing 747',  category: 'widebody'   },
  B767: { imageFile: '767.png',  iconWidth: 32, iconHeight: 38, wingspanMetres:  47.6, label: 'Boeing 767',  category: 'widebody'   },
  B777: { imageFile: '777.png',  iconWidth: 44, iconHeight: 50, wingspanMetres:  64.8, label: 'Boeing 777',  category: 'widebody'   },
  B787: { imageFile: '787.png',  iconWidth: 40, iconHeight: 44, wingspanMetres:  60.1, label: 'Boeing 787',  category: 'widebody'   },
  A320: { imageFile: 'A320.png', iconWidth: 24, iconHeight: 28, wingspanMetres:  35.8, label: 'Airbus A320', category: 'narrowbody' },
  A350: { imageFile: 'A350.png', iconWidth: 44, iconHeight: 48, wingspanMetres:  64.8, label: 'Airbus A350', category: 'widebody'   },
  A380: { imageFile: 'A380.png', iconWidth: 54, iconHeight: 56, wingspanMetres:  79.8, label: 'Airbus A380', category: 'super'      },
};

/** Yellow placeholder icon used when the aircraft image would be too small to see. */
export const PLACEHOLDER_ICON = {
  imageFile: 'airplane-icon-yellow.png',
  /** Fixed pixel size — does NOT change with zoom */
  size: 18,
};

/**
 * Minimum rendered wing-to-wing pixel width before we fall back to the
 * placeholder icon.  Below this threshold the aircraft image is too small
 * to be useful, so the fixed-size yellow icon is shown instead.
 */
export const MIN_AIRCRAFT_PX = 14;

// ── Public helpers ────────────────────────────────────────────────

/** Resolve a raw aircraft type string to one of the eight canonical keys. */
export function resolveAircraftType(rawType: string): string {
  if (!rawType) return 'B737';
  const direct = TYPE_ALIASES[rawType];
  if (direct) return direct;
  const upper = rawType.toUpperCase().replace(/\s+/g, '');
  for (const [key, val] of Object.entries(TYPE_ALIASES)) {
    if (key.toUpperCase().replace(/\s+/g, '') === upper) return val;
  }
  return 'B737'; // safe fallback
}

/** Get the full display config for a raw aircraft type string. */
export function getAircraftDisplay(rawType: string): AircraftDisplayConfig {
  const key = resolveAircraftType(rawType);
  return AIRCRAFT_DISPLAY[key] ?? AIRCRAFT_DISPLAY['B737'];
}

/**
 * Get the URL for an image asset.
 * Uses Vite's import.meta.url trick so images are fingerprinted in prod.
 */
export function getImageUrl(filename: string): string {
  // Vite resolves new URL(..., import.meta.url) at build time for static paths.
  // For a fully dynamic lookup, we use a map of pre-resolved URLs.
  return IMAGE_URLS[filename] ?? IMAGE_URLS['airplane-icon-yellow.png'];
}

// Build the static URL map at module load time (all 9 filenames known).
const IMAGE_URLS: Record<string, string> = {
  '737.png':                  new URL('../images/737.png',                  import.meta.url).href,
  '747.png':                  new URL('../images/747.png',                  import.meta.url).href,
  '767.png':                  new URL('../images/767.png',                  import.meta.url).href,
  '777.png':                  new URL('../images/777.png',                  import.meta.url).href,
  '787.png':                  new URL('../images/787.png',                  import.meta.url).href,
  'A320.png':                 new URL('../images/A320.png',                 import.meta.url).href,
  'A350.png':                 new URL('../images/A350.png',                 import.meta.url).href,
  'A380.png':                 new URL('../images/A380.png',                 import.meta.url).href,
  'airplane-icon-yellow.png': new URL('../images/airplane-icon-yellow.png', import.meta.url).href,
};

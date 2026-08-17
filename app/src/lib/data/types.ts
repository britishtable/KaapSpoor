export interface Coords { lat: number; lon: number; zoom: number; }

/**
 * How well a route's position is known. `crawl` is the coordinate the source
 * page carried; `curated` was looked up and cited by hand; `osm-match` was tied
 * to a named OSM feature inside the route's own area; `area-approx` is the
 * area's centroid and is only as good as `coordsAccuracyM` says.
 */
export type CoordsSource = 'crawl' | 'curated' | 'osm-match' | 'area-approx';

export interface OsmRef { type: string; id: number; name: string; }

/**
 * One entry of data/route-locations.json, written by tools/geocode.
 *
 * Split by `source` so the optional fields are discriminated rather than
 * merely conventional: only an `area-approx` entry can carry an accuracy
 * radius, and only an `osm-match` entry an OSM reference.
 */

/** A location the app can place on the map as a point. */
export interface PreciseLocation {
  coords: Coords;
  source: 'crawl' | 'curated' | 'osm-match';
  osm?: OsmRef;
}

/** An area-level guess. Deliberately NOT rendered as a point: it carries a
 *  radius in kilometres, and drawing it as a dot would imply metre precision
 *  the coordinate does not have. Held here until the map can draw uncertainty. */
export interface ApproximateLocation {
  coords: Coords;
  source: 'area-approx';
  accuracyM: number;
}

export type RouteLocation = PreciseLocation | ApproximateLocation;

export interface RouteIndexEntry {
  id: string;
  title: string;
  area: string[];
  coords: Coords | null;
  /** Never null when `coords` is non-null, and vice versa. */
  coordsSource: CoordsSource | null;
  /** Metres. Set for `area-approx` only. */
  coordsAccuracyM: number | null;
  /** Set for `osm-match` only. */
  coordsOsm: OsmRef | null;
  /**
   * OSM names of paths this route's description mentions, in the order the
   * prose introduces them. Empty when it names none — 24 of the 133 in-region
   * routes do. These are paths the description REFERS TO, which includes
   * escape routes and paths merely crossed; they are not the route's own line.
   * See docs/superpowers/specs/2026-08-06-phase4e-named-paths-design.md.
   */
  mentionedPaths: string[];
  /**
   * True when the author has drawn this route's line. The geometry itself
   * lives in one static file the map fetches once — see
   * docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md.
   */
  hasLine: boolean;
  grade: string | null;
  gradeSource: 'label' | 'prose' | null;
  time: string | null;
  heightGain: string | null;
  isFullEntry: boolean;
}

/** One drawn line of a route: an alternative, with a caption saying what it is. */
export interface RouteLine {
  variant: string | null;
  note: string | null;
}

export interface RouteContent extends RouteIndexEntry {
  sections: Record<string, string>;
  description: string;
  related: { id: string; title: string }[];
  attachments: string[];
  photoCount: number;
  sourceUrl: string;
  /** Empty when nothing is drawn. One entry per variant, in file order. */
  lines: RouteLine[];
}

export interface JournalEntry {
  routeId: string;
  done: boolean;
  date: string | null;
  notes: string;
}

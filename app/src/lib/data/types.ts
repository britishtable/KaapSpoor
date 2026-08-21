import type { SegmentRole } from './segments';

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
   * True when the author has drawn this route's MAIN line. Approach and exit
   * segments without a main are not a route. The geometry itself lives in one
   * static file the map fetches once — see
   * docs/superpowers/specs/2026-08-17-drawn-route-lines-design.md.
   */
  hasLine: boolean;
  grade: string | null;
  gradeSource: 'label' | 'prose' | null;
  time: string | null;
  heightGain: string | null;
  isFullEntry: boolean;
}

/**
 * One drawn segment of a route, without its geometry.
 *
 * The coordinates stay in the single static route-lines.geojson the map and
 * the route page each fetch once; carrying them here would put a few hundred
 * positions into every per-route JSON.
 */
export interface RouteSegmentMeta {
  segmentId: string;
  role: SegmentRole;
  /** The picker label. Null when the role holds only one option. */
  name: string | null;
  note: string | null;
}

/**
 * What the drawn line measures. `ascentM` is null when the line carries no
 * heights — "not measured" and "flat" are different claims.
 */
export interface RouteLineStats {
  distanceM: number;
  ascentM: number | null;
}

export interface RouteContent extends RouteIndexEntry {
  sections: Record<string, string>;
  description: string;
  related: { id: string; title: string }[];
  attachments: string[];
  photoCount: number;
  sourceUrl: string;
  /** Empty when nothing is drawn. Every segment, in file order. */
  segments: RouteSegmentMeta[];
  /**
   * The DEFAULT PLAN's numbers — first main, plus the first approach and exit
   * that connect to it. Null when the route has no main. Was "the longest
   * variant"; a reader walks a day, not a line.
   */
  lineStats: RouteLineStats | null;
}

/**
 * The walk actually taken, by segment id.
 *
 * Optional, and absent on every entry written before segments existed — which
 * is why `done` stays keyed on routeId rather than on a plan. A tick with no
 * plan is a legacy or unrecorded one, and stays valid forever.
 */
export interface JournalPlan {
  approach?: string;
  main?: string;
  exit?: string;
  reversed: boolean;
}

export interface JournalEntry {
  routeId: string;
  done: boolean;
  date: string | null;
  notes: string;
  plan?: JournalPlan;
}

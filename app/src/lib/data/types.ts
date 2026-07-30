export interface Coords { lat: number; lon: number; zoom: number; }

/**
 * How well a route's position is known. `crawl` is the coordinate the source
 * page carried; `curated` was looked up and cited by hand; `osm-match` was tied
 * to a named OSM feature inside the route's own area; `area-approx` is the
 * area's centroid and is only as good as `coordsAccuracyM` says.
 */
export type CoordsSource = 'crawl' | 'curated' | 'osm-match' | 'area-approx';

export interface OsmRef { type: string; id: number; name: string; }

/** One entry of data/route-locations.json, written by tools/geocode. */
export interface RouteLocation {
  coords: Coords;
  source: CoordsSource;
  accuracyM?: number;
  osm?: OsmRef;
}

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
  grade: string | null;
  gradeSource: 'label' | 'prose' | null;
  time: string | null;
  heightGain: string | null;
  isFullEntry: boolean;
}

export interface RouteContent extends RouteIndexEntry {
  sections: Record<string, string>;
  description: string;
  related: { id: string; title: string }[];
  attachments: string[];
  photoCount: number;
  sourceUrl: string;
}

export interface JournalEntry {
  routeId: string;
  done: boolean;
  date: string | null;
  notes: string;
}

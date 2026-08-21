import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeId } from '../src/lib/data/ids';
import { mentionedPaths, type OsmPathName } from '../src/lib/data/path-mentions';
import type {
  RouteIndexEntry,
  RouteContent,
  RouteLineStats,
  RouteLocation,
  RouteSegmentMeta
} from '../src/lib/data/types';
import type { Point3 } from '../src/lib/map/profile';
import { isRole } from '../src/lib/data/segments';
import {
  resolvePlan, assemble, planStats, gapM, joins, JUNCTION_TOLERANCE_M, type PlanSegment
} from '../src/lib/data/plan';

interface RawRoute {
  slug: string; title: string; url: string; area: string[];
  coords: { lat: number; lon: number; zoom: number } | null;
  grade: string | null; grade_source: 'label' | 'prose' | null;
  stats: Record<string, string>; sections: Record<string, string>;
  description: string; related: string[]; attachments: string[];
  photos: { deck_ids: string[]; inline_urls: string[] };
}
export interface RawDataset { routes: RawRoute[]; [k: string]: unknown; }

export function statValue(stats: Record<string, string>, name: string): string | null {
  const hit = Object.entries(stats).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit ? hit[1] : null;
}

export interface RouteLineFeature {
  geometry?: { type: 'LineString'; coordinates: number[][] };
  properties: {
    routeId: string;
    segmentId?: string;
    role?: string;
    name?: string;
    note?: string;
  };
}
export interface RouteLines {
  features: RouteLineFeature[];
}

export function transform(
  raw: RawDataset,
  locations: Record<string, RouteLocation> = {},
  pathNames: OsmPathName[] = [],
  lines: RouteLines = { features: [] }
): { index: RouteIndexEntry[]; content: RouteContent[] } {
  // GeoJSON positions are number[] by spec; narrow each one explicitly to
  // Point3 rather than casting, since a coordinate may or may not carry the
  // elevation sampled at Save.
  const toPoint3 = (coord: number[]): Point3 =>
    coord.length >= 3 ? [coord[0], coord[1], coord[2]] : [coord[0], coord[1]];

  // Every drawn segment, grouped by route, geometry included — the plan's stats
  // need the coordinates even though only the metadata is written out.
  const planByRoute = new Map<string, PlanSegment[]>();
  for (const feature of lines.features) {
    const { routeId: rid, segmentId, role, name, note } = feature.properties;
    // A feature with no role predates the segment schema and cannot be placed;
    // scripts/migrate-segments.ts exists to give it one.
    if (!segmentId || !isRole(role)) continue;
    const list = planByRoute.get(rid) ?? [];
    list.push({
      segmentId, role,
      name: name ?? null,
      note: note ?? null,
      coords: (feature.geometry?.coordinates ?? []).map(toPoint3)
    });
    planByRoute.set(rid, list);
  }

  const segmentsByRoute = new Map<string, RouteSegmentMeta[]>();
  const statsByRoute = new Map<string, RouteLineStats>();
  for (const [rid, segments] of planByRoute) {
    segmentsByRoute.set(
      rid,
      segments.map(({ segmentId, role, name, note }) => ({ segmentId, role, name, note }))
    );
    const plan = resolvePlan(segments);
    if (!plan.choice.main) continue;
    const stats = planStats(assemble(plan.chosen));
    statsByRoute.set(rid, {
      distanceM: Math.round(stats.distanceM),
      ascentM: stats.ascentM === null ? null : Math.round(stats.ascentM)
    });
    // A near miss is almost always a segment whose neighbour was redrawn under
    // it. Warned rather than thrown: the build must still produce a site, and
    // the picker already refuses to OFFER an unconnected pairing, so the reader
    // never sees a total that crosses this gap.
    //
    // Judged purely locally against EACH main, not against the resolved plan:
    // `plan.approaches`/`plan.exits` are only the pairings computed for the
    // ONE chosen main (the first in file order), so on a route with a second
    // main an approach that meets IT exactly was never considered for that
    // main at all, and testing plan membership would misreport a perfect
    // junction as a near miss.
    const mains = segments.filter((s) => s.role === 'main');
    for (const main of mains) {
      for (const s of segments) {
        if (s.role === 'approach' && !joins(s, main)) {
          const d = gapM(s, main);
          if (d <= JUNCTION_TOLERANCE_M) {
            console.warn(`${s.segmentId} does not meet ${main.segmentId} (${d.toFixed(1)} m)`);
          }
        }
        if (s.role === 'exit' && !joins(main, s)) {
          const d = gapM(main, s);
          if (d <= JUNCTION_TOLERANCE_M) {
            console.warn(`${s.segmentId} does not meet ${main.segmentId} (${d.toFixed(1)} m)`);
          }
        }
      }
    }
  }
  const idFor = (r: RawRoute) => routeId(r.area, r.slug);
  // The source's `related` field is the full site nav (every page links to
  // every other), so it is useless as relations. Instead relate routes that
  // share the same area path — "other routes in this sub-area".
  const areaKey = (area: string[]) => JSON.stringify(area);
  const siblings = new Map<string, { id: string; title: string }[]>();
  for (const r of raw.routes) {
    const key = areaKey(r.area);
    const list = siblings.get(key) ?? [];
    list.push({ id: idFor(r), title: r.title });
    siblings.set(key, list);
  }

  const index: RouteIndexEntry[] = [];
  const content: RouteContent[] = [];
  for (const r of raw.routes) {
    const id = idFor(r);
    // route-locations.json is the single source of truth for provenance and
    // wins over the crawl's own coords: a curated entry exists precisely
    // because somebody judged the crawl coordinate wrong or missing.
    //
    // The gate that used to drop every `area-approx` entry here was lifted in
    // Phase 4c, on the condition its own comment set: that the map could draw
    // uncertainty first. It can. What now keeps the Otter Trail's area centroid
    // — near Worcester, 450 km from the walk — from passing as a surveyed
    // position is not this function but two things downstream, and removing
    // either one puts the gate back on the table:
    //
    //   1. src/lib/map/pins.ts draws a route with `coordsSource: 'area-approx'`
    //      as a HOLLOW pin, always, at every zoom, selected or not.
    //   2. Selecting one draws its accuracy circle and frames the camera on
    //      that circle rather than flying to z14, so the radius is visible
    //      rather than implied.
    //
    // Both depend on `coordsAccuracyM` and `coordsSource` reaching the app, so
    // they are written out below rather than nulled.
    const recorded = locations[id];
    // An area centroid is strictly less information than a coordinate for the
    // route itself: it is a fallback for a route that has nothing, never a
    // replacement for something better. (geocode only emits it as a last
    // resort, so today this changes no route — it is here so a future re-crawl
    // cannot quietly downgrade a real coordinate to its area's midpoint.)
    const location = recorded?.source === 'area-approx' && r.coords ? undefined : recorded;
    const entry: RouteIndexEntry = {
      id, title: r.title, area: r.area,
      coords: location?.coords ?? r.coords,
      coordsSource: location?.source ?? (r.coords ? 'crawl' : null),
      // Only `area-approx` carries a radius; the discriminated union in
      // types.ts is what makes reading it off any other source impossible.
      coordsAccuracyM: location?.source === 'area-approx' ? location.accuracyM : null,
      // Only a precise location can carry an OSM reference; the discriminated
      // union means `area-approx` never reaches `.osm` at all.
      coordsOsm: location && location.source !== 'area-approx' ? (location.osm ?? null) : null,
      // Matched against the prose, not the title: this is what the description
      // TALKS ABOUT, which is what makes the map readable beside it. Lives on
      // the index rather than the per-route content because the map needs the
      // union of all of them at load time to label the static tier, and
      // `npm test` runs before `build:data` has ever produced anything.
      mentionedPaths: mentionedPaths(Object.values(r.sections).join(' '), pathNames),
      // A flag rather than the geometry: the line itself is fetched once,
      // lazily, from a single static file the first time a selection needs it
      // — so 184 index entries do not each carry a few hundred coordinates.
      hasLine: statsByRoute.has(id),
      grade: r.grade, gradeSource: r.grade_source,
      time: statValue(r.stats, 'Time'),
      heightGain: statValue(r.stats, 'Height gain'),
      isFullEntry: Object.keys(r.stats).length > 0 || r.grade_source === 'label'
    };
    index.push(entry);
    const related = (siblings.get(areaKey(r.area)) ?? [])
      .filter((s) => s.id !== id)
      .sort((a, b) => a.title.localeCompare(b.title));
    content.push({
      ...entry, sections: r.sections, description: r.description,
      related, attachments: r.attachments,
      photoCount: r.photos.deck_ids.length + r.photos.inline_urls.length,
      sourceUrl: r.url,
      segments: segmentsByRoute.get(id) ?? [],
      lineStats: statsByRoute.get(id) ?? null
    });
  }
  return { index, content };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, '../../data/routes.json'), 'utf-8')) as RawDataset;
  // Absent on a fresh clone that has not run tools/geocode yet; every route
  // then falls back to its crawl coordinate, which is the pre-Phase-3 behaviour.
  const locationsPath = resolve(here, '../../data/route-locations.json');
  const locations = existsSync(locationsPath)
    ? (JSON.parse(readFileSync(locationsPath, 'utf-8')).locations as Record<string, RouteLocation>)
    : {};
  // Absent on a clone that has not run tools/pathnames; every route then names
  // no paths, which is the pre-Phase-4e behaviour and builds fine.
  const pathNamesPath = resolve(here, '../../data/osm-path-names.json');
  const pathNames = existsSync(pathNamesPath)
    ? (JSON.parse(readFileSync(pathNamesPath, 'utf-8')).names as OsmPathName[])
    : [];
  // Absent on a clone that has not run tools/routelines; every route then has
  // no line, which is the pre-Phase-4d behaviour and builds fine.
  const linesPath = resolve(here, '../../data/route-lines.geojson');
  const lines = existsSync(linesPath)
    ? (JSON.parse(readFileSync(linesPath, 'utf-8')) as RouteLines)
    : { features: [] };
  const { index, content } = transform(raw, locations, pathNames, lines);
  const out = resolve(here, '../static/data');
  await mkdir(resolve(out, 'routes'), { recursive: true });
  await writeFile(resolve(out, 'routes-index.json'), JSON.stringify(index));
  // Copied rather than imported by the app: it is one static asset the map
  // fetches at runtime, and copying keeps data/ the single source of truth.
  await writeFile(resolve(out, 'route-lines.geojson'), JSON.stringify(lines));
  for (const c of content) await writeFile(resolve(out, `routes/${c.id}.json`), JSON.stringify(c));
  const bySource = new Map<string, number>();
  for (const e of index) if (e.coordsSource) bySource.set(e.coordsSource, (bySource.get(e.coordsSource) ?? 0) + 1);
  const withPaths = index.filter((e) => e.mentionedPaths.length).length;
  const vocabulary = new Set(index.flatMap((e) => e.mentionedPaths));
  console.log(
    `transform: ${index.length} routes, ${index.filter((e) => e.coords).length} located ` +
      `(${[...bySource].map(([k, v]) => `${k}=${v}`).join(', ')}); ` +
      `${withPaths} name a mapped path, ${vocabulary.size} distinct names used ` +
      `of ${pathNames.length} available; ` +
      `${index.filter((e) => e.hasLine).length} have a drawn line`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

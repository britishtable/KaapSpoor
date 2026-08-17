import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeId } from '../src/lib/data/ids';
import { mentionedPaths, type OsmPathName } from '../src/lib/data/path-mentions';
import type { RouteIndexEntry, RouteContent, RouteLine, RouteLocation } from '../src/lib/data/types';

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
  properties: { routeId: string; variant?: string; note?: string };
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
  // Grouped per route: an entry may carry several drawn alternatives, and the
  // panel needs each one's name and caption. The geometry stays out of the
  // per-route JSON — only the map fetches that.
  const linesByRoute = new Map<string, RouteLine[]>();
  for (const feature of lines.features) {
    const list = linesByRoute.get(feature.properties.routeId) ?? [];
    list.push({
      variant: feature.properties.variant ?? null,
      note: feature.properties.note ?? null
    });
    linesByRoute.set(feature.properties.routeId, list);
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
      coordsOsm: location?.osm ?? null,
      // Matched against the prose, not the title: this is what the description
      // TALKS ABOUT, which is what makes the map readable beside it. Lives on
      // the index rather than the per-route content because the map needs the
      // union of all of them at load time to label the static tier, and
      // `npm test` runs before `build:data` has ever produced anything.
      mentionedPaths: mentionedPaths(Object.values(r.sections).join(' '), pathNames),
      // A flag rather than the geometry: the line itself is fetched once,
      // lazily, from a single static file the first time a selection needs it
      // — so 184 index entries do not each carry a few hundred coordinates.
      hasLine: linesByRoute.has(id),
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
      lines: linesByRoute.get(id) ?? []
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

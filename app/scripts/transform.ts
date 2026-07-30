import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeId } from '../src/lib/data/ids';
import type { RouteIndexEntry, RouteContent, RouteLocation } from '../src/lib/data/types';

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

export function transform(
  raw: RawDataset,
  locations: Record<string, RouteLocation> = {}
): { index: RouteIndexEntry[]; content: RouteContent[] } {
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
    // DO NOT REMOVE THIS GATE without the map first being able to draw
    // uncertainty. An `area-approx` entry is an area centroid with a radius of
    // kilometres; nothing in the app reads `coordsAccuracyM` yet, so merging it
    // would render a whole-region guess as a pin indistinguishable from a
    // surveyed one — e.g. the Otter Trail pinned near Worcester, 450 km out.
    // Until then such a route stays honestly unlocated, exactly as it was
    // before tools/geocode existed. The data remains in route-locations.json.
    const recorded = locations[id];
    const location = recorded?.source === 'area-approx' ? undefined : recorded;
    const entry: RouteIndexEntry = {
      id, title: r.title, area: r.area,
      coords: location?.coords ?? r.coords,
      coordsSource: location?.source ?? (r.coords ? 'crawl' : null),
      // Always null while the gate above holds: only `area-approx` ever carries
      // a radius, and `area-approx` never reaches this point.
      coordsAccuracyM: null,
      coordsOsm: location?.osm ?? null,
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
      sourceUrl: r.url
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
  const { index, content } = transform(raw, locations);
  const out = resolve(here, '../static/data');
  await mkdir(resolve(out, 'routes'), { recursive: true });
  await writeFile(resolve(out, 'routes-index.json'), JSON.stringify(index));
  for (const c of content) await writeFile(resolve(out, `routes/${c.id}.json`), JSON.stringify(c));
  const bySource = new Map<string, number>();
  for (const e of index) if (e.coordsSource) bySource.set(e.coordsSource, (bySource.get(e.coordsSource) ?? 0) + 1);
  console.log(
    `transform: ${index.length} routes, ${index.filter((e) => e.coords).length} located ` +
      `(${[...bySource].map(([k, v]) => `${k}=${v}`).join(', ')})`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeId } from '../src/lib/data/ids';
import type { RouteIndexEntry, RouteContent } from '../src/lib/data/types';

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

export function transform(raw: RawDataset): { index: RouteIndexEntry[]; content: RouteContent[] } {
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
    const entry: RouteIndexEntry = {
      id, title: r.title, area: r.area, coords: r.coords,
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
  const { index, content } = transform(raw);
  const out = resolve(here, '../static/data');
  await mkdir(resolve(out, 'routes'), { recursive: true });
  await writeFile(resolve(out, 'routes-index.json'), JSON.stringify(index));
  for (const c of content) await writeFile(resolve(out, `routes/${c.id}.json`), JSON.stringify(c));
  console.log(`transform: ${index.length} routes, ${index.filter((e) => e.coords).length} located`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

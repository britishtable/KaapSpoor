import { readFileSync } from 'node:fs';
import { base } from '$app/paths';
import type { RouteContent, RouteIndexEntry } from '$lib/data/types';

export const prerender = true;

// entries() runs during the build and does NOT receive SvelteKit's asset-serving
// fetch, so read the generated index straight off disk (cwd is app/).
export function entries() {
  const index = JSON.parse(readFileSync('static/data/routes-index.json', 'utf-8')) as RouteIndexEntry[];
  return index.map((e) => ({ id: e.id }));
}

// load() DOES get the special fetch, which serves generated static assets at prerender.
export async function load({ params, fetch }) {
  const route = (await (await fetch(`${base}/data/routes/${params.id}.json`)).json()) as RouteContent;
  return { route };
}

import { base } from '$app/paths';
import type { RouteIndexEntry } from '$lib/data/types';
import type { PageLoad } from './$types';

export const prerender = true;

export const load: PageLoad = async ({ fetch }) => {
  const entries = (await (await fetch(`${base}/data/routes-index.json`)).json()) as RouteIndexEntry[];
  return { entries };
};

import { base } from '$app/paths';
import type { RouteIndexEntry } from '$lib/data/types';

export const prerender = true;

export async function load({ fetch }) {
  const entries = (await (await fetch(`${base}/data/routes-index.json`)).json()) as RouteIndexEntry[];
  return { entries };
}

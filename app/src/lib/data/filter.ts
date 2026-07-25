import type { RouteIndexEntry } from './types';

export interface FilterOptions {
  query: string;
  status: 'all' | 'done' | 'todo';
  located: 'all' | 'mapped' | 'unmapped';
}

export function filterEntries(
  entries: RouteIndexEntry[],
  opts: FilterOptions,
  doneIds: Set<string>
): RouteIndexEntry[] {
  const q = opts.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (q && !e.title.toLowerCase().includes(q)) return false;
    if (opts.status === 'done' && !doneIds.has(e.id)) return false;
    if (opts.status === 'todo' && doneIds.has(e.id)) return false;
    if (opts.located === 'mapped' && !e.coords) return false;
    if (opts.located === 'unmapped' && e.coords) return false;
    return true;
  });
}

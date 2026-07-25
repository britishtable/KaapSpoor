import type { JournalEntry } from '../data/types';

export interface JournalExport {
  version: 1;
  exportedAt: string;
  entries: JournalEntry[];
}

export function serialize(entries: JournalEntry[]): string {
  const payload: JournalExport = { version: 1, exportedAt: new Date().toISOString(), entries };
  return JSON.stringify(payload, null, 2);
}

function isEntry(x: unknown): x is JournalEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.routeId === 'string' &&
    typeof e.done === 'boolean' &&
    (e.date === null || typeof e.date === 'string') &&
    typeof e.notes === 'string'
  );
}

export function parse(json: string): JournalEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const obj = data as { version?: unknown; entries?: unknown };
  if (obj.version !== 1 || !Array.isArray(obj.entries)) {
    throw new Error('Not a KaapSpoor journal export.');
  }
  if (!obj.entries.every(isEntry)) {
    throw new Error('Journal contains a malformed entry.');
  }
  return obj.entries as JournalEntry[];
}

export function merge(
  current: Map<string, JournalEntry>,
  incoming: JournalEntry[],
  mode: 'merge' | 'replace'
): JournalEntry[] {
  if (mode === 'replace') return [...incoming];
  const out = new Map(current);
  for (const e of incoming) out.set(e.routeId, e);
  return [...out.values()];
}

import type { JournalEntry, JournalPlan } from '../data/types';

export interface JournalExport {
  version: 1;
  exportedAt: string;
  entries: JournalEntry[];
}

export function serialize(entries: JournalEntry[]): string {
  const payload: JournalExport = { version: 1, exportedAt: new Date().toISOString(), entries };
  return JSON.stringify(payload, null, 2);
}

function isPlan(x: unknown): x is JournalPlan {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  const optionalId = (v: unknown) => v === undefined || typeof v === 'string';
  return (
    typeof p.reversed === 'boolean' &&
    optionalId(p.approach) && optionalId(p.main) && optionalId(p.exit)
  );
}

function isEntry(x: unknown): x is JournalEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.routeId === 'string' &&
    typeof e.done === 'boolean' &&
    (e.date === null || typeof e.date === 'string') &&
    typeof e.notes === 'string' &&
    (e.plan === undefined || isPlan(e.plan))
  );
}

export function parse(json: string): JournalEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) {
    throw new Error('Not a KaapSpoor journal export.');
  }
  const obj = data as { version?: unknown; entries?: unknown };
  if (obj.version !== 1 || !Array.isArray(obj.entries)) {
    throw new Error('Not a KaapSpoor journal export.');
  }
  if (!obj.entries.every(isEntry)) {
    throw new Error('Journal contains a malformed entry.');
  }
  // Normalize to exactly the JournalEntry shape so junk fields from a
  // hand-edited or foreign file never reach IndexedDB.
  return (obj.entries as JournalEntry[]).map((e) => {
    const entry: JournalEntry = {
      routeId: e.routeId, done: e.done, date: e.date, notes: e.notes
    };
    // Rebuilt field by field for the same reason the entry is: a hand-edited
    // file must not smuggle extra keys into IndexedDB.
    if (e.plan) {
      const plan: JournalPlan = { reversed: e.plan.reversed };
      if (e.plan.approach) plan.approach = e.plan.approach;
      if (e.plan.main) plan.main = e.plan.main;
      if (e.plan.exit) plan.exit = e.plan.exit;
      entry.plan = plan;
    }
    return entry;
  });
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

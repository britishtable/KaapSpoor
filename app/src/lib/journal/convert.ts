import type { Hike, JournalPlan, RouteNotes } from '../data/types';

/** A plan whose legs are absent, null (as a server or an export of one may write them) or ids. */
export function isPlan(x: unknown): x is JournalPlan {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  const optionalId = (v: unknown) => v === undefined || v === null || typeof v === 'string';
  return (
    typeof p.reversed === 'boolean' &&
    optionalId(p.approach) && optionalId(p.main) && optionalId(p.exit)
  );
}

/** The plan as the app stores it: absent legs omitted, never null or empty. */
export function cleanPlan(p: { approach?: string | null; main?: string | null; exit?: string | null; reversed: boolean }): JournalPlan {
  const plan: JournalPlan = { reversed: p.reversed };
  if (p.approach) plan.approach = p.approach;
  if (p.main) plan.main = p.main;
  if (p.exit) plan.exit = p.exit;
  return plan;
}

/**
 * Turns old one-per-route journal entries into hikes plus route notes.
 * Pure and lenient: legacy rows may lack fields, so each is read defensively.
 * A done entry's plan goes to both the hike (which way it went) and the
 * route notes (the user's saved plan).
 */
export function convertJournal(
  entries: unknown[],
  now: string,
  newId: () => string
): { hikes: Hike[]; routeNotes: RouteNotes[] } {
  const hikes: Hike[] = [];
  const routeNotes: RouteNotes[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.routeId !== 'string' || e.routeId === '') continue;
    const routeId = e.routeId;
    const date = typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : null;
    const notes = typeof e.notes === 'string' ? e.notes : '';
    const plan = isPlan(e.plan) ? cleanPlan(e.plan) : undefined;

    if (e.done) {
      const hike: Hike = {
        id: newId(), routeId, date, notes: '',
        visibility: 'PRIVATE', notesVisibility: 'PRIVATE',
        startedAt: null, finishedAt: null, updatedAt: now,
        deleted: false, owner: null, pending: true
      };
      if (plan) hike.plan = { ...plan };
      hikes.push(hike);
    }
    if (notes !== '' || plan) {
      const rn: RouteNotes = { routeId, notes, updatedAt: now };
      if (plan) rn.plan = { ...plan };
      routeNotes.push(rn);
    }
  }
  return { hikes, routeNotes };
}

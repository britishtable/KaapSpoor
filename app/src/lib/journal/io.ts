import {
  DIFFICULTY_GRADED, DIFFICULTY_UNGRADED, NAVIGATION_ANSWERS,
  SAFETY_ANSWERS, WATER_ANSWERS,
  type Hike, type JournalPlan, type Review, type RouteNotes, type Visibility
} from '../data/types';
import { cleanPlan, cleanReview, convertJournal, isPlan } from './convert';
import { canReview, localDate, now, reviewProblem } from './store';

export interface Data { hikes: Hike[]; routeNotes: RouteNotes[] }

/**
 * The hikes an export may contain: the viewer's and unowned ones. Signed out, that is
 * only unowned hikes: the same lock an import applies (see merge).
 */
export function exportableHikes(all: Hike[], viewer: string | null): Hike[] {
  return all.filter((h) => !h.deleted && (h.owner === null || h.owner === viewer));
}

export function serialize(d: Data): string {
  const hikes = d.hikes.filter((h) => !h.deleted).map((h) => {
    const { owner: _o, pending: _p, syncError: _s, ...rest } = h;
    return rest;
  });
  return JSON.stringify(
    { version: 2, exportedAt: new Date().toISOString(), hikes, routeNotes: d.routeNotes }, null, 2
  );
}

const VIS: Visibility[] = ['PRIVATE', 'FRIENDS', 'PUBLIC'];
const isVis = (x: unknown): x is Visibility => VIS.includes(x as Visibility);
const isStrOrNull = (x: unknown) => x === null || typeof x === 'string';
/** A calendar date as the app writes it ("2026-07-21"); a hand-edited "21/07/2026" is malformed. */
const isDateOrNull = (x: unknown) => x === null || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));

const oneOf = (list: readonly string[]) => (v: unknown) => v === undefined || v === null || list.includes(v as string);
const isStr = (v: unknown) => v === undefined || v === null || typeof v === 'string';
const isNum = (v: unknown) => v === undefined || v === null || typeof v === 'number';
/** Types and enum membership only; ranges, lengths and combinations are reviewProblem's. */
const REVIEW_CHECKS: Record<string, (v: unknown) => boolean> = {
  difficulty: oneOf([...DIFFICULTY_GRADED, ...DIFFICULTY_UNGRADED]),
  enjoyment: isNum, safety: oneOf(SAFETY_ANSWERS), navigation: oneOf(NAVIGATION_ANSWERS),
  water: oneOf(WATER_ANSWERS), note: isStr, safetyNote: isStr
};
function isReview(x: unknown): boolean {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return Object.entries(REVIEW_CHECKS).every(([k, ok]) => ok(r[k]));
}

function toHike(x: unknown): Hike | null {
  if (typeof x !== 'object' || x === null) return null;
  const h = x as Record<string, unknown>;
  if (
    typeof h.id !== 'string' || typeof h.routeId !== 'string' ||
    !isDateOrNull(h.date) || typeof h.notes !== 'string' ||
    !isVis(h.visibility) || !isVis(h.notesVisibility) ||
    !isStrOrNull(h.startedAt) || !isStrOrNull(h.finishedAt) ||
    typeof h.updatedAt !== 'string' || typeof h.deleted !== 'boolean' ||
    (h.plan !== undefined && !isPlan(h.plan)) ||
    (h.review !== undefined && h.review !== null && !isReview(h.review))
  ) return null;
  const hike: Hike = {
    id: h.id, routeId: h.routeId, date: h.date as string | null, notes: h.notes,
    visibility: h.visibility, notesVisibility: h.notesVisibility,
    startedAt: h.startedAt as string | null, finishedAt: h.finishedAt as string | null,
    updatedAt: h.updatedAt, deleted: h.deleted, owner: null, pending: true
  };
  if (h.plan) hike.plan = cleanPlan(h.plan as JournalPlan);
  if (h.review) {
    const review = cleanReview(h.review as Review);
    // Unknown keys are dropped like any junk field.
    const known: Record<string, unknown> = {};
    for (const k of Object.keys(REVIEW_CHECKS)) if (k in review) known[k] = (review as Record<string, unknown>)[k];
    hike.review = known as Review;
    // The same validity the store enforces; a review the server would 400 must not be imported.
    if (reviewProblem(hike.review) || !canReview(hike, localDate())) return null;
  }
  return hike;
}

function toNotes(x: unknown): RouteNotes | null {
  if (typeof x !== 'object' || x === null) return null;
  const n = x as Record<string, unknown>;
  if (typeof n.routeId !== 'string' || typeof n.notes !== 'string' || typeof n.updatedAt !== 'string') return null;
  if (n.plan !== undefined && !isPlan(n.plan)) return null;
  const out: RouteNotes = { routeId: n.routeId, notes: n.notes, updatedAt: n.updatedAt };
  if (n.plan) out.plan = cleanPlan(n.plan as JournalPlan);
  return out;
}

export function parse(json: string): Data {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) throw new Error('Not a KaapSpoor export.');
  const obj = data as { version?: unknown; entries?: unknown; hikes?: unknown; routeNotes?: unknown };

  if (obj.version === 1 && Array.isArray(obj.entries)) {
    return convertJournal(obj.entries, now(), () => crypto.randomUUID());
  }
  if (obj.version === 2 && Array.isArray(obj.hikes) && Array.isArray(obj.routeNotes)) {
    const hikes = obj.hikes.map(toHike);
    const notes = obj.routeNotes.map(toNotes);
    if (hikes.some((h) => h === null) || notes.some((n) => n === null)) {
      throw new Error('The file contains a malformed hike.');
    }
    return { hikes: hikes as Hike[], routeNotes: notes as RouteNotes[] };
  }
  throw new Error('Not a KaapSpoor export.');
}

function newer<T extends { updatedAt: string }>(a: T | undefined, b: T): T {
  // Compare as instants: "…:05Z" and "…:05.500Z" sort wrongly as strings.
  return a && Date.parse(a.updatedAt) > Date.parse(b.updatedAt) ? a : b;
}

/**
 * `current` is everything on the device, tombstones and other owners included.
 * A local hike is never overwritten by an import when it is a tombstone
 * (deletion is final) or belongs to an account other than the viewer's (which,
 * signed out, is every account) on a shared phone.
 */
export function merge(
  current: Data, incoming: Data, mode: 'merge' | 'replace', viewer: string | null = null
): Data {
  const locked = (h: Hike) =>
    h.deleted || (h.owner !== null && h.owner !== viewer);
  const hikes = new Map<string, Hike>();
  for (const h of current.hikes) {
    if (mode === 'merge' || locked(h)) hikes.set(h.id, h);
  }
  for (const incomingHike of incoming.hikes) {
    const local = current.hikes.find((x) => x.id === incomingHike.id);
    if (local && locked(local)) continue;
    // Imported while signed in: the hike is the viewer's now. Left unowned, signing out
    // before it uploads would let the next account to sign in upload it as its own.
    const h = { ...incomingHike, owner: incomingHike.owner ?? viewer };
    hikes.set(h.id, mode === 'merge' ? newer(hikes.get(h.id), h) : h);
  }
  if (mode === 'replace') return { hikes: [...hikes.values()], routeNotes: [...incoming.routeNotes] };
  const notes = new Map(current.routeNotes.map((n) => [n.routeId, n]));
  for (const n of incoming.routeNotes) notes.set(n.routeId, newer(notes.get(n.routeId), n));
  return { hikes: [...hikes.values()], routeNotes: [...notes.values()] };
}

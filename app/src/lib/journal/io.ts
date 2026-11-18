import type { Hike, JournalPlan, RouteNotes, Visibility } from '../data/types';
import { convertJournal, isPlan } from './convert';
import { now } from './store';

export interface Data { hikes: Hike[]; routeNotes: RouteNotes[] }

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

function rebuildPlan(p: JournalPlan): JournalPlan {
  const plan: JournalPlan = { reversed: p.reversed };
  if (p.approach) plan.approach = p.approach;
  if (p.main) plan.main = p.main;
  if (p.exit) plan.exit = p.exit;
  return plan;
}

function toHike(x: unknown): Hike | null {
  if (typeof x !== 'object' || x === null) return null;
  const h = x as Record<string, unknown>;
  if (
    typeof h.id !== 'string' || typeof h.routeId !== 'string' ||
    !isStrOrNull(h.date) || typeof h.notes !== 'string' ||
    !isVis(h.visibility) || !isVis(h.notesVisibility) ||
    !isStrOrNull(h.startedAt) || !isStrOrNull(h.finishedAt) ||
    typeof h.updatedAt !== 'string' || typeof h.deleted !== 'boolean' ||
    (h.plan !== undefined && !isPlan(h.plan))
  ) return null;
  const hike: Hike = {
    id: h.id, routeId: h.routeId, date: h.date as string | null, notes: h.notes,
    visibility: h.visibility, notesVisibility: h.notesVisibility,
    startedAt: h.startedAt as string | null, finishedAt: h.finishedAt as string | null,
    updatedAt: h.updatedAt, deleted: h.deleted, owner: null, pending: true
  };
  if (h.plan) hike.plan = rebuildPlan(h.plan as JournalPlan);
  return hike;
}

function toNotes(x: unknown): RouteNotes | null {
  if (typeof x !== 'object' || x === null) return null;
  const n = x as Record<string, unknown>;
  if (typeof n.routeId !== 'string' || typeof n.notes !== 'string' || typeof n.updatedAt !== 'string') return null;
  if (n.plan !== undefined && !isPlan(n.plan)) return null;
  const out: RouteNotes = { routeId: n.routeId, notes: n.notes, updatedAt: n.updatedAt };
  if (n.plan) out.plan = rebuildPlan(n.plan as JournalPlan);
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
  return a && a.updatedAt > b.updatedAt ? a : b;
}

export function merge(current: Data, incoming: Data, mode: 'merge' | 'replace'): Data {
  if (mode === 'replace') return { hikes: [...incoming.hikes], routeNotes: [...incoming.routeNotes] };
  const hikes = new Map(current.hikes.map((h) => [h.id, h]));
  for (const h of incoming.hikes) hikes.set(h.id, newer(hikes.get(h.id), h));
  const notes = new Map(current.routeNotes.map((n) => [n.routeId, n]));
  for (const n of incoming.routeNotes) notes.set(n.routeId, newer(notes.get(n.routeId), n));
  return { hikes: [...hikes.values()], routeNotes: [...notes.values()] };
}

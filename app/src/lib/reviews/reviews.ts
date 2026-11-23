import { publicApi } from '../account/session';
import type { components } from '../api/schema';
import { DIFFICULTY_GRADED, DIFFICULTY_UNGRADED, SAFETY_ANSWERS, NAVIGATION_ANSWERS, WATER_ANSWERS } from '../data/types';

export type RouteReviews = components['schemas']['RouteReviews'];
export type PublicReview = components['schemas']['PublicReview'];
export type Counts = components['schemas']['Counts'];
export type Question = 'difficulty' | 'enjoyment' | 'safety' | 'navigation' | 'water';

/** Short chip labels, as the review form shows them. */
export const DIFF_LABELS = {
  EASIER: 'Easier', AS_GRADED: 'As graded', HARDER: 'Harder', EASY: 'Easy', MODERATE: 'Moderate', HARD: 'Hard'
} as const;
export const SAFETY_LABELS = { YES: 'Yes', MOSTLY: 'Mostly', NO: 'No' } as const;
export const NAV_LABELS = { OBVIOUS: 'Obvious', TRICKY_JUNCTIONS: 'Tricky junctions', GOT_LOST: 'Got lost' } as const;
export const WATER_LABELS = { NONE: 'None', SEASONAL: 'Seasonal', RELIABLE: 'Reliable' } as const;

/** One answer in words, as a hike's review line and a reviewer's list show it. */
export const DIFFICULTY_WORDS = {
  EASIER: 'Easier than graded', AS_GRADED: 'As graded', HARDER: 'Harder than graded',
  EASY: 'Easy', MODERATE: 'Moderate', HARD: 'Hard'
} as const;
const SAFETY_WORDS = { YES: 'Felt safe', MOSTLY: 'Felt mostly safe', NO: 'Did not feel safe' } as const;
const NAVIGATION_WORDS = { OBVIOUS: 'Easy to follow', TRICKY_JUNCTIONS: 'Tricky junctions', GOT_LOST: 'Got lost' } as const;
const WATER_WORDS = { NONE: 'No water', SEASONAL: 'Seasonal water', RELIABLE: 'Reliable water' } as const;

/** What a person says in a distribution line: "7 of 9 <said harder than graded>". */
const SAID: Record<string, string> = {
  EASIER: 'said easier than graded', AS_GRADED: 'said as graded', HARDER: 'said harder than graded',
  EASY: 'said easy', MODERATE: 'said moderate', HARD: 'said hard',
  YES: 'felt safe', MOSTLY: 'felt mostly safe', NO: 'did not feel safe',
  OBVIOUS: 'found it easy to follow', TRICKY_JUNCTIONS: 'found tricky junctions', GOT_LOST: 'got lost',
  NONE: 'found no water', SEASONAL: 'found seasonal water', RELIABLE: 'found reliable water'
};

function order(question: Question, graded: boolean): readonly string[] {
  switch (question) {
    case 'difficulty': return graded ? DIFFICULTY_GRADED : DIFFICULTY_UNGRADED;
    case 'enjoyment': return ['5', '4', '3', '2', '1'];
    case 'safety': return SAFETY_ANSWERS;
    case 'navigation': return NAVIGATION_ANSWERS;
    case 'water': return WATER_ANSWERS;
  }
}

/** Counts as lines like "7 of 9 said harder than graded": highest count first, zeros left out. Never an average. */
export function phrase(question: Question, counts: Counts, graded: boolean): string[] {
  const keys = order(question, graded);
  return keys
    .map((key, i) => ({ key, i, n: counts.counts[key] ?? 0 }))
    .filter((e) => e.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ key, n }) => {
      const what = question === 'enjoyment' ? `gave it ${key} out of 5` : SAID[key] ?? key.toLowerCase();
      return `${n} of ${counts.answered} ${what}`;
    });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-03" as "March 2026"; "Date not recorded" for a public hike with no date; null when no date is shown. */
export function formatMonth(month: string | null, dateRecorded: boolean): string | null {
  const m = month === null ? null : /^(\d{4})-(\d{2})$/.exec(month);
  if (m && MONTHS[Number(m[2]) - 1]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return dateRecorded ? null : 'Date not recorded';
}

/** One reviewer's answers in words, in the order the form asks them. */
export function answerWords(r: PublicReview): string[] {
  const out: string[] = [];
  if (r.difficulty) out.push(DIFFICULTY_WORDS[r.difficulty]);
  if (r.enjoyment !== undefined) out.push(`Enjoyed it ${r.enjoyment}/5`);
  if (r.safety) out.push(SAFETY_WORDS[r.safety]);
  if (r.navigation) out.push(NAVIGATION_WORDS[r.navigation]);
  if (r.water) out.push(WATER_WORDS[r.water]);
  return out;
}

/** 'unavailable': no API in this build, or the server says no (404, 5xx). 'offline': no network. */
export async function fetchRouteReviews(routeId: string): Promise<RouteReviews | 'offline' | 'unavailable'> {
  // A public read: no token, so an expired one can't turn it into a 401.
  const client = publicApi();
  if (!client) return 'unavailable';
  try {
    const res = await client.GET('/api/v1/routes/{routeId}/reviews', { params: { path: { routeId } } });
    return res.data ?? 'unavailable';
  } catch {
    return 'offline';
  }
}

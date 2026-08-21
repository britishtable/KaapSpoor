/**
 * What a drawn segment IS, before anything measures or draws it.
 *
 * Identity only — connectivity and arithmetic live in plan.ts. Kept apart so
 * the editor can name a segment without importing the profile machinery.
 */

export type SegmentRole = 'approach' | 'main' | 'exit';

/** Walking order, which is also the order the route page stacks its rows. */
export const ROLES: readonly SegmentRole[] = ['approach', 'main', 'exit'];

export function isRole(x: unknown): x is SegmentRole {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}

/** Lowercase, hyphenated, with runs of punctuation collapsed to one hyphen. */
export function slugPart(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A segment's permanent name.
 *
 * Qualified by the FULL routeId rather than the bare route slug: the source
 * data carries two different routes both slugged `klipspringer`, so a bare
 * slug would hand two mountains the same segment id.
 *
 * `taken` is every id already in use in the file. A collision suffixes rather
 * than overwriting, because an id is a promise: once written it must keep
 * pointing at the same line, or a journal entry and a shared URL both go stale.
 */
export function makeSegmentId(
  routeId: string,
  role: SegmentRole,
  name: string,
  taken: ReadonlySet<string>
): string {
  const leaf = slugPart(name) || role;
  const base = `${routeId}/${role}/${leaf}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

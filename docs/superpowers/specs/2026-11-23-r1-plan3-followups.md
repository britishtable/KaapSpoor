# R1 Plan 3 (reviews): follow-ups

These items were carried out of the plan 3 build (branch `r1-reviews`, 2026-11-23). Items fixed in the review rounds are not listed.

## Browser check: done 2026-11-23

Run in Chromium (Playwright) against a local server, PostGIS and the dev app at a 412 px phone width.

- **Review flow.** Registering in the UI, Start, Finish, then **Review the route** all work. The form says reviews are public, Save stays disabled until the first answer, and every chip is 48 px tall. Save is full width at the bottom.
- **Safety note.** "What happened?" hides when safety is cleared, and the typed text survives re-selecting it.
- **Sync.** The review reached the server. A second browser profile signed in as the same account received the hike and its review.
- **Remove.** Removing a review takes two taps.
- **Reviews section.** Distributions show ("2 of 3 said harder than graded") and questions below three answers are hidden. A public hike shows its month, a private one shows none, and a public undated one says "Date not recorded". HTML shows as text, and a 38-character name causes no sideways scroll. Today's review is not public yet.
- **Bug found and fixed:** missing spaces ("BongiOctober 2026", "What happened:One…", "1.2 km· ≈"). Svelte 5 trims whitespace at element and block edges. Fixed in `f4c7906`, with whole-line tests.

## Decisions made during the build (for review)

- **Release and order.**
  - A review is public only from the SA calendar day after its hike was last written. An edit re-hides it until the next day.
  - The public list is ordered by month, then name, never by write time, so it can't reveal that someone hiked today.
- **Each question is optional.** A review needs one answer or a note.
- **Latest per person.** "Latest review" is the review on a person's most recent hike by date, and only it counts.
  - If its difficulty is on the wrong scale after a regrade and nothing else is left, the person is dropped. They do not fall back to an older review.
- **Changing a reviewed hike's date.** Moving the date into the future is refused, with an explanation, rather than dropping the review.
- **Import.** A hike whose review the server would refuse is treated as malformed.

## Deferred minors

**Server**
- **Removal shows an older review.** Removing a review, or deleting its hike, today makes that person's older review visible at once. That reveals a removal today, but not a hike or its date. Fixing it needs review-less and deleted rows in the per-person pick, so check it against deletion scrubbing first.
- **Token clock.** The access-token `JwtDecoder` uses system time, not the injected `Clock`. This is harmless in production, but tests must register users before moving the clock.
- **Enjoyment range in the contract.** `enjoyment` has no minimum or maximum in the OpenAPI schema; only the service checks the range.
- **Untested enum.** There is no test that an unknown enum value is a 400.
- **Blank notes.** Java's `isBlank` treats U+001C-001F as whitespace and JS `trim` does not. Only a hand-edited import can reach this.

**App**
- **Two answer maps.** `reviews.ts` has a `SAID` map alongside the `*_WORDS` maps. Key both by the answer enums so a missing key is a compile error.
- **Thin tests.** No test covers:
  - a 5xx rendering nothing;
  - abandoning the fetch on a route change;
  - rendering `safetyNote`;
  - the response's `graded` winning over the page's;
  - `phrase` for `safety: NO`, "1 of 1", navigation and water.
- **No guard on Cancel.** The review form's Cancel discards answers without asking.
- **Error position.** The error shows below Save.
- **Stale date.** `today` is captured once per mount; `setReview` re-checks it.
- **Keyboard blur.** An armed "Tap again to remove" doesn't reset when focus moves away by keyboard.
- **Import edge cases.** A tombstone carrying a review fails the import, and a falsy non-object review is dropped.
- **Edits blocked on bad data.** `updateHike` blocks every edit on a hike already stored in a state that can't be reviewed. Only data from before the fix can reach this, and that never shipped.
- **Old clients.** A client that omits `review` in `HikeWrite` would erase the review. No such client exists; revisit this before a native app ships.

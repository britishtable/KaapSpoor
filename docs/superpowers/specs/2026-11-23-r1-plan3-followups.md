# R1 Plan 3 (reviews): follow-ups

These items were carried out of the plan 3 build (branch `r1-reviews`, 2026-11-23). Items fixed in the review rounds are not listed.

## Open: check not yet run

**Browser check (plan 3, Task 5 Step 5).** The API side was checked live against a real server and PostGIS. That check covered:
- the threshold, which appears at the third answer;
- hiding per question;
- the private and undated attribution;
- the second-device pull;
- deletion dropping the review from the counts;
- the next-day release and the time-free ordering.

Chrome couldn't be driven from the session, so the screens were never seen running. To run the check:
1. Run the server locally and `npm run dev` with `VITE_API_BASE_URL` set (see `server/README.md`).
2. Create an account, start a hike and finish it. **Review the route** appears; answer, then save.
3. Check the review form: Save stays disabled until there is one answer, "What happened?" keeps its text, and Remove takes two taps.
4. Check that the "Reviews are public…" line shows above Save.
5. Set the network to Offline in devtools, edit the review, then go back online. It sends with no action.
6. Sign in from a second browser profile. The hike and its review arrive.
7. On a route with three or more reviewers released before today, the route page shows distributions. Long names wrap. "Show N more" works.

This also covers plan 2's open manual check, in `2026-11-18-r1-plan2-followups.md`.

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

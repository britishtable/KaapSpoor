# R1 Plan 4 (reports): follow-ups

These items were carried out of the plan 4 build (branch `r1-reports`, 2026-11-23). Items fixed in the review rounds are not listed.

## Open: check not yet run

**Browser check (plan 4, Task 6 Step 5).** The API was checked live against a real server and PostGIS:
- A report filed mid-hike was held: invisible to the public and to another user's `/mine`, and a 404 to confirmation.
- It was released with the reporter's name on Finish.
- One "gone" didn't clear it, even twice from the same person. Two different people did, and so did the reporter alone.
- A cleared report refused further answers (409).
- A report filed from home was public at once.
- A safety report stayed unverified until someone else answered "still there".

That run used the build before the final fix wave. The final wave's server changes are covered by tests: any active hike holds a report, and the fallback counts from receipt.

The screens have never been seen running, because Chrome couldn't be driven from the session. Run this together with plan 3's owed browser check (`2026-11-23-r1-plan3-followups.md`):
1. **Report and pin.** Account A starts a hike and reports a fallen tree, using "Use my location" or picking the spot on the map. The form stays open while picking, and the spot stays marked.
2. **Held, then released.** Account B, in a second browser profile, doesn't see the report. A finishes, and B sees it with "Seen … ago" and a pin. Tapping the pin scrolls to the report.
3. **Cleared.** B answers Gone, then account C answers Gone. The report moves to "Earlier reports" as Cleared.
4. **Offline.** Set the network to Offline in devtools, file a report, then go back online. It sends with no action.
5. **Another route.** During a hike on route X, report on route Y. The form says it will show once you finish, and the report isn't public until X finishes.
6. **Upgrade banner.** With an old tab open, load the new build. The banner says "Close other KaapSpoor tabs to finish updating."
7. **Contrast.** Measure AA contrast for `.hint` and `.age` (stacked opacity) in light and dark themes.

## Decisions made during the build (for review)

- **Holding and the 12 h fallback.**
  - Any of your active hikes holds a report, whichever route the report is on.
  - The 12 h fallback counts from the later of when it was seen and when the server received it. The spec §7.4 line is amended to match.
  - A report whose hike is deleted stays held until the fallback.
- **Confirming.**
  - A held report can't be confirmed by anyone, its author included. The author withdraws it with "It's gone now" once it's public.
  - A safety report's "verified" mark reverts if the only other confirmer later says gone or not sure, because a newer answer replaces the older one.
- **"Still there?"** is asked after Finish only when the hike started today or yesterday. After logging a past hike, it's asked only when the hike is dated today or yesterday.
- **Your own reports** come from the server: `/reports/mine` lists all your reports on the route. Nothing is kept per device.
- **Refused answers.** An answer refused because the report is no longer active is dropped, since nothing is lost. Refused reports stay visible with Discard.
- **Report form.**
  - Picking on the map is set up by the page; the form asks it for the tapped spot.
  - "When" is "Now" or "Earlier", up to 14 days back.

## Deferred minors

**Server**
- **Query cost.** `view()` makes up to 3 queries per report, which is fine at R1 scale. `/reports/mine` is unbounded per route.
- **Test gaps.**
  - No test covers a report observed more than 150 days ago but confirmed recently (it guards the `coalesce` in the pre-filter).
  - The two-thread GONE test is likely serial: a smoke test, not a proof of the lock.
  - No test covers a distinct user switching GONE → NOT_SURE.
- **Code tidy.** The `authorGone` query is a redundant round-trip. `EntityManager` is field-injected. Some `java.util` names are written in full inline.
- **Retry with a different body.** It returns the stored report silently, so the client must trust the response.

**App**
- **Clock and upgrade.** A device clock more than 2 minutes fast has its "Now" reports refused as in the future. A tab still on the v3 build has no blocking handler (the banner covers what that causes).
- **Answer state.** An answer dropped on a 409 briefly reads "Answer sent" until the quiet reload. The still-there card flattens errors and has no Discard.
- **Report form.**
  - The "Earlier" bounds refresh only when it is chosen.
  - A tap on the route pin is ignored in pick mode.
  - The Where arrow keys deviate from the WAI-ARIA radiogroup pattern.
  - The page-level pick glue is untested at page level.
- **Route page.** Signed out, the sign-in line appears twice. "Will send when you have signal" briefly flashes while online.
- **Sync.** If the hike store isn't loaded when sending starts, a report can go out early (a visible, discardable 400). Refused outbox items aren't retried at sign-in.

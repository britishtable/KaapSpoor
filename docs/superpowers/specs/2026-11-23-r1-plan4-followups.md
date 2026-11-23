# R1 Plan 4 (reports): follow-ups

These items were carried out of the plan 4 build (branch `r1-reports`, 2026-11-23). Items fixed in the review rounds are not listed.

## Browser check: done 2026-11-23

Run in Chromium (Playwright) against a local server, PostGIS and the dev app at a 412 px phone width.

- **Filing mid-hike.** A map pick keeps the form and its input and snaps to the route. The saved line promises release on finish, and the server holds the report. Another account sees nothing, and the reporter sees it under the held line.
- **Release.** Finish releases the report. Another account then sees "Seen just now" and "Reported by …", and the pin sits on the route line.
- **Clearing.** Two different accounts answering Gone clear the report, and it moves to "Earlier reports (1)".
- **Offline.** Filed offline, the report says "Will send when you have signal" and isn't on the server. Back online, it sent with no action.
- **Another route.** During a hike on X, a report on Y shows the finish line and isn't public. Finishing X releases it.
- **Use my location.** A fix about 33 m from the line is snapped. One about 450 m away is "Marked where you are". With permission denied, a calm message shows and the note is kept.
- **Contrast.** Light theme: the worst muted text is 7.9:1. Dark theme: white at 75–80 % opacity on the browser's dark canvas, about 10:1.
- **Not run live:** the upgrade banner (it needs a real old-build tab; covered by fake-indexeddb tests) and tapping a pin to scroll.
- **Noticed, outside these plans:** the OpenStreetMap attribution box covers much of the small route map on a phone.

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

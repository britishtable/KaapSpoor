# R1 plan 5 (live position): follow-ups

## Live check, 2026-11-24

Chromium through Playwright, 390 px wide, light and dark, against a local server and database.
The route was the Lekkerwater Traverse, with a granted location on its line.

| Check | Result |
|---|---|
| Dot and halo on the map, above the line and the report pins | Pass, both schemes |
| "On route" and "616 m done · 551 m to go" | Pass |
| Marker on the elevation profile | Pass. It was too small on a phone, so it was enlarged |
| "Off route by 93 m" after moving away | Pass |
| ±160 m fix: waiting line, last distances greyed | Pass |
| Permission denied | Pass, one calm line |
| Near-report question 50 m from another account's report | Pass. "Gone" reached the server, and a second person's "Gone" cleared it |
| The next question waits for the next fix; "Not now" hides it | Pass |
| Tab hidden stops the watch, and shown restarts it (simulated visibility event) | Pass |
| Opening a Related route stops the watch | Pass |
| Start hike turns it on, Finish hike turns it off | Pass |
| Text contrast, touch targets, sideways scroll | Lowest contrast measured 17:1, 48 px, none |

The contrast figure doesn't cover the orange off-route line or the greyed distances. It was taken
while on route.

## Not checked

- **A real phone on a real trail.** Everything above used a simulated position. How often fixes
  arrive, how accurate they are and what they cost in battery are all untested.
- **A real tab switch or screen lock.** The visibility event was simulated.

## Decisions for the product owner

- **A dot that walks off the map.** The map doesn't follow, as planned, and it can't be panned
  either. An off-route hiker can leave its frame, which is when they most need it. Turning live
  position off and on reframes it.
- **"Safety incident, 50 m from you. Still there?"** The prompt asks about safety reports as it does
  about any other. That may be the wrong thing to say to somebody standing there.

## Deferred

- **Screen readers.** "Off route by N m" is a live region, so it is read out again at every change.
- **Out-and-back turning point.** `locateOnLine` sees one pass, not two, where two long segments
  join directly at the turn. Drawn lines have short segments, so it corrects itself within one.
- **"0 m to go" while off route.** Someone far past the end of the line is projected onto its last
  point.
- **No-line fallback.** `routeStatus` drops the distance to the pin if a line of two or more points
  can't be located on.
- **Remaining distance.** `remainingM` could go a hair below zero. It is never shown as negative.
- **Task 3 tests not written.** A rough fix after a no-line one, and accuracy of exactly 100 m.
- **Existing 404.** The map asks for `fonts/Open Sans Regular/0-255.pbf`, which isn't shipped. This
  predates plan 5.

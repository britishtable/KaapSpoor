# R1 Plan 5: Live Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a route page, a hiker sees where they are, with a dot and an accuracy halo on the route's map. On a route with a drawn line they also see "On route" or "Off route by N m", distance done and remaining, and their place on the elevation profile. Near an active report, they're asked "Still there?".

**Architecture:**
- **App only; no server change.** The position never leaves the device in R1.
- **Position source.** A small interface, `watchPosition(onFix, onError) → stop`, has a web implementation now. Plan 6 adds a Capacitor implementation behind the same interface.
- **Lifecycle.** A `livePosition` store runs that source only while a route page has live position switched on *and* the tab is visible.
- **One definition of along-route arithmetic.** All of it is added to `app/src/lib/map/profile.ts`, as the spec requires. A pure `routeStatus` function turns a fix plus the line into what the page shows.

**Tech Stack:** SvelteKit with Svelte 5 runes, MapLibre GL, Vitest with Testing Library, and Playwright (with granted geolocation for the e2e).

**Spec:** `docs/superpowers/specs/2026-11-18-platform-and-release1-design.md`: §7.1 live position, §7.4's "near or on a route" confirm prompt (deferred from plan 4), §7.5 (Start hike opens the live-position view) and §8 (battery and field use).

## Prerequisites

- **`npm install` in `app/`.** A fresh worktree also needs `app/static/tiles/*.pmtiles` copied from the main checkout.
- **No server or Docker is needed** for this plan's tests. The e2e suite runs without an API.

## Global Constraints

**Position rules (§7.1)**
- **Off-route threshold.** `OFF_ROUTE_M = 40`, the builder's call (the spec says "about 40 m").
  - The state goes from on to off when the distance off the line is greater than `max(40, accuracy)`.
  - It goes from off to on when that distance is below `max(30, accuracy − 10)`. That 10 m of hysteresis stops the label flickering at the edge.
- **Rough fixes.** A fix whose `accuracy` is over `ROUGH_FIX_M = 100` is shown as a dot and halo, but nothing is worked out from it. The text reads "Waiting for a better GPS fix (±N m)".
- **Stale fixes.** A fix older than `STALE_S = 30` seconds shows "Last fix N s ago" under the status line.
- **Distances.**
  - Distance done is the distance along the line to the projected point, and remaining is the line's total minus that.
  - Both use the page's resolved `lineCoords`, which already honours the chosen plan and its direction. Never re-select a plan.
  - The arithmetic lives in `profile.ts` only.
- **Routes without a drawn line** (most of them): show the dot, the route pin, and "{d} to the route pin, as the crow flies".
- **Routes with no map position** show no live-position control at all.
- **Distance copy.** Under 1000 m it reads "{n} m"; otherwise "{x.x} km". There is one formatter, `formatDistance` in `profile.ts`, reused by every new line.

**Battery and privacy (§8)**
- **Watching.** `watchPosition` uses `enableHighAccuracy: true` and `maximumAge: 5000`. It runs only while live position is on, the route page is mounted and `document.visibilityState === 'visible'`. Hiding the tab or leaving the page stops it at once, and coming back resumes it.
- **No timers or polling.** No `setInterval` and no wake lock. The "Last fix N s ago" age updates only when a fix arrives or the page becomes visible again.
- **The position never leaves the device.** Nothing in this plan sends it to the server or stores it in IndexedDB.

**Client and UX (§8)**
- **The control.** A full-width toggle button, **"Show where I am"** / **"Stop showing where I am"**, with `aria-pressed`, sits with the route's map.
  - **Start hike** turns it on. **Finish hike** turns it off.
- **Failure copy** (calm, one line each):
  - **Permission denied:** "Location is off for this site. You can turn it on in your browser's settings."
  - **Unavailable or timed out:** "Couldn't get your location just now. It will keep trying."
  - **Insecure context:** "Location needs a secure (https) page."
- **Status line**, with `role="status"`: "On route", "Off route by {d}", or "Waiting for a better GPS fix (±{n} m)". It sits above "{done} done · {remaining} to go".
- **Field use.**
  - Touch targets are ≥ 48 px.
  - Text meets WCAG AA in light and dark.
  - The dot and halo stay visible on the light and dark map styles.
- **Spaces.** Svelte 5 trims whitespace at element and block edges, so write separators as `{' '}`. Assert a whole line's `textContent` in tests.
- **Design.** Load `frontend-design:frontend-design` for the new UI. Check that every changed file is valid UTF-8.

**Process:** Commits carry **no `Co-Authored-By` trailer** (user preference).

## Review Focus

1. **An out-and-back or looping line.** On the way back, the nearest segment may be the outbound one, so the distance done jumps backwards. Continuity must keep the hiker on the leg they're walking. Test in Task 1.
2. **A poor or jumpy fix** (±150 m in a ravine, or one wild fix). It must not flip the status or the distances; "rough" is shown instead. Tests in Tasks 1 and 2.
3. **Battery.** Switching tabs, locking the phone or leaving the route page must stop the GPS watch. Tests in Task 2, plus an e2e in Task 4.
4. **Location denied, or a plain-http LAN dev page.** Both show calm copy, and nothing breaks or retries in a loop. Test in Task 2.
5. **The near-report prompt** must never ask about the user's own report, or about one already answered here, and must not ask twice in a visit. Test in Task 5.

## Not in this plan (and where it goes)

- **The Capacitor geolocation implementation:** plan 6. The interface is defined here.
- **Background or screen-off tracking and recording a track:** R5 and R6, which are gated on the real-device GPS run.
- **Live position on the home map:** that map already has MapLibre's geolocate control. The route-relative status belongs on the route page.
- **Navigation-style turn prompts:** not in R1.

---

### Task 1: Along-route geometry in `profile.ts`

**Files:**
- Modify: `app/src/lib/map/profile.ts`
- Test: `app/src/lib/map/profile.test.ts`

**Interfaces:**
- Produces:
  - **`locateOnLine(coords: Point3[], p: [number, number], prevAlongM?: number | null): { alongM: number; offM: number; point: [number, number] } | null`**
    - `alongM` is the cumulative distance along the line to the projected point. It uses `cumulativeDistanceM`, so it agrees with the profile and stats.
    - `offM` is the haversine distance from `p` to that point.
    - It returns null for fewer than 2 points.
  - **`formatDistance(m: number): string`**, giving "640 m" or "1.2 km".
- **Continuity (Review Focus 1).**
  - With no `prevAlongM`, take the globally nearest projection, as `nearestOnLine` does.
  - With `prevAlongM` set, consider every segment projection whose `offM` is within `bestOffM + 25` m. Among those, choose the one whose `alongM` is closest to `prevAlongM`.
  - This keeps an out-and-back walker on their own leg. It still jumps when the other leg is clearly nearer, by more than 25 m.
- `nearestOnLine` should be rebuilt on the same segment loop, so the projection maths exists once.

- [ ] **Step 1: Write the failing tests.**
  - **`locateOnLine` on a straight 1 km east–west line:**
    - a point 20 m north of the 300 m mark gives `alongM ≈ 300` (±2) and `offM ≈ 20` (±1);
    - a point beyond the end clamps to `alongM = total`.
  - **Out-and-back:** a line going 500 m east, then back west along a parallel path 10 m north.
    - From a point on the return leg at 200 m from the start, with `prevAlongM = 750`, the result is `alongM ≈ 800`, not ≈ 200.
    - The same point without `prevAlongM` returns whichever leg is nearest.
  - **Alignment with the stats:** `alongM` at the last vertex equals `totalDistanceM(coords)` exactly.
  - **Reversed plans:** a line from `reverseCoords` gives `alongM' = total − alongM` (±1 m).
  - **`formatDistance`:** 0 gives "0 m", 999.4 gives "999 m", 1000 gives "1.0 km", 12345 gives "12.3 km".
  - **`nearestOnLine`:** its existing tests still pass unchanged.
- [ ] **Step 2: Run and confirm they fail.** Run: `cd app && npx vitest run src/lib/map/profile.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): locate a position along a route line, staying on the walked leg"`

---

### Task 2: The position source and the live-position store

**Files:**
- Create: `app/src/lib/position/source.ts`, `app/src/lib/position/live.ts`, and their `*.test.ts`

**Interfaces:**
- Produces:
  - **The fix type.** `type Fix = { lon: number; lat: number; accuracy: number; at: number }`, where `at` is epoch ms.
  - **The source.** `type PositionSource = { watch(onFix: (f: Fix) => void, onError: (e: PositionProblem) => void): () => void }` and `type PositionProblem = 'denied' | 'unavailable' | 'insecure'`.
    - `webSource` maps `GeolocationPositionError` codes 1 → `denied`, and 2 or 3 → `unavailable`.
    - `!window.isSecureContext` gives `insecure`, without calling geolocation.
  - **The store.** `livePosition: Readable<{ on: boolean; fix: Fix | null; problem: PositionProblem | null }>`, with these controls:
    - `startLive(): void`, `stopLive(): void` and `setSource(s: PositionSource): void` (tests and plan 6 use the last).
- **Lifecycle (Review Focus 3).**
  - `startLive` subscribes to `visibilitychange`. While on and visible, one source watch runs. Hidden stops it, and visible starts it again.
  - `stopLive` stops the watch, removes the listener and clears `fix`.
  - A `denied` or `insecure` problem stops the watch, so it doesn't retry. An `unavailable` problem keeps watching.
  - Calling `startLive` twice never runs two watches.

- [ ] **Step 1: Write the failing tests**, using a fake `PositionSource` that records watch and stop calls.
  - `startLive watches once; a second startLive doesn't add a watch`.
  - `hiding the tab stops the watch and showing it resumes`. Set `document.visibilityState` and dispatch `visibilitychange`.
  - `stopLive stops the watch, removes the listener and clears the fix`.
  - `denied stops watching and keeps the problem`. `unavailable keeps watching`.
  - `insecure context reports insecure without calling geolocation` (for `webSource`; stub `isSecureContext`).
  - `webSource maps error codes 1/2/3`, using a fake `navigator.geolocation`.
  - `a fix is stored, and the problem clears on the next good fix`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): a live position that runs only while shown and visible"`

---

### Task 3: Route status from a fix

**Files:**
- Create: `app/src/lib/position/route-status.ts`, `app/src/lib/position/route-status.test.ts`

**Interfaces:**
- Consumes: `locateOnLine`, `totalDistanceM`, `haversineM` (`snap.ts`) and `Fix`.
- Produces: `routeStatus(input: { fix: Fix; lineCoords: Point3[]; pin: { lon: number; lat: number } | null; prev: RouteStatus | null; now: number }): RouteStatus`. The result is one of these shapes:
  - `{ kind: 'rough'; accuracy: number }`
  - `{ kind: 'on' | 'off'; offM: number; doneM: number; remainingM: number; alongM: number }`
  - `{ kind: 'noline'; toPinM: number | null }`

  Every shape also carries `ageS: number`.
- **Rules:**
  - `accuracy > ROUGH_FIX_M` gives `rough`. A rough fix never changes the previous on/off state; the UI keeps showing the last good distances greyed, with the rough line.
  - A line with fewer than 2 points gives `noline`.
  - `on` and `off` use the hysteresis in Global Constraints, based on `prev.kind`.
  - `alongM` passes `prev.alongM` into `locateOnLine` for continuity.
  - The constants `OFF_ROUTE_M`, `ROUGH_FIX_M` and `STALE_S` are exported from this file.

- [ ] **Step 1: Write the failing tests.**
  - **Threshold:** on at 35 m off; off at 45 m off (accuracy 10).
  - **Hysteresis:** from off, 35 m stays off and 25 m turns on.
  - **Accuracy:** with accuracy 60, 50 m off is still on, because the limit is `max(40, 60)`.
  - **Rough fixes (Review Focus 2):** accuracy 150 gives `rough`, and the next good fix decides on/off from the state before the rough fix.
  - **One wild fix (Review Focus 2):** a single fix 300 m off with accuracy 20 turns the state off. Correct, not hidden.
  - **No line:** gives `noline` with `toPinM` from `haversineM`. With no pin, `toPinM` is null.
  - **Age:** `ageS` = (now − fix.at) / 1000, rounded down.
  - **Done and remaining:** `doneM + remainingM === totalDistanceM(lineCoords)`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): on route, off route by N m, done and to go"`

---

### Task 4: Live position on the route page

**Files:**
- Create: `app/src/lib/components/LivePosition.svelte`, `app/src/lib/components/LivePosition.test.ts`
- Modify: `app/src/lib/components/LocatorMap.svelte`
  - A `position: { lon, lat, accuracy } | null` prop.
  - It draws a dot plus an accuracy-halo circle layer, with the halo sized in metres via zoom-interpolated radius or a polygon; implementer's choice.
  - The dot and halo sit above the route line and report pins.
  - The map doesn't auto-follow, except to fit the dot into view the first time live position turns on.
- Modify: `app/src/lib/components/RouteProfile.svelte`: a `positionM: number | null` prop draws a distinct "you are here" marker. It is separate from the scrub marker.
- Modify: `app/src/lib/components/HikeLog.svelte`: Start hike calls `startLive()` and Finish calls `stopLive()`.
- Modify: `app/src/routes/route/[id]/+page.svelte`: wire `livePosition` → `routeStatus` → LocatorMap, RouteProfile and LivePosition.
  - Call `stopLive()` in the page's `onDestroy`.
  - Don't add a `$effect` that both reads and writes the same state. That is the plan 4 Task 5 trap.
- Create: `app/e2e/live-position.spec.ts`

**Interfaces:**
- Consumes: `livePosition`, `startLive` and `stopLive` (Task 2); `routeStatus` and its constants (Task 3); `formatDistance` (Task 1).
- Produces: `LivePosition` takes `{ status: RouteStatus | null; on: boolean; problem: PositionProblem | null; hasLine: boolean }` and shows the toggle, the status line, the distances line, the age line and the problem copy.

- [ ] **Step 1: Write the failing tests.**
  - `LivePosition.test.ts`:
    - `toggle reads Show where I am and has aria-pressed`;
    - `on route shows "On route" and "0.6 km done · 1.4 km to go"` (assert the whole line's `textContent`);
    - `off route shows "Off route by 85 m"`;
    - `rough shows the waiting line with ±150 m`;
    - `noline shows "1.2 km to the route pin, as the crow flies"`;
    - `denied, unavailable and insecure each show their copy`;
    - `a 45 s old fix shows "Last fix 45 s ago"`.
  - `RouteProfile.test.ts`: `positionM draws the you-are-here marker, separate from the scrub marker`.
  - `LocatorMap.test.ts`: `position adds the dot and halo layers once and updates their data`, following the existing map-mock pattern.
  - `HikeLog.test.ts`: `Start hike starts live position and Finish stops it` (use a fake source via `setSource`).
  - `e2e/live-position.spec.ts`. Playwright grants `geolocation` and sets a fix near the drawn line of a route with a line; reuse the e2e's existing way of finding one, and skip as the map spec does when none exists. It checks:
    - "Show where I am" leads to "On route" and a "done · to go" line;
    - `context.setGeolocation` about 200 m off the line leads to "Off route by";
    - leaving the route page stops the watch. Assert through a page-exposed counter or by checking that `navigator.geolocation.clearWatch` was called (use `page.addInitScript` to wrap it).
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check && npm run test:e2e`.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): show where you are on a route, with on/off route and distance to go"`

---

### Task 5: "Still there?" when you're near a report

**Files:**
- Create: `app/src/lib/components/NearReportPrompt.svelte`, `app/src/lib/components/NearReportPrompt.test.ts`
- Modify: `app/src/routes/route/[id]/+page.svelte` (or `RouteReports.svelte`): place the prompt just under `LivePosition`.

**Interfaces:**
- Consumes:
  - the live `Fix` (Task 2);
  - the route's active reports, with `mineIds` and the user's queued answers, from plan 4's `loadRouteReports` / `pendingOutbox` (`app/src/lib/reports/`);
  - `answerReport`, `haversineM`, `formatDistance` and the labels from `app/src/lib/reports/labels.ts`.
- **Behaviour:**
  - **When it asks:** signed in, live position on, and a fix that isn't rough. The report must have a position and be within `NEAR_REPORT_M = 100` m. It must not be the user's own, and must not be answered in this visit or still queued in the outbox.
  - **What it shows:** one card for the nearest such report: "{Category label}, {d} from you. Still there?" with Still there / Gone / Not sure, plus "Not now".
  - **After a choice:** an answer or "Not now" hides that report's prompt for the rest of the visit, kept in component state with no storage. The next nearest qualifying report can then be asked about.
  - **Accessibility:** `role="status"` on the card. Answers go through `answerReport`, so they queue offline.

- [ ] **Step 1: Write the failing tests.**
  - `asks about the nearest active report within 100 m`;
  - `ignores one 150 m away`;
  - `never asks about your own report` (Review Focus 5);
  - `not again after an answer or Not now`;
  - `not for a report with no position`;
  - `not while the fix is rough`;
  - `signed out, no prompt`;
  - `answering calls answerReport and shows Will send when you have signal while queued`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check && npm run test:e2e`.
- [ ] **Step 5: Live check.** Use Chromium via Playwright against a local server, the way plans 3 and 4 were checked (see memory `live-browser-checks`).
  1. Grant geolocation near the drawn line of the Lekkerwater Traverse, and screenshot the dot, the halo, the status line and the profile marker at phone width.
  2. Seed an active report by another account about 50 m from the fix, and confirm the prompt shows and answering clears it.
  3. Switch tabs, and confirm the watch stops.
  4. Record the results in a plan 5 follow-ups doc.
- [ ] **Step 6: Commit.** `git commit -m "feat(app): ask still there? when you're near a report"`

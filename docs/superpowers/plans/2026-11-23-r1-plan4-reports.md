# R1 Plan 4: Day-Level Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hiker can report something true about a route today, such as a fallen tree, closure, fire, water, baboons, a safety incident or mud. It is held back until their hike is finished, then shown on the route page with its age, and others can confirm it or clear it.

**Architecture:**
- **Server.** A `report` table, written with an idempotent `PUT` keyed on the client's UUID.
  - Release and expiry are computed when read from the server clock, with no scheduled jobs. A report is public once its linked hike is finished, 12 h after the later of `observedAt` and when the server received it, or at once if it has no hike.
  - Confirmations are one row per person per report.
- **Device.** Reports and confirmations are written to an IndexedDB **outbox** and sent by the existing sync engine on its existing triggers, so filing works with no signal.
- **Route page.** It reads the public list from the server, plus the user's own held reports from an authenticated endpoint, plus anything still in the outbox.

**Tech Stack:**
- **Server:** as in plans 1 to 3 (Java 21, Spring Boot 3.5.3, PostGIS, Flyway, Testcontainers).
- **App:** SvelteKit with Svelte 5 runes, `idb`, the generated `openapi-fetch` client, MapLibre, Vitest with Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-platform-and-release1-design.md`, §7.4 (day-level reports), §7.5 (Finish releases held reports), §6 (offline-first writes) and §8 (UX). This plan also uses `docs/superpowers/specs/2026-11-18-r1-plan2-followups.md`, "Device storage", for the two fixes due before the next schema version.

## Prerequisites

- **Docker Desktop must be running.** If it isn't, almost every server test errors on Testcontainers.
- **Maven uses JDK 21.** Set `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot`.
- **`npm install` in `app/`.** A fresh worktree also needs `app/static/tiles/*.pmtiles` copied from the main checkout.
- **Don't run `./mvnw package` or `verify` while a local server runs from the same `target/`.** The repackage step can't replace a jar that is in use.

## Global Constraints

**Report content (§7.4; lifetimes are the spec's defaults)**

| Category | Label | Lifetime |
|---|---|---|
| `OBSTRUCTION` | Obstruction (fallen tree, rockfall) | 30 days |
| `TRAIL_DAMAGE` | Trail damage or erosion | 60 days |
| `CLOSURE` | Closure | until cleared |
| `FIRE` | Fire or fire damage | 30 days |
| `WATER` | Water source | 14 days |
| `WILDLIFE` | Wildlife (e.g. baboons) | 2 days |
| `SAFETY` | Safety incident | 14 days |
| `CONDITIONS` | Mud, flooding or snow | 3 days |

- **Fields.**
  - `category` is required.
  - `note` is optional, up to 500 characters.
  - `observedAt` is required. It can't be after the server's now, and can't be more than 14 days before it.
  - `position` is optional: `{lon, lat}`, inside lon 17.0 to 24.5 and lat −35.0 to −30.0.
  - `hikeId` is optional.
  - There are no photos in R1.
- **Expiry.** `expiresAt` = (`lastConfirmedAt` ?? `observedAt`) + the lifetime. A `CLOSURE` has none.
  - A report is **active** while it isn't cleared and either has no expiry or its `expiresAt` is after now.
  - Otherwise it is **history**: listed for 90 days after it expired or was cleared, up to 50 per route.
- **Hold and release.** A report is **released**, meaning publicly visible, when any of these is true:
  - `hikeId` is null (filed after the hike, from home);
  - the linked hike has `finished_at`;
  - the later of `observedAt` and when the server received it, + 12 h ≤ now (the fallback when someone forgets to finish).

  Before that, only its author sees it. The admin view is plan 8.
- **Confirmations.**
  - The answers are `STILL_THERE`, `GONE` and `NOT_SURE`.
  - Each person has one answer per report, and a newer answer replaces the older one.
  - `STILL_THERE` sets `lastConfirmedAt = now`.
  - The report is cleared (`clearedAt = now`) by `GONE` from two distinct non-authors, or by `GONE` from the author.
  - `NOT_SURE` changes nothing.
  - A `SAFETY` report is **unverified** until a non-author answers `STILL_THERE`.
  - A held, expired or cleared report can't be confirmed (409).
- **Attribution.** A report shows its reporter's display name, or "Former member" if they deleted their account. It always shows `observedAt` ("seen 3 hours ago"), plus "last confirmed …" when that is set.
- **Position.**
  - **From GPS:** a one-shot fix (`getCurrentPosition`, high accuracy, 15 s timeout).
  - **From a map tap:** a point tapped on the route page's map.
  - **Snapping:** either way, the point is snapped to the route's drawn line when it lies within 100 m of it. Otherwise it is kept as tapped.
  - **No location:** a route with no map location takes reports without a position, which then describe the whole route.

**Server**
- **API conventions.** The package root is `za.kaapspoor.server`, endpoints live under `/api/v1`, and errors are `ProblemDetail`. User-safe 400s use `web.BadRequestException`. The `Clock` is injected.
- **Regenerate the API files with the change.** Every API change regenerates the snapshot and the client in the same commit: `./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true`, then `cd ../app && npm run gen:api`.
- **Test cleanup.** Test classes that delete from `app_user` or `hike` must delete from `report_confirmation` and `report` first. Grep for every `delete from app_user`.
- **Test clocks.** Use the shared `MutableClock` from `server/src/test/java/za/kaapspoor/server/`. Register users before moving the clock, because access tokens are validated against system time.

**Client and UX (§8)**
- **Signed in to report.** Filing or confirming needs a signed-in account, because reports carry a name. Signed out, the entry point says "Sign in to report what you see." and links to `/account`.
- **Offline is normal.** A queued report or confirmation shows "Will send when you have signal". Input is never lost.
- **Freshness is always visible.** No report is shown without its age.
- **Calm language.**
  - Safety copy informs; it doesn't alarm.
  - The safety form says: "Describe what happened and where. Please don't name or describe the people involved."
- **Field use.**
  - The primary actions sit in the lower third, as full-width buttons.
  - Touch targets are ≥ 48 px.
  - Text meets WCAG AA contrast.
- **Battery.** A one-shot GPS fix only, with no `watchPosition`.
- **Untrusted text.** User text renders as text, never `{@html}`.
- **Design.** Load `frontend-design:frontend-design` for the report form and the reports section. Check that every new source file is valid UTF-8 before committing.

**Process:** Commits carry **no `Co-Authored-By` trailer** (user preference).

## Review Focus

1. **Filing a report with no signal, mid-hike.** It is saved at once and shows "Will send when you have signal". It uploads when signal returns, and it stays held until Finish or the 12 h fallback. Tests in Tasks 1 and 4.
2. **A named report must not reveal where someone is right now.** Before release, the public endpoint never returns a held report, not even its count. Tests in Task 2.
3. **The same person tapping "gone" twice,** or answering from two devices, counts once. Only distinct people clear a report. Test in Task 3.
4. **Shared phone.** A reports and signs out, then B signs in. A's queued items are neither sent as B's nor shown as B's. Test in Task 4.
5. **A report on a route with no drawn line, or no map position at all,** files without a snapped point, or without any position. Tests in Task 5.

## Not in this plan (and where it goes)

- **The "still there?" prompt when a user is near or on a route:** plan 5, which needs live position. This plan asks after Finish hike and after logging a hike on the route, and puts the same answers on each report in the list.
- **Flagging, three flags hiding an item, the admin view and the moderation log:** plan 8, built once for reports and reviews. The admin view of held reports is also there.
- **Report pins on the home map:** later. Here they appear on the route page's map only.
- **Anonymising a deleted account's reports:** plan 8. Here they show "Former member".

---

### Task 1: Server: filing a report

**Files:**
- Create: `server/src/main/resources/db/migration/V6__report.sql`
- Create: `server/src/main/java/za/kaapspoor/server/report/{Report.java, ReportCategory.java, ReportRepository.java, ReportService.java, ReportController.java, ReportDtos.java}`
- Modify: test classes that delete from `app_user` or `hike` (Global Constraints)
- Modify (regenerated): `server/openapi.json`, `app/src/lib/api/schema.d.ts`
- Test: `server/src/test/java/za/kaapspoor/server/report/ReportFilingApiTest.java`

**Schema (`V6__report.sql`):**
```sql
create table report (
    id                uuid primary key,                          -- client-generated
    user_id           uuid not null references app_user (id),
    route_id          text not null references route (id),
    hike_id           uuid references hike (id),
    category          text not null check (category in
                        ('OBSTRUCTION','TRAIL_DAMAGE','CLOSURE','FIRE','WATER','WILDLIFE','SAFETY','CONDITIONS')),
    note              text not null default '',
    position          geography(Point, 4326),
    observed_at       timestamptz not null,
    last_confirmed_at timestamptz,
    cleared_at        timestamptz,
    received_at       timestamptz not null
);
create index report_route_idx on report (route_id);

create table report_confirmation (
    report_id   uuid not null references report (id),
    user_id     uuid not null references app_user (id),
    answer      text not null check (answer in ('STILL_THERE','GONE','NOT_SURE')),
    answered_at timestamptz not null,
    primary key (report_id, user_id)
);
```

**Interfaces:**
- Produces:
  - **`ReportCategory`** enum (the eight values), with `Optional<Duration> lifetime()`, empty for `CLOSURE`.
  - **`PUT /api/v1/reports/{id}`** (auth). The body is `ReportWrite { routeId, category, note?, observedAt, position?: {lon, lat}, hikeId? }`.
    - It always returns 200 with `MyReport`, the author's view: `{ id, routeId, category, note, observedAt, position|null, hikeId|null, held: boolean, lastConfirmedAt|null, expiresAt|null, clearedAt|null, unverified: boolean }`.
  - **`ReportService.view(Report, Instant now)`**, which computes `held`, `expiresAt` and `unverified`. Task 2 reuses it as the one definition of the release and expiry rules.
- **Write-once.**
  - The same id from the same user returns the stored report unchanged, so a retry is idempotent.
  - The same id from another user → 409 "This report id is already in use."
  - Reports can't be edited. The author withdraws one by answering `GONE` (Task 3).
- **Validation** (400s with plain copy):
  - missing fields;
  - an unknown route;
  - `note` over 500 characters;
  - `observedAt` in the future (beyond a 2-minute clock-skew allowance) → "That time is in the future.";
  - `observedAt` more than 14 days ago → "Reports are for things seen in the last two weeks.";
  - a position outside the bounding box → "That spot is outside the area KaapSpoor covers.";
  - a `hikeId` that isn't the caller's own, not-deleted hike, on any route (the outbox sends hikes first, so the hike is already on the server) → "That hike isn't yours.";
  - a soft-deleted user → 401, as in `HikeService`.

- [ ] **Step 1: Write the failing tests** in `ReportFilingApiTest`.
  - `putCreatesAndReturnsMyReport()`: `held` is false with no `hikeId`, and `expiresAt` = `observedAt` + 30 d for `OBSTRUCTION`.
  - `retryIsIdempotent()`; `otherUsersIdIs409()`.
  - `closureHasNoExpiry()`.
  - `reportDuringActiveHikeIsHeld()` (Review Focus 1): the hike is started and not finished, so `held` is true. After the hike is PUT with `finishedAt`, a re-PUT of the same report shows `held` false.
  - `heldReleasesAfter12Hours()`: move the clock to `observedAt` + 12 h, and `held` becomes false.
  - Validation, one test per 400 above, including `observedAtTwoMinutesAheadAccepted()` and `positionOutsideBoxIs400()`.
  - `requiresAuth()`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=ReportFilingApiTest`. Expected: compile failure.
- [ ] **Step 3: Implement.** Write `position` with `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography` and read it back with `ST_X` and `ST_Y`; follow `RouteIndexLoader`'s SQL style. The entity may leave `position` unmapped and use `JdbcTemplate` for it. Regenerate the snapshot and the client.
- [ ] **Step 4: Run and confirm they pass.** Run: `./mvnw -q verify` and `cd ../app && npm run check`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): file a day-level report, held until the hike is finished"`

---

### Task 2: Server: a route's reports, public and mine

**Files:**
- Create: `server/src/main/java/za/kaapspoor/server/report/RouteReportService.java` and `RouteReportController.java` (or add to `ReportController`; implementer's choice)
- Modify: `server/src/main/java/za/kaapspoor/server/web/SecurityConfig.java` (permit `GET /api/v1/routes/*/reports` only)
- Modify (regenerated): `server/openapi.json`, `app/src/lib/api/schema.d.ts`
- Test: `server/src/test/java/za/kaapspoor/server/report/RouteReportsApiTest.java`

**Interfaces:**
- Consumes: `ReportService.view(Report, Instant)` from Task 1.
- Produces:
  - **The public list.** `GET /api/v1/routes/{routeId}/reports` (no auth) returns `RouteReports { active: PublicReport[], history: PublicReport[] }`. An unknown route → 404.
    - `PublicReport { id, category, note, displayName, observedAt, lastConfirmedAt|null, expiresAt|null, clearedAt|null, unverified, position|null }`.
    - Only **released** reports appear, in either list.
    - `active` is newest `observedAt` first. `history` holds at most 50, each within 90 days of expiring or being cleared, newest first.
  - **The author's held reports.** `GET /api/v1/reports/mine?routeId=` (auth) returns `MyReport[]`: the caller's reports on that route that are still **held**.
    - These are kept on a separate authenticated path, so the public endpoint never has to read a token. An expired token on a permitAll path would otherwise 401 an anonymous reader.

- [ ] **Step 1: Write the failing tests** in `RouteReportsApiTest`.
  - `anonymousCanRead()`; `unknownRouteIs404()`.
  - `heldReportIsInvisibleEvenAsACount()` (Review Focus 2): A files during an active hike. The public body has empty `active` and `history`, and the raw JSON contains neither A's display name nor the report id.
  - `releasedOnFinish()`: A finishes the hike, and the report appears in `active` with A's display name.
  - `mineShowsOwnHeldOnly()`: A sees the held report, and B's `mine` for the route is empty.
  - `expiredMovesToHistory()`: `WILDLIFE` past 2 d moves to `history`, with `expiresAt` in the past.
  - `historyDropsAfter90Days()`; `historyCapsAt50()`.
  - `closureStaysActiveUntilCleared()` (with the clock at +400 d).
  - `formerMember()`: the author is soft-deleted, so their name shows as "Former member".
  - `noteRenderedVerbatim()`: a note containing `<b>` comes back as the same string; the API doesn't escape it, and the client renders it as text.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=RouteReportsApiTest`.
- [ ] **Step 3: Implement.** Add the security matcher for `HttpMethod.GET` and `/api/v1/routes/*/reports`, then regenerate the snapshot and the client.
- [ ] **Step 4: Run and confirm they pass.** Run: `./mvnw -q verify` and `npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): a route's reports, released ones public, held ones to their author"`

---

### Task 3: Server: still there, gone, not sure

**Files:**
- Modify: `server/src/main/java/za/kaapspoor/server/report/{ReportService.java, ReportController.java, ReportDtos.java}`
- Modify (regenerated): `server/openapi.json`, `app/src/lib/api/schema.d.ts`
- Test: `server/src/test/java/za/kaapspoor/server/report/ReportConfirmationApiTest.java`

**Interfaces:**
- Produces: `PUT /api/v1/reports/{id}/confirmation` (auth), with body `{ answer: STILL_THERE | GONE | NOT_SURE }`.
  - It returns 200 with the report's `PublicReport` after applying the answer.
  - An unknown id, or a report still held (not yet visible to the caller) → 404.
  - An expired or cleared report → 409 "This report is no longer active."
- **Rules** (Global Constraints), applied in one transaction:
  - Lock the report row (`for update`) so two `GONE` answers at once can't both miss the clear.
  - Upsert the confirmation row.
  - Then recompute: `STILL_THERE` sets `last_confirmed_at`. A distinct-non-author `GONE` count ≥ 2, or a `GONE` from the author, sets `cleared_at`. A `SAFETY` report becomes verified by any non-author `STILL_THERE` row.

- [ ] **Step 1: Write the failing tests** in `ReportConfirmationApiTest`.
  - `stillThereRefreshesLifetime()`: `WILDLIFE` at +1 d answered `STILL_THERE` gives `expiresAt` = now + 2 d.
  - `twoDistinctGoneClears()`. `sameUserGoneTwiceCountsOnce()` (Review Focus 3): B answers `GONE`, then `GONE` again, then `NOT_SURE`, then `GONE`, and the report is still active.
  - `authorGoneClearsAlone()`. `notSureChangesNothing()`.
  - `safetyUnverifiedUntilSecondPerson()`: the author's own `STILL_THERE` doesn't verify it, and B's does.
  - `confirmingHeldIs404()`; `confirmingExpiredIs409()`; `confirmingClearedIs409()`.
  - `requiresAuth()`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=ReportConfirmationApiTest`.
- [ ] **Step 3: Implement.** Then regenerate the snapshot and the client.
- [ ] **Step 4: Run and confirm they pass.** Run: `./mvnw -q verify` and `npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): confirm or clear a report; two people, or the reporter, clear it"`

---

### Task 4: App: outbox, sending, and reading reports

**Files:**
- Modify: `app/src/lib/journal/db.ts`
  - Move to version 4 and add an `outbox` store with keyPath `id` and an index `byOwner`.
  - Make the migration additive per version: `if (oldVersion < 3) { …existing v3 body… }`, then `if (oldVersion < 4) { create outbox }`.
  - Add a `blocked` and a `blocking` handler. On `blocking`, close this tab's connection, so an old tab no longer hangs the upgrade.
  - These close the two plan 2 follow-ups.
- Create: `app/src/lib/reports/{types.ts, outbox.ts, reports.ts}` and their `*.test.ts`
- Modify: `app/src/lib/sync/sync.ts`. Its run flushes the signed-in user's outbox items after the hike push, on the same triggers.
- Test: `app/src/lib/journal/db.test.ts`, `app/src/lib/reports/*.test.ts`, `app/src/lib/sync/sync.test.ts`

**Interfaces:**
- Consumes: the generated schema types from Tasks 1–3, plus `api()` and `session` from `session.ts`.
- Produces:
  - **The outbox item.** `type OutboxItem = { id: string; owner: string; createdAt: string; error?: string } & ({ kind: 'report'; body: ReportWrite } | { kind: 'confirmation'; reportId: string; answer: Answer })`. The `id` is the report's UUID for `report` items, and `reportId + ':' + owner` for `confirmation` items. The latest answer replaces the older one.
  - **Filing and answering** (`outbox.ts`):
    - `fileReport(input: Omit<ReportWrite, 'observedAt'> & { observedAt?: string }): Promise<string>` mints the UUID and defaults `observedAt` to now.
    - `answerReport(reportId: string, answer: Answer): Promise<void>`.
    - Both throw `SignInRequiredError` when signed out, and both trigger the sync engine.
  - **Queued items.** `pendingOutbox: Readable<OutboxItem[]>` holds the current user's items only.
  - **Flushing.** `flushOutbox(client, me): Promise<void>` sends items in `createdAt` order. A 2xx removes the item. A 4xx other than 401 sets `error` and keeps it, so it is never retried blindly and never lost. A network error stops the flush.
  - **Reading** (`reports.ts`): `loadRouteReports(routeId): Promise<RouteReportsView | 'offline' | 'unavailable'>`.
    - It merges the public list, the caller's held reports from `/reports/mine`, and the caller's not-yet-sent outbox reports for this route.
    - The merged view is `{ active, history, mineHeld, minePending }`.
- **Shared-phone rule** (Review Focus 4): an item is flushed and listed only for the user who owns it. Signing out never sends anything.

- [ ] **Step 1: Write the failing tests.**
  - `db.test.ts`:
    - `upgrading 3 → 4 adds outbox and keeps hikes and routeNotes` (seed a v3 database first).
    - `a fresh install creates every store`.
    - `an open v3 connection in another tab is closed on blocking, so the upgrade completes`.
  - `outbox.test.ts`:
    - `fileReport while offline stores the item with "pending" and mints observedAt now`.
    - `a second answer to the same report replaces the first`.
    - `signed out throws SignInRequiredError`.
  - `sync.test.ts`:
    - `outbox flushes after hikes, oldest first`.
    - `a 400 keeps the item with its error and the flush continues`.
    - `a network error stops the flush and keeps everything`.
    - `A's items are never sent after B signs in` (Review Focus 4).
  - `reports.test.ts`:
    - `merges public, mine-held and pending without duplicates` (a pending item whose id now appears in `mineHeld` shows once, as held).
    - `'unavailable' with no API base`, and `'offline'` on a network error.
- [ ] **Step 2: Run them and confirm they fail.** Run: `cd app && npx vitest run src/lib/journal/db.test.ts src/lib/reports src/lib/sync`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): reports and confirmations queue offline and send with sync"`

---

### Task 5: App: the report form and where it's offered

**Files:**
- Create: `app/src/lib/components/ReportForm.svelte`, `app/src/lib/components/ReportForm.test.ts`
- Modify: `app/src/lib/map/profile.ts`: add `nearestOnLine`
- Modify: `app/src/lib/components/LocatorMap.svelte`: an optional `onpick` prop puts the map in pick mode (tap to choose a spot)
- Modify: `app/src/lib/components/HikeLog.svelte`: during an active hike, a full-width **"Report something"** under Finish hike
- Modify: `app/src/routes/route/[id]/+page.svelte`: a **"Report something on this route"** entry, wired to `ReportForm`
- Test: `app/src/lib/map/profile.test.ts`, `app/src/lib/components/HikeLog.test.ts`

**Interfaces:**
- Consumes: `fileReport` and `SignInRequiredError` (Task 4), the page's `lineCoords` (the plan the page already resolved; never re-select a plan), `activeHike` from the store, `session`.
- Produces:
  - **Snapping.** `nearestOnLine(coords: Point3[], p: [number, number]): { point: [number, number]; distanceM: number } | null`, the nearest point on any segment. It returns null for fewer than 2 points. Snap when `distanceM ≤ 100`.
  - **The form's props.** `ReportForm` takes `{ routeId: string; lineCoords: Point3[]; hasLocation: boolean; activeHikeId: string | null; onclose: () => void }`, plus a slot or callback that lets the page put the locator map into pick mode.
- **Behaviour:**
  - **Category.** A category chip grid shows the eight labels from Global Constraints. Choosing `SAFETY` shows the safety guidance line verbatim.
  - **Note.** Optional, with `maxlength=500`.
  - **"When":** "Now" (the default) or "Earlier today", which opens a time picker (14 days earliest).
  - **"Where":**
    - "Use my location" takes a one-shot fix and shows "Snapped to the route" or "Marked where you are".
    - "Pick on the map" uses `LocatorMap` in pick mode.
    - "No exact spot" is pre-selected when `hasLocation` is false, and is then the only choice (Review Focus 5).
    - A location error, such as a denied permission or a timeout, gets calm copy: "Couldn't get your location. You can pick the spot on the map instead."
  - **Saving.** **Send report** is full-width at the bottom.
    - Afterwards the form shows "Saved. It will show once you finish your hike." when `activeHikeId` is set, or "Saved." otherwise, plus "Will send when you have signal" while it's queued.
    - Signed out, the form isn't shown. The entry point reads "Sign in to report what you see." and links to `/account`.

- [ ] **Step 1: Write the failing tests.**
  - `profile.test.ts`:
    - `nearestOnLine projects onto a segment interior`.
    - `nearestOnLine returns null for one point`.
    - `distanceM is metres`. Check against `haversineM` from `snap.ts` within 1 m.
  - `ReportForm.test.ts`:
    - `Send disabled until a category`.
    - `SAFETY shows the guidance line`.
    - `a fix 40 m from the line is snapped and says "Snapped to the route"` (mock `navigator.geolocation`).
    - `a fix 300 m away is kept and says "Marked where you are"`.
    - `denied permission shows the calm copy and keeps the answers`.
    - `no location: only "No exact spot" is offered` (Review Focus 5).
    - `during an active hike the saved line says it will show once you finish`.
    - `a route with no drawn line keeps the tapped point unsnapped` (Review Focus 5).
  - `HikeLog.test.ts`:
    - `an active hike shows Report something under Finish`.
    - `signed out shows the sign-in line instead`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check && npm run test:e2e` (the e2e has no API; it proves nothing else broke).
- [ ] **Step 5: Commit.** `git commit -m "feat(app): report what you see on a route, mid-hike or after"`

---

### Task 6: App: reports on the route page, pins, and "still there?"

**Files:**
- Create: `app/src/lib/components/RouteReports.svelte`, `app/src/lib/components/RouteReports.test.ts`
- Create: `app/src/lib/reports/age.ts` (plain-words age), `app/src/lib/reports/age.test.ts`
- Modify: `app/src/lib/components/LocatorMap.svelte`: a `reports` prop drawn as a circle layer (one colour per category group), above the route line
- Modify: `app/src/lib/components/HikeLog.svelte`: after Finish, or after logging a hike on this route, a **"Still there?"** card for each active report the user didn't file
- Modify: `app/src/routes/route/[id]/+page.svelte`: place `RouteReports` above `RouteReviews`, and pass its active reports to `LocatorMap`

**Interfaces:**
- Consumes: `loadRouteReports`, `answerReport` and `pendingOutbox` (Task 4).
- Produces: `formatAge(fromIso: string, now: Date): string`, giving "just now", "12 minutes ago", "3 hours ago", "yesterday", "3 days ago" or "2 weeks ago".
- **Behaviour:**
  - **Not shown, or offline.** No section when the API is unavailable. "Reports need a connection." when offline. "Nothing reported recently." when there are none.
  - **Each active report shows:**
    - the category label;
    - "Seen {formatAge(observedAt)}", plus " · last confirmed {formatAge(lastConfirmedAt)}" when it has been confirmed;
    - the reporter's name;
    - the note.
  - **Safety reports.** A `SAFETY` report that is `unverified` carries a calm "Not yet confirmed by anyone else" line, never alarming styling.
  - **Answering.** Each report has three answer buttons (Still there / Gone / Not sure), which call `answerReport`. The user's own reports show "You reported this" instead, plus a single **"It's gone now"** button that answers `GONE`.
  - **The user's own reports, before they're public.**
    - Held ones show under "Only you can see these until you finish your hike."
    - Pending ones show "Will send when you have signal".
  - **History.** A collapsed "Earlier reports ({n})" list, each with "Expired" or "Cleared" and its age.
  - **Map pins.** They come from `active` only, never `mineHeld` or `minePending`. Tapping a pin scrolls to that report in the list.
  - **"Still there?" after Finish or logging.** The card lists the route's active reports by others, each with the three answers. "Skip" closes it, and nothing is sent.

- [ ] **Step 1: Write the failing tests.**
  - `age.test.ts`: each bucket boundary (59 s → "just now", 61 min → "1 hour ago", 1 day → "yesterday", 14 days → "2 weeks ago").
  - `RouteReports.test.ts`:
    - `renders nothing when unavailable`.
    - `offline line`.
    - `active report shows category, Seen …, name and note as text` (with a `<b>` note).
    - `last confirmed shows when set`.
    - `unverified safety shows the calm line`.
    - `own report shows It's gone now instead of three answers`.
    - `held and pending own reports show their lines`.
    - `history is collapsed and labelled Expired or Cleared`.
    - `answering shows Will send when you have signal while queued`.
  - `HikeLog.test.ts`:
    - `after Finish, Still there? lists others' active reports and Skip sends nothing`.
    - `own reports are not asked about`.
  - `LocatorMap.test.ts`: `reports prop adds a circle layer with one feature per active report` (follow the existing map test pattern).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check && npm run test:e2e`.
- [ ] **Step 5: Live check.** Unit tests can't see this, and in plan 3 the browser couldn't be driven, so this step stays until a person has done it.
  1. Run the server locally and `npm run dev` with `VITE_API_BASE_URL` set.
  2. Account A starts a hike and reports a fallen tree with "Use my location", or with a map pick if the desktop has no GPS.
  3. Account B in a second browser profile doesn't see the report. A finishes, and B sees it with "Seen … ago" and a pin.
  4. B answers Gone; a third account C answers Gone. The report moves to "Earlier reports" as Cleared.
  5. Set the network to Offline in devtools, file a report, then go back online. It sends with no action.
  6. Record the results in `docs/superpowers/specs/2026-11-23-r1-plan3-followups.md` beside plan 3's owed browser check, and do that check in the same session.
- [ ] **Step 6: Commit.** `git commit -m "feat(app): reports on the route page with age, pins and still-there answers"`

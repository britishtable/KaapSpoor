# KaapSpoor platform + Release 1 (on-trail app) — design

Date: 2026-11-18. Status: draft for approval.

## 1. Intent

KaapSpoor becomes the hiking app Western Cape locals keep open **on the trail**, not just
while planning. Today's alternatives each fall short for this audience:

- **Mountain Meanders** is the best route knowledge in the region, but it's a wiki you
  read before a hike, not something you use during one.
- **AllTrails** misses the niche routes, its descriptions aren't very helpful, and there's
  no real sense of community.

The edge is **regional depth**: every niche route, descriptions from people who've walked
them, fresh day-by-day conditions, and a community of people hiking the same mountains.
The goal is a product people genuinely use and that can become profitable.

## 2. Goals, non-goals, anti-goals

**Goals (whole product)**
- Usable during a hike: live position on the route, offline maps.
- A community that is hiking-shaped: structured reviews, day-level reports, friends,
  planned group hikes, trail history.
- Ships on **web, Android and iOS** from one front end.
- Profitable through premium features that are app capabilities, not content.

**Non-goals**
- Coverage outside the Western Cape.
- A general social network.

**Anti-goals**: things that would make this a failure even if they technically work:
- Reels, stories, feeds tuned for engagement, or dark patterns.
- **Safety features behind the paywall.** Check-in, reports and live position stay free.
- Changing or paywalling openly licensed content. Mountain Meanders material stays free
  and unaltered, with attribution.
- Anything that broadcasts where a person *is* or *will be* to strangers. No public live
  location, no public planned hikes.

## 3. Constraints

- **Licence.** Route content comes from Mountain Meanders under CC BY-SA 2.5 ZA. It stays
  free and attributed, and derivatives carry the same licence. User-generated content
  (reviews, reports, tracks) is a separate licence, set out in the terms of service.
- **Backend in Java (Spring Boot).** This was the user's decision. The front end stays the
  existing SvelteKit app.
- **POPIA.** Location history and friend graphs are personal information. Before launch:
  a privacy policy, account export and deletion, data minimisation, and a registered
  information officer.
- **No public launch until all six releases are complete.** Test builds for a few hiking
  friends along the way are encouraged.
- **Field conditions.** Patchy or no signal, harsh sunlight, one-handed use, battery
  matters.
- **iOS builds need macOS.** The dev machine is Windows, so iOS builds use a cloud Mac
  (CI) and ship through TestFlight. This needs an Apple Developer account ($99/yr).

## 4. Roadmap

Releases are ordered by **operational obligation, not effort**: the low-obligation
features come first, the heavy promises later. Each release gets its own design doc. This
doc designs the shared platform and Release 1 only.

| # | Release | Contents |
|---|---------|----------|
| 1 | On-trail app | Accounts, live position on route, offline maps, structured reviews, day-level reports, trail history with privacy levels |
| 2 | Social | Friends, planned hikes (privacy rules below), privacy zones |
| 3 | Conditions | Wind, fire danger/closures, tides, sunset vs. finish time, fees and permits |
| 4 | Premium | Subscriptions, stats, route planner (snap-to-trail, from `/draw`), personal time estimates, saved-route alerts, GPX export, photo storage |
| 5 | Check-in | Expected-return alerts with graded escalation (below) |
| 6 | Completion lists, track contributions | Area and peak lists; opt-in GPS tracks that help map unmapped routes |

Decisions already agreed for later releases are recorded here so the platform doesn't
preclude them:

- **Check-in escalation (R5).** It runs **server-side**, because the case that matters is
  a dead or offline phone:
  1. At the return time, the hiker is prompted first ("I'm fine / add an hour").
  2. The hiker sets a grace period, scaled to the route's length.
  3. Only then does the contact get a calm message: "probably just running late, try
     calling first", with the route and the last known position.
  4. After a further delay, the Wilderness Search and Rescue number is shown.
- **Planned hikes (R2).** Never public. Friends-only by default, and friends-of-friends
  join only with approval. Plans show a time window, not an exact start; the meeting
  point goes only to accepted people. Public history posts only after the hike ends.
  Privacy zones trim track ends near places the user marks.
- **Premium (R4).** Offline maps, stats/history depth, route planner, time estimates,
  saved-route alerts, GPX, photos. **Live position is free.** Possible non-subscription
  revenue: guide-booking commission, gear partners.

## 5. Approaches considered (platform)

The fixed parts are the Spring Boot API, PostgreSQL + PostGIS, the static route content,
and PMTiles for maps. The open question was how the phone apps get built.

- **A. Wrap the existing Svelte app with Capacitor. Chosen.** One codebase for web, iOS and
  Android, reusing the map, route pages, profiles, journal and test suite. Risk: background
  GPS (screen off) goes through native plugins.
- **B. Native Kotlin + Swift.** Most reliable background GPS, but two new codebases and a
  full front-end rewrite. Rejected.
- React Native / Flutter: also a rewrite. Rejected.
- PWA only: no background GPS on iOS. Rejected as the *only* target. The web build still
  ships, with reduced capability.

**Background-GPS test: built, emulator-verified, real-device run pending.** The spike
(`spikes/gps-test/`, uncommitted) uses `@capacitor-community/background-geolocation`
1.3.1 on Capacitor 8.
- **Emulator result:** about 1 fix per second continued while backgrounded, with no gaps
  and no process kill.
- **Finding:** while backgrounded, fixes reach the WebView **in batches, up to 34 s late**.
  The fix timestamps themselves are accurate. This is fine for track recording. But R5's
  last-known-position upload probably needs to happen natively, not from JS.
- **Pending:** a 30–60 min real walk on the user's Android phone, to test OEM battery
  killers.
- **The result gates R5 (check-in) and R6 (track recording) only.** Nothing in R1 depends
  on background GPS, so development continues.

## 6. Platform architecture

```
            ┌─────────────── one SvelteKit front end (app/) ───────────────┐
            │  web build → static host      Capacitor shells → Android/iOS │
            └───────┬───────────────────────────────────────┬──────────────┘
   static content   │  route index, pages, tiles             │  user data (JSON/HTTPS)
   (CC BY-SA, free) ▼                                        ▼
        static hosting + tile downloads            server/ — Spring Boot (Java 21)
                                                     PostgreSQL 16 + PostGIS
```

- **Repo layout.** A monorepo. `app/` is unchanged in role. `app/android/` and `app/ios/`
  are the Capacitor projects. `server/` is new: Spring Boot, Java 21 LTS, **Maven** (my
  call: the most conventional Spring Boot setup).
- **Two kinds of data, kept apart.**
  - *Content* (routes, lines, profiles, tiles) stays static, built by the existing
    pipeline. It needs no account and works offline.
  - *User data* (accounts, reviews, reports, hikes) lives only in the API.
  - The server does not serve route content. It keeps a `route` table of ids plus
    geometry, loaded from the build's route index at deploy, so it can validate route ids
    and run spatial queries.
- **Native content (my call).**
  - Route content (index, per-route JSON, `route-lines.geojson`) is bundled into the
    app build, so it works offline from first launch.
  - The Capacitor build uses an SPA fallback with runtime data loading. The web build
    keeps prerendering.
  - On launch with signal, the app checks the static host for a newer content version and
    refreshes its JSON. That way a newly drawn line or a content fix doesn't need an
    app-store release.
- **Route identity.** The id from `app/src/lib/data/ids.ts` is the shared key between
  client and server. It is already the journal's persistence key and must not change
  without a migration.
- **One API definition.** The API is documented as OpenAPI, generated by springdoc. The
  TypeScript client in `app/` is **generated** from it, not hand-written. This follows the
  project's existing "one quantity, one definition" rule.
- **Offline-first writes.** Reviews, reports and hikes are written locally (IndexedDB)
  first, then synced by a queue with retry when there's signal. Each record carries a
  client-generated UUID, so a retry is idempotent, and a device `observedAt` time alongside
  the server's `receivedAt`. Reports display `observedAt`.
- **Auth.** Users sign in with Google, with Apple (Apple requires it on iOS when other
  social logins are offered), or with email and password. The server verifies the identity
  token and issues its own short-lived access JWT plus a rotating refresh token, using
  Spring Security. **Browsing, maps and the local journal need no account.** An account is
  only needed to post or sync.
- **Persistence.** Flyway migrations, Spring Data JPA with Hibernate Spatial for the
  PostGIS columns.
- **CORS.** Allow the web origin, `https://localhost` (Android Capacitor) and
  `capacitor://localhost` (iOS).
- **Hosting.** Left to the builder. Criteria: managed Postgres with PostGIS, low cost at
  small scale, automated backups, an EU or ZA region.
- **Testing.**
  - Server: JUnit 5 + Testcontainers (real PostGIS).
  - Front end: the existing Vitest + Playwright suites keep running at both base paths.
  - Contract: the generated client must type-check against the live OpenAPI spec in CI.

## 7. Release 1 design

### 7.1 Live position on route (free, all platforms, foreground)
- A position dot on the map with an accuracy halo.
- On a route with a drawn line, the app shows:
  - **"On route"**, or **"Off route by N m"** past a threshold (builder's call, about 40 m,
    allowing for GPS error)
  - distance done and distance remaining
  - a marker on the elevation profile at your position
- All along-route arithmetic comes from `app/src/lib/map/profile.ts`. Recomputing distance
  anywhere else is a bug, as it is today.
- **Foreground only in R1.** Web uses the browser's geolocation; native uses the
  Capacitor geolocation plugin.
- **Most routes have no drawn line yet.** Only 4 of 184 do, so the no-line path is the
  *main* path, not an edge case:
  - These routes show the position dot, the route pin, and the straight-line distance to
    the pin.
  - Drawing more lines is ongoing content work in `/draw`, done in parallel. It is not on
    R1's critical path (my call).

### 7.2 Offline maps
- **Coverage first (my call: in R1).** Today's tiles cover only Cape Town (trails,
  contours and hillshade, about 9 MB in total). Around 50 routes, in the Cederberg,
  Overberg, Winelands, West Coast, Garden Route and Karoo, have no trail tiles at all.
  R1 extends the tile build (`tools/tiles/`, WSL) to every area that has routes, in line
  with the already-spec'd tiles-v2 wider bbox. It cuts **one pack per top-level region**.
- **A pack** holds that region's trails, contours and hillshade PMTiles, plus fonts.
  **Route content is not in packs:** it is bundled in the app (see §6, "Native content").
- **Native:** packs are downloaded to app storage and read through a custom `pmtiles`
  `Source` backed by the device filesystem.
- **Web:** packs are stored with the Cache Storage API through a service worker, with a
  clear notice that browser storage may be evicted.
- **The app shell doesn't bundle tiles.** It ships online-only map access plus whatever
  packs the user downloads.
- Packs are listed with their size, can be deleted, and show a "last updated" date.
- Free in R1, since there are no payments yet. The paywall arrives in R4.

### 7.3 Structured reviews
These describe the **route**, not the day. They are submitted after logging a hike (7.5),
one per hike, and the user can edit it later.

| Question | Answers |
|---|---|
| Difficulty | easier than graded / as graded / harder than graded (shown against the route's Mountain Meanders grade) |
| Enjoyment | 1–5 |
| Felt safe? | yes / mostly / no, with an optional "what happened" |
| Navigation | obvious / a few tricky junctions / got lost |
| Water on route | none / seasonal / reliable |
| Note | optional free text |

- **Attribution (my call, following the report decision).** Reviews show the reviewer's
  display name. They show the hike **month**, and no date at all when the hike is private,
  so a review never reveals a hike the person set to private.
- **Counting (my call).** Distributions and thresholds count **people, not hikes**: each
  person's latest review of a route. Hikes with an unknown date show "date not recorded".
- **Display.** Show **distributions, not averages**, e.g. "7 of 9 said harder than graded".
  Each review shows its hike date, and a dimension's summary is hidden until there are at
  least 3 reviews. Exact presentation is a UX task for the builder under §8.
- **Grade.** When a route has no grade, the difficulty question becomes easy / moderate /
  hard.

### 7.4 Day-level reports (the main differentiator)
These describe **the day**: something true now that may not be true next week.

- **Categories**, each with a default lifetime (builder may tune):
  - obstruction (fallen tree, rockfall): 30 d
  - trail damage or erosion: 60 d
  - closure: until cleared
  - fire or fire damage: 30 d
  - water source status: 14 d
  - wildlife (e.g. baboons): 2 d
  - safety incident: 14 d
  - mud, flooding or snow: 3 d
- **Position.** A point on the route, taken from the user's GPS or tapped on the map, and
  snapped to the drawn line when there is one. On a route without a line, it is a free
  point on the map, tied to the route by id.
- **Fields.** Category, an optional short note, and `observedAt`. There are **no photos in
  R1** (photo storage is R4).
- **Attribution and release (user's decision).** Reports carry the reporter's display name
  but are **held back until the reporter's hike is finished**, so a named report never
  reveals where someone is right now.
  - A held report is visible only to its author and to admins.
  - It is released when the reporter taps **Finish hike** (§7.5).
  - **Fallback if they forget** (my call): release 12 hours after `observedAt`.
  - Released reports still display `observedAt` ("seen 3 hours ago"), so the delay never
    misrepresents freshness.
  - A report filed after the hike, from home, is released immediately.
- **Display.**
  - The report's age in plain words ("3 days ago") and "last confirmed 1 day ago".
  - Active reports are listed on the route page and pinned on the map.
  - Expired reports drop out of the default view but stay in a "history" list.
- **Confirm or clear.** When a signed-in user is near or on a route with active reports,
  or logs a hike on it, they're asked **"still there?"**: yes / gone / not sure.
  - "Yes" refreshes the lifetime.
  - Two "gone" answers, or one from the original reporter, clear the report.
- **Safety incidents.**
  - They show immediately but are marked **unverified** until a second person confirms.
  - The form guides users to describe what happened and where, never to identify people.
- **Moderation.**
  - Any user can flag a report or review.
  - Three flags hide the item, pending review.
  - A minimal admin view (an `ADMIN` role) lists flagged items so they can be restored or
    removed.
  - Every moderation action is logged.

### 7.5 Trail history
- **New data model.** Today's journal holds one entry per route
  (`JournalEntry` keyed on `routeId` in `app/src/lib/journal/db.ts`). History needs a
  **hike** record, with many per route: `id`, `routeId`, `date`, `notes`, `plan` (the
  existing `JournalPlan`), `visibility`, timestamps.
- **"Done" stays derived:** a route is done if any of the user's hikes is on it.
- **Visibility.** Each hike is **private** (the default, my call: safest), **friends** (it
  takes effect when friends exist in R2) or **public**.
  - Public hikes are visible only after their date has passed.
  - The visibility of hike notes can be set separately from the hike itself.
- **Start and finish (my call; needed for report release).** On a route page, **Start
  hike** creates the hike record and opens the live-position view. **Finish hike** ends it,
  releases any held reports, and offers the review. Hikes can still be logged after the
  fact without starting one.
- **Local-first for everyone (my call).** Hikes live in IndexedDB whether or not the user
  is signed in. A one-time IndexedDB upgrade converts the per-route journal:
  - `done` with a date → a hike on that date
  - `done` without a date → a hike with an unknown date
  - Per-route notes and the saved `plan` move to a separate **route notes** store, one per
    route. These are planning notes, not hike records.
  - JSON export and import cover both stores. Importing an old-format file runs the same
    conversion.
- **Sync.** Signing in uploads local hikes, merged by client UUID. A second device
  downloads and merges. Signing out keeps local data on the device.
- **Public visibility (my call).** In R1 it is **stored only, with no public surface**.
  Nothing shows another person's hikes until R2 designs friends and profiles. This keeps
  R1 smaller and avoids building a public screen twice.

### 7.6 Accounts and personal data
- **Profile:** display name and optional avatar initials. No avatar photos in R1.
- **Settings:** export all my data as JSON, and delete my account. Deletion removes
  personal data and anonymises reports and reviews, which keep their community value.
- The privacy policy and terms (including the user-content licence) are drafted during R1
  and finalised before launch.

### 7.7 Out of scope for R1
Payments; friends and planned hikes; conditions; check-in; photos; background or
screen-off tracking; track recording.

## 8. UX principles (apply throughout)

No dedicated UX-review tool exists, so these are the bar every screen is checked against.
- **Field use.**
  - The primary actions on trail screens sit in the lower third, within thumb reach.
  - Touch targets are at least 48 px.
  - Text contrast meets WCAG AA at minimum, and trail screens aim for AAA (harsh sun).
- **Offline is a normal state, not an error.** Show it plainly. Queued posts show
  "will send when you have signal". Never lose input.
- **A review takes under 30 seconds.** Every question is tap-only and the note is
  optional.
- **Freshness is always visible.** No report or condition appears without its age.
- **Calm language,** especially around safety. Inform, don't alarm.
- **Consistency with the existing app.** The current visual language (bottom sheet, map
  beside the panel) is the base. The front-end design skill is used for new screens.
- **Battery.** No polling loops. Watch position only while a trail screen is open in R1.

## 9. Open items and risks

- **Real-device background-GPS run: pending.** It gates R5 and R6 only (§5). On iOS it
  needs its own run once the iOS build exists.
- **iOS pipeline:** pick a cloud Mac CI and set up the Apple Developer account. Needed
  before R1 is complete, not before it starts.
- **Hosting choice** (§6).
- **The terms of service and the user-content licence** need care. Contributions in R6 may
  feed route geometry, so the licence should allow that.
- **Mountain Meanders relationship.** Consider telling them about the project. The
  community overlaps heavily with theirs, and goodwill matters.

## 10. Left to the builder

The off-route threshold; report lifetimes (within reason); visual design of review and
report displays (under §8); hosting provider; the exact API shape (REST, OpenAPI-first);
how sync conflicts are resolved for edits (last-write-wins per record is acceptable in
R1).

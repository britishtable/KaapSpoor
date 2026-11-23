# R1 Plan 3: Structured Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a hike, the hiker can answer five tap-only questions about the route. Every route page shows what people said, as distributions, counting each person once.

**Architecture:**
- **A review is part of its hike.** It is an optional `review` field on the hike record, on the device and on the server. It rides the existing offline-first hike sync, LWW key, tombstones and export, so there is no second sync engine. Deleting the hike deletes the review.
- **Server storage.** Nullable `review_*` columns on `hike`, mapped as one `@Embedded` value.
- **Public read.** `GET /api/v1/routes/{routeId}/reviews` needs no auth. It reduces the reviews to each person's latest one, and returns per-question counts plus the list.
- **"Graded" has one definition.** `transform.ts` writes `graded` into `routes-index.json`. The app reads it from there, and the server loader stores it on `route`, so both sides agree on which difficulty scale a route uses.

**Tech Stack:**
- **Server:** as in plans 1 and 2 (Java 21, Spring Boot 3.5.3, PostGIS, Flyway, Testcontainers).
- **App:** SvelteKit with Svelte 5 runes, `idb`, the generated `openapi-fetch` client, Vitest with Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-18-platform-and-release1-design.md`, §7.3 (structured reviews), §7.5 (Finish offers the review) and §8 (UX).

## Prerequisites

Same as plan 2:
- **Docker Desktop must be running.** If it isn't, 71 of the 73 server tests error on Testcontainers.
- **Maven uses JDK 21.** Set `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot`.
- **`npm install` in `app/`** after pulling.
- **Tiles in a fresh worktree.** It lacks the gitignored `app/static/tiles/*.pmtiles`; copy them from the main checkout.

## Global Constraints

**Review content (§7.3, verbatim values)**

Every question is optional. A review must answer at least one question, or carry a non-blank note.

| Field | Values |
|---|---|
| `difficulty`, graded route | `EASIER`, `AS_GRADED`, `HARDER` |
| `difficulty`, ungraded route | `EASY`, `MODERATE`, `HARD` |
| `enjoyment` | 1 to 5 |
| `safety` | `YES`, `MOSTLY`, `NO`, plus an optional `safetyNote` ("what happened") |
| `navigation` | `OBVIOUS`, `TRICKY_JUNCTIONS`, `GOT_LOST` |
| `water` | `NONE`, `SEASONAL`, `RELIABLE` |
| `note` | free text |

- **Length limits:** `note` ≤ 2000 characters, and `safetyNote` ≤ 1000 characters.
- **One review per hike, editable later.** The review's LWW key is the hike's `updatedAt`.

**Display rules (§7.3)**
- **Counting.** Counts are of people, not hikes. Each person's latest review of a route counts: the one on their most recent hike by date (unknown dates sort oldest), with ties broken by the hike's `updatedAt`.
- **Distributions, not averages.** Show "7 of 9 said harder than graded", never a mean.
- **Threshold.** A question's summary is hidden until at least 3 people answered it, on the route's current scale for difficulty. This is `REVIEW_SUMMARY_MIN = 3`, in the server only.
- **Attribution.** Each review shows the reviewer's display name, plus the hike **month** ("March 2026") only when the hike is `PUBLIC` and has a date.
  - A `PRIVATE` or `FRIENDS` hike shows no date. Friends don't exist until R2, so `FRIENDS` counts as private here.
  - A public hike with no date shows "Date not recorded".
  - A soft-deleted user shows as "Former member". Plan 8 does the real anonymisation.
- **Grade scale.** The difficulty question is shown against the route's grade level, as `summariseGrade(grade).level` from `app/src/lib/data/grade.ts`.

**Server**
- **API conventions.** The package root is `za.kaapspoor.server`, endpoints live under `/api/v1`, and errors are `ProblemDetail`. User-safe 400s use `web.BadRequestException`.
- **Regenerate the API files with the change.** Every API change regenerates the snapshot and the client in the same commit: `./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true`, then `cd ../app && npm run gen:api`.

**Client and UX (§8)**
- **Tap-only, under 30 s.** Every question is tap-only.
- **Field use.**
  - Touch targets ≥ 48 px.
  - The primary Save button is full-width and sits at the bottom of the form.
  - Text meets WCAG AA contrast.
- **Offline is normal.** A saved review says "Will send when you have signal", as hikes already do.
- **Builds without an API.** Where `apiBaseUrl()` is null (GitHub Pages), the route page shows no reviews section. The device-local review form still works.
- **Design.** Load `frontend-design:frontend-design` for `ReviewForm` and `RouteReviews`, and follow the existing visual language.

**Process:** Commits carry **no `Co-Authored-By` trailer** (user preference).

## Review Focus

1. **A review written with no signal, or signed out.** It saves at once and uploads when there is signal or someone signs in, with no user action. Test in Task 3.
2. **Someone who hiked the route four times** counts once in every distribution, with the answers from their most recent hike. Test in Task 2.
3. **A private hike's review** shows the name but no month, and the API response carries no date for it at all. Test in Task 2.
4. **Deleting a hike** removes its review from the route's list and counts, and the server tombstone keeps no review fields. Tests in Tasks 1 and 2.
5. **A route that gains or loses its grade after reviews exist.** Only answers on the current scale are counted or shown, and old answers never appear under the wrong question. Tests in Tasks 2 and 5.

## Not in this plan (and where it goes)

- **Flagging reviews and the admin view:** plan 8, built once for both reports and reviews. Until then a review needs no public id, so the API exposes none.
- **Anonymising a deleted account's reviews:** plan 8. Here a soft-deleted user's name renders as "Former member".
- **Showing reviews on the map or in the library:** not in R1.

---

### Task 1: Server: a hike carries its review, and routes know whether they're graded

**Files:**
- Create: `server/src/main/resources/db/migration/V5__review.sql`
- Create: `server/src/main/java/za/kaapspoor/server/hike/HikeReview.java` (`@Embeddable`) and `server/src/main/java/za/kaapspoor/server/hike/ReviewAnswers.java` (the answer enums)
- Modify:
  - `server/src/main/java/za/kaapspoor/server/hike/{Hike.java, HikeDtos.java, HikeService.java}`
  - `server/src/main/java/za/kaapspoor/server/route/{Route.java, RouteIndexLoader.java}`
  - `server/src/test/resources/routes-index-fixture.json` (give one route `"graded": true`)
- Modify: `app/scripts/transform.ts` and `app/src/lib/data/types.ts` (`RouteIndexEntry.graded: boolean`, set to `summariseGrade(grade).level !== null`)
- Modify (regenerated): `server/openapi.json`, `app/src/lib/api/schema.d.ts`
- Test: `server/src/test/java/za/kaapspoor/server/hike/HikeReviewApiTest.java`, `server/src/test/java/za/kaapspoor/server/route/RouteIndexLoaderTest.java`, `app/scripts/transform.test.ts`

**Schema (`V5__review.sql`):**
```sql
alter table route add column graded boolean not null default false;

alter table hike
    add column review_difficulty  text check (review_difficulty in ('EASIER','AS_GRADED','HARDER','EASY','MODERATE','HARD')),
    add column review_enjoyment   smallint check (review_enjoyment between 1 and 5),
    add column review_safety      text check (review_safety in ('YES','MOSTLY','NO')),
    add column review_safety_note text,
    add column review_navigation  text check (review_navigation in ('OBVIOUS','TRICKY_JUNCTIONS','GOT_LOST')),
    add column review_water       text check (review_water in ('NONE','SEASONAL','RELIABLE')),
    add column review_note        text;
```

**Interfaces:**
- Produces:
  - **The review DTO.** `HikeDtos.Review(Difficulty difficulty, Integer enjoyment, Safety safety, String safetyNote, Navigation navigation, Water water, String note)`. Every field is nullable, and absent fields are omitted (`@JsonInclude(NON_NULL)`, as `HikePlan` does).
  - **On the write and the read.** `HikeWrite` gains an optional `review` (`Review` or null). `Hike` gains `review`, which is required and nullable.
  - **The answer enums** (in `ReviewAnswers`):
    - `Difficulty { EASIER, AS_GRADED, HARDER, EASY, MODERATE, HARD }`
    - `Safety { YES, MOSTLY, NO }`
    - `Navigation { OBVIOUS, TRICKY_JUNCTIONS, GOT_LOST }`
    - `Water { NONE, SEASONAL, RELIABLE }`
  - **Which scale.** `Difficulty.isGradedScale(): boolean` is true for the first three values.
  - **Routes.** `Route.isGraded(): boolean`.
  - **The index.** `RouteIndexEntry.graded: boolean` in the app's types and in `routes-index.json`.

**Server rules, added to `HikeService.upsert`:**
- **Validation.** Each failure is a 400 with plain copy:
  - A non-null review with every answer null and a blank `note` → "A review needs at least one answer."
  - `note` > 2000 or `safetyNote` > 1000 characters → "That review is too long."
  - A non-null `safetyNote` while `safety` is null → "Say whether it felt safe before saying what happened."
  - A review on a hike whose `startedAt` is set and `finishedAt` is null → "Finish the hike before reviewing it."
  - A review on a hike dated after today in Africa/Johannesburg → "You can review a hike once it's happened."
- **No scale check at write time.** Either difficulty scale is accepted whatever the route's grade. A route can be regraded after a review is written, and rejecting the write would wedge the whole hike in sync (a 400 becomes `syncError`). Task 2 filters by scale at read time.
- **Tombstones.** A tombstone clears every `review_*` column, alongside `notes` and `plan`, in `Hike.apply`.
- **Mapping.** Hibernate maps an all-null embedded value to `null`, which is exactly "no review".

- [ ] **Step 1: Write the failing server tests** in `HikeReviewApiTest`. Reuse `HikeApiTest`'s helpers for register, seed route and fixed clock, extracting them to a shared test helper if needed.
  - `putWithReviewRoundTrips()`: PUT a hike with `review {difficulty: HARDER, enjoyment: 4, safety: MOSTLY, safetyNote: "loose scree", navigation: OBVIOUS, water: SEASONAL, note: "go early"}`. The response and a `GET ?since=0` both carry exactly those values.
  - `putWithoutReviewClearsIt()`: PUT with a review, then a later PUT with `review: null` → `review` is null.
  - `emptyReviewIs400()`: `review: {}` → 400. `review: {note: "  "}` → 400.
  - `noteOver2000Is400()`; `safetyNoteOver1000Is400()`; `safetyNoteWithoutSafetyIs400()`.
  - `reviewOnActiveHikeIs400()`: `startedAt` set, `finishedAt` null, with a review → 400 "Finish the hike before reviewing it."
  - `reviewOnTomorrowsHikeIs400()`: date = fixed clock's tomorrow, with a review → 400. Without a review → 200.
  - `eitherScaleAccepted()`: `EASY` on a graded route → 200.
  - `tombstoneDropsReview()` (Review Focus 4): PUT with a review, then `deleted: true` → response `review` null, and `select review_note, review_difficulty from hike where id = ?` gives nulls.
  - `enjoymentOutOfRangeIs400()`: `enjoyment: 6` → 400 (validated in the service, not left to the DB check).
- [ ] **Step 2: Write the failing loader test.** In `RouteIndexLoaderTest`, `storesGraded()`: the fixture route with `"graded": true` loads as `graded = true`, and an entry without the field loads as `false`.
- [ ] **Step 3: Write the failing transform test.** In the transform test, an entry with grade `"3 ***: long prose"` gets `graded: true`, a `null` grade gets `false`, and a prose grade starting "Moderate walk" gets `false` (`summariseGrade`'s two-letter bound).
- [ ] **Step 4: Run them all and confirm they fail.**
  - Server: `cd server && ./mvnw -q test -Dtest='HikeReviewApiTest,RouteIndexLoaderTest'`. Expected: compile failure.
  - App: `cd app && npx vitest run scripts`. Expected: the `graded` assertions fail.
- [ ] **Step 5: Implement** the migration, the enums, the `HikeReview` embeddable, the DTO fields, the validation and tombstone scrub, `Route.graded`, and the loader's `graded` column. Add `graded` to `transform.ts` and `RouteIndexEntry`, then regenerate the snapshot and `schema.d.ts`.
- [ ] **Step 6: Run and confirm they pass.** Run the full `./mvnw -q verify`, then in `app/` run `npm run check && npx vitest run`. Expected: all green, and the regenerated files are staged with the code.
- [ ] **Step 7: Commit.** `git commit -m "feat(server): a hike carries its review; routes know if they are graded"`

---

### Task 2: Server: public route reviews

**Files:**
- Create: `server/src/main/java/za/kaapspoor/server/review/{RouteReviewController.java, RouteReviewService.java, RouteReviewDtos.java}`
- Modify: `server/src/main/java/za/kaapspoor/server/web/SecurityConfig.java` (permit `GET /api/v1/routes/*/reviews`)
- Modify (regenerated): `server/openapi.json`, `app/src/lib/api/schema.d.ts`
- Test: `server/src/test/java/za/kaapspoor/server/review/RouteReviewApiTest.java`

**Interfaces:**
- Consumes: the `review_*` columns, `route.graded`, and `Difficulty.isGradedScale()` from Task 1.
- Produces: `GET /api/v1/routes/{routeId}/reviews`, which needs no auth and returns `RouteReviews`. An unknown route → 404.
  ```
  RouteReviews   { graded: boolean, people: int, summary: ReviewSummary, reviews: PublicReview[] }
  ReviewSummary  { difficulty: Counts|null, enjoyment: Counts|null, safety: Counts|null,
                   navigation: Counts|null, water: Counts|null }
  Counts         { answered: int, counts: { [answer: string]: int } }  // enjoyment keys "1".."5"
  PublicReview   { displayName: string, month: string|null /* "2026-03" */, dateRecorded: boolean,
                   difficulty?, enjoyment?, safety?, safetyNote?, navigation?, water?, note? }
  ```
  - **`people`:** the number of distinct reviewers.
  - **`reviews`:** sorted newest first by the hike's `updatedAt`, at most 100.
  - **`dateRecorded`:** false only for a `PUBLIC` hike with a null date. A private hike sends `month: null, dateRecorded: true`, so a private hike reveals nothing.
  - **Difficulty on the wrong scale.** It is dropped from that review in `reviews` and from the counts. "Wrong scale" means `isGradedScale() != route.graded`.
  - **Counts below the threshold.** A question with `answered < 3` is `null` in `summary`.

**Query (`RouteReviewService`, `JdbcTemplate`):**
```sql
select distinct on (h.user_id) h.*, u.display_name, u.deleted_at as user_deleted_at
from hike h join app_user u on u.id = h.user_id
where h.route_id = ? and h.deleted_at is null
  and (h.review_difficulty is not null or h.review_enjoyment is not null or h.review_safety is not null
       or h.review_navigation is not null or h.review_water is not null or h.review_note is not null)
order by h.user_id, h.hiked_on desc nulls last, h.client_updated_at desc
```
- **Counting and display name.** Count in Java over the result.
- **Soft-deleted users** render as "Former member".

- [ ] **Step 1: Write the failing tests** in `RouteReviewApiTest`. Seed a graded route `g` and an ungraded route `u`, with users via the register helper and hikes via PUT.
  - `anonymousCanRead()`: GET with no token → 200.
  - `unknownRouteIs404()`.
  - `countsPeopleNotHikes()` (Review Focus 2): user A reviews `g` on four hikes, the latest-dated saying `HARDER`, and B and C say `AS_GRADED`. The result is `people` 3, `difficulty.answered` 3, counts `{HARDER:1, AS_GRADED:2}`, and three entries in `reviews`.
  - `latestIsByHikeDateThenUpdatedAt()`: A's hike dated 2026-03-01 says `EASIER`. A's undated hike, written later, says `HARDER` → `EASIER` counts.
  - `summaryHiddenBelowThree()`: two reviewers → `summary.difficulty` null, and both are still listed in `reviews`.
  - `privateHikeShowsNoMonth()` (Review Focus 3): a `PRIVATE` hike dated 2026-03-14 → `month` null and `dateRecorded` true. The same as `FRIENDS` → the same. As `PUBLIC` → `month "2026-03"`. A `PUBLIC` hike with a null date → `dateRecorded` false. Assert the raw JSON body has no `"2026-03-14"` substring.
  - `wrongScaleDropped()` (Review Focus 5): on graded `g`, three people say `EASY` and one says `HARDER` → `difficulty` null (1 answered < 3), and the `EASY` reviews are listed without `difficulty`.
  - `deletedHikeDisappears()` (Review Focus 4): tombstone a reviewed hike → it is gone from `reviews` and from the counts.
  - `formerMember()`: set `app_user.deleted_at` for a reviewer → their `displayName` is "Former member".
  - `noteOnlyReviewListedNotCounted()`: a review with only a note appears in `reviews` and adds to `people`, but to no `answered`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=RouteReviewApiTest`. Expected: compile failure.
- [ ] **Step 3: Implement** the controller, service and DTOs, and the security matcher (`HttpMethod.GET`, `/api/v1/routes/*/reviews`). Regenerate the snapshot and the client.
- [ ] **Step 4: Run and confirm they pass.** Run the full `./mvnw -q verify` and `cd ../app && npm run check`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): public route reviews, one per person, summaries from three"`

---

### Task 3: App: the review lives on the hike (store, import/export, sync)

**Files:**
- Modify:
  - `app/src/lib/data/types.ts`: `Review`, and `Hike.review?: Review`
  - `app/src/lib/journal/store.ts`: `setReview`
  - `app/src/lib/journal/io.ts`: validate and carry `review`
  - `app/src/lib/sync/sync.ts`: `toWrite` and `fromServer` carry `review`
- Test: `app/src/lib/journal/store.test.ts`, `app/src/lib/journal/io.test.ts`, `app/src/lib/sync/sync.test.ts`

**Interfaces:**
- Consumes: the generated `components['schemas']['Review']` from Task 1.
- Produces:
  - **The type.** `type Review = components['schemas']['Review']`, re-exported from `types.ts` so there's one definition. Absent answers are omitted, never `null`, as `JournalPlan` does.
  - **The store call.** `setReview(hikeId: string, review: Review | null): Promise<Hike>` in `store.ts`.
    - It goes through `requireEditable` and `localWriteHike`, so it is locked for other owners, stamps the owner and marks the hike pending.
    - It throws `ReviewNotAllowedError` when the hike is active (started, not finished) or its date is after today's `localDate()`.
    - `null` removes the field.
  - **Who may review.** `canReview(h: Hike, today: string): boolean` in `store.ts`. The UI and `setReview` both use it.

- [ ] **Step 1: Write the failing tests.**
  - `store.test.ts`:
    - `setReview saves the review and marks the hike pending`.
    - `setReview(null) removes it`.
    - `setReview on an active hike throws ReviewNotAllowedError`.
    - `setReview on another owner's hike throws LockedHikeError`.
    - `canReview is false for a hike dated tomorrow`.
  - `io.test.ts`:
    - `a review round-trips through serialize/parse`.
    - `a review with enjoyment 9 or an unknown answer makes the hike malformed`.
    - `a v2 file without reviews still imports`.
  - `sync.test.ts`:
    - `a review written signed out uploads on sign-in` (Review Focus 1): the PUT body carries the `review`.
    - `a pulled hike's review is stored without null fields`.
    - `a review written offline shows pending and sends when online fires`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `cd app && npx vitest run src/lib/journal src/lib/sync`. Expected: they fail on the missing `setReview` and `review`.
- [ ] **Step 3: Implement.** `fromServer` strips `null` answer fields the way it already strips null plan legs; put that in one `cleanReview(r)` next to `cleanPlan` in `convert.ts`. `toHike` in `io.ts` validates each answer against the same value lists as Global Constraints, and declares those lists once in `types.ts` as `const` arrays.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): a hike carries its review through store, export and sync"`

---

### Task 4: App: the review form and where it's offered

**Files:**
- Create: `app/src/lib/components/ReviewForm.svelte`, `app/src/lib/components/ReviewForm.test.ts`
- Modify: `app/src/lib/components/HikeLog.svelte`, `app/src/lib/components/HikeLog.test.ts`
- Modify: `app/src/routes/route/[id]/+page.svelte` (pass `graded` and the grade level to `HikeLog`)

**Interfaces:**
- Consumes: `setReview`, `canReview` and `Review` from Task 3, and `summariseGrade` from `grade.ts`.
- Produces: `ReviewForm` props: `{ review: Review | undefined; graded: boolean; gradeLevel: string | null; onsave: (r: Review | null) => void; oncancel: () => void }`.

**Behaviour:**
- **Five questions, each a single-choice chip row** (radio semantics: `role="radiogroup"`, arrow keys). Tapping the chosen chip again clears it.
- **Difficulty heading.** On a graded route it reads "Compared with grade {level}:", with easier / as graded / harder. On an ungraded route it reads "How hard was it?", with easy / moderate / hard.
- **Felt safe?** The "What happened?" box appears only when safety is `MOSTLY` or `NO`. If safety is cleared, the box hides and its text is dropped on save.
- **Note.** An optional textarea, collapsed behind "Add a note".
- **Saving.**
  - Save is disabled until there is at least one answer or a non-blank note.
  - It calls `onsave(review)` with absent answers omitted.
  - On an existing review, a "Remove review" button calls `onsave(null)`.
- **In `HikeLog`:**
  - After Finish hike, the "Hike finished. Nice one." line gains a **"Review the route"** button that opens the form for that hike.
  - Each past hike where `canReview` is true gets "Add review" or "Edit review".
  - The existing rule that only one form is open at a time (`formFor`) covers the review form too.
  - A saved review shows a one-line summary on the hike row, for example "Harder than graded · 4/5".
  - A pending review shows "Will send when you have signal".

- [ ] **Step 1: Write the failing tests.**
  - `ReviewForm.test.ts`:
    - `graded route asks against the grade level` (text "Compared with grade 3").
    - `ungraded route asks easy/moderate/hard`.
    - `Save disabled until one answer`.
    - `tapping the chosen chip clears it`.
    - `what-happened shows for MOSTLY and NO only, and is dropped when safety is cleared`.
    - `saves with absent answers omitted` (`onsave` gets `{ enjoyment: 4 }` exactly).
    - `Remove review calls onsave(null)`.
    - `chips are at least 48px` (check the computed `min-height` style the component sets).
  - `HikeLog.test.ts`:
    - `after Finish, Review the route opens the form for that hike and saving stores it`.
    - `an active hike offers no review`.
    - `a reviewed hike shows its summary and Edit review`.
    - `a locked hike (another owner) offers no review`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/lib/components/ReviewForm.test.ts src/lib/components/HikeLog.test.ts`. Expected: fail (no component).
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check`. Expected: all green.
- [ ] **Step 5: Commit.** `git commit -m "feat(app): review a route after a hike, tap-only"`

---

### Task 5: App: route reviews on the route page, then a live check

**Files:**
- Create: `app/src/lib/reviews/reviews.ts` (fetch and phrasing), `app/src/lib/reviews/reviews.test.ts`
- Create: `app/src/lib/components/RouteReviews.svelte`, `app/src/lib/components/RouteReviews.test.ts`
- Modify: `app/src/routes/route/[id]/+page.svelte` (place `RouteReviews` above `HikeLog`)

**Interfaces:**
- Consumes: `GET /api/v1/routes/{routeId}/reviews` (Task 2), `api()` from `session.ts`, and `apiBaseUrl()`.
- Produces:
  - **The fetch.** `fetchRouteReviews(routeId: string): Promise<RouteReviews | 'offline' | 'unavailable'>`:
    - `'unavailable'` when `apiBaseUrl()` is null, or on a 404 or 5xx;
    - `'offline'` on a network error.
  - **The phrasing.** `phrase(question: Question, counts: Counts, graded: boolean): string[]` turns the counts into lines like "7 of 9 said harder than graded". Lines are ordered by count, highest first, and zero counts are omitted.
  - **The month.** `formatMonth(month: string | null, dateRecorded: boolean): string | null` gives "March 2026", "Date not recorded", or `null`.

**Behaviour:**
- **When the section shows.**
  - It is not rendered at all when the API is unavailable.
  - Offline, it shows "Reviews need a connection." in calm muted text.
  - With no reviews, it shows "No reviews yet."
- **Summary.** Each question shows its `phrase` lines. A null summary shows "Not enough reviews yet" for that question.
- **Difficulty on the current scale only.** The difficulty phrasing uses `graded` from the response, never the page's index entry, so the server and the page cannot disagree mid-regrade.
- **The list.** Each review shows the display name and `formatMonth`, then its answers in words, then the safety note and note.
  - Show 5, with "Show all {n}".
  - Text is user content: render it as text, never `{@html}`.

- [ ] **Step 1: Write the failing tests.**
  - `reviews.test.ts`:
    - `phrase orders by count and omits zeros`.
    - `phrase uses graded wording only when graded` (Review Focus 5).
    - `formatMonth("2026-03", true)` is "March 2026"; `(null, false)` is "Date not recorded"; `(null, true)` is null.
    - `fetchRouteReviews returns 'unavailable' with no API base`, and `'offline'` when fetch rejects.
  - `RouteReviews.test.ts`:
    - `renders nothing when unavailable`.
    - `shows the offline line`.
    - `hidden summary says Not enough reviews yet`.
    - `a review note with <b> renders as literal text`.
    - `Show all reveals the rest`.
- [ ] **Step 2: Run them and confirm they fail.** Run: `npx vitest run src/lib/reviews src/lib/components/RouteReviews.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.** Load `frontend-design:frontend-design` first.
- [ ] **Step 4: Run and confirm they pass.** Run: `npx vitest run && npm run check && npm run test:e2e`. Expected: all green. The e2e suite runs without an API, so it proves the section stays absent and nothing else broke.
- [ ] **Step 5: Live check in a real browser.** Unit tests can't see this; see memory "two bugs invisible to unit tests". It also covers plan 2's open manual check.
  1. Start the server locally, then run the app with `VITE_API_BASE_URL` pointing at it.
  2. Make account A, start and finish a hike, and review it. The route page's list shows A's review after reload.
  3. In a second browser profile, sign in as A: the hike and its review arrive.
  4. Do the same as B and C with three difficulty answers. The difficulty summary appears only once the third arrives.
  5. Switch the network to Offline in devtools, write a review, then go back online. It sends with no action.
  6. Record the results in `docs/superpowers/specs/2026-11-18-r1-plan2-followups.md` (the manual check) and in this plan.
- [ ] **Step 6: Commit.** `git commit -m "feat(app): route reviews as distributions on the route page"`

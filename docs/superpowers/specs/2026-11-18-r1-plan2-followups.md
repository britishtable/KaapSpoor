# R1 Plan 2 (hikes): follow-ups

These items were carried out of the plan 2 build (branch `r1-hikes`, merged 2026-11-18). Items fixed in the final review's fix round are not listed.

## Open: fix first (before plan 3 builds on hikes)

- **Import while signed in can leak to the next account.**
  - **What goes wrong:** settings import stores incoming hikes with `owner: null` (`io.ts` `toHike`, then `store.ts` `replaceAll`). If the user signs out before those hikes upload, they are editable and exportable by anyone holding the phone. The next account to sign in then uploads them as its own.
  - **Fix:** when signed in, stamp `owner = viewer` on incoming hikes whose owner is null.
  - **Test:** A imports while offline and signs out; B signs in; B can't see the hikes and sends no PUT for them.

## Open: checks not yet run (machine was low on memory)

- **Subpath e2e:** run `npx playwright test --config=playwright.subpath.config.ts`. The root config passed 27/27 before the final fix round.
- **Manual live-server check (plan 2, Task 7 Step 5):**
  1. Run the server locally with `VITE_API_BASE_URL` set.
  2. Create an account and log a hike.
  3. Check `GET /api/v1/hikes`.
  4. Sign in from a second browser profile; the hike arrives.
  5. Repeat with a plan-bearing hike, and include export, then import.
- `./mvnw verify` on the merged tree. It last passed at 205cf4a (73 tests).

## Deferred minors

**Server**
- **Duplicate new id from two users.** If two users create a hike with the same new id at once, the second gets a 500, not a 409.
- **Omitted `deleted` is not rejected.** `deleted` and `reversed` are primitive booleans, so an omitted `deleted` reads as false instead of giving a 400.
- **Duplicated test clock.** The test `MutableClock` is duplicated in `HikeApiTest` and `TokenServiceTest`, which also forces an extra Spring context.
- **Retries use a revision.** An exact retry takes a new revision, so the client must not treat `revision` as stable.
- **Untested server paths:**
  - a soft-deleted user gets 401 on `/hikes`;
  - `since` < 0 or `limit` < 1 gives 400;
  - a tombstone's `client_updated_at` is the later of the stored and incoming values.

**Device storage (`db.ts`)**
- **Lost error.** The upgrade's catch discards the original error.
- **Fix before the next schema version:** gate store creation on `oldVersion < 3`.
- **No `blocking` handler.** An old tab still holding v2 hangs the v3 open.
- **Secure context needed.** `crypto.randomUUID` requires a secure context, so a plain-http LAN dev server would abort the upgrade.
- **Weak failure tests.** They assert `rejects.toBeDefined()` rather than `AbortError`.

**Store and import (`store.ts`, `io.ts`)**
- **Edits reach tombstones.** `updateHike` writes onto a tombstone; it should do nothing.
- **Clock not injectable.** `serialize` uses `new Date()` rather than `now()`.
- **Duplicate v1 import.** Importing the same v1 file twice duplicates hikes, because it mints new UUIDs. That also re-creates hikes deleted since.
- **Slow merge.** `merge` looks up each incoming hike with `find`, which is O(n·m).
- **Planning notes ignore the signed-in account.** `routeNotes` are not scoped by viewer; they are device-local by design.
- **Weak date validation.** `isDateOrNull` checks only the shape, so `2026-13-45` passes.
- **Form date limit.** The form's maximum date is tomorrow in the device's time zone, but the server uses tomorrow in Africa/Johannesburg.
- **Store test gaps:**
  - `setRouteNotes` rollback;
  - `onLocalWrite` not called when a write fails;
  - a tie in `merge`;
  - the `hikesForRoute` tiebreak;
  - `localDate` ignores the test clock.

**Hike log UI**
- **Accessibility:**
  - All Delete buttons share one accessible name; add an `aria-label` with the date.
  - The disabled "Log a past hike" disclosure keeps `aria-expanded`, and there is no Escape to close the form.
- **Defence in depth.** `openNew` and `openEdit` don't check `formFor` themselves.
- **Notes saved on blur.** Planning notes save on change, so only when the box loses focus. The brief mandated this.

**Session (`session.ts`)**
- **Untested retry condition.** Nothing tests that only an `invalid_token` 401 is retried.
- **Missing path guard.** Add a `/api/v1/auth/` path guard to the retry wrapper.
- **Wasted refresh.** Refresh doesn't check storage for a token another tab already rotated.
- **Live token left behind.** If `/me` fails after login, the token pair is discarded without a logout call.
- **Test gap.** The account page's sign-out test doesn't assert that logout was called.

**Sync (`sync.ts`)**
- **Wedge risk.** `followUp` isn't cleared if `runOnce` ever rejects; use `finally`.
- **Throwaway clients.** `syncState` calls `api()` inside a derived store on every change.
- **Failed startup.** The layout starts sync even when `hydrate()` rejected.
- **No error copy.** There is no user copy for the `error` status.
- **Bad server time.** `canonical()` throws on an unparseable server instant, which aborts the pull.
- **Stalled requests.** There is no request timeout, so a stalled request holds sync. Add `AbortSignal.timeout`.
- **No automatic retry.** Nothing retries after a failed run when no `online` event follows.
- **Late offline text.** "Will send when you have signal" only shows once a run has set the offline status.
- **Replace-mode import.** It can leave the device behind the server, because the cursor isn't reset.
- **Self re-import.** Re-importing your own backup while signed in drops the owner. It heals on the next push.
- **Server checks order.** The server validates before checking for a tombstone, so an invalid edit of a deleted hike gets a 400.

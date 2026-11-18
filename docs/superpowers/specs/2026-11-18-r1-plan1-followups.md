# R1 Plan 1 (server foundation): follow-ups

These are carried out of the plan 1 build (branch `r1-server-foundation`). Each item has a destination plan.

Fixed in plan 2, Task 1: the auth endpoints now ignore a stale Bearer header.

## Client auth handling (R1 plan 2 / plan 6)

- **Grace window.** A refresh reused within 10 s returns a bare 401. On a refresh 401, the client must re-read its stored tokens and retry if they've changed before treating the session as dead (two tabs).
- **Telling 401s apart.** An invalid or expired access token carries the reason only in `WWW-Authenticate: Bearer error="invalid_token"`.
- **Nonce for native Apple sign-in.** The server checks no nonce or `at_hash` yet. Add it when the native sign-in flow can supply a nonce.
- **JWKS outage.** An outage returns 401 rather than 503. Revisit with the sign-in UI.
- **Lockout hint.** After a takeover lockout, the original password user sees only "Email or password is incorrect". Consider a "try Google/Apple" hint.

## Account deletion (R1 plan 8)

- **Soft-deleted users are only checked at password login.** Token refresh, the OIDC identity path and `/me` don't check `deleted_at` yet. Deletion must revoke every token family (`TokenService.revokeAllForUser` exists).
- **Deleted users' emails stay reserved.** The `app_user_email_idx` unique index includes deleted users, so deletion must null the email, or that address returns 409 forever.
- **Access tokens outlive lockout and deletion.** They stay valid for up to 15 minutes after either. A token-version claim would close this if needed.
- **Missing tests:** soft-deleted login gives the identical 401, and `/me` for a deleted user.

## Before public launch

- Rate limiting or lockout on login and register (BCrypt makes them a CPU-exhaustion vector).
- Pruning expired `refresh_token` rows.
- Password reset and email verification.
- **Swagger UI is public in production.** Decide deliberately.
- **Register's 409 reveals existing accounts,** while login hides them (plan-mandated).

## Small, opportunistic

- The `iat` claim is never bounded; only `exp` and `nbf` are checked. Review Focus 3's test proves acceptance only.
- Lock comment in `RefreshTokenRepository`: it says FOR UPDATE, but Hibernate emits FOR NO KEY UPDATE.
- No two-thread test of concurrent `refresh(r1)`.
- The bare `accounts.google.com` issuer form is untested.
- `RouteIndexLoaderTest`: `upserted` and preserved `retired_at` are unasserted, and fixture paths are relative to the working directory.
- `BCryptPasswordEncoder` is inline, not a bean. `JwtDecoder` uses the system clock.
- Test log noise from handled constraint violations.

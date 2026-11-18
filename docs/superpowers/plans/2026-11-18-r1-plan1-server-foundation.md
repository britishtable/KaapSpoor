# R1 Plan 1 — Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Spring Boot API in `server/` with PostGIS, a route table seeded from the app's route index, email/password + Google/Apple sign-in issuing KaapSpoor's own tokens, and a TypeScript client generated into `app/` from the API's OpenAPI spec.

**Architecture:** The server holds user data only. Route content stays static, and the server keeps just route ids plus location for validation and spatial queries. Identity tokens from Google/Apple are verified server-side, then exchanged for a short-lived HS256 access JWT and a rotating opaque refresh token. The OpenAPI document is a committed snapshot that the TS client is generated from, so client and server share one definition.

**Tech Stack:** Java 21, Spring Boot 3.5.3 (web, security, oauth2-resource-server, data-jpa, validation, actuator), Hibernate Spatial (Boot-managed version), Flyway + `flyway-database-postgresql`, PostgreSQL 16 + PostGIS (`postgis/postgis:16-3.4`), springdoc-openapi 2.8.6, JUnit 5 + Testcontainers (Boot-managed), Maven wrapper. App side: openapi-typescript 7.13.0, openapi-fetch 0.17.0.

**Spec:** `docs/superpowers/specs/2026-11-18-platform-and-release1-design.md` (§3 constraints, §6 platform architecture, §7.6 accounts). Plans 2–8 of R1 (hikes, reviews, reports, live position, Capacitor shells, offline maps, export/deletion/admin) build on this one.

## Prerequisites (user action, before Task 1)

- **Install Docker Desktop with the WSL 2 backend** and start it. Testcontainers needs a Docker daemon, and this machine has none (`docker: command not found`, checked 2026-11-18). Verify with `docker version` showing a Server section.
- JDK 21 is at `C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot`. Run Maven with `JAVA_HOME` pointing there, **not** at JDK 23, which is first on PATH.

## Global Constraints

- Backend is Java (Spring Boot); the front end stays the existing SvelteKit app (spec §3).
- Package root `za.kaapspoor.server`; all endpoints under `/api/v1`.
- Route id is the string produced by `app/src/lib/data/ids.ts`. The server never re-derives it and never deletes a route row (user data will reference it).
- `area-approx` locations are never stored as points (the provenance gate in `app/scripts/transform.ts`).
- Errors are RFC 9457 `ProblemDetail` JSON.
- CORS allows exactly the configured origins; defaults: `http://localhost:5173`, `https://britishtable.github.io`, `https://localhost`, `capacitor://localhost`.
- Access token: HS256 JWT, 15 min, claims `sub` (user UUID) and `role`. Refresh token: 256-bit random, base64url, 60 days, stored only as SHA-256 hash, rotated on every use.
- `kaapspoor.jwt-secret` must decode to ≥ 32 bytes, or startup fails.
- Commits carry no `Co-Authored-By` trailer (user preference).

## Review Focus

1. **Email in mixed case or with spaces** (`" Sam@Example.com "`) must log into the account registered as `sam@example.com`. Test in Task 4.
2. **Two tabs refreshing with the same token at once** must not log the user out. If a token is reused within 10 s of its first use, return 401 *without* revoking the family; reuse after 10 s revokes the family. Test in Task 3.
3. **Phone clock slightly off.** An OIDC token with `iat` 30 s in the future is accepted (60 s allowed skew). Test in Task 5.
4. **Apple sends name and email only on the first sign-in, and email may be a private relay.** A missing name falls back to the request's `displayName`, then `"Hiker"`. Test in Task 5.
5. **Display name blank after trimming, or over 40 characters,** is rejected with 400, not stored. Test in Task 4.

---

### Task 1: Server skeleton with PostGIS and health

**Files:**
- Create: `server/pom.xml`, `server/mvnw`, `server/mvnw.cmd`, `server/.mvn/wrapper/maven-wrapper.properties` (via `mvn -N wrapper:wrapper`)
- Create: `server/src/main/java/za/kaapspoor/server/KaapSpoorServerApplication.java`
- Create: `server/src/main/resources/application.yml`
- Create: `server/src/main/resources/db/migration/V1__postgis.sql` containing `CREATE EXTENSION IF NOT EXISTS postgis;`
- Create: `server/src/test/java/za/kaapspoor/server/TestcontainersConfig.java`
- Test: `server/src/test/java/za/kaapspoor/server/ApplicationBootsTest.java`
- Modify: `.gitignore` (add `server/target/`)

**Interfaces:**
- Produces: `TestcontainersConfig`, a `@TestConfiguration(proxyBeanMethods = false)` exposing a `@Bean @ServiceConnection PostgreSQLContainer<?>` built from `DockerImageName.parse("postgis/postgis:16-3.4").asCompatibleSubstituteFor("postgres")`. Every later integration test uses `@SpringBootTest @Import(TestcontainersConfig.class)`.
- Produces: the property `kaapspoor.jwt-secret`, set in `src/test/resources/application-test.yml` to a fixed 32+ byte base64 value; tests run with `@ActiveProfiles("test")`.

- [ ] **Step 1: Write the failing test.** `ApplicationBootsTest`:
  - `healthIsUp()`: GET `/actuator/health` returns 200 with `"status":"UP"`.
  - `postgisIsInstalled()`: `jdbcTemplate.queryForObject("select postgis_version()", String.class)` is not null.
- [ ] **Step 2: Run it and confirm it fails.** Run: `cd server && ./mvnw -q test -Dtest=ApplicationBootsTest`. Expected: compile failure, because no application class exists yet.
- [ ] **Step 3: Implement.**
  - `pom.xml`: parent `spring-boot-starter-parent:3.5.3`, `java.version` 21. Dependencies:
    - web, security, oauth2-resource-server, data-jpa, validation, actuator
    - `flyway-core`, `flyway-database-postgresql`, `postgresql`, `hibernate-spatial`
    - `springdoc-openapi-starter-webmvc-ui:2.8.6`
    - test: `spring-boot-starter-test`, `spring-boot-testcontainers`, `testcontainers:postgresql`, `junit-jupiter`, `spring-security-test`
  - `application.yml`: `spring.jpa.hibernate.ddl-auto: validate` and `open-in-view: false`; expose only the `health` actuator endpoint.
  - Security: permit `/actuator/health`. A minimal `SecurityFilterChain` is acceptable here; Task 4 replaces it.
- [ ] **Step 4: Run it and confirm it passes.** Same command. Expected: `Tests run: 2, Failures: 0`.
- [ ] **Step 5: Commit.** `git add server .gitignore && git commit -m "feat(server): Spring Boot skeleton with PostGIS and health check"`

### Task 2: Route table seeded from the route index

**Files:**
- Create: `server/src/main/resources/db/migration/V2__route.sql`
- Create: `server/src/main/java/za/kaapspoor/server/route/{Route.java, RouteRepository.java, RouteIndexLoader.java}`
- Test: `server/src/test/java/za/kaapspoor/server/route/RouteIndexLoaderTest.java`, fixture `server/src/test/resources/routes-index-fixture.json`

**Interfaces:**
- Consumes: `TestcontainersConfig` (Task 1). Input is the JSON array in the app's `build/data/routes-index.json`, whose shape is `RouteIndexEntry` in `app/src/lib/data/types.ts`. Read only `id`, `title`, `area`, `coords {lat, lon}`, `coordsSource`. Ignore unknown fields.
- Produces: `RouteRepository.existsByIdAndRetiredAtIsNull(String id): boolean`, used by plans 2–4 to validate route ids.
- Produces: `RouteIndexLoader.load(Path indexJson): LoadResult(int upserted, int retired)`. It runs automatically at startup (an `ApplicationRunner`) when `kaapspoor.routes-index` is set.

Table `route`:

| Column | Type |
|---|---|
| `id` | `text` primary key |
| `title` | `text not null` |
| `area` | `text[] not null` |
| `location` | `geography(Point,4326)` null |
| `location_source` | `text` null |
| `retired_at` | `timestamptz` null |
| `updated_at` | `timestamptz not null` |

- [ ] **Step 1: Write the failing tests.** The fixture has 3 entries: `a` (`crawl`, coords set), `b` (`area-approx`, coords set) and `c` (coords null).
  - `loadsAllRoutesButOnlyPreciseLocations()`: after loading, there are 3 rows. `a` has a location of `lon 18.4, lat -33.9` (assert via `ST_X/ST_Y`). `b` and `c` have a null `location`, and `b`'s `location_source` is `area-approx`.
  - `routesMissingFromANewIndexAreRetiredNotDeleted()`: load the fixture, then load an index holding only `a`. The result is `retired == 2`, the row count is still 3, and `existsByIdAndRetiredAtIsNull("b")` is false.
  - `reappearingRouteIsUnretired()`: load the full fixture, then only `a`, then the full fixture again. `existsByIdAndRetiredAtIsNull("b")` is true.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=RouteIndexLoaderTest`. Expected: compile failure.
- [ ] **Step 3: Implement.**
  - Jackson reads the index into a record, with `@JsonIgnoreProperties(ignoreUnknown = true)`.
  - Rows are upserted with `INSERT … ON CONFLICT (id) DO UPDATE`, and the location is built with `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography`. The location is stored only when `coordsSource` is not `area-approx`.
  - Rows absent from the index get `retired_at = now()`.
  - Everything runs in one transaction.
- [ ] **Step 4: Run them and confirm they pass.** Same command. Expected: 3 passing.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): route table seeded from the app's route index"`

### Task 3: Token service with rotating refresh tokens

**Files:**
- Create: `server/src/main/resources/db/migration/V3__users_and_tokens.sql`
- Create: `server/src/main/java/za/kaapspoor/server/account/{AppUser.java, AppUserRepository.java, Role.java}`
- Create: `server/src/main/java/za/kaapspoor/server/auth/{TokenService.java, TokenPair.java, RefreshToken.java, RefreshTokenRepository.java, JwtConfig.java}`
- Test: `server/src/test/java/za/kaapspoor/server/auth/TokenServiceTest.java`

Tables:

**`app_user`**

| Column | Type |
|---|---|
| `id` | `uuid` primary key |
| `email` | `text` null, unique when not null |
| `email_verified` | `boolean not null default false` |
| `password_hash` | `text` null |
| `display_name` | `text not null` |
| `role` | `text not null default 'USER'` |
| `created_at` | `timestamptz not null` |
| `deleted_at` | `timestamptz` null |

**`identity`**

| Column | Type |
|---|---|
| `provider` | `text` (primary key together with `subject`) |
| `subject` | `text` (primary key together with `provider`) |
| `user_id` | `uuid not null`, references `app_user` |

**`refresh_token`**

| Column | Type |
|---|---|
| `id` | `uuid` primary key |
| `user_id` | `uuid not null`, references `app_user` |
| `family_id` | `uuid not null` |
| `token_hash` | `bytea unique not null` |
| `expires_at` | `timestamptz not null` |
| `used_at` | `timestamptz` null |
| `revoked_at` | `timestamptz` null |
| `created_at` | `timestamptz not null` |

Emails are stored already normalised (trimmed, lower-cased); see Task 4.

**Interfaces:**
- Produces:
  - `record TokenPair(String accessToken, Instant accessExpiresAt, String refreshToken)`
  - `TokenService.issue(AppUser user): TokenPair`: a new family.
  - `TokenService.refresh(String refreshToken): TokenPair`: throws `InvalidTokenException`, which maps to 401.
  - `TokenService.revoke(String refreshToken): void`
  - `InvalidTokenException extends RuntimeException`, in package `auth`, which Task 4
    maps to 401.
  - `Role` enum: `USER`, `ADMIN`.
- Produces: `JwtConfig` beans `JwtEncoder` and `JwtDecoder` (Nimbus, HS256, from `kaapspoor.jwt-secret`). It throws `IllegalStateException("kaapspoor.jwt-secret must be at least 32 bytes")` on a short secret.
- `TokenService` takes a `java.time.Clock` bean, so tests control time.

- [ ] **Step 1: Write the failing tests** (integration, with `@SpringBootTest`, `TestcontainersConfig` and a mutable test `Clock`):
  - `issuedAccessTokenDecodesWithSubAndRole()`: decoding gives `sub` equal to the user id, `role` equal to `"USER"`, and an expiry 15 min after issue.
  - `refreshRotates()`: refreshing with `r1` gives `r2 != r1`, and then refreshing with `r1` again 11 s later throws `InvalidTokenException`.
  - `reuseAfterGraceRevokesFamily()`: refresh with `r1` to get `r2`. Advance the clock 11 s and refresh with `r1` again, which throws. Then refreshing with `r2` also throws, because the family was revoked.
  - `reuseWithinGraceDoesNotRevokeFamily()`: refresh with `r1` to get `r2`. Advance the clock 5 s and refresh with `r1` again, which throws. Then refreshing with `r2` **succeeds**. (Review Focus 2.)
  - `expiredRefreshTokenRejected()`: advance the clock 60 days plus 1 s, and refresh throws.
  - `shortSecretFailsStartup()`: `new JwtConfig().jwtEncoder("c2hvcnQ=")` throws `IllegalStateException` with the message above.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=TokenServiceTest`. Expected: compile failure.
- [ ] **Step 3: Implement.**
  - Refresh tokens are 32 bytes from `SecureRandom`, base64url-encoded without padding. They are looked up by `SHA-256(token)`.
  - On refresh, take a row lock (`SELECT … FOR UPDATE`) and:
    - if the token is unused and live: mark it used and issue a new token in the same family
    - if it is used and `now - used_at ≤ 10 s`: throw without revoking
    - if it is used and older than that: revoke every token in the family, then throw
- [ ] **Step 4: Run them and confirm they pass.** Expected: 6 passing.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): access JWTs and rotating refresh tokens with reuse detection"`

### Task 4: Email/password auth, `/me`, security and CORS

**Files:**
- Create: `server/src/main/java/za/kaapspoor/server/auth/{AuthController.java, PasswordAuthService.java, AuthRequests.java}`
- Create: `server/src/main/java/za/kaapspoor/server/account/{MeController.java, DisplayNames.java, Emails.java}`
- Create: `server/src/main/java/za/kaapspoor/server/web/{SecurityConfig.java, ProblemHandlers.java}`
- Test: `server/src/test/java/za/kaapspoor/server/auth/PasswordAuthFlowTest.java`, `server/src/test/java/za/kaapspoor/server/web/CorsTest.java`

**Interfaces:**
- Consumes: `TokenService`, `TokenPair`, `AppUserRepository` (Task 3).
- Produces these endpoints:

| Endpoint | Body | Success | Failure |
|---|---|---|---|
| `POST /api/v1/auth/register` | `{email, password, displayName}` | 201 `TokenPair` | 409 duplicate email; 400 validation |
| `POST /api/v1/auth/login` | `{email, password}` | 200 `TokenPair` | 401 with `detail` `"Email or password is incorrect"`, identical for an unknown email and a wrong password |
| `POST /api/v1/auth/refresh` | `{refreshToken}` | 200 `TokenPair` | 401 |
| `POST /api/v1/auth/logout` | `{refreshToken}` | 204 | — |
| `GET /api/v1/me` | — | `{id, displayName, initials, email, role}` | — |
| `PATCH /api/v1/me` | `{displayName}` | `{id, displayName, initials, email, role}` | 400 invalid name |

- Produces these helpers, which Task 5 reuses:
  - `Emails.normalise(String): String`: trim, then lower-case (`Locale.ROOT`).
  - `DisplayNames.validate(String): String`: trim. A result that is empty or over 40 code points throws `IllegalArgumentException`, which maps to 400.
  - `DisplayNames.initials(String): String`: the first letter of each of the first two words, upper-cased. `"sam van wyk"` gives `"SV"`.
- Password: at least 10 characters, hashed with `BCryptPasswordEncoder`.
- `SecurityConfig`:
  - permit `/api/v1/auth/**`, `/actuator/health`, `/v3/api-docs/**` and `/swagger-ui/**`; every other path needs authentication
  - stateless sessions, CSRF disabled (bearer tokens only)
  - CORS origins come from `kaapspoor.cors.allowed-origins`, with the defaults in Global Constraints

- [ ] **Step 1: Write the failing tests.** `PasswordAuthFlowTest` (MockMvc):
  - `registerThenMe()`: registering `sam@example.com` / `correct-horse` / `Sam van Wyk` returns 201. Then `GET /api/v1/me` with the bearer token gives `displayName "Sam van Wyk"` and `initials "SV"`.
  - `loginIgnoresEmailCaseAndSpaces()`: register `sam@example.com`, then log in with `" Sam@Example.COM "`, which returns 200. (Review Focus 1.)
  - `duplicateEmailIs409()`: registering `SAM@example.com` after `sam@example.com` returns 409.
  - `wrongPasswordAndUnknownEmailLookIdentical()`: both return 401 with the same `detail`.
  - `shortPasswordIs400()`: a 9-character password returns 400.
  - `blankOrLongDisplayNameIs400()`: `"   "` returns 400, and a 41-character name returns 400 on both register and `PATCH /me`. (Review Focus 5.)
  - `meWithoutTokenIs401()`
  - `logoutRevokesRefresh()`: after logout, refreshing with the same token returns 401.

  `CorsTest`:
  - `preflightFromCapacitorAndroidAllowed()`: OPTIONS `/api/v1/me` with `Origin: https://localhost` returns `Access-Control-Allow-Origin: https://localhost`.
  - `preflightFromUnknownOriginRejected()`: `Origin: https://evil.example` returns 403.
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest='PasswordAuthFlowTest,CorsTest'`.
- [ ] **Step 3: Implement** to the interfaces above. `ProblemHandlers` maps `IllegalArgumentException` to 400, `InvalidTokenException` to 401, and `DataIntegrityViolationException` on the email unique index to 409.
- [ ] **Step 4: Run them and confirm they pass.** Then run the full suite: `./mvnw -q verify`. Expected: everything green.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): email/password auth, /me, stateless security and CORS"`

### Task 5: Google and Apple sign-in

**Files:**
- Create: `server/src/main/java/za/kaapspoor/server/auth/{OidcProvider.java, OidcProperties.java, IdTokenVerifier.java, VerifiedIdentity.java, OidcAuthService.java}`
- Modify: `AuthController.java` (add the endpoint)
- Test: `server/src/test/java/za/kaapspoor/server/auth/OidcAuthFlowTest.java`, `server/src/test/java/za/kaapspoor/server/auth/TestIdTokens.java`

**Interfaces:**
- Consumes: `TokenService` (Task 3); `Emails`, `DisplayNames` (Task 4).
- Produces: `POST /api/v1/auth/oidc` with body `{provider: "GOOGLE"|"APPLE", idToken, displayName?}`. It returns 200 `TokenPair` for an existing identity, 201 for a newly created user, and 401 for an invalid token.
- Produces:
  - `enum OidcProvider { GOOGLE, APPLE }`
  - `record VerifiedIdentity(OidcProvider provider, String subject, String email, boolean emailVerified, String name)`
  - `IdTokenVerifier.verify(OidcProvider, String idToken): VerifiedIdentity`
- `OidcProperties` (`kaapspoor.oidc.<provider>.*`) holds the issuer(s), the JWKS URI and the allowed audiences (client ids):

| Provider | Issuers | JWKS URI |
|---|---|---|
| Google | `https://accounts.google.com`, `accounts.google.com` | `https://www.googleapis.com/oauth2/v3/certs` |
| Apple | `https://appleid.apple.com` | `https://appleid.apple.com/auth/keys` |

  Audiences come from configuration, with an empty default. An empty audience list rejects every token.
- The verifier is a `NimbusJwtDecoder` per provider, with validators for issuer, audience and timestamps (60 s clock skew). The test config swaps the JWKS for a test RSA key via a `@TestConfiguration` that overrides the `IdTokenVerifier` decoders.
- Account resolution, in order:
  1. If an `identity(provider, subject)` exists, use that user.
  2. Otherwise, if `emailVerified` and an `app_user` with that normalised email exists, link the identity to it.
  3. Otherwise, create a user and the identity. The email is stored only when it is verified and not already taken. `email_verified` mirrors the token. The display name is the first valid one of `name`, request `displayName`, `"Hiker"`.

- [ ] **Step 1: Write the failing tests.** `TestIdTokens.sign(issuer, audience, subject, email, emailVerified, name, iat, exp)` signs with a test RSA key.
  - `newGoogleUserIs201AndRepeatIs200SameUser()`
  - `wrongAudienceIs401()`
  - `expiredTokenIs401()`
  - `iatSlightlyInFutureAccepted()`: `iat = now + 30 s`. (Review Focus 3.)
  - `verifiedEmailLinksToPasswordAccount()`: register `sam@example.com` by password, then sign in with Google with `email=Sam@example.com` and `email_verified=true`. `/me` returns the same id.
  - `unverifiedEmailDoesNotLink()`: same setup with `email_verified=false`. The result is a different user id, and that user's `email` is null.
  - `appleWithoutNameUsesRequestThenHiker()`: an Apple token without `name` and with `displayName: "Thandi"` gives `"Thandi"`. With no `displayName` at all, the result is `"Hiker"`. (Review Focus 4.)
- [ ] **Step 2: Run them and confirm they fail.** Run: `./mvnw -q test -Dtest=OidcAuthFlowTest`.
- [ ] **Step 3: Implement** to the interfaces above.
- [ ] **Step 4: Run them and confirm they pass,** then run `./mvnw -q verify`.
- [ ] **Step 5: Commit.** `git commit -m "feat(server): Google and Apple sign-in with verified-email account linking"`

### Task 6: OpenAPI snapshot, generated TS client, CI

**Files:**
- Create: `server/openapi.json` (generated by the test, committed)
- Test: `server/src/test/java/za/kaapspoor/server/OpenApiSnapshotTest.java`
- Modify: `app/package.json`:
  - add devDependencies `openapi-typescript@7.13.0` and `openapi-fetch@0.17.0` (the latter as a dependency)
  - add the script `"gen:api": "openapi-typescript ../server/openapi.json -o src/lib/api/schema.d.ts"`
- Create: `app/src/lib/api/schema.d.ts` (generated, committed), `app/src/lib/api/client.ts`
- Test: `app/src/lib/api/client.test.ts`
- Create: `.github/workflows/server.yml`
- Modify: `.github/workflows/deploy.yml`, adding after `npm ci` a step: `npm run gen:api && git diff --exit-code src/lib/api/schema.d.ts`

**Interfaces:**
- Consumes: every endpoint from Tasks 4–5.
- Produces: `createApiClient(baseUrl: string, getAccessToken: () => string | null)` in `app/src/lib/api/client.ts`. It returns an `openapi-fetch` client typed by `paths` from `schema.d.ts` and attaches `Authorization: Bearer <token>` when `getAccessToken()` is non-null. Plans 2–4 use this; none of them hand-write request types.

- [ ] **Step 1: Write the failing tests.**
  - `OpenApiSnapshotTest.specMatchesCommittedSnapshot()`: GET `/v3/api-docs`, pretty-print it with sorted keys, and compare it with `server/openapi.json`. When run with `-Dopenapi.update=true`, it writes the file instead and passes. The failure message reads: `"API changed: run ./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true and npm run gen:api"`.
  - `client.test.ts`:
    - `attaches bearer token`: with a stubbed `fetch`, `client.GET('/api/v1/me')` calls `https://api.test/api/v1/me` with the header `Authorization: Bearer t1`.
    - `omits header when signed out`: when `getAccessToken` returns `null`, there is no `Authorization` header.
- [ ] **Step 2: Run them and confirm they fail.** Run `./mvnw -q test -Dtest=OpenApiSnapshotTest` (fails: there's no snapshot yet) and `cd app && npx vitest run src/lib/api/client.test.ts` (fails: there's no module yet).
- [ ] **Step 3: Implement.**
  - Generate the snapshot with `-Dopenapi.update=true`, then run `npm install` and `npm run gen:api`, and write `client.ts`.
  - `server.yml` runs on push and PR with `paths: [server/**]`. It sets up Java 21 (temurin, maven cache) and runs `./mvnw -B verify`. GitHub's ubuntu runners have Docker.
- [ ] **Step 4: Run them and confirm they pass.** Run `./mvnw -q verify`; then in `app`, run `npm test` and `npm run check`. Expected: all green, with no other app test changed.
- [ ] **Step 5: Commit.** `git commit -m "feat: OpenAPI snapshot, generated TypeScript API client, server CI"`

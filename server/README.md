# KaapSpoor server

Spring Boot 3.5 / Java 21 API backed by PostgreSQL with PostGIS. It serves `/api/v1/**`, with the
OpenAPI spec at `/v3/api-docs` and its committed snapshot in `openapi.json`.

## Configuration

Set these as environment variables in production. Spring's relaxed binding maps each one to the
property in brackets. Both the spellings shown (`KAAPSPOOR_JWT_SECRET` and `KAAPSPOOR_JWTSECRET`)
bind; the table uses the underscore form.

| Variable | Property | Required | Notes |
| --- | --- | --- | --- |
| `KAAPSPOOR_JWT_SECRET` | `kaapspoor.jwt-secret` | yes | Base64 of at least 32 random bytes (e.g. `openssl rand -base64 48`). Signs access tokens with HS256. Startup fails if it is shorter. Changing it invalidates every access token, though refresh tokens survive. |
| `SPRING_DATASOURCE_URL` | `spring.datasource.url` | yes | e.g. `jdbc:postgresql://host:5432/kaapspoor` |
| `SPRING_DATASOURCE_USERNAME` | `spring.datasource.username` | yes | See the database role note below. |
| `SPRING_DATASOURCE_PASSWORD` | `spring.datasource.password` | yes | |
| `KAAPSPOOR_OIDC_GOOGLE_AUDIENCES` | `kaapspoor.oidc.google.audiences` | for Google sign-in | Comma-separated Google OAuth client ids (web, Android, iOS). Unset or empty rejects every Google token. |
| `KAAPSPOOR_OIDC_APPLE_AUDIENCES` | `kaapspoor.oidc.apple.audiences` | for Apple sign-in | Comma-separated Apple Services ID / bundle ids. Unset or empty rejects every Apple token. |
| `KAAPSPOOR_ROUTES_INDEX` | `kaapspoor.routes-index` | no | Path to the app's `build/data/routes-index.json`. When set, the `route` table is upserted from it at startup, and routes missing from it are retired. An empty index fails startup rather than retiring everything. |
| `KAAPSPOOR_CORS_ALLOWED_ORIGINS` | `kaapspoor.cors.allowed-origins` | no | Comma-separated origins. Overrides the default in `application.yml`: the dev server, GitHub Pages and the Capacitor origins. |

The issuer and JWKS URLs for Google and Apple have defaults in `application.yml` and do not normally
need changing.

### Database role

Flyway runs the migrations at startup. `V1__postgis.sql` runs `CREATE EXTENSION IF NOT EXISTS postgis`,
so on first start the datasource role must be allowed to `CREATE EXTENSION postgis` (a superuser,
or the managed provider's equivalent role). The alternative is to have an administrator create the
extension in the database beforehand, after which the statement is a no-op and the application role
needs no extra privilege.

## Running the app against a local server

Start the server (see Configuration), then create `app/.env.local` with:

```
VITE_API_BASE_URL=http://localhost:8080
```

and run `npm run dev` in `app/`. Without this variable the app has no accounts (the GitHub Pages build sets nothing).
The default CORS allow-list already includes the dev origin (`http://localhost:5173`).

## Running the tests

Needs JDK 21 and a running Docker daemon. Testcontainers starts a `postgis/postgis:16-3.4` container.

```sh
./mvnw verify
```

If a newer JDK is first on `PATH`, point `JAVA_HOME` at a JDK 21 for the command.

### When the API changes

`OpenApiSnapshotTest` fails when the live spec differs from `openapi.json`. Regenerate the snapshot
and the app's typed client together:

```sh
./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true
cd ../app && npm run gen:api
```

CI checks both: the server workflow fails if `app/src/lib/api/schema.d.ts` differs from what
`npm run gen:api` produces, or if the app no longer type-checks against it.

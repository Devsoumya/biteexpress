# Build plan

The step-by-step implementation plan. Work one step at a time, in order. A step is done only when its acceptance criteria hold and its tests pass (see "Definition of done" in `AGENTS.md`). Tick the boxes as work lands, and update **Status** at the top, so any new session can see where things stand.

**Status:** Step 1 done; code reorganised into top-level layers (`plans/change-layered-structure.md`); Step 2 done. Step 3 done (seed: 9,550 restaurants, validator, `uq_tenant_source`, `restaurants_search`; Compose runs `mongo` → `seed` → `api` with `/ready` 200; 228 tests: 190 unit with no database, 38 integration). Step 4 done (POST and GET by id; tenant owned by the repository; 328 tests: 278 unit, 50 integration). OpenAPI document and Swagger UI added (`plans/change-openapi-docs.md`): `/swagger`, `/openapi.json`; every later endpoint must be documented. Error-code catalog done (`plans/change-error-codes.md`; 413 tests: 363 unit, 50 integration). Step 5 done (list endpoint on Atlas Search; 547 tests: 472 unit, 75 integration). Step 6 done (search endpoint with the rule-based interpreter and the database vocabulary; 683 tests: 593 unit, 90 integration). Step 7 done (pino request logging with X-Request-Id, `npm run explain` with results in ADR-003; 716 tests: 623 unit, 93 integration). All steps done; stretch items optional. A code-quality refactor with no behavior change followed (`plans/change-code-quality-refactor.md`). Design documents are final (ADR-001 to ADR-005, RFC-001).

Legend: `[ ]` to do · `[x]` done · `[~]` in progress or partially done (say what is left)

Dependencies: 0 → 1 → 3, 2 → 3 (Step 2 is pure and can run any time after 0), 3 → 4 → 5 → 6. Each step lists only work it can finish and test without a later step. The integration test setup (`globalSetup`) grows with the steps: none in Step 0; connect and test database in Step 1; validator, unique index and search index in Step 3; fixtures and `waitForSearch` in Step 5.

---

## Step 0: Tooling (Vitest → Jest) — Done

Design: ADR-005 (Configuration, Moving the scaffold from Vitest). Plan: [`plans/step-0-jest-tooling.md`](plans/step-0-jest-tooling.md) (Done, 2026-11-05).

- [x] Ask the user before installing packages (network access). Remove `vitest`; add `jest`, `ts-jest`, `@types/jest`.
- [x] `jest.config.js` with two projects, `unit` (`tests/unit/**/*.test.ts`) and `integration` (`tests/integration/**/*.test.ts`, 20 s timeout). No `globalSetup` yet: it needs MongoDB, and the health test must pass without one (added in Step 1).
- [x] `tsconfig.test.json` extending `tsconfig.json` with `rootDir: "."`, including `src` and `tests`, `types: ["node", "jest"]`.
- [x] Scripts: `test` (both), `test:unit`, `test:integration` (`--runInBand`), `test:coverage`. Keep `lint`, `typecheck`, `format:check`.
- [x] ESLint covers `tests/` with Jest globals.
- [x] Port `tests/integration/health.api.test.ts` to Jest globals.
- [x] First unit test, `tests/unit/config/env.test.ts`, on the existing `loadEnv()` (Jest fails a project with no tests; `--passWithNoTests` would hide a wrong `testMatch`). Step 1 extends it.

**Accept:** `npm run test:unit` runs with no database; the health test passes with no database; lint, typecheck and format checks pass.

## Step 1: Database runtime (Compose, config, readiness) — Done

Design: ADR-004. Plan: [`plans/step-1-database-runtime.md`](plans/step-1-database-runtime.md) (Done, 2026-11-05).

- [x] Pin `mongodb/mongodb-atlas-local:8.0@sha256:5cf57bb433ad0fc9c9e44df0a883c804034e395e0083efc04ecdfbffe7044be5` (already pulled locally; ask before pulling if the digest changes).
- [x] `docker-compose.yml`: `mongo` → `mongodb/mongodb-atlas-local:8.0` (pin the digest), `hostname: mongo`, no data volume, `restart: unless-stopped`, image healthcheck; credentials from `.env` with local defaults. `api` depends on `mongo` `service_healthy`; `api` healthcheck on `/health` (the `seed` service and the `/ready` healthcheck come in Step 3, when the seed script and search index exist).
- [x] Dockerfile `test` stage (`FROM build AS test`, copying `jest.config.js`, `tsconfig.test.json` and `tests/`); the runtime stage is unchanged.
- [x] `test` service under the `test` profile, built from the Dockerfile `test` stage, running `npm test` against `mongo` with `TEST_MONGODB_URI`.
- [x] `createApp(deps)` in `src/app.ts` (no app singleton); `src/config/database.ts` returns a `MongoClient` instead of holding module state; `server.ts` wires them. The health test builds the app with no database.
- [x] Jest `globalSetup`/`globalTeardown` for the `integration` project: read `TEST_MONGODB_URI` (fail fast with a clear message if unset), ping, and drop `biteexpress_test` in teardown.
- [x] `.env.example`: `directConnection=true` in both URIs; new variables.
- [x] `src/config/env.ts`: `MONGODB_URI`, `TENANT_ID` (`biteexpress`), `SEARCH_INDEX_NAME` (`restaurants_search`), `QUERY_MAX_TIME_MS` (2000), `BEST_MIN_VOTES` (20), `LOG_LEVEL` (`info`), `PORT`, `NODE_ENV`.
- [x] `src/config/database.ts`: one `MongoClient` with `appName: "biteexpress-api"`, `serverSelectionTimeoutMS: 5000`.
- [x] `GET /ready`: `ping` + `listSearchIndexes` shows the index `queryable`; cached 5 s; 503 otherwise. `GET /health` unchanged (never touches MongoDB).

**Tests:** unit (no database): env parsing (defaults, invalid values); readiness logic and 5 s cache with fake probes; `/health` 200 (moved from `tests/integration/` to `tests/unit/http/`); `/ready` 503 when the database is unreachable. Integration (`atlas-local`, `biteexpress_test`): ping with `directConnection=true`; `/ready` 503 when `SEARCH_INDEX_NAME` points to a missing index. Teardown drops only `biteexpress_test`, and the test helper rejects a `TEST_MONGODB_URI` naming any other database. (`/ready` 200 needs a queryable search index, which only the seed creates, so that test is in Step 3.)

**Accept:** `docker compose up mongo` is healthy; the API connects from the host with `directConnection=true`; `docker compose up --build` starts `mongo` → `api`, and `/health` returns 200.

## Step 2: Shared domain helpers (pure, unit-tested) — Done

Design: ADR-001 Rules 3, 4, 6; ADR-002 (aliases). Plan: [`plans/step-2-domain-helpers.md`](plans/step-2-domain-helpers.md) (Done, 2026-11-05).

- [x] `utils/normalize.ts`: `normalize()` (lowercase, fold diacritics with NFD + strip marks, collapse whitespace, trim).
- [x] `normalizeCity()` resolves `constants/city-aliases.ts`: `gurugram→gurgaon`, `delhi→new delhi`, `bengaluru→bangalore`, `bombay→mumbai`, `calcutta→kolkata`, `madras→chennai`. The data contains none of these spellings; aliases serve input (POST, query values, natural language). No alias for a city not in the data.
- [x] `splitCuisines()` and `normalizeCuisines()`: split, trim, normalize, de-duplicate (first display spelling kept, order preserved).
- [x] Country table `constants/countries.ts` + lookups `utils/country.ts`: numeric seed code and ISO alpha-2 → `{isoCode, name, currency, seedCode}` (15 markets; 162 is PH/PHP).
- [x] `utils/geo.ts` `parseCoordinates(lat, lng)` → `point | unknown | invalid`: lat −90..90, lng −180..180, finite; exactly 0 on either axis is `unknown`; `point` is GeoJSON `[lng, lat]`. The seed omits `location` on `unknown` and `invalid`; POST omits on `unknown` and returns 400 on `invalid`.
- [x] `haversineKm()` (earth radius 6378.1 km) plus `haversineDistanceKmExpression()`, the aggregation version used in the pipeline (`null` when `location` is absent).
- [x] Interfaces in `models/geo.model.ts`, `models/country.model.ts`, `models/restaurant.model.ts`.

**Tests:** unit, table-driven (`test.each`), including edge cases (accents, `İstanbul`, aliases, duplicate cuisines, 0,0 and one axis 0, out-of-range and boundaries, NaN, PH currency, table integrity). One integration test evaluates the aggregation expression in Atlas Local (`$documents`) and checks it against `haversineKm`, because a shape-only unit test cannot catch a wrong formula.

## Step 3: Seed (database ready) — Done

Design: ADR-001 (Rules 1-13, appendix validator), ADR-003 (search index definition, Index lifecycle), ADR-004 (`seed` service). Plan: [`plans/step-3-seed.md`](plans/step-3-seed.md) (Done, 2026-11-05).

- [x] `src/scripts/seed.ts` (`runSeed(db, options)` + thin `main()`), idempotent, in this order:
  1. create the `restaurants` collection with the `$jsonSchema` validator, or `collMod` it (`validationLevel: strict`, `validationAction: error`)
  2. create `uq_tenant_source` `{tenantId: 1, sourceId: 1}`, unique, partial `{sourceId: {$exists: true}}`
  3. read `zomato_data.csv` as **strict UTF-8** (the file is valid UTF-8; latin1 would add mojibake), parse with `csv-parse` (runtime dependency, approved; wrapped in `utils/csv.ts` with strict options: quoted fields, `""`, newlines inside quotes, a field-count mismatch throws), map rows → documents with `mappers/restaurant-csv.mapper.ts`: skip ID 18419884; omit rating 0, cost 0, unknown location; repair 3 city and 2 cuisine names (U+FFFD keys → `Brasília`, `São Paulo`, `İstanbul`, `Döner`, `Börek`) and `۱` → `ı` (systematic Turkish mis-encoding); collapse whitespace; derive country and currency from the table; build `norm.*`; `schemaVersion: 1`
  4. `MongoRestaurantRepository.upsertManyBySourceId`: `bulkWrite` upserts on `{tenantId, sourceId}` (`$set` every field plus `updatedAt`; `$setOnInsert` `createdAt`), unordered; on failure log the first `writeErrors` with `errInfo`
  5. `createSearchIndex` if missing, `updateSearchIndex` if the definition differs; wait until `READY` and `queryable`
  6. log counts and exit 0 (non-zero on any failure)
- [x] The validator and the search index definition live in code (`src/db/restaurant.json-schema.ts`, `src/db/restaurant.search-index.ts`), copied from the ADRs, as the single source used by the seed and by tests.
- [x] Schema management in `src/db/restaurant-collection.setup.ts`: `applyValidator(db)`, `ensureIndexes(collection)`, `ensureSearchIndex(collection, name, definition)`, `waitForSearchIndex(collection, name)`; used only by the seed and the test setup.
- [x] Extend the Jest `globalSetup` to apply the validator, the unique index and the search index on `biteexpress_test`, and wait until the index is queryable (reusing the setup functions).
- [x] `seed` service in Compose (one-shot, same image as the API, `node dist/scripts/seed.js`); the runtime image includes `zomato_data.csv`; `api` depends on `seed` `service_completed_successfully`; `api` healthcheck moves to `/ready` (timeout above the 5 s server selection).
- [x] `npm run seed` for the host (against `localhost:27017`); `SEED_CSV_PATH` (default `zomato_data.csv`).

**Tests:** unit for the `utils/csv.ts` wrapper (the cases this file needs) and for CSV row → document (each cleanup rule), plus an in-memory mapping of the whole file asserting the counts (9,550 mapped, 499 without location, 2,147 unrated, no U+FFFD in cities or cuisines). Integration: validator accepts a mapped row and rejects bad shapes (code 121); upserting mapped rows twice inserts 0 the second time with stable `_id` and `createdAt` (tests that write use their own `tenantId` and clean up); the collection has exactly `_id_` and `uq_tenant_source`; the stored search index definition equals the code's; `/ready` 200 once the index is queryable (the health-repository "missing" test moves to a collection that does not exist).

**Accept:** `docker compose up --build` runs `mongo` → `seed` → `api`, and the seed takes a few seconds.

## Step 4: POST and GET by id — Done

Design: RFC-001 §5, ADR-001 Rules 1, 2, 6, 8. Plan: [`plans/step-4-create-and-get.md`](plans/step-4-create-and-get.md) (Done, 2026-11-06).

- [x] Layers (AGENTS.md §5): `routes/restaurant.routes.ts` → `controllers/restaurant.controller.ts` → `services/restaurant.service.ts` → `repositories/restaurant.repository.ts`, with `models/restaurant.model.ts` (interfaces), `validators/restaurant.schema.ts` (Zod) and `mappers/restaurant.mapper.ts`.
- [x] POST body: `name`, `address`, `city`, `countryCode` required; `locality`, `cuisines`, `latitude` + `longitude` (both or neither), `averageCostForTwo`, `priceRange`, `features` optional; unknown keys rejected (`strict`). Server derives country name, currency, `norm.*`, `rating.votes = 0`, timestamps, `tenantId`, `schemaVersion`.
- [x] 201 with the created entity (detail shape) and `Location: /v1/restaurants/{id}`.
- [x] GET by id: invalid ObjectId → 400 `INVALID_ID`; not found or another tenant's → 404 `NOT_FOUND`; otherwise detail. Query `{_id, tenantId}` on the collection (not `$search`), with `maxTimeMS`.
- [x] Detail shape: list item fields + `location`, `cost`, `features`, `votes`, derived rating label, `sourceId`.
- [x] Validation errors: 400 `VALIDATION_ERROR` with field-level `details` (path + message).

**Tests:** (400 cases run as unit Supertest tests with a stub service; one 400 stays in integration to prove nothing is written) unit for the Zod schema and mapper (both directions, rating label bands, null `averageRating`). Integration: POST 201 + Location; POST → GET read-your-writes; 400 cases (missing field, unknown key, lat without lng, bad country); GET 400/404; other tenant's document → 404.

## Step 5: List endpoint (`GET /v1/restaurants`) — Done

Design: ADR-003 (index, query builder, Rules 1-11), RFC-001 §5 (parameters). Plan: [`plans/step-5-list-endpoint.md`](plans/step-5-list-endpoint.md) (Done, 2026-11-06).

- [x] Query schema (Zod, coerced): `name`, `city`, `cuisine` (comma list) + `cuisineMatch` (`any`|`all`), `minRating`, `minVotes`, `minCost`/`maxCost`/`currency`, `lat`/`lng`/`radiusKm`, `sort` (`distance`|`rating`|`cost`), `order` (`asc`|`desc`), `cursor`, `limit` (default 20, max 100). Unknown `sort` → 400.
- [x] `criteria` object (shared with search) built from the query; `normalize()` applied to city and cuisine values.
- [x] `buildSearchPipeline(criteria, {tenantId, indexName})`: a pure function returning the pipeline (see the invariants in `AGENTS.md`).
- [x] Cursor: opaque base64url of the last item's `searchSequenceToken` plus a fingerprint of the query; malformed or used with a different query → 400 `CURSOR_INVALID`. Fetch `limit + 1` to compute `nextCursor`.
- [x] Repository runs the pipeline with a time limit; timeout → 503 `SEARCH_TIMEOUT`, unreachable → 503 `SEARCH_UNAVAILABLE` (both with `Retry-After`), anything else → 500. The search executor is injected (for the failure test).
- [x] OpenAPI: `GET /v1/restaurants` in `src/openapi/openapi.document.ts` with the query parameters generated from the query schema, `ListResponse` (`data`, `nextCursor`), 400 (`VALIDATION_ERROR`, `CURSOR_INVALID`) and 503 `SEARCH_UNAVAILABLE` with `Retry-After`; no example values (field `.describe()` instead); `expectDocumentedResponse` in the integration tests.
- [x] Response: `{ data: ListItem[], nextCursor }`. List item: `id`, `name`, `address`, `city`, `country {code, name}`, `cuisines`, `averageRating` (null if unrated), `distanceKm` (only with coordinates).

**Tests:** unit for the builder (one test per rule: tenant filter always present; each filter clause; each sort; defaults; `name` in `must` vs `filter`; radius default/cap/none-with-city; `exists` + currency on cost sort; `noData`; `_id` tie-break) and the cursor. Integration on fixtures: each filter alone and combined; each sort (cost both ways); unknown values excluded on explicit sorts and last on the default; currency rule; city + coordinates → that city only, nearest first, with `distanceKm`; `sort=distance` without coordinates → 400; paging without gaps or repeats; tenant isolation; executor throws → 503 while GET by id works; POST → appears in the list (`waitForSearch`).

## Step 6: Search endpoint (`GET /v1/restaurants/search`) — Done

Design: ADR-002 (revised 2026-11-06). Plan: [`plans/step-6-search-endpoint.md`](plans/step-6-search-endpoint.md) (Done, 2026-11-06).

- [x] `services/vocabulary.service.ts`: cities (with country) and cuisines from the database, loaded at startup, refreshed every 24 hours (changed from 5 minutes on 2026-11-06; `VOCABULARY_REFRESH_MS`) and after POST, last good snapshot kept on failure, `/ready` reports it; it replaces Step 5's static `city-countries.ts` for the currency rule.
- [x] `constants/lexicon.ts` (cities + aliases from the data, cuisines, dish → cuisine map, price and intent words) and `services/query-interpreter.service.ts`: `interpret(q, {hasCoords}) → {criteria, notes}`, a pure function; interfaces in `models/search.model.ts`.
- [x] Passes in ADR-002 order: price, intent ("best" → rating sort + vote floor `BEST_MIN_VOTES`; "nearest" → distance), features, city, dishes (phrase), cuisine, leftovers → boost terms, nothing recognized → whole-query `text`.
- [x] Explicit query parameters override parsed values (with a note). Response = list response + `interpretation`.
- [x] A price in `q` without a resolvable currency → ranking preference (within-price first). City typo after `in` → corrected when exactly one city is one edit away, else empty with a suggestion. Relevance ties → rating, then `_id`.
- [x] Route registered **before** `/:id`.
- [x] OpenAPI: `GET /v1/restaurants/search` with `q` and the list parameters, the response including `interpretation`, 400 and 503; the three brief queries mentioned in the operation description, not as example values.

**Tests:** unit table (`test.each`) of query → criteria, including the three brief queries, aliases, typos, overrides, "nearest" without coordinates. Integration: the three brief queries end to end on fixtures; empty or > 200 character `q` → 400; search failure → 503.

## Step 7: Operations polish — Done

Design: ADR-004 (Observability), ADR-003 (Still to do). Plan: [`plans/step-7-operations.md`](plans/step-7-operations.md) (Done, 2026-11-06).

- [x] Structured logging (pino, ask before installing) with `x-request-id`; one line per list/search request (sort, filter names, result count, DB time, total time); coordinates rounded to 2 decimals; `errInfo` logged for validator rejections.
- [x] `src/scripts/explain.ts`: `explain` for each request shape; paste results into ADR-003.
- [x] Graceful shutdown still closes the client (already in `server.ts`).

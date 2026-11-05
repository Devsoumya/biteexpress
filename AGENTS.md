# AGENTS.md

Instructions for AI coding agents working in this repository. Read this file fully before doing anything. It is self-contained: you do not need any earlier conversation.

## 1. What this project is

BiteExpress restaurant discovery API.

## 2. Read before working

| File                                           | What it holds                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.ai/REQUIREMENTS.md`                          | The assignment requirements ("the brief") and the scope decisions made against them           |
| `.ai/BUILD-PLAN.md`                            | **Current status** and the step-by-step plan with acceptance criteria and tests. Start here   |
| `.ai/plans/`                                   | Per-step plans (`step-<N>-<slug>.md`), written and approved before coding                     |
| `docs/RFC-001-restaurant-discovery.md`         | Overview: design, data, API contract (§5), operations (§6), key decisions (§8)                |
| `docs/adr/001-mongodb-data-model.md`           | Document shape, data cleanup rules, `$jsonSchema` validator (appendix), country table         |
| `docs/adr/002-natural-language-search.md`      | Rule-based query interpreter and how its criteria become `$search` clauses                    |
| `docs/adr/003-indexing-strategy.md`            | Atlas Search index definition, query builder rules 1-11, failure behavior, verified behaviors |
| `docs/adr/004-runtime-and-local-deployment.md` | Compose services, connection strings, env vars, `/health` vs `/ready`, logging                |
| `docs/adr/005-testing-strategy.md`             | The kinds of tests (unit, integration) and what each covers                                   |

Read only the documents relevant to the current step; `.ai/BUILD-PLAN.md` names them for each step. The ADRs are the design of record. If code and an ADR disagree, stop and ask the user which one is right, then update the other. Do not silently diverge.

`zomato_data.csv` (repo root) is the seed dataset and stays in the repository.

## 3. Hard rules

- Keep all work local. Do not add git remotes, commit, push, deploy, or access external services. The user makes commits; at the end of each step, **suggest** a Conventional Commit message (for example `feat(restaurants): add list endpoint with $search builder`).
- Installing npm packages and pulling Docker images reach the network. **Ask the user first**, name the packages and why. Prefer no new dependency when a few lines of code do the job.
- This repository is **one service: restaurant discovery**, the first capability carved out of BiteExpress's legacy monolith (strangler fig). Inside it, keep the **top-level layered structure** in §5. Use the **official MongoDB Node.js driver** (`mongodb`); no ODM (no Mongoose).
- `/health` must never touch MongoDB (liveness). Database and search checks belong in `/ready`.
- Work **one build step at a time**, in the order of `.ai/BUILD-PLAN.md`. Do not start the next step until the user says so. Within a step, small increments are fine.
- **Plan before code.** For each step, read or write its plan in `.ai/plans/step-<N>-<slug>.md` (same sections as the existing plans). If the plan is new or changed, show it to the user and wait for approval before implementing. When the step is done, fill in "Notes after implementation" and set its status to Done.
- Do not change the design (document shape, indexes, API contract, sort/filter semantics) on your own. Propose it, explain the trade-off, and update the ADRs if the user agrees.
- Prefer clear, conventional code over clever code; explain non-obvious decisions in your summary to the user, and in a short comment when the reason is not visible in the code.

## 4. Stack and commands

Node.js 22+, TypeScript 5 (strict, `noUncheckedIndexedAccess`), Express 5, `mongodb` driver 6, Zod 4, CommonJS (`module: NodeNext`, no `"type": "module"`). ESLint (typescript-eslint) and Prettier (single quotes, trailing commas). Tests: **Jest + ts-jest + Supertest** (the scaffold still has Vitest until Build Step 0 replaces it).

| Command                                                     | Purpose                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `docker compose up --build`                                 | Whole stack: MongoDB (`atlas-local`) → seed → API            |
| `docker compose up mongo`                                   | Just the database, for host development                      |
| `npm run dev`                                               | API with reload (`tsx watch`) against `localhost:27017`      |
| `open http://localhost:3000/swagger`                        | Swagger UI (`/openapi.json` is the document; `/` redirects)  |
| `npm run seed`                                              | Seed from the host (after Step 3)                            |
| `npm run explain`                                           | Measure every list/search shape on the seed (ADR-003)        |
| `npm run test:unit`                                         | Unit tests, no database (add `-- --watch` while coding)      |
| `npm run test:integration`                                  | API + DB tests; needs `mongo` running and `TEST_MONGODB_URI` |
| `npm test` / `npm run test:coverage`                        | Everything / with coverage                                   |
| `docker compose --profile test run --rm test`               | Full suite inside Docker                                     |
| `npm run lint`, `npm run typecheck`, `npm run format:check` | Quality gates                                                |

Connection strings always include `directConnection=true` (required from the host for `atlas-local`): `mongodb://<user>:<pass>@localhost:27017/biteexpress?authSource=admin&directConnection=true`.

## 5. Architecture and code layout

One service, layered: **routes → controllers → services → repositories → MongoDB**, with interfaces in `models/` and cross-cutting code in `middlewares/`, `utils/` and `config/`.

```
src/
  app.ts                      createApp(deps): builds controllers, mounts middlewares and routes; no I/O at import time
  server.ts                   composition root: env → logger → Mongo client → repositories → vocabulary → services → app;
                              listen; graceful shutdown
  config/                     env.ts (Zod-validated env), database.ts (MongoClient factory, collection name)
  routes/                     index.ts (mounts all), docs.routes.ts, health.routes.ts, restaurant.routes.ts
                              paths and HTTP verbs only; route(path).<verb>(…).all(methodNotAllowed);
                              register /search BEFORE /:id
  controllers/                docs.controller.ts (/openapi.json, /swagger), health.controller.ts, restaurant.controller.ts
                              parse and validate the request, call a service, shape the response
  services/                   readiness.service.ts, restaurant.service.ts (business rules, derived fields, defaults),
                              query-interpreter.service.ts (q → { criteria, notes }, pure),
                              vocabulary.service.ts (cities + cuisines from the database, cached, 24-hour refresh)
  repositories/               health.repository.ts, restaurant.repository.ts, search.executor.ts
                              the ONLY code that talks to MongoDB; owns tenantId (constructor), maxTimeMS,
                              driver-error classification, timed() database calls
  models/                     interfaces and types only: app, country, error, geo, health, restaurant, search, seed
  middlewares/                error-handler.ts, not-found-handler.ts, method-not-allowed.ts, require-json.ts,
                              request-id.ts (X-Request-Id, request context), request-logger.ts (one line per request)
  utils/                      pure helpers: normalize, geo (coordinates, haversine), country, csv, cursor,
                              restaurant-search.builder.ts (criteria → $search), search-sort (resolveSort), edit-distance, validation-details,
                              mongo-errors, log-safety, request-context, logger, application-error, error-response
  validators/                 restaurant.schema.ts: Zod schemas for body, params, list and search queries
                              (+ their z.infer types); parse-request.ts
  mappers/                    restaurant.mapper.ts (request → draft, document → API shapes),
                              restaurant-csv.mapper.ts (CSV row → seed draft), search-criteria.mapper.ts
                              (query → criteria; merge of parsed and explicit search parameters)
  constants/                  countries.ts (country table), city-aliases.ts, error-codes.ts (the catalog),
                              search.ts (radius, limits), restaurant.ts (schema version), seed-repairs.ts,
                              lexicon.ts (dishes, price/intent/feature words, fillers; cities and cuisines
                              come from the database vocabulary)
  openapi/                    openapi.document.ts (the OpenAPI 3.1 document: every endpoint; request schemas
                              generated from validators/ with z.toJSONSchema), response.schemas.ts (Zod response
                              shapes, documentation only, checked against real responses by tests)
  db/                         restaurant.json-schema.ts ($jsonSchema validator), restaurant.search-index.ts
                              (Atlas Search definition): single sources used by the seed and the tests;
                              restaurant-collection.setup.ts: applies validator and indexes (seed and tests only)
  scripts/                    seed.ts (idempotent: validator, unique index, CSV upsert, search index, wait),
                              explain.ts (every query shape: explain + timings, for ADR-003)
tests/
  unit/                       mirrors src/ (no database): services/, routes/, utils/, validators/, openapi/,
                              middlewares/, ...
  integration/                needs Atlas Local: repositories/, routes/ (*.api.test.ts), db/ contract tests, scripts/
  fixtures/                   hand-built documents in their own tenants: restaurants (list), search (search)
  helpers/                    test-database (TEST_MONGODB_URI, biteexpress_test only), app (createTestApp),
                              route-inventory + openapi-contract (expectDocumentedResponse), restaurant-fixtures,
                              wait-for-search, vocabulary, logger (captureLogger)
  setup/                      Jest globalSetup / globalTeardown
```

Layer rules:

- Routes map paths to controller methods only. Controllers know HTTP, not MongoDB. Services know neither `req`/`res` nor the driver. Repositories know MongoDB, not HTTP.
- Repositories are the only code on the request path that talks to MongoDB. The one other place is `db/*.setup.ts` (validator and index management), which only `scripts/` and the test setup call; the API never creates indexes or applies the validator (invariant 20).
- `models/` holds interfaces and types, never logic. Zod-inferred request types stay next to their schema in `validators/`.
- Every seam a test substitutes is an interface in `models/` with a class implementing it (for example `HealthRepository` / `MongoHealthRepository`, `ReadinessService` / `CachedReadinessService`).
- Dependencies are passed in through constructors, not imported as singletons, so tests can substitute them (for example, a search executor that throws). `server.ts` wires the real ones.
- Pure logic (normalize, mapper, search builder, interpreter, cursor) has no I/O and no Express or driver imports beyond types, so it is unit-testable in milliseconds.
- Express 5 forwards rejected promises from async handlers to the error handler; do not add `asyncHandler` wrappers.

## 6. Coding conventions

- TypeScript strict; no `any` (use `unknown` and narrow). No non-null assertions (`!`) without a comment explaining why it is safe.
- Validate every input at the edge with Zod (`.strict()` for bodies, coerced numbers for query strings). Use `z.infer` types instead of duplicating them.
- Errors: throw `ApplicationError(code, message, details?)` with a code from the catalog in `src/constants/error-codes.ts`, which owns each code's HTTP status and `Retry-After`. The error handler shapes every response as `{ error: { code, message, details? } }`; `details` entries are `{ path, code, message }`. Codes: `VALIDATION_ERROR` 400, `MALFORMED_JSON` 400, `INVALID_ID` 400, `CURSOR_INVALID` 400, `RESTAURANT_NOT_FOUND` 404, `ROUTE_NOT_FOUND` 404, `METHOD_NOT_ALLOWED` 405 (`Allow`), `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `INTERNAL_ERROR` 500, `DATABASE_UNAVAILABLE` / `DATABASE_TIMEOUT` / `SEARCH_UNAVAILABLE` / `SEARCH_TIMEOUT` 503 (`Retry-After: 5`). Driver errors are classified in repositories only (`utils/mongo-errors.ts`), by class and code, never by message. A new failure mode gets a catalog entry, not a reused code. Never leak stack traces or driver messages to clients.
- Names: files `kebab-case` with a role suffix (`restaurant.service.ts`); functions and variables `camelCase`; types `PascalCase`; constants `UPPER_SNAKE_CASE` only for true constants.
- Small functions with one job. No dead code, no commented-out code, no speculative abstractions (no generic base repository).
- Comments explain **why**, not what.
- Configuration comes from `src/config/env.ts` only; never read `process.env` elsewhere in `src/`. Tests read the environment only in `tests/helpers/test-database.ts` (`TEST_MONGODB_URI`).
- No `console` in application code: use the injected logger (`src/utils/logger.ts`, pino). The request line is written by `request-logger`; code adds to it through `request-context` (`timed()` for database calls, `setRequestSummary`), never by logging per call. Never log the query string, request bodies, `q` or raw coordinates (round with `roundCoordinates`). `console` only in the CLI scripts in `scripts/`.
- Keep `README.md` and the relevant ADR in step with behavior you change.
- **Every endpoint is documented in OpenAPI** (`src/openapi/openapi.document.ts`), in the same change that adds or alters it: path, parameters, request body (generated from its Zod validator, never hand-copied), every status code it can return. **No `example`/`examples` values**: Swagger UI then shows each body as type placeholders (`"name": "string"`) generated from the schema; describe non-obvious fields with `.describe()` instead (a unit test rejects examples). Response shapes go in `src/openapi/response.schemas.ts`. New query parameters (Step 5) come from the query schema the same way. `tests/unit/openapi/route-coverage.test.ts` fails if a route is registered but not documented, or documented but not registered. Integration tests of an endpoint call `expectDocumentedResponse(response, method, path)` on its main responses.

## 7. Design invariants (do not break these)

Data (ADR-001):

1. **Absent means unknown.** Omit `location`, `rating.average`, `cost.averageForTwo` when unknown; never store 0 or null. Arrays are `[]`. API returns `averageRating: null` and omits `distanceKm` when not applicable.
2. Coordinates: GeoJSON `[lng, lat]`. Exactly 0 on either axis, or out of range, means unknown.
3. `norm.city` and `norm.cuisines` come only from the shared `normalize()`; never accepted from clients. Query values go through the same function.
4. Country name and currency come from the code's country table, never from the CSV's `Currency` column (wrong for code 162, the Philippines).
5. `tenantId` is injected by the repository into **every** query, write and `$search`. GET by id queries `{_id, tenantId}`.
6. The `$jsonSchema` validator and the search index definition each exist once in code and are used by both the seed and the tests.

Queries (ADR-003):

7. List and search use **Atlas Search only** (`$search`). GET by id and POST use the collection only (read-your-writes).
8. **Every filter goes inside `compound.filter`.** Never `$match` after `$search`: with `returnStoredSource: true` later stages see only stored fields, so the filter silently fails.
9. Sorts: `distance` (`near` is the **only** scored clause; any name/text clause moves to `filter`), `rating` (`rating.average` desc, `rating.votes` desc, `noData: "lowest"`), `cost` (`cost.averageForTwo` asc/desc). **`_id` is the final tie-breaker in every sort.** Relevance is the implicit default when `name`/text is present and no `sort` is given. Unknown `sort` → 400. `sort=distance` without coordinates → 400 on the list endpoint.
10. Defaults: relevance with name/text; else distance with coordinates; else rating.
11. An explicit `sort=rating` or `sort=cost` adds an `exists` filter. The default list keeps unrated restaurants, last. Distance (explicit or default) keeps restaurants without a location, last: `near` is a `should` clause.
12. Any cost filter or cost sort adds a `cost.currency` filter: the given currency, else the currency of the city's country (from the vocabulary snapshot). If neither is known, an explicit cost parameter → 400 `VALIDATION_ERROR` on `currency` (no INR default); a price read from `q` becomes a ranking preference instead (ADR-002).
13. Radius: coordinates without a city → `geoWithin` default 5 km, max 50 km. Coordinates **with** a city → no radius unless `radiusKm` is given; the city filters and the coordinates only order and produce `distanceKm`.
14. `distanceKm` is computed for the returned page only, with an `$addFields` haversine (earth radius 6378.1 km), rounded for output.
15. Pagination: keyset with `searchSequenceToken` / `searchAfter`, opaque base64url cursor that carries a fingerprint of the query; a cursor used with a different query, or undecodable → 400 `CURSOR_INVALID`. `limit` default 20, max 100, fetch `limit + 1`. No total count, no offset.
16. Every read has a time limit (`QUERY_MAX_TIME_MS`). A `$search` timeout → 503 `SEARCH_TIMEOUT`, search unreachable → 503 `SEARCH_UNAVAILABLE`, any other search error → 500. Collection reads: `DATABASE_TIMEOUT` / `DATABASE_UNAVAILABLE`. There is **no circuit breaker or fallback** in the MVP (considered and left out; ADR-003, Search failure).
17. A missing or unbuilt search index returns **empty results, not an error**, which is why `/ready` checks `listSearchIndexes` for `queryable`.
18. The search index lags writes by about 1 s. Tests that write then list must poll (`waitForSearch`), never `sleep`.
19. Indexes: `_id`, `uq_tenant_source` (`{tenantId, sourceId}`, unique, partial on `sourceId` exists), and the `restaurants_search` Atlas Search index. Do not add indexes without a query that needs them, and record the reason in ADR-003.
20. The API never creates indexes or applies the validator; the seed script does.

## 8. Testing

Write tests **alongside** each piece of code, not at the end. Typical loop: write or extend a unit test for the next rule, make it pass, then add the integration test for the endpoint behavior.

- **Unit** (`tests/unit/**`, no DB): anything that needs no database, including Supertest tests of routes that never touch MongoDB (`/health`, `/ready` unreachable), readiness logic, `normalize`, countries, coordinates, CSV row mapping, Zod schemas, mapper, **search builder** (one test per rule in §7), cursor, **interpreter** (`test.each` table of query → criteria). Assert exact output objects.
- **Integration** (`tests/integration/**`, real `atlas-local`, database `biteexpress_test`, `--runInBand`): every endpoint through Supertest on the fixture set, covering success paths, each validation error, 404s, tenant isolation, sort order with ties, paging, absent values, currency, city + coordinates, the three brief queries, 503 on search failure, `/ready`. Plus database contract tests: validator accept/reject (code 121), seed idempotency, exact index list, stored search index definition.
- No mocking of the MongoDB driver. Substitute dependencies only at the injected seams (for example, a throwing search executor).
- Tests are deterministic: fixed fixtures, explicit `_id`s where order matters, no reliance on the full CSV.
- Every bug fix comes with a test that fails before the fix.
- Coverage: run `npm run test:coverage`; aim for at least 80% lines overall and near 100% on the builder, interpreter, mapper and normalize. Coverage is a signal; the real check is that every requirement in the brief has a test that proves it.
- Test names describe behavior: `it('excludes unrated restaurants when sort=rating is explicit')`.

## 9. Definition of done (every step)

1. The step's acceptance criteria in `.ai/BUILD-PLAN.md` hold.
2. `npm run lint`, `npm run typecheck`, `npm run format:check` pass.
3. `npm run test:unit` passes; `npm run test:integration` passes when the step touches the database or HTTP (start `docker compose up mongo` if needed).
4. `.ai/BUILD-PLAN.md` boxes and **Status** are updated; any ADR/README affected is updated.
5. The step's plan and the ADRs record every decision the step made; the RFC and ADR sections it touches match the behavior (and RFC §8 gains it if it is worth discussing).
6. Every new or changed endpoint is in the OpenAPI document with its parameters, request and responses (no example values), and appears correctly at `http://localhost:3000/swagger`; the route-coverage and response-contract tests pass.
7. Report to the user: what changed (files), how it was verified (commands and results), anything skipped or left open, and a suggested Conventional Commit message. Report failures honestly with their output.

## 10. AI-usage disclosure

The submission must disclose AI assistance in the short "AI usage" section of `README.md`: the tool and model, and the plan-driven process (each phase planned in `.ai/plans/`, approved, then implemented). Keep it short: no per-step list.

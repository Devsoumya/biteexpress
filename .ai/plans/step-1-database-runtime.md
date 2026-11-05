# Step 1: Database runtime (Compose, config, readiness)

- **Status:** Done
- **Design:** ADR-004 (One command, Connection strings, Configuration, Driver settings, Health/readiness); ADR-005 (Test database, Where tests run); ADR-003 (Index lifecycle: `/ready`); `AGENTS.md` §5, §7 (invariants 16–20)

## Goal

Run `mongodb-atlas-local` through Compose, with the API connecting from both the host and the Compose network (`directConnection=true`). Add `GET /ready`, which pings MongoDB and checks that the search index is queryable, so it returns 503 until Step 3. Add test infrastructure on a separate `biteexpress_test` database that can never touch application data. `/health` keeps passing with no MongoDB.

## Approach

### Files

| File                                                      | Change                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/env.ts`                                       | Add `TENANT_ID` (`biteexpress`, min 1), `SEARCH_INDEX_NAME` (`restaurants_search`, min 1), `QUERY_MAX_TIME_MS` (coerced int > 0, 2000), `BEST_MIN_VOTES` (coerced int ≥ 0, 20), `LOG_LEVEL` (enum `fatal`…`trace`/`silent`, `info`). Keep `PORT`, `NODE_ENV`, `MONGODB_URI`. |
| `src/config/database.ts`                                  | Rewrite without module state: `RESTAURANTS_COLLECTION = 'restaurants'`; `createMongoClient(uri): MongoClient` (`appName: 'biteexpress-api'`, `serverSelectionTimeoutMS: 5000`); `pingDatabase(db: Db): Promise<void>` (`db.command({ ping: 1 })`).                           |
| `src/modules/health/readiness.ts` (new)                   | Readiness logic and the MongoDB probes (below).                                                                                                                                                                                                                              |
| `src/modules/health/health.routes.ts` (new)               | `createHealthRouter({ checkReadiness })`: `GET /health` → 200 `{ status: 'ok' }` (never calls `checkReadiness`); `GET /ready` → 200 `{ status: 'ready', checks }` or 503 `{ status: 'not_ready', checks }`, with `Cache-Control: no-store`.                                  |
| `src/app.ts`                                              | `createApp(deps: AppDependencies): Express`, where `AppDependencies = { checkReadiness: () => Promise<ReadinessResult> }`. No I/O at import time; mounts the health router, restaurants router, 404 handler and error handler.                                               |
| `src/server.ts`                                           | Composition root: `loadEnv` → `createMongoClient` → `connect` → `pingDatabase(client.db())` → `createReadinessCheck(mongoReadinessProbes(...))` → `createApp` → `listen`. Shutdown as today: close HTTP, then `client.close()`.                                              |
| `docker-compose.yml`                                      | Compose changes (below)                                                                                                                                                                                                                                                      |
| `Dockerfile`                                              | Add `FROM build AS test` **between** `build` and `runtime`: copy `jest.config.js`, `tsconfig.test.json`, `tests/`; `CMD ["npm", "test"]`. `runtime` stays the last stage and is unchanged.                                                                                   |
| `.env.example`                                            | Both URIs with `directConnection=true` (host form); `TEST_MONGODB_URI` → `/biteexpress_test`; the new variables; `MONGO_PORT`.                                                                                                                                               |
| `jest.config.js`                                          | `integration` project gets `globalSetup: '<rootDir>/tests/setup/global-setup.ts'` and `globalTeardown: '<rootDir>/tests/setup/global-teardown.ts'`.                                                                                                                          |
| `tests/helpers/test-database.ts` (new)                    | Test-database safety (below)                                                                                                                                                                                                                                                 |
| `tests/setup/global-setup.ts`, `global-teardown.ts` (new) | Setup: connect, ping, drop `biteexpress_test` (a clean start), close. Teardown: connect, drop `biteexpress_test`, close. A failed ping throws `MongoDB not reachable at TEST_MONGODB_URI; run "docker compose up -d mongo"`.                                                 |
| `tests/integration/health.api.test.ts`                    | **Moved** to `tests/unit/http/health.test.ts` (user decision) and rewritten for `createApp`.                                                                                                                                                                                 |
| README, docs                                              | Part B, plus the README's local-dev and test sections and an AI-usage line                                                                                                                                                                                                   |

### Readiness (`src/modules/health/readiness.ts`)

```ts
type SearchIndexState =
  'ok' | 'missing' | 'not_queryable' | 'error' | 'skipped';
export type ReadinessResult = {
  ready: boolean;
  checks: { mongo: 'ok' | 'fail'; searchIndex: SearchIndexState };
};
export interface ReadinessProbes {
  ping(): Promise<void>;
  searchIndexState(): Promise<'ok' | 'missing' | 'not_queryable'>;
}
export function createReadinessCheck(
  probes: ReadinessProbes,
  options?: { ttlMs?: number; now?: () => number }, // ttlMs default 5000
): () => Promise<ReadinessResult>;
export function mongoReadinessProbes(
  db: Db,
  collectionName: string,
  indexName: string,
): ReadinessProbes;
```

- Ping fails → `{ mongo: 'fail', searchIndex: 'skipped' }`. If the index probe throws → `searchIndex: 'error'`. Ready only when both are `ok`.
- The result (pass **or** fail) is cached for `ttlMs` (ADR-004: 5 s). With an injected `now`, unit tests need no timers.
- `searchIndexState` runs `collection.listSearchIndexes(indexName).toArray()`. If no entry is found → `missing`; if `queryable !== true` → `not_queryable`. A missing **collection**, which is the situation in Step 1, maps to `missing`. Its exact `atlas-local` behavior (empty cursor or NamespaceNotFound, code 26) is checked during M3 and recorded in the notes and ADR-003's verified behaviors.
- The probes are the injected seam, so unit tests use fake probes and never mock the driver.

### Test-database safety (`tests/helpers/test-database.ts`)

- `TEST_DB_NAME = 'biteexpress_test'`, a constant. Every test and setup file uses `client.db(TEST_DB_NAME)` and never `client.db()`.
- `testMongoUri()` reads `process.env.TEST_MONGODB_URI`. If it is unset, it throws `TEST_MONGODB_URI is not set; see .env.example`.
- `connectTestClient()` returns a `MongoClient` with `appName: 'biteexpress-tests'`, connected. It **throws if `client.options.dbName !== TEST_DB_NAME`**, so a URI pointing at `biteexpress` (or no path, which defaults to `test`) is rejected before anything runs.
- `dropTestDatabase(client)` drops `client.db(TEST_DB_NAME)` only. The application database name is never written in test code.

### Docker Compose

- **`mongo`:**
  - image `mongodb/mongodb-atlas-local:8.0@sha256:5cf57bb4…be5`
  - `hostname: mongo`
  - `MONGODB_INITDB_ROOT_USERNAME`/`PASSWORD` from `${MONGO_ROOT_USERNAME:-biteexpress}` / `${MONGO_ROOT_PASSWORD:-local-dev-only}`
  - `ports: '${MONGO_PORT:-27017}:27017'`, `restart: unless-stopped`, **no volume** (the `volumes:` block is removed)
  - healthcheck keeps the image's test (`/usr/local/bin/runner healthcheck`) with faster timing: `interval: 10s`, `timeout: 10s`, `retries: 5`, `start_period: 60s`, `start_interval: 2s`. The image default (30 s interval) would hold `api` back about 30 s when `mongo` is healthy after about 8 s.
- **`api`:**
  - `build: { context: ., target: runtime }`. The explicit target is needed because adding a `test` stage would otherwise make the default target ambiguous to readers.
  - env: `MONGODB_URI=mongodb://…@mongo:27017/biteexpress?authSource=admin&directConnection=true` and the new variables
  - `depends_on: mongo: service_healthy`
  - healthcheck `wget -qO- http://127.0.0.1:3000/health || exit 1` (busybox `wget` is in `node:22-alpine`), `interval: 10s`, `timeout: 3s`, `retries: 3`, `start_period: 10s`
- **`test`** (profile `test`):
  - `build: { context: ., target: test }`
  - `TEST_MONGODB_URI=mongodb://…@mongo:27017/biteexpress_test?authSource=admin&directConnection=true`
  - `depends_on: mongo: service_healthy`
  - `command: npm test`

### Implementation order and milestone checks

| #   | Milestone                                                                                                                           | Verify                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `env.ts`, `database.ts`, `readiness.ts`, `health.routes.ts`, `createApp`, `server.ts`; unit tests (including the moved health test) | `npm run test:unit`; `npm run lint && npm run typecheck`. No Docker needed.                                                                                                                                                                                                                                                                                                  |
| M2  | Compose `mongo` (Atlas Local, digest, no volume, healthcheck timing); `.env.example`                                                | `docker compose up -d mongo`; `docker compose ps` shows `healthy` (note the time). From the host, a node one-liner pings with `directConnection=true` → ok; **without** it → `ENOTFOUND mongo`, which confirms ADR-004.                                                                                                                                                      |
| M3  | Host API against Compose `mongo`                                                                                                    | Export `.env`, then `npm run dev`. `curl -i localhost:3000/health` → 200. `curl -i localhost:3000/ready` → 503 `{ status: 'not_ready', checks: { mongo: 'ok', searchIndex: 'missing' } }`. Record what `listSearchIndexes` does on the missing collection.                                                                                                                   |
| M4  | Test infra: helper, `globalSetup`/`globalTeardown`, integration tests                                                               | Write a sentinel document to `biteexpress.step1_sentinel`, then run `TEST_MONGODB_URI=… npm run test:integration` (passes). Check the sentinel **still exists**, then delete it. `listDatabases` shows **no** `biteexpress_test` after teardown. `TEST_MONGODB_URI` unset → the run fails with the clear message. A URI pointing at `/biteexpress` → rejected by the helper. |
| M5  | Full Compose: `api` + `test` service + Dockerfile `test` stage                                                                      | `docker compose up --build -d`, then `docker compose ps` shows `api` healthy. `curl` `/health` → 200 and `/ready` → 503. `docker compose --profile test run --rm test` passes. `docker compose down`, then `up` again starts empty (no volume).                                                                                                                              |
| M6  | Docs and gates                                                                                                                      | `npm run lint`, `typecheck`, `format:check`, `test:unit`, `test:integration`, `test:coverage`, `build`. Update the README, the ADRs (Part B), BUILD-PLAN boxes and Status, and these notes.                                                                                                                                                                                  |

## Decisions and trade-offs

- **No-DB HTTP tests live in `unit`** (user decision). `npm run test:unit` proves `/health` needs no MongoDB, and the integration project can fail fast without a DB.
- **Readiness lives in `src/modules/health/`.** It is not restaurant behavior, and `app.ts` stays a composition of routers. This is a new folder, so it is added to the AGENTS.md §5 layout.
- **Probes are injected** instead of `createApp` taking a `Db`. Logic and cache are unit-tested with fakes, and `/health`'s test asserts `checkReadiness` is never called. The real probes are exercised in integration against `atlas-local`.
- **`/ready` body is a probe status, not the error envelope.** The 503 here means "not ready" rather than a request error, and `checks` tells an operator which part failed. RFC §5 gets this shape.
- **Failures are cached for 5 s too**, so a flapping DB is not hammered by probes. Recovery shows up within 5 s.
- **`/ready` can take up to `serverSelectionTimeoutMS` (5 s) when MongoDB is down.** In Step 3, the Compose `/ready` healthcheck timeout must exceed this (≥ 6 s). The unit test uses a client on `127.0.0.1:1` with `serverSelectionTimeoutMS=200`.
- **Test DB name is a constant, and the helper checks the URI's database name** (two independent guards). Teardown can never drop `biteexpress`.
- **`process.env` in tests:** the "only via `env.ts`" rule is for application code. `TEST_MONGODB_URI` is test-only and is read in exactly one helper (AGENTS.md §6 wording clarified).
- **`TENANT_ID`, `QUERY_MAX_TIME_MS`, `BEST_MIN_VOTES` and `LOG_LEVEL` are validated now but used from Step 4/6/7**, as the build plan lists. They are configuration, not speculative code.
- **The image's healthcheck command is kept, with only its timing overridden**, so the image vendor's definition of healthy still applies.
- **`.env` loading:** the README documents `set -a; . ./.env; set +a`. `npm run dev` is unchanged, because `--env-file-if-exists` needs Node ≥ 22.9 and the engines field allows 22.0.

## Tests

Unit (no database):

- [x] `tests/unit/config/env.test.ts`: defaults for every new variable; coerces `QUERY_MAX_TIME_MS`/`BEST_MIN_VOTES`; rejects `QUERY_MAX_TIME_MS=0`, negative `BEST_MIN_VOTES`, an unknown `LOG_LEVEL`, an empty `TENANT_ID` (plus the existing 5)
- [x] `tests/unit/health/readiness.test.ts` (fake probes, fake clock):
  - [x] ready when ping and index are ok
  - [x] ping fails → not ready, `searchIndex: 'skipped'`
  - [x] index missing / not queryable / probe throws → not ready with that state
  - [x] returns the cached result within 5 s without calling the probes
  - [x] re-probes after 5 s
- [x] `tests/unit/http/health.test.ts`: `GET /health` → 200 `{ status: 'ok' }` and `checkReadiness` is never called
- [x] `tests/unit/http/ready.test.ts`:
  - [x] 200 `{ status: 'ready', checks }` when ready
  - [x] 503 `{ status: 'not_ready', checks }` when not ready
  - [x] with real probes on an unreachable client (`127.0.0.1:1`): 503, `mongo: 'fail'`
  - [x] `Cache-Control: no-store`

Integration (`atlas-local`, `biteexpress_test`):

- [x] `tests/integration/database.test.ts`:
  - [x] ping succeeds through `TEST_MONGODB_URI` with `directConnection=true`
  - [x] the database in use is `biteexpress_test`
  - [x] the server is a replica set (`hello.setName` set), so it is Atlas Local and not a standalone `mongod`
- [x] `tests/integration/ready.api.test.ts`:
  - [x] `/ready` → 503 `{ mongo: 'ok', searchIndex: 'missing' }` for `restaurants_search` (absent in Step 1)
  - [x] the same for `SEARCH_INDEX_NAME=does_not_exist`

Manual checks (recorded in the notes): M2 `directConnection` with/without; M4 sentinel survives, no `biteexpress_test` left, fail-fast messages; M5 Compose `api` healthy and the `test` service passing.

**Acceptance:**

- `docker compose up -d mongo` reaches healthy.
- The API runs from the host against it with `directConnection=true`; `/health` 200, `/ready` 503.
- `docker compose up --build` starts `mongo` → `api`, with `api` healthy on `/health`.
- `docker compose --profile test run --rm test` passes.
- `npm run test:unit` passes with no database; `npm run test:integration` passes with `mongo` up.
- Application data survives a test run.
- Lint, typecheck and format pass.

## Out of scope

`seed` service, seed script, validator, `uq_tenant_source`, search index, `/ready` 200 test, and the `api` healthcheck on `/ready` (Step 3). Fixtures and `waitForSearch` (Step 5). Pino logging (Step 7). Restaurant endpoints (Step 4+).

## Notes after implementation

> Paths changed after this step: the code moved to top-level layer folders (`change-layered-structure.md`). For example, `src/modules/health/*` is now `controllers/`, `services/`, `repositories/` and `models/`, `src/middleware/` is `src/middlewares/`, and the tests moved under `tests/unit/{services,routes}` and `tests/integration/{repositories,routes}`.

Implemented and verified on 2026-11-05 (Docker 29.9.2, Compose 5.6.1, Node 26 on the host).

### Results

| Milestone / command                                                           | Result                                                                                                                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 `npm run test:unit` (no database, no `TEST_MONGODB_URI`, nothing on 27017) | 4 suites, 22 tests passed in 0.8 s                                                                                                                             |
| M2 `docker compose up -d mongo`                                               | healthy after 8 s (with the overridden healthcheck timing)                                                                                                     |
| M2 host ping with `directConnection=true`                                     | ok; `hello.setName` `mongo`, `me` `mongo:27017`                                                                                                                |
| M2 host ping without it                                                       | `MongoServerSelectionError: getaddrinfo ENOTFOUND mongo` (confirms ADR-004)                                                                                    |
| M3 `npm run dev` from the host                                                | `/health` 200 `{"status":"ok"}`; `/ready` 503 `{"status":"not_ready","checks":{"mongo":"ok","searchIndex":"missing"}}`, `Cache-Control: no-store`              |
| M3 `listSearchIndexes` on the missing `restaurants` collection                | empty cursor, no error (recorded as ADR-003 row 18a)                                                                                                           |
| M4 `npm run test:integration`                                                 | 2 suites, 5 tests passed                                                                                                                                       |
| M4 sentinel in `biteexpress.step1_sentinel`                                   | still present after the run (then removed); `biteexpress_test` absent after teardown                                                                           |
| M4 `TEST_MONGODB_URI` unset / `/biteexpress` / no path / unreachable          | globalSetup fails with: "not set" / "must name … got biteexpress" / "… got test" / "MongoDB is not reachable"                                                  |
| M5 `docker compose up --build -d`                                             | `api` healthy 57 s after start, including the first image build; 12 s on a cold `up` without build. `/health` 200, `/ready` 503 (connected over `mongo:27017`) |
| M5 runtime image                                                              | `/app` holds `dist/`, `node_modules`, `package*.json` only; runs as `node`                                                                                     |
| M5 `docker compose --profile test run --rm test`                              | exit 0; 6 suites, 27 tests passed                                                                                                                              |
| M5 `down` then `up`                                                           | marker document gone (no volume); no `biteexpress` volumes exist                                                                                               |
| M6 `lint`, `typecheck`, `format:check`, `build`                               | all exit 0                                                                                                                                                     |
| M6 `npm test` / `npm run test:coverage`                                       | 27 tests passed; lines 80.5% over `src/`                                                                                                                       |

### Differences from the plan

- **`.env.example` URIs are quoted.** The plan's `set -a; . ./.env; set +a` failed on the unquoted `&` (`parse error near '&'`). Compose and Node both accept quoted values.
- **`createMongoClient`'s explicit `serverSelectionTimeoutMS: 5000` overrides a value in the URI** (the driver gives programmatic options priority). The unreachable-database unit test therefore builds its own `MongoClient` with a 200 ms option instead of a URI parameter. As a consequence, ops cannot shorten the timeout through `MONGODB_URI`; acceptable for the MVP.
- **Database-name check timing:** `connectTestClient()` checks `client.options.dbName` right after `new MongoClient(...)`, which only parses the URI. So the check runs before any connection and before any drop.
- **Jest coverage fix (Step 0 config):** `collectCoverageFrom` inside `projects` is ignored by Jest, so coverage had listed `tests/helpers/` and skipped unloaded `src` files. It now sits at the top level of `jest.config.js`.
- **`node:22-alpine` was not local.** It was pulled (with the user's approval) for the M5 image build; `npm ci` in the image uses the existing lockfile.
- The health test was moved with `git mv`, so that rename is staged in the index; nothing is committed.

### Left open

- `/ready` 200, the `seed` service and the `api` healthcheck on `/ready` are Step 3 work, as planned.
- Branch coverage is 58%: the env `source` default (`process.env`) and the error handler are not exercised yet. The error handler gets its tests with the endpoints in Step 4.

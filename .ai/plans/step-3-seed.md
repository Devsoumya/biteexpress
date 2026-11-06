# Step 3: Seed (database ready)

- **Status:** Done
- **Design:** ADR-001 (Rules 1–13, appendix validator), ADR-003 (search index definition, Index lifecycle), ADR-004 (`seed` service, One command), ADR-005 (test database); AGENTS.md §7 invariants 1–6, 17, 19, 20

## Goal

An idempotent seed applies the validator, the unique index and the search index, and upserts the cleaned CSV, all through functions shared with the test setup. `docker compose up --build` then runs `mongo` → `seed` → `api`, and `/ready` returns 200.

## Approach

### Files

| File                                        | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/models/restaurant.model.ts`            | Add `RestaurantDocument` (ADR-001 shape: `_id: ObjectId`, `tenantId`, `sourceId?`, `name`, `address {line, locality?, city}`, `country {code, name}`, `location?: GeoPoint`, `cuisines`, `cost? {averageForTwo?, currency, priceRange?}`, `features?`, `rating {average?, votes}`, `norm {city, cuisines}`, `createdAt`, `updatedAt`, `schemaVersion`) and `NewRestaurant = Omit<RestaurantDocument, '_id' \| 'createdAt' \| 'updatedAt'>`.                                                                                                                                                                        |
| `src/models/seed.model.ts`                  | `CsvRow` (`Record<string, string>` keyed by the CSV header), `SeedSkip { sourceId; reason }`, `SeedSummary { rows, mapped, skipped, inserted, updated, durationMs }`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `package.json`                              | Runtime dependency **`csv-parse@^7.0.3`** (MIT, no dependencies of its own; ships CommonJS through the `require` export of `csv-parse/sync`). Approved by the author on 2026-11-05.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/utils/csv.ts`                          | `parseCsvRecords(text: string): CsvRow[]`, a thin wrapper over `parse` from `csv-parse/sync` with `{ columns: true, bom: true, skip_empty_lines: true, relax_column_count: false, relax_quotes: false }`. This is the only file that imports the library, so the options are reviewed in one place and the library can be swapped. Values are not trimmed here; the mapper owns text cleanup.                                                                                                                                                                                                                      |
| `src/constants/seed-repairs.ts`             | `SOURCE_TEXT_REPAIRS` (the 3 cities and 2 cuisines, keyed by the exact U+FFFD string → `Brasília`, `São Paulo`, `İstanbul`, `Döner`, `Börek`), `SKIPPED_SOURCE_IDS = [18419884]`, and `MISENCODED_DOTLESS_I = '۱'` → `'ı'`                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/mappers/restaurant-csv.mapper.ts`      | `mapCsvRow(row: CsvRow, tenantId: string): NewRestaurant \| SeedSkip`, a pure function (details below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/db/restaurant.json-schema.ts`          | `RESTAURANT_JSON_SCHEMA`, copied from the ADR-001 appendix (single source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/db/restaurant.search-index.ts`         | `RESTAURANT_SEARCH_INDEX: { name, definition }`, copied from ADR-003 (single source); `name` comes from `SEARCH_INDEX_NAME` at call time                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/db/restaurant-collection.setup.ts`     | Schema management, which only the seed and the tests call; the API never does (invariant 20): `applyValidator(db)` (create with validator, or `collMod`; `validationLevel: 'strict'`, `validationAction: 'error'`), `ensureIndexes(collection)` (`uq_tenant_source`), `ensureSearchIndex(collection, name, definition)` (create if missing, update if `latestDefinition` differs; returns `'created' \| 'updated' \| 'unchanged'`), `waitForSearchIndex(collection, name, { timeoutMs = 60_000, intervalMs = 250 })` (until `status === 'READY'` and `queryable === true`; throws with the last status on timeout) |
| `src/repositories/restaurant.repository.ts` | `RestaurantRepository` interface in `models/` plus `MongoRestaurantRepository` with `upsertManyBySourceId(docs: NewRestaurant[], now: Date): Promise<{ inserted; updated }>`: unordered `bulkWrite` of `updateOne` with `filter {tenantId, sourceId}`, `$set` all fields plus `updatedAt`, `$setOnInsert { createdAt }`, `upsert: true`. Step 4 adds `insert` and `findById` here.                                                                                                                                                                                                                                 |
| `src/scripts/seed.ts`                       | `runSeed(db, { tenantId, indexName, csvPath, log })` → `SeedSummary`, which composes the functions above in ADR order. A thin `main()`: `loadEnv` → client → `runSeed` → log summary → `process.exitCode = 1` and close on failure.                                                                                                                                                                                                                                                                                                                                                                                |
| `src/config/env.ts`                         | Add `SEED_CSV_PATH` (default `zomato_data.csv`, resolved from the working directory).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/setup/global-setup.ts`               | After the drop: `applyValidator`, `ensureIndexes`, `ensureSearchIndex` and `waitForSearchIndex` on `biteexpress_test` (empty collection, so a fast build)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Dockerfile`                                | `runtime`: `COPY zomato_data.csv ./`. The CSV is 2.2 MB and only invalidates its own layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docker-compose.yml`                        | `seed` service: same build (`target: runtime`), `command: ['node', 'dist/scripts/seed.js']`, same env as `api`, `depends_on: mongo: service_healthy`, `restart: 'no'`. `api`: `depends_on: seed: service_completed_successfully`; healthcheck moves to `/ready` with `timeout: 7s` (more than the 5 s server selection), `interval: 10s`, `retries: 3`, `start_period: 10s`.                                                                                                                                                                                                                                       |
| `package.json`                              | `"seed": "tsx src/scripts/seed.ts"`. `test` and `test:coverage` get `--selectProjects unit integration`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### `mapCsvRow` rules (ADR-001 Rules 1–11, in order)

1. `sourceId = Number(row['Restaurant ID'])`. In `SKIPPED_SOURCE_IDS` → `{ skip: 'test row' }`.
2. **Text cleanup** for every text field: replace `۱` with `ı`, apply the `SOURCE_TEXT_REPAIRS` exact matches (city and each cuisine), collapse whitespace runs (including the embedded newlines) to one space, and trim.
3. `country = countryBySeedCode(code)`. If it is unknown → skip `'unknown country code'` (none occur; this guards a changed file).
4. `address = { line, locality, city }`. `name` is cleaned but otherwise kept; the 103 U+FFFD names can't be recovered (Rule 11).
5. `location`: `parseCoordinates(lat, lng)`. `point` → set; `unknown` or `invalid` → omit (Rule 2/3).
6. `cuisines`: `normalizeCuisines(splitCuisines(raw))` → `cuisines = display`, `norm.cuisines = norm`. Blank → `[]`.
7. `norm.city = normalizeCity(city)`.
8. `cost`: `{ currency: country.currency }`, plus `averageForTwo` only if > 0 and `priceRange` (1–4). The CSV `Currency` column is ignored.
9. `rating`: `{ votes }`, plus `average` only if > 0.
10. `features`: Yes/No → booleans for table booking, online delivery and delivering now. `Switch to order menu`, `Rating text`, `Rating color` and `Locality Verbose` are dropped.
11. `tenantId` from the argument; `schemaVersion: 1`.

### `runSeed` order (ADR-001 Rule 12, ADR-003 Index lifecycle)

1. `applyValidator`
2. `ensureIndexes`
3. Read the file with a strict UTF-8 decoder (`new TextDecoder('utf-8', { fatal: true })`, so a re-encoded file fails loudly), `parseCsvRecords`, then `mapCsvRow`.
4. `upsertManyBySourceId` with one `now`.
5. `ensureSearchIndex`, then `waitForSearchIndex`.
6. Log `rows, mapped, skipped (by reason), inserted, updated, search index created|updated|unchanged, durationMs`.

On a `MongoBulkWriteError`, log the first 5 `writeErrors` with `errInfo` (the validator's reason, ADR-004) and fail.

### Implementation order and milestones

| #   | Milestone                                                                                                    | Verify                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Install `csv-parse`; `csv.ts`, `seed-repairs.ts`, `restaurant-csv.mapper.ts`, the document model; unit tests | `npm run test:unit` (no DB). A dry run over the real file (unit test reads it): 9,551 rows → 9,550 mapped + 1 skipped; 499 without `location`; 2,147 without `rating.average`; 18 without `averageForTwo`; 141 distinct cities, no U+FFFD in any city or cuisine; 0 `۱` left. |
| M2  | `db/` definitions and setup functions, repository, extended `globalSetup`; integration tests                 | `npm run test:integration`                                                                                                                                                                                                                                                    |
| M3  | `seed.ts`, `npm run seed` from the host                                                                      | `docker compose up -d mongo`, then `npm run seed` twice. Run 1: inserted 9,550; run 2: inserted 0, updated 9,550, index `unchanged`. Check the timing; `curl /ready` → 200 with `npm run dev`.                                                                                |
| M4  | Compose `seed` service, Dockerfile CSV, `api` → `/ready`                                                     | `docker compose down && docker compose up --build`: `seed` exits 0 → `api` healthy; `/ready` 200; `docker compose --profile test run --rm test`                                                                                                                               |
| M5  | Docs and gates                                                                                               | `lint`, `typecheck`, `format:check`, `build`, `test:unit`, `test:integration`, `test`, `test:coverage`                                                                                                                                                                        |

## Decisions and trade-offs

- **`csv-parse` instead of a hand-written parser.** CSV has well-known traps (quotes, `""` escapes, newlines inside quotes, CRLF, BOM), and this file contains three of them. A mature, widely used library with no dependencies of its own is less code to own and a conventional choice. It's wrapped in `utils/csv.ts`, so the rest of the code depends on our function, not on the library. Strict options (`relax_column_count: false`, `relax_quotes: false`) make a malformed row throw instead of silently shifting columns. The sync API is enough for a 2.2 MB file; `csv-parse/stream` would be the switch for large or streamed input.
- **Decode as strict UTF-8 (corrects ADR-001 Rule 11).** The bytes are valid UTF-8, and latin1 would add mojibake on top of the upstream damage. The repair keys become U+FFFD strings.
- **Repair `۱` → `ı` globally.** It's one systematic, one-to-one mis-encoding (52 occurrences, all Turkish words), so the fix is safe and readable. U+FFFD itself is lossy, so only the 5 known exact strings are repaired, and names stay as they are.
- **Schema management lives in `src/db/`, data access in a repository.** "Only repositories talk to MongoDB" holds for the request path. `db/*.setup.ts` is the migration-job code from ADR-004 (validator and indexes need elevated privileges and must not race across API replicas), and only `scripts/seed.ts` and the test setup call it. AGENTS.md §5 gets this exception written down.
- **Re-seed updates every document's `updatedAt`.** That follows the ADR: `$set` + `$setOnInsert`. The idempotency guarantee is therefore "no new documents, same `_id`s, same content", not "0 modified". A run on an unchanged file modifies 9,550 documents, which costs a few seconds of re-indexing. The alternative (an update pipeline that changes `updatedAt` only on real change) is more complex than it's worth, because Compose has no volume and starts from empty anyway. Logged as `updated`.
- **Search-index comparison.** `ensureSearchIndex` deep-compares the code definition with the stored `latestDefinition`. If `atlas-local` adds server defaults, a naive comparison would call `update` on every run. M2 checks this. If defaults appear, the comparison covers only the keys the code defines, and the ADR-003 verified-behaviors table records the finding.
- **Waiting after `updateSearchIndex`.** Atlas keeps the old version queryable while the new one builds, so `READY` + `queryable` could be the old build. M3 records the status sequence `atlas-local` reports after an update. If a status other than `READY` is not observed first, the wait also requires that `latestDefinition` equals the code's.
- **Test data isolation.** Integration tests that write use their own `tenantId` (for example `seed-test`) and delete it in `afterAll`. Steps 4–5 can then share one collection and one search index without interference.
- **Logging:** `console.info` in `scripts/seed.ts`, which is a CLI. Structured logging arrives in Step 7. AGENTS.md §6 gets this exception written down.

## Tests

Unit (no database):

- [x] `tests/unit/utils/csv.test.ts`: proves our wrapper's options on the cases this file needs: header → keys; quoted comma; `""` escape; newline inside quotes; CRLF; trailing newline adds no record; empty field stays `''`; a BOM is stripped; a row with a different field count throws
- [x] `tests/unit/mappers/restaurant-csv.mapper.test.ts` (`test.each`, exact objects), one case per rule:
  - [x] the full document for a normal Indian row
  - [x] skipped test row
  - [x] rating 0 → no `average`, votes kept
  - [x] cost 0 → no `averageForTwo`, currency kept
  - [x] `(0,0)` and one axis 0 → no `location`
  - [x] code 162 → PH/PHP although the column says Pula; Dollar countries
  - [x] city repair (`Bras�_lia`) → `Brasília`, with `norm.city` `brasilia`
  - [x] cuisine repair (`D�_ner`)
  - [x] duplicate cuisine de-duplicated; blank cuisines → `[]`
  - [x] `۱` → `ı` in the name and address
  - [x] whitespace and embedded newline collapsed
  - [x] Yes/No flags
  - [x] unknown country code → skip
- [x] `tests/unit/scripts/seed-dataset.test.ts`: maps the real `zomato_data.csv` in memory (no DB) and asserts the M1 counts. This catches any change to the file or the rules.

Integration (`atlas-local`, `biteexpress_test`; the extended `globalSetup` created the schema and indexes):

- [x] `tests/integration/db/validator.test.ts`:
  - a mapped real row inserts
  - each bad shape is rejected with code 121: missing `norm`, `rating.average: 0`, `location` `[lng, lat]` out of range, an unknown top-level field, lowercase `country.code`, `schemaVersion` as a double
- [x] `tests/integration/db/indexes.test.ts`:
  - exactly `_id_` and `uq_tenant_source`, with `unique: true` and the partial filter
  - the stored search-index definition matches `RESTAURANT_SEARCH_INDEX.definition`
  - the index is `READY` and queryable
  - `applyValidator`, `ensureIndexes` and `ensureSearchIndex` run again without error (`unchanged`)
- [x] `tests/integration/repositories/restaurant.repository.test.ts` (tenant `seed-test`): upsert 5 mapped rows → 5 inserted; again → 0 inserted, 5 updated, same `_id`s, `createdAt` unchanged, `updatedAt` advanced; a duplicate `{tenantId, sourceId}` insert is rejected (code 11000)
- [x] `tests/integration/routes/ready.api.test.ts`: `restaurants_search` → **200** `{ mongo: ok, searchIndex: ok }`; `does_not_exist` → 503 `missing`
- [x] `tests/integration/repositories/health.repository.test.ts`: the "missing" case now uses a collection that doesn't exist, because `restaurants` now does

**Acceptance:**

- `docker compose up --build` runs `mongo` → `seed` (exit 0, a few seconds) → `api` healthy on `/ready` (200).
- Re-running the seed inserts 0 documents.
- All unit and integration tests pass; lint, typecheck, format and build pass.
- The integration suite still runs in seconds.

## Out of scope

- Restaurant endpoints (Step 4+), fixtures and `waitForSearch` (Step 5)
- Pino logging (Step 7)
- An update pipeline to avoid touching `updatedAt` on unchanged rows
- `explain.ts` (Step 7)

## Notes after implementation

Implemented and verified on 2026-11-05.

### Results

| Check                                         | Result                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit` (no database, no URIs)    | 190 passed. The real file maps 9,551 rows → 9,550 + 1 skipped; 499 without `location`, 2,147 unrated, 18 without `averageForTwo`, 9 without cuisines, 141 cities, no U+FFFD in cities or cuisines, no `۱` left |
| `npm run test:integration`                    | 38 passed in about 2 s; 8 back-to-back runs all pass                                                                                                                                                           |
| `npm test` / `npm run test:coverage`          | 228 passed; 91% lines overall; mapper, CSV wrapper, repository, definitions 100%; setup 98%; `seed.ts` 78% (the uncovered part is `main()`, exercised by the real runs)                                        |
| `npm run seed` from the host, twice           | run 1: 9,550 inserted, index created, 1.6 s; run 2: 0 inserted, 9,550 updated, index `unchanged`, 0.5 s                                                                                                        |
| `docker compose down && up --build`           | `mongo` healthy → `seed` exit 0 (1.9 s) → `api` healthy on `/ready` 200; 19 s with a cached build, 45 s for the first build                                                                                    |
| `docker compose --profile test run --rm test` | exit 0, 228 passed                                                                                                                                                                                             |
| `lint`, `typecheck`, `format:check`, `build`  | all pass                                                                                                                                                                                                       |

### Differences from the plan

- **`csv-parse` instead of our own parser** (user decision, recorded before implementation).
- **Search-index comparison:** the server also reorders set-like arrays (the `name` type list, and `storedSource.include`, which it sorts), so even a containment check reported `updated` on every seed. Arrays are now compared as sets, except `tokenFilters` and `charFilters`, whose order matters. Recorded in ADR-003 (18b).
- **Update status, verified:** after `updateSearchIndex` the status is `PENDING` at once, then `BUILDING`, then `READY`, so waiting for `READY` + `queryable` is enough. The index is not queryable during the rebuild on `atlas-local` (ADR-003 18c).
- **Test setup clears instead of dropping.** Back-to-back integration runs failed in about 1 of 3: after the previous teardown's `dropDatabase`, `createSearchIndex` with the same name was sometimes lost (never listed), and setup timed out after 60 s. Setup and teardown now empty the collections and keep the schema and indexes, created idempotently by the seed's functions. Runs are faster too (0.34 s versus about 2 s). Recorded in ADR-003 (18d) and ADR-005. Step 1's "teardown drops `biteexpress_test`" is replaced by this.
- **The upsert also `$unset`s `location`, `cost` and `features` when absent**, so a re-seed cannot leave a stale value behind (Rule 2); covered by a test.
- **Added:** the setup functions are generic over the document type; `tests/helpers/restaurant-fixtures.ts` builds valid seed restaurants from the mapper; a search-index lifecycle test (create → update → unchanged, plus the wait timeout); a `runSeed` integration test with a 3-row CSV and a real validator rejection whose report shows `errInfo` (`describeSeedError`).
- ESLint `no-unused-vars` gained `ignoreRestSiblings: true`, the standard setting for `const { dropped, ...rest } = obj`.
- The Dockerfile `test` stage also copies `zomato_data.csv`, because the full-file unit test reads it.

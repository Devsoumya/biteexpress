# Step 5: List endpoint (`GET /v1/restaurants`)

- **Status:** Done (2026-11-06)
- **Design:** ADR-003 (search index, query builder Rules 1–11, Search failure, Verification), RFC-001 §5 (list parameters, list item), ADR-002 (the shared criteria object), ADR-005 (fixtures, `waitForSearch`, injected search executor); AGENTS.md §7 invariants 5, 7–18

## Goal

`GET /v1/restaurants` returns a filtered, sorted, cursor-paginated list from Atlas Search. Name, city, cuisine, rating, votes, cost and location combine freely with every sort, all served by one `$search` stage. A search outage returns 503 `SEARCH_UNAVAILABLE`, while GET by id and POST keep working. The query builder is a pure function shared with Step 6, so the natural-language endpoint only has to produce criteria.

## Approach

### Request flow

```
GET /v1/restaurants?city=Gurugram&cuisine=north indian&sort=rating&limit=20
  controller   listRestaurantsQuerySchema.parse(req.query)          400 VALIDATION_ERROR + details
  service      toSearchCriteria(query)                               normalizeCity / normalize → criteria
               decodeCursor(query.cursor, criteria)                  400 CURSOR_INVALID
               repository.search(criteria, { limit, searchAfter })
  repository   buildSearchPipeline(criteria, { tenantId, indexName, limit + 1, searchAfter })
               executor.aggregate(pipeline, { timeoutMS })           timeout → SEARCH_TIMEOUT, unreachable → SEARCH_UNAVAILABLE (503), other → 500
  service      first `limit` hits → toRestaurantListItem; hit #limit+1 exists → encodeCursor(last token, criteria)
  controller   200 { data, nextCursor }
```

### Files

| File                                        | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/models/search.model.ts`                | `SearchCriteria`: the ADR-002 shape, minus the Step 6-only fields until Step 6 (`city?`, `cuisines?`, `cuisineMatch`, `minRating?`, `minVotes?`, `minCost?`, `maxCost?`, `currency?`, `name?`, `origin?: LatLng`, `radiusKm?`, `sort?: 'distance' \| 'rating' \| 'cost'`, `order?`). `SearchPage` (`limit`, `searchAfter?`), `RestaurantSearchHit` (stored-source fields + `distanceKm` + `paginationToken`), `SearchExecutor` (`aggregate(pipeline, options)`), `ListRestaurantsResponse` |
| `src/validators/restaurant.schema.ts`       | `listRestaurantsQuerySchema`: `z.strictObject`, coerced numbers. Rules are listed below                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/mappers/search-criteria.mapper.ts`     | `toSearchCriteria(query)`: pure. City → `normalizeCity` (aliases), cuisines → split on commas + `normalize` + de-duplicate, `lat`/`lng` → `origin`                                                                                                                                                                                                                                                                                                                                         |
| `src/utils/restaurant-search.builder.ts`    | `buildSearchPipeline(criteria, options)`: pure, no I/O, returns `Document[]`. Implements Rules 1–11 (table below). `resolveSort(criteria)` is exported and also used by Step 6 for its notes                                                                                                                                                                                                                                                                                               |
| `src/constants/city-countries.ts`           | Normalized city → ISO country, for the currency rule (decision 2). Generated once from the CSV mapping; a unit test checks it against the data                                                                                                                                                                                                                                                                                                                                             |
| `src/utils/cursor.ts`                       | `encodeCursor(token, criteria)` / `decodeCursor(value, criteria)`: base64url JSON `{ v: 1, t: token, q: fingerprint(criteria) }`. Malformed input, an unknown version or a fingerprint mismatch → `CURSOR_INVALID` (decision 3)                                                                                                                                                                                                                                                            |
| `src/repositories/restaurant.repository.ts` | `search(criteria, page)`: builds the pipeline with its own `tenantId` and the index name, runs it through the injected `SearchExecutor`, and classifies failures with `utils/mongo-errors.ts`: timeout → `SEARCH_TIMEOUT`, unreachable → `SEARCH_UNAVAILABLE`, anything else rethrown (→ 500); logged with the driver code                                                                                                                                                                 |
| `src/repositories/search.executor.ts`       | `MongoSearchExecutor(collection)`: `collection.aggregate(pipeline, { timeoutMS }).toArray()`. The seam the 503 test replaces                                                                                                                                                                                                                                                                                                                                                               |
| `src/utils/application-error.ts`            | Uses the catalog from `change-error-codes.md`: `SEARCH_TIMEOUT` and `SEARCH_UNAVAILABLE` carry `Retry-After: 5`                                                                                                                                                                                                                                                                                                                                                                            |
| `src/services/restaurant.service.ts`        | `list(query)`: criteria, cursor, repository, mapping, `nextCursor`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/mappers/restaurant.mapper.ts`          | `toRestaurantListItem` accepts a search hit (a structural `Pick` of the document) and adds `distanceKm`, rounded to 2 decimals, only when the request had coordinates and the restaurant has a location                                                                                                                                                                                                                                                                                    |
| Controller, routes                          | `GET /` → `controller.list`. Registered above `/:id`, so Step 6's `/search` slots in correctly                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/openapi/*`                             | `GET /v1/restaurants`. Each query parameter is generated from `listRestaurantsQuerySchema.shape`. `ListRestaurantsResponse` (`data: RestaurantListItem[]` with an optional `distanceKm`, `nextCursor: string \| null`); 400, 503 with a `Retry-After` header; no example values                                                                                                                                                                                                            |
| `tests/fixtures/restaurants.fixture.ts`     | About 30 hand-built documents with explicit `_id`s (list below)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/helpers/wait-for-search.ts`          | `waitForSearch(collection, filter, predicate, { timeoutMs: 5000, intervalMs: 100 })`: polls `$search`, never sleeps                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/setup/global-setup.ts`               | Inserts the fixtures under tenant `fixtures`, then waits until `$searchMeta` counts all of them                                                                                                                                                                                                                                                                                                                                                                                            |

### Query parameters (`listRestaurantsQuerySchema`)

| Parameter            | Rule                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `name`               | trimmed, 2–100 characters (ADR-003 Rule 4: under 2 → 400)                                                                  |
| `city`               | trimmed, 1–100 characters                                                                                                  |
| `cuisine`            | comma-separated list, 1–10 non-empty values                                                                                |
| `cuisineMatch`       | `any` (default) \| `all`; only with `cuisine`                                                                              |
| `minRating`          | number 0–5                                                                                                                 |
| `minVotes`           | integer ≥ 0                                                                                                                |
| `minCost`, `maxCost` | number > 0; `minCost ≤ maxCost`                                                                                            |
| `currency`           | ISO 4217, uppercased; must be a currency from the country table                                                            |
| `lat`, `lng`         | both or neither; −90..90, −180..180                                                                                        |
| `radiusKm`           | number > 0 and ≤ 50 (ADR-003 Rule 5: cap 50 → 400, not silently clamped); requires `lat`/`lng`                             |
| `sort`               | `distance` \| `rating` \| `cost`; anything else → 400 (`relevance` is not a client value). `distance` requires `lat`/`lng` |
| `order`              | `asc` \| `desc`; only with `sort=rating` or `sort=cost`. Defaults: rating `desc`, cost `asc`                               |
| `cursor`             | opaque string from `nextCursor`                                                                                            |
| `limit`              | integer 1–100, default 20                                                                                                  |

Unknown parameters → 400, exactly like unknown body keys, so a typo such as `cusine=` does not silently return an unfiltered list. A repeated parameter (`city=a&city=b`, an array after Express's parser) → 400 `Must be a single value`.

### Builder rules (one unit test each)

| #   | Criteria                             | Pipeline                                                                                                                                                             |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | always                               | `compound.filter` starts with `equals tenantId`; every filter goes in `filter`, never a `$match` after `$search` (invariant 8)                                       |
| 2   | city / cuisine any / cuisine all     | `equals norm.city`; `in norm.cuisines`; one `equals norm.cuisines` per value                                                                                         |
| 3   | minRating / minVotes / cost range    | `range rating.average gte`; `range rating.votes gte`; `range cost.averageForTwo gte/lte`                                                                             |
| 4   | any cost filter or `sort=cost`       | `equals cost.currency`: the given currency, else the known city's currency (the schema has already rejected the rest, invariant 12)                                  |
| 5   | explicit `sort=rating` / `sort=cost` | adds `exists` on `rating.average` / `cost.averageForTwo` (invariant 11)                                                                                              |
| 6   | sort resolution                      | name → relevance; else coordinates → distance; else rating (invariant 10)                                                                                            |
| 7   | rating sort                          | `rating.average` (order, `noData: 'lowest'`), `rating.votes` desc, `_id` asc                                                                                         |
| 8   | cost sort                            | `cost.averageForTwo` asc/desc, `_id` asc                                                                                                                             |
| 9   | distance / relevance sort            | `score` desc, `_id` asc; `near` (pivot 1000 m) in `should` is the only scored clause for distance; unknown locations score 0 and come last                           |
| 10  | name                                 | `compound.should [autocomplete name, text name fuzzy {maxEdits 1, prefixLength 2}]`, `minimumShouldMatch 1`; in `must` for relevance, in `filter` for any other sort |
| 11  | coordinates, no city                 | `geoWithin` circle, `radiusKm` or 5 km                                                                                                                               |
| 12  | coordinates + city                   | no radius unless `radiusKm` is given                                                                                                                                 |
| 13  | coordinates                          | `$addFields distanceKm: haversineDistanceKmExpression(origin)` after `$limit` (page only, invariant 14)                                                              |
| 14  | paging                               | `returnStoredSource: true`; `searchAfter` when a cursor is given; `$limit: limit + 1`; `paginationToken: { $meta: 'searchSequenceToken' }`                           |

## Decisions agreed with the author (2026-11-06)

1. **Restaurants without a location come last in every distance order**, explicit or default. `near` is a `should` clause: located restaurants are scored by distance, the others match with score 0 and follow, ordered by `_id`. Without a city, the radius filter cannot include them anyway. Recorded in ADR-003 Rules 2 and 6 and AGENTS.md invariant 11. M1 verifies 0 inversions and unknowns last on Atlas Local.
2. **Currency is required when it cannot be inferred.** With a cost filter or `sort=cost`: use `currency` if given, else the currency of the city's country when the city is in `src/constants/city-countries.ts` (generated from the data, checked against it by a unit test). Otherwise 400 `VALIDATION_ERROR` with a detail on `currency`. There is no INR default. This is checked in the query schema, so it is reported with the other field errors. Recorded in ADR-003 Rule 11 and AGENTS.md invariant 12.
3. **The cursor is bound to its query (option B).** It carries a SHA-256 prefix of the criteria (filters, coordinates, sort, order; not `limit`). A mismatch or an undecodable cursor → 400 `CURSOR_INVALID`, with the message "start again without `cursor`". Recorded in ADR-003 Rule 8 and AGENTS.md invariant 15.
4. **Search failures are classified** (error catalog, `change-error-codes.md`): a timeout (code 50 or the driver's operation timeout) → 503 `SEARCH_TIMEOUT`; unreachable (network or server selection) → 503 `SEARCH_UNAVAILABLE`; both with `Retry-After: 5`. Anything else (for example our own malformed query) → 500 `INTERNAL_ERROR`, logged in full. M1 records which errors Atlas Local actually raises.

## Other decisions and trade-offs

- **Timeouts:** `timeoutMS` (client-side operation timeout) on the aggregate. The driver then sends the remaining budget as `maxTimeMS`, which covers ADR-003 Rule 9's server limit plus a driver-level timeout in one option. M1 checks that a hung `mongot` produces the 503 near 2,000 ms, and that the error is a timeout. If CSOT misbehaves, it falls back to `maxTimeMS` only, recorded in ADR-003.
- **`Retry-After: 5`.** That is the readiness cache window, so a client retrying after it sees the current `/ready` state. A constant, not configuration.
- **`distanceKm` rounded to 2 decimals (10 m)**, in the mapper (presentation), not in the pipeline.
- **`order` with `sort=distance` or no sort → 400.** "Farthest first" has no user need, and an `order` that silently does nothing is a trap.
- **Fixtures live in their own tenant (`fixtures`)**, inserted once by `globalSetup`. Tests that write (POST → list) use their own tenant and clean up, so they never disturb the fixture assertions. Tenant isolation is itself what makes this work, and it is tested.

## API docs

`GET /v1/restaurants`: all query parameters from the Zod schema with descriptions (defaults, the cap, which sort each needs); `200 ListRestaurantsResponse`; `400 ErrorResponse` (`VALIDATION_ERROR`, `CURSOR_INVALID`); `503 ErrorResponse` with a `Retry-After` header. The operation description states the about 1 s search lag after writes. No example values. Route-coverage and response-contract tests are extended.

## Tests

Unit (no database):

- [x] Query schema (`test.each`): each parameter's bounds; `name` with 1 character; `lat` without `lng`; `radiusKm` 50 / 50.1 and without coordinates; `sort=relevance` / `name` → 400; `sort=distance` without coordinates; `order` without a rating or cost sort; `minCost > maxCost`; an unknown currency; `maxCost` without a city or `currency` → `currency` required, with a known city → accepted; an unknown parameter; a repeated parameter; numeric strings are coerced; `limit` 0, 101 and the default.
- [x] `toSearchCriteria`: aliases (`Gurugram`), accents and case, a cuisine list with blanks and duplicates, `origin` from `lat`/`lng`.
- [x] Builder: one test per rule 1–14, asserting the exact `$search` stage, plus combinations: name + `sort=cost` (name in `filter`); city + coordinates + default sort; unknown locations last for implicit and explicit distance (decision 1); currency from city and from the parameter.
- [x] City–country table vs the CSV mapping (every mapped restaurant's `norm.city` is in the table with its country).
- [x] Cursor: round trip; a mismatched criteria fingerprint; malformed base64 or JSON; an unknown version; a different `limit` is still accepted.
- [x] Mapper: list item from a hit with and without `distanceKm`; rounding; a hit without a location → no `distanceKm`.
- [x] Service with a fake repository: fetches `limit + 1`; `nextCursor` null on the last page and the last item's token otherwise.
- [x] Routes (stub service): 400 details; 503 with `Retry-After: 5` and the error envelope, without driver text.
- [x] OpenAPI: route coverage includes `GET /v1/restaurants`; response contract for 200 (with and without `distanceKm`), 400 and 503.

Integration (Atlas Local, `fixtures` tenant), each through Supertest, with `expectDocumentedResponse` on 200s:

- [x] Each filter alone: city (an alias too), cuisine any/all, minRating, minVotes, cost range, name (prefix "gol", typo "goli vada pao").
- [x] Combinations: city + cuisine + minRating; name + `sort=cost` desc.
- [x] Sorts: rating (ties by votes, then `_id`); cost asc and desc (equal costs by `_id`, no-cost excluded); distance (shared coordinates by `_id`).
- [x] Unknown values: explicit `sort=rating` excludes unrated; the default puts them last; with a city, both default and explicit distance put restaurants without a location last (decision 1).
- [x] Currency: a USD restaurant never appears in an INR cost filter; currency from city (Orlando → USD); an explicit `currency`; a cost filter near me without a city or `currency` → 400 on `currency`.
- [x] City + far coordinates → only that city, nearest first, with `distanceKm` equal to `haversineKm` (rounded).
- [x] Radius: the default 5 km excludes a 6 km restaurant; `radiusKm=10` includes it.
- [x] Paging: walk every page with `limit=3`; concatenated equals a single `limit=100` call, with no repeats and no gaps; reusing a cursor with another `sort` → 400 `CURSOR_INVALID`.
- [x] Tenant isolation: the other tenant's restaurant at identical coordinates never appears.
- [x] `sort=distance` without coordinates → 400.
- [x] Search failure: an executor that throws a network error → 503 `SEARCH_UNAVAILABLE`; one that throws code 50 → 503 `SEARCH_TIMEOUT`; both with `Retry-After`, while GET by id on the same app still returns 200; any other error → 500.
- [x] POST → appears in the list (`waitForSearch`, own tenant).

### Fixture set (tenant `fixtures`, plus 1 in `fixtures-other`)

Anchor: Cyber City, Gurgaon (28.4950, 77.0890).

- **Gurgaon, about 12:** distances 0.2 / 0.5 / 1 / 3 / 6 km (radius tests); two at one shared point; Goli Vada Pav No. 1 (Street Food); Summer Pavilion (Chinese); a Street Food place without the dish in its name; one unrated; one without a location; one with no cost.
- **Ties:** two rated 4.2 with 300 votes (`_id` decides); two at cost 800 INR.
- **New Delhi, about 8:** 15–25 km from the anchor; North Indian, South Indian and Cafe; varied ratings and costs.
- **Orlando, 2:** USD costs (currency rule, a city in another country).
- **`fixtures-other`, 1:** at the same point as a Gurgaon fixture (isolation).

## Milestones

| #   | Work                                                                                                                                                        | Check                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Done: decisions 1–4 recorded in ADR-003, RFC-001, AGENTS.md; error catalog done first (`change-error-codes.md`)                                             | —                                                                                                                                                                                                                |
| M1  | Spike on Atlas Local: `near` in `should` scoring and unknowns last; `timeoutMS` on a hung mongot (SIGSTOP); `searchSequenceToken` with `returnStoredSource` | Results added to the ADR-003 Verification table                                                                                                                                                                  |
| M2  | Models, query schema, criteria mapper, city table, cursor                                                                                                   | Unit tests                                                                                                                                                                                                       |
| M3  | Builder (rules 1–14)                                                                                                                                        | Unit tests; 100% branches                                                                                                                                                                                        |
| M4  | Executor, repository `search` with error classification, service, controller, route, error handler `Retry-After`                                            | Unit route tests                                                                                                                                                                                                 |
| M5  | Fixtures, `waitForSearch`, `globalSetup`, integration tests                                                                                                 | `npm run test:integration`                                                                                                                                                                                       |
| M6  | OpenAPI, README (parameters, `curl` examples, known limits), BUILD-PLAN, AI-usage line                                                                      | Contract tests; `/swagger` shows the endpoint                                                                                                                                                                    |
| M7  | Gates and manual check                                                                                                                                      | `lint`, `typecheck`, `format:check`, `build`, `test`, `test:coverage`; Docker test profile; `curl` on the seeded data (brief example 1 as list parameters, Gurgaon near Cyber City, cost sort both ways, paging) |

## Out of scope

The search endpoint and interpreter (`dishes`, `text`, `boostTerms`, `features`: Step 6). `$searchMeta` facets and total counts. Request logging and `explain.ts` (Step 7). A circuit breaker or B-tree fallback (ADR-003 Future enhancements). Response caching.

## Notes after implementation

- **Timeout: `maxTimeMS`, not `timeoutMS`.** The M1 spike paused mongot (SIGSTOP). The driver's `timeoutMS` did not abort the `$search` (it waited 11.6 s, until mongot resumed); `maxTimeMS` aborted at 2,008 ms with code 50. The executor passes `maxTimeMS`, and code 50 maps to `SEARCH_TIMEOUT`. Recorded in ADR-003 Rule 9 and check 38.
- **Unknown locations last (decision 1) verified on the full seed:** Gurgaon + Cyber City returns all 1,118, with the 1,070 located ones in exact order and the 48 unlocated last (check 36). A mutation test (moving `near` back to `must`) fails exactly the two "unlocated last" integration tests.
- **US fixture city is Orlando, not New York.** New York is not in the data; the city table only knows the 141 seeded cities.
- **Blank parameters mean "not given".** `withoutBlankValues` drops them, because `z.coerce.number()` reads `''` as 0. A repeated parameter is a 400 (`invalid_type`).
- **Constants moved to `constants/search.ts`** (default radius, cap, limits) so the builder in `utils/` does not import from `validators/`.
- **`toRestaurantListItem` takes a structural `ListItemSource`** (a search hit or a document) and adds `distanceKm` (rounded to 2 decimals) only when the pipeline computed a number.
- **16 fixtures, not about 30.** Each covers a case: ties on rating, votes and cost; a shared point; unrated, no location, no cost; INR and USD; known distances (points exactly _d_ km due north, so `distanceKm` is exact); another tenant at identical coordinates. They are inserted by `globalSetup`, which waits with `$searchMeta` until all are indexed.
- **Express's JSON parser accepts any `utf-*` charset**, so the 415 charset test uses `latin1`.
- **Verified:** lint, typecheck, format and build are clean. 547 tests pass (472 unit, 75 integration); builder, cursor, schema, repository and service are at 100% lines and branches; 97.8% lines overall. Live on the seeded data: brief example 1 → "Zambar" first, near me ordered with `distanceKm`, cost asc and desc, a typo name, a Dubai cost filter → 400 asking for `currency`, page 2 continues, and a reused cursor → 400 `CURSOR_INVALID`.

# Step 4: POST and GET by id

- **Status:** Done (2026-11-06)
- **Design:** RFC-001 §5 (POST body, detail); ADR-001 Rules 1, 2, 3, 6, 8, 9, 12, 13; ADR-004 (read-your-writes on the primary, code 121 → 500 + `errInfo`); AGENTS.md §6 (errors), §7 invariants 1–7

## Context

Step 3 left a seeded collection, the validator and the search index, but the API serves only `/health` and `/ready`. Step 4 adds the first two business endpoints. They read and write the collection directly, not `$search`, so a client always sees its own write (ADR-001 Rule 13). This step also sets the request-path pattern that Steps 5 and 6 reuse: validator → controller → service → repository → mapper, the error envelope with field-level `details`, tenant injection in the repository, and `maxTimeMS` on reads.

## Approach

### Request flow

```
POST /v1/restaurants
  controller: createRestaurantBodySchema.parse(body)    ZodError → 400 VALIDATION_ERROR + details
  service.create(body)
    countryByIsoCode(code)                              (Zod has already checked it is supported)
    toRestaurantDraft(body, country)                    mapper, pure: norm.*, location, cost.currency, votes 0, schemaVersion
    repository.insert(draft, clock())                   adds _id, tenantId, createdAt = updatedAt
  controller: 201, Location: /v1/restaurants/{id}, toRestaurantDetail(doc)

GET /v1/restaurants/:id
  controller: restaurantIdSchema.safeParse(id)          fails → 400 INVALID_ID
  service.getById(id)  → repository.findById(id)        findOne({_id, tenantId}, {maxTimeMS})
                       → null → 404 NOT_FOUND           (same answer for "missing" and "another tenant's")
  controller: 200, toRestaurantDetail(doc)
```

### Files

| File                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/models/restaurant.model.ts`                                                     | `RestaurantDraft = Omit<RestaurantDocument, '_id' \| 'tenantId' \| 'createdAt' \| 'updatedAt'>` (replaces `NewRestaurant`); `SeedRestaurant = RestaurantDraft & { sourceId }`. `RestaurantRepository` gains `insert(draft, now): Promise<RestaurantDocument>` and `findById(id: string): Promise<RestaurantDocument \| null>`. New `RestaurantService` interface (`create(body)`, `getById(id)`), plus API shapes `RestaurantListItem` and `RestaurantDetail`.                |
| `src/validators/restaurant.schema.ts`                                                | `createRestaurantBodySchema` (`z.strictObject`) and `restaurantIdSchema` (`/^[0-9a-f]{24}$/i`; `ObjectId.isValid` is not used because it also accepts any 12-character string). `CreateRestaurantBody = z.infer<…>`. Rules are listed below.                                                                                                                                                                                                                                  |
| `src/mappers/restaurant.mapper.ts`                                                   | Pure functions. `toRestaurantDraft(body, country)` builds the document from the request with the same helpers as the CSV mapper (`normalizeCity`, `normalizeCuisines`, `parseCoordinates`). `toRestaurantListItem(doc)`, `toRestaurantDetail(doc)` (list item plus the extra fields) and `ratingLabel(average?)`.                                                                                                                                                             |
| `src/services/restaurant.service.ts`                                                 | `DefaultRestaurantService(repository, clock = () => new Date())`. `create`: look up the country, call the mapper, call the repository. `getById`: throw `NOT_FOUND` when the repository returns null. No Express or driver imports.                                                                                                                                                                                                                                           |
| `src/repositories/restaurant.repository.ts`                                          | Constructor `(collection, { tenantId, maxTimeMS })`. `insert` builds `{ _id: new ObjectId(), tenantId, ...draft, createdAt: now, updatedAt: now }`, calls `insertOne`, and returns that document: the validator is strict and the server does not transform it, so this equals what is stored. `findById` converts the string to an `ObjectId` here, so services never see driver types. `upsertManyBySourceId` now filters and `$set`s with `this.tenantId` (see Decisions). |
| `src/controllers/restaurant.controller.ts`                                           | `RestaurantController(service)` with arrow-property handlers `create` and `getById`, the same pattern as `HealthController`.                                                                                                                                                                                                                                                                                                                                                  |
| `src/routes/restaurant.routes.ts`, `routes/index.ts`                                 | `POST /` and `GET /:id`. A comment says Step 6's `/search` must be registered before `/:id`. `Controllers` gains `restaurant`.                                                                                                                                                                                                                                                                                                                                                |
| `src/app.ts`, `models/app.model.ts`, `server.ts`                                     | `AppDependencies.restaurantService`. `server.ts` wires collection → repository (`TENANT_ID`, `QUERY_MAX_TIME_MS`) → service → app.                                                                                                                                                                                                                                                                                                                                            |
| `src/utils/application-error.ts`, `utils/error-response.ts`, `models/error.model.ts` | Optional `details: ErrorDetail[]` (`{ path: string; message: string }`) on `ApplicationError` and in the envelope.                                                                                                                                                                                                                                                                                                                                                            |
| `src/utils/validation-details.ts`                                                    | `toValidationDetails(zodError)`: dotted paths (`features.tableBooking`), and `unrecognized_keys` split into one detail per key (Zod reports those with an empty path).                                                                                                                                                                                                                                                                                                        |
| `src/middlewares/error-handler.ts`                                                   | ZodError → 400 with `details`. Malformed JSON (body-parser `entity.parse.failed`) → 400 `VALIDATION_ERROR`; today it falls through to a 500. For an error that carries `errInfo` (validator code 121), log the full `errInfo` and return the usual 500 `INTERNAL_ERROR`. The handler checks for `errInfo` by narrowing `unknown`, so it does not import the driver.                                                                                                           |
| `src/constants/restaurant.ts`                                                        | `RESTAURANT_SCHEMA_VERSION = 1`, moved from `seed-repairs.ts` (`SEED_SCHEMA_VERSION`) because POST and the seed must write the same version.                                                                                                                                                                                                                                                                                                                                  |
| `src/mappers/restaurant-csv.mapper.ts`, `scripts/seed.ts`                            | `mapCsvRow(row)` no longer takes `tenantId`; the seed passes the tenant to the repository instead.                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/helpers/app.ts` (new)                                                         | `createTestApp(overrides)`: stub dependencies that throw "not used in this test", so the health tests and the new route tests each pass only what they need.                                                                                                                                                                                                                                                                                                                  |
| Docs                                                                                 | RFC-001 §5: the exact detail shape and the `details` format. ADR-001 Rule 9: the repository owns `tenantId`. AGENTS.md §5 (`validators/`, `mappers/` are no longer "later"). BUILD-PLAN boxes and Status. README: endpoints and an AI-usage line.                                                                                                                                                                                                                             |

### POST body rules (`createRestaurantBodySchema`)

| Field                   | Rule                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | string, trimmed, 1–200 characters (200 is the validator's `maxLength`)                                                                                                                 |
| `address`, `city`       | string, trimmed, 1–500 and 1–100 characters                                                                                                                                            |
| `countryCode`           | trimmed and uppercased, then checked with `countryByIsoCode`. Unsupported code → issue on `countryCode` ("unsupported country code")                                                   |
| `locality`              | optional string, trimmed, 1–200 characters                                                                                                                                             |
| `cuisines`              | optional array of 0–20 strings, each trimmed, 1–50 characters. Duplicates are not an error: the mapper de-duplicates them, as the seed does                                            |
| `latitude`, `longitude` | optional JSON numbers (no coercion), −90..90 and −180..180. Only one given → issue on the missing one. Exactly 0 passes validation, and the mapper then omits `location` (invariant 2) |
| `averageCostForTwo`     | optional number > 0. 0 is rejected: a client that does not know the cost omits the field (invariant 1)                                                                                 |
| `priceRange`            | optional integer 1–4                                                                                                                                                                   |
| `features`              | optional `z.strictObject` of optional booleans: `tableBooking`, `onlineDelivery`, `deliveringNow`                                                                                      |

Validation reports every issue in one response, so the client can fix all fields in one go.

### Response shapes

```jsonc
// list item (Step 5 adds distanceKm)
{ "id": "…24 hex…", "name": "…", "address": "Shop 12…", "city": "Gurgaon",
  "country": { "code": "IN", "name": "India" }, "cuisines": ["Street Food"], "averageRating": 3.6 }
// detail = list item +
{ "locality": "Sector 29" | null,
  "location": { "latitude": 28.4595, "longitude": 77.0688 } | null,
  "cost": { "averageForTwo": 300 | null, "currency": "INR", "priceRange": 1 | null },
  "features": { "tableBooking": false | null, "onlineDelivery": true | null, "deliveringNow": false | null },
  "votes": 112, "ratingLabel": "Good" /* "Not rated" when unrated */, "sourceId": 3400341 | null }
```

Rating label bands, from the CSV analysis: below 2.5 Poor; below 3.5 Average; below 4.0 Good; below 4.5 Very Good; otherwise Excellent.

## Decisions and trade-offs

1. **The repository owns `tenantId` (invariant 5).** Today the CSV mapper puts `tenantId` into each document, and the repository trusts it. Step 4 makes the repository the only place the tenant enters: it gets the tenant through its constructor, and every filter and write uses it. A draft type cannot carry a tenant, so neither a client nor the seed can write into another tenant's data. Cost: a small refactor of the Step 3 code (the `mapCsvRow` signature, the fixture helper, the repository test). Its tests must stay green before the new code lands (milestone M1).
2. **Unknown values are `null` in the detail; keys are always present.** This matches `averageRating: null` in the RFC. Clients get a fixed shape and do not have to check whether each key exists. `distanceKm` is still omitted, as the RFC says. API `location` is `{latitude, longitude}`, matching the POST body, rather than GeoJSON, because the API is flat (ADR-001 Rule 7). This adds detail to the API contract, so it is written into RFC-001 §5.
3. **404 for another tenant's id.** The answer is the same as for a missing id, so tenant data cannot be detected by probing ids.
4. **All input validation happens at the edge, in Zod**, including the supported-country check, which is a pure lookup. A client gets every field error in one 400. The service still guards the lookup and throws an internal error if it ever returns undefined, which would mean a bug, not bad input.
5. **The coordinate range is checked twice**, in Zod (for field-level details) and in `parseCoordinates` (the domain rule shared with the seed). A unit test checks that both accept and reject the same boundary values (±90, ±180, just past each).
6. **The service is an interface**, `RestaurantService`. That lets the 400, 404 and 500 behaviour be tested with Supertest and a stub service, with no database: fast unit tests. Integration tests then cover only what needs MongoDB. This deviates from BUILD-PLAN, which lists the 400 cases under integration; one 400 case stays in integration as an end-to-end check that nothing was written.
7. **An injected clock** (`() => Date`) makes `createdAt` and `updatedAt` exact in tests.
8. **Validator rejection (121) → 500, `errInfo` logged** (ADR-001 Consequences, ADR-004). A request that passes Zod but fails `$jsonSchema` is a mapping bug on our side. The integration test that a POST document passes the validator guards against it.
9. **No `maxTimeMS` on `insertOne`.** The `insert` command has none. Writes are bounded by `serverSelectionTimeoutMS`, and `timeoutMS` (client-side operation timeout) is listed as a future enhancement.

## Tests

Unit (no database):

- [x] `validators/restaurant.schema.test.ts` (`test.each`): a minimal and a full valid body; each required field missing; unknown key at the root and inside `features`; latitude without longitude and the reverse; latitude 90 / 90.0001, longitude ±180 / beyond; a numeric string for latitude is rejected (no coercion); cost 0 and below 0; `priceRange` 0, 5 and 2.5; lowercase `in` accepted; unsupported `XX`; an empty or whitespace-only name; 201 characters; more than 20 cuisines; id: 24 hex characters accepted, 23 characters, non-hex and a 12-character string rejected.
- [x] `mappers/restaurant.mapper.test.ts`: the draft has country name and currency from the table (PH → PHP), `norm.city` resolves the alias (Gurugram → gurgaon) while the display `city` stays as given, cuisines are de-duplicated with `norm` aligned, latitude 0 → no `location`, an unknown cost → `cost: { currency }` only, `rating: { votes: 0 }`, `schemaVersion: 1`, no `features` key when none are given. Detail and list item: exact objects for a full document and a minimal one (all nulls); `ratingLabel` bands (`test.each` at 1.8, 2.4, 2.5, 3.4, 3.5, 3.9, 4.0, 4.4, 4.5, 4.9, unrated).
- [x] Zod and `parseCoordinates` agree on the coordinate boundaries.
- [x] `services/restaurant.service.test.ts` with a fake repository: `create` passes the clock's time and a draft without a tenant; `getById` → `NOT_FOUND` on null.
- [x] `utils/validation-details.test.ts`: nested paths and unrecognized keys.
- [x] `routes/restaurant.routes.test.ts` (Supertest, stub service): 400 `VALIDATION_ERROR` with exact `details` (missing field, unknown key, latitude without longitude, bad country, several issues at once); malformed JSON → 400; GET with a bad id → 400 `INVALID_ID` and the service is not called; a service `NOT_FOUND` → 404 envelope; a service error carrying `errInfo` → 500 `INTERNAL_ERROR` with no driver text in the body, and `errInfo` logged (spy on `console.error`).
- [x] Existing health route tests move to `createTestApp`.

Integration (`biteexpress_test`; tenants `api-test` and `api-test-other`, removed in `afterEach`):

- [x] POST 201: the `Location` header equals `/v1/restaurants/{body.id}`; the body is the detail; the stored document (read back from the collection) has `tenantId`, country name and currency, `norm.*`, `rating.votes: 0`, `schemaVersion: 1`, and the clock's `createdAt` and `updatedAt`. This proves that POST documents pass the `$jsonSchema` validator.
- [x] POST with the minimum fields: no `location`, `features` or `cost.averageForTwo` stored; the detail shows nulls and `ratingLabel: "Not rated"`.
- [x] POST → GET returns the same body (read-your-writes, no polling).
- [x] POST with an invalid body → 400, and the tenant has no documents.
- [x] GET of a seed-shaped document → `sourceId`, `votes` and the rating label.
- [x] GET of a well-formed but unknown id → 404; GET of another tenant's id → 404; GET of a malformed id → 400.

## Milestones

| #   | Work                                                                                                             | Check                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Copy this plan to `.ai/plans/step-4-create-and-get.md` and index it                                              | —                                                                                                                                     |
| M1  | Tenant refactor: `RestaurantDraft`, repository constructor, `mapCsvRow(row)`, schema-version constant            | All existing unit and integration tests pass unchanged in meaning                                                                     |
| M2  | Error envelope `details`, `toValidationDetails`, error handler (Zod, malformed JSON, `errInfo`)                  | Unit tests                                                                                                                            |
| M3  | Validator schema and mapper                                                                                      | Unit tests                                                                                                                            |
| M4  | Repository `insert` / `findById`, service, controller, routes, app and server wiring, `createTestApp`            | Unit route tests, then integration                                                                                                    |
| M5  | Manual check: `docker compose up mongo`, `npm run dev`, a `curl` POST then GET, and a GET with someone else's id | Responses as specified                                                                                                                |
| M6  | Docs and gates                                                                                                   | `lint`, `typecheck`, `format:check`, `build`, `test:unit`, `test:integration`, `test:coverage` (mapper, schema and service near 100%) |

## Out of scope

- List and search (Steps 5 and 6). A POST that appears in the list is tested in Step 5 with `waitForSearch`.
- PUT, PATCH and DELETE; idempotency keys for repeated POSTs; checking that a city belongs to its country; `createdAt` and `updatedAt` in the API response (not in the RFC contract).
- 413 for bodies over Express's 100 kB default: it still goes through the generic handler. Noted as open.
- Structured logging (Step 7). Until then the error handler keeps using `console.error`.

## Verification

1. `docker compose up -d mongo`; export `TEST_MONGODB_URI`; then `npm run lint && npm run typecheck && npm run format:check && npm run test:unit && npm run test:integration && npm run test:coverage`.
2. `npm run seed` and `npm run dev`. Then:
   - `curl -i -X POST localhost:3000/v1/restaurants -H 'content-type: application/json' -d '{"name":"Goli Vada Pav","address":"Sector 29","city":"Gurugram","countryCode":"in","latitude":28.4595,"longitude":77.0688,"cuisines":["Street Food","street food"]}'` should return 201, a `Location` header, `city: "Gurugram"`, one cuisine and `ratingLabel: "Not rated"`.
   - GET the `Location` URL; it should return the same body.
   - `GET /v1/restaurants/abc` → 400 `INVALID_ID`; `GET /v1/restaurants/000000000000000000000000` → 404.
3. `docker compose --profile test run --rm test` passes in Docker.

Suggested commit: `feat(restaurants): add POST and GET by id with validation, tenant-scoped repository and error details`

## Notes after implementation

- **Zod 4 skips object refinements once a field is missing.** The latitude/longitude pairing check uses `superRefine(..., { when })` so it still runs on any object, and a single 400 lists every problem. Its unit test ("reports every issue in one response") failed before this change.
- **`countryCode` has no length check.** The country table is the whole rule, so `IND` gets one message ("Unsupported country code") instead of two.
- **Missing required fields say `Required`.** Wrong types say `Must be a string`, `Must be a number` and so on, instead of Zod's longer default messages.
- **The mapper never emits an `undefined`-valued key.** The driver would store it as `null`, and the validator rejects `null`. `features: {}` is therefore omitted, and a unit test walks the draft to check this.
- **`SeedOptions` gained `maxTimeMS`.** The repository constructor requires it. The seed only writes, but the option is passed explicitly rather than hidden in a constant.
- **Manual check (M5) done** on port 3001 against the Compose database: POST → 201 + `Location`, GET returns the same body, `abc` → 400, an all-zero id → 404, a seeded PH restaurant shows PHP. The created document was deleted afterwards, so the dev database is back to the 9,550 seeded documents.
- **Verification:** `lint`, `typecheck`, `format:check` and `build` are clean. 328 tests (278 unit, 50 integration) pass on the host and in `docker compose --profile test run --rm test`. Coverage is 96.3% lines overall and 100% lines on the mapper, schema, service, controller and repository.
- **Open:** a body over 100 kB still gives a 500 rather than a 413.

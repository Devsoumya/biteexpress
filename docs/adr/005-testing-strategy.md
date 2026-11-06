# ADR-005: Testing strategy

Jest with ts-jest and Supertest. 718 tests in two projects.

## Unit tests (no database)

- **Domain helpers:** `normalize`, city aliases, cuisine de-duplication, the country table, coordinate validation, haversine.
- **CSV mapping:** each cleanup rule, plus the whole file mapped in memory (9,550 mapped, 499 without location, 2,147 unrated).
- **Request validation:** the Zod schemas for the POST body and the list and search queries, including every error and its field-level code.
- **Mappers:** document → API shapes, including `null` for unknown values and the rating label bands.
- **The `$search` builder:** one test per rule, on the exact pipeline it produces.
- **The query interpreter:** a table of query → criteria, including the three brief queries, prices, intents, cities, typos, dishes and leftovers.
- **Cursors, error classification, the error catalog, the vocabulary cache and request logging.**
- **HTTP routes with stub services:** every 400, 404, 405, 413, 415 and 503 response shape.
- **Contract tests:**
  - every route is in the OpenAPI document, and every documented route exists
  - real responses match the documented schemas and error codes

## Integration tests (real Atlas Local)

- **API tests** for every endpoint, through Supertest on real `$search`:
  - create, and read-your-writes
  - each filter and each sort, including ties and paging
  - unknown values placed last, and the currency rule
  - city plus coordinates, and tenant isolation
  - the three brief queries end to end
  - 503 when search fails, using an injected search executor that throws, while GET by id still works
  - `/ready`
- **Database contract tests:**
  - the validator accepts a mapped row and rejects bad documents (code 121)
  - the seed is idempotent
  - the collection has exactly the intended indexes
  - the stored search index definition matches the code
  - the search index lifecycle (create, update, unchanged)
- **Repository and script tests:** the upsert, tenant-scoped reads, the vocabulary query, the haversine expression evaluated in MongoDB, and the explain script.

## Totals

Measured 2026-11-07: 718 tests (625 unit, 93 integration); 97.0% line coverage.

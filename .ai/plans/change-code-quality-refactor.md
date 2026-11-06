# Change: code-quality refactor (no behavior change)

- **Status:** Done (approved and implemented 2026-11-06)
- **Design:** none changed. Layer rules in `AGENTS.md` §5; ADR-002 (merge of parsed and explicit parameters), ADR-003 (builder rules 1-11).

## Goal

Make the request path easier to read and defend, without changing any behavior: the API contract, the document shape, the index, the produced `$search` pipelines, the error codes and the log line stay byte-for-byte the same. The existing tests are the proof; they must pass unchanged, apart from one import path.

## Approach

Ordered by value. Each item is behavior-preserving and can be checked on its own.

1. **`mappers/search-criteria.mapper.ts`: remove the duplicated mapping.**
   `toSearchCriteria` and `explicitFields` map the same 15 query fields twice, and the "uses cost → resolve currency" rule is written twice (`usesCost` and `anyCost`/`explicitCost`).
   - One `explicitCriteria(query)` (normalized explicit parameters), used by both the list and the search.
   - One `usesCost(criteria)` and one `currencyFor(criteria, vocabulary)`.
   - `toSearchCriteria` becomes: explicit criteria → currency rule (400 when missing) → drop a currency without a cost use.
   - `toSearchRequestCriteria` (about 80 lines) is split into three named steps: `mergeExplicitOverParsed` (with override notes), `applyCurrencyRule` (filter, preference, or 400), `dropBoostTermsUnlessRelevance`. Exported names and outputs unchanged.

2. **Move `resolveSort` out of the MongoDB builder** into `utils/search-sort.ts` (pure, no driver types).
   It is a domain rule (ADR-003 Rule 3, invariant 10) used by the mapper, `log-safety` and the builder. Today the mapper and the logging helper import it from the module that builds MongoDB pipelines, so application-level code depends on the query-language module. `hasTextClauses` moves with it.

3. **`utils/restaurant-search.builder.ts`: read top-down, one function per rule.**
   - `buildSearchPipeline` first, helpers below in the order it calls them.
   - `filters()` (70 lines) becomes a list of small rule functions (`attributeFilters`, `costFilters`, `sortExistsFilters`, `radiusFilter`, `featureFilters`), concatenated **in today's order**, so every pipeline is identical (the builder tests assert exact arrays).
   - `nameClause` reuses the `FUZZY` constant instead of repeating it inline.

4. **`repositories/restaurant.repository.ts` and `search.executor.ts`: remove casts.**
   - `MongoSearchExecutor` takes `Collection<RestaurantDocument>`, which removes `collection as unknown as Collection<Document>`.
   - `failureCode()` returns a narrow `OutageCode` type; the message table becomes `Record<OutageCode, string>`, which removes the `code in FAILURE_MESSAGES` check and its cast. A new outage code without a message then fails to compile.
   - The vocabulary aggregation pipeline moves to a named, typed helper.

5. **`services/restaurant.service.ts`: one log summary per request.**
   Today `page()` writes the request summary and `search()` then overwrites it. `page()` will only fetch and shape the page; `list()` and `search()` each write the summary once.

6. **`services/readiness.service.ts`: one path instead of two.**
   `probe()` repeats the vocabulary check in two branches. It becomes three small checks (mongo, search index, vocabulary) combined in one place. Same results, same keys.

7. **`services/query-interpreter.service.ts`: split `parseCity`, name the noise rule.**
   - `parseCity` (65 lines, three strategies with early returns) becomes three functions, one per strategy: known city after a preposition, bare known city, one-edit correction after a preposition. Each returns a match; one place applies it.
   - "filler, currency word or amount" is checked identically in `startsNonPlace` and `leftovers`; it becomes `isNoiseWord(word)`.

8. **`server.ts`: the composition root reads as a recipe.**
   `start()` (80 lines) is split into `wireServices(env, logger, client)`, `listen(app, port)` and `registerShutdown(...)`. Same order, same shutdown behavior.

9. **Comments where they are missing.** A short "why" doc comment on the modules and exports that have none today (`createApp`, `routes/index.ts`, `not-found-handler`, `error-response`, `MongoHealthRepository`, `DocsController`, the mapper and builder helpers above). No "what" comments.

## Decisions and trade-offs

- **No behavior change, by construction.** Clause order, object keys that reach a response, error messages and notes stay the same. Cursor fingerprints sort keys before hashing, so internal key order in criteria cannot invalidate cursors.
- **The builder stays in `utils/`.** It builds MongoDB pipelines, so `repositories/` would be a defensible home, but `AGENTS.md` §5 and the ADRs place it in `utils/` as pure, unit-tested logic. Moving it is a structure change for the author to decide, not part of this refactor.
- **Validators, OpenAPI, scripts and `db/` are not touched.** They are long because they are declarative (schemas, documents, index definitions); splitting them would add indirection without making them clearer.
- **Path constants stay where they are** (`RESTAURANTS_PATH` in the controller, used for the `Location` header and by the router). Moving them is churn with no reader benefit.

## API docs

None. No endpoint, parameter or response changes.

## Tests

- [x] All existing unit and integration tests pass with no change to their assertions.
- [x] `resolveSort` tests move from `restaurant-search.builder.test.ts` to a new `tests/unit/utils/search-sort.test.ts` (import path only).
- [x] `npm run lint`, `typecheck`, `format:check`, `test:unit`, `test:integration` (Atlas Local is running), `test:coverage` stays at or above 96.8% lines.
- [x] Same pipelines: checked directly instead of through `npm run explain` (old and new builder compared on 117 shapes; see notes).

## Docs

- [x] `AGENTS.md` §5: add `search-sort.ts` to the `utils/` list.
- [x] `README.md` "AI usage": up to date.
- [x] ADR-003: update any reference to where `resolveSort` lives.

## Out of scope

Any change to the design, the API contract, the document shape, indexes, error codes or log fields; new dependencies; moving files between layers other than `resolveSort`.

## Notes after implementation

- All nine items implemented as planned; no item dropped.
- **Verification.** Lint, typecheck and format pass. 625 unit and 93 integration tests pass (718, the same counts as before), with no assertion changed; the two `resolveSort` tests moved to `tests/unit/utils/search-sort.test.ts`. Coverage 97.0% lines.
- **Side-by-side check.** The tests compare objects regardless of key order, so the old code (from `HEAD`) and the new code were also run on 117 shapes (12 list queries, 16 `q` strings × 7 parameter sets). The interpretation, notes, `interpretation` response body, search criteria, `$search` pipelines, cursor fingerprints and log summaries are byte-identical.
- **One internal difference:** the list endpoint's criteria object now builds its keys in a different order (`cuisineMatch` first, a resolved `currency` last). It is never sent to clients, the cursor fingerprint and the log summary sort keys, and the pipeline is identical, so nothing observable changes and existing cursors stay valid.
- ADR-003 needed no edit: no document named the module that held `resolveSort`.

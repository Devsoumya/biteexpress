# Step 7: Operations polish

- **Status:** Done (2026-11-06)
- **Design:** ADR-004 (Observability, Health/startup/shutdown), ADR-003 (Still to do: `scripts/explain.ts`), RFC-001 §3.3 and §9 (debugging path); AGENTS.md §6 (no `console` once the logger exists)

## Goal

Make the running API operable: structured JSON logs with a request id on every line, one line per request that says what was asked and how long the database took, slow requests flagged, failures logged with their cause, and coordinates and free text never logged raw. Add `scripts/explain.ts`, which measures every request shape with the production query builder against the seeded data and records the numbers in ADR-003. When something is slow or failing, an operator can go from a log line to its query plan.

## Approach

### Request flow (what gets logged)

```
request ─► requestContext (AsyncLocalStorage: requestId, startedAt, dbMs = 0, summary)
             ├─ X-Request-Id: the client's (if valid) or a new UUID; echoed on the response
             ├─ repositories add their measured time to dbMs (every MongoDB call)
             ├─ list/search controllers attach a summary (sort, filter names, result count …)
             └─ on 'finish': ONE line ─► logger
                    info  normal             warn  slower than SLOW_REQUEST_MS
                    debug /health, /ready     error  5xx (with the cause: driver class + code)
```

Example line (list):

```json
{
  "level": "info",
  "time": "2026-11-06T10:00:00.000Z",
  "requestId": "7f9c…",
  "method": "GET",
  "route": "/v1/restaurants",
  "status": 200,
  "durationMs": 24,
  "dbMs": 19,
  "search": {
    "sort": "distance",
    "filters": ["city", "cuisines", "origin"],
    "origin": { "lat": 28.5, "lng": 77.09 },
    "resultCount": 20,
    "hasNextPage": true
  },
  "msg": "request"
}
```

### Files

| File                                                  | Contents                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                        | Runtime dependency **`pino@^10.4.0`** (decision 1). No `pino-http`, no `pino-pretty`                                                                                                                                                          |
| `src/utils/logger.ts`                                 | `createLogger({ level })`: pino with ISO time, the standard `err` serializer, and redaction of `req.headers.authorization` / `cookie` (defensive). `Logger` type re-exported, so the rest of `src` imports ours, not pino's                   |
| `src/utils/request-context.ts`                        | `AsyncLocalStorage<RequestContext>`: `runWithContext`, `currentContext()`, `recordDbTime(ms)`, `setRequestSummary(summary)`. Lets the repository and controllers contribute to the request line without passing a context through every layer |
| `src/middlewares/request-id.ts`                       | Accept `X-Request-Id` if it is 1–128 characters of `[A-Za-z0-9._-]`, else `randomUUID()`; set the response header; start the context                                                                                                          |
| `src/middlewares/request-logger.ts`                   | On `finish`: build the line (method, route template not raw URL, status, duration, dbMs, error code, summary), pick the level, log. The query string is **never** logged                                                                      |
| `src/utils/log-safety.ts`                             | `roundCoordinates({lat, lng})` (2 decimals, about 1 km; ADR-004) and `summarizeCriteria(criteria)` → filter **names**, the resolved sort, rounded origin, radius, page size                                                                   |
| `src/repositories/restaurant.repository.ts`           | Wraps each MongoDB call (`findOne`, `insertOne`, `$search`, vocabulary) in `timed()`, which records its duration in the context. Also logs nothing itself: failures go up as `ApplicationError` with their `cause`                            |
| `src/controllers/restaurant.controller.ts`            | `list` and `search` call `setRequestSummary`: criteria summary, `resultCount`, `hasNextPage`; search adds the interpretation's recognized field names, `notes` count and `qLength`, never `q` itself, at any level (decision 2)               |
| `src/middlewares/error-handler.ts`                    | Uses the request's logger: 5xx logged at `error` with `err` (the cause: driver error class, code, `errInfo` for 121); 4xx carry their `code` in the request line only                                                                         |
| `src/app.ts`, `models/app.model.ts`                   | `AppDependencies.logger`; middleware order: request-id → request-logger → json → routes → 404 → errors                                                                                                                                        |
| `src/server.ts`, `src/services/vocabulary.service.ts` | `console.*` replaced by the logger (startup, listening, shutdown, vocabulary refresh failures); `logger.flush()` on shutdown                                                                                                                  |
| `src/scripts/seed.ts`                                 | Keeps `console` (a CLI's output is for the person running it; AGENTS.md §6 allows it in `scripts/`)                                                                                                                                           |
| `src/config/env.ts`                                   | `SLOW_REQUEST_MS` (default 500). `LOG_LEVEL` already exists                                                                                                                                                                                   |
| `src/scripts/explain.ts`, `npm run explain`           | Decision 7: every request shape through the real builder; `explain('executionStats')` plus timed runs; a Markdown table on stdout; `$indexStats` and the search index status                                                                  |
| `tests/helpers/logger.ts`                             | `captureLogger()`: a real pino logger writing to memory, so tests assert on the parsed log lines (no `console` spies)                                                                                                                         |
| `tests/helpers/app.ts`                                | `createTestApp` passes a silent logger unless a test gives its own                                                                                                                                                                            |

### `scripts/explain.ts`

`runExplain(db, { tenantId, indexName, runs })`, plus a thin `main()`, like the seed. For each shape it takes the shape's **criteria**, builds the pipeline with `buildSearchPipeline` (so the numbers are for exactly what production runs), and then:

- runs `aggregate(pipeline).explain('executionStats')` and extracts:
  - Lucene documents matched (`collectors.allCollectorStats.invocationCounts.collect`)
  - query, collect and sort milliseconds
  - result-materialization milliseconds
  - `mongod`'s `executionTimeMillisEstimate`
- runs the real query `runs` times (default 20, after 3 warm-up runs) and reports the median and p95 wall-clock time, and the result count
- for one shape, runs page 2 with `searchAfter` to show that deep pages cost the same

Shapes, from ADR-003's request table and "Still to do" list:

| #   | Shape                                                                                      |
| --- | ------------------------------------------------------------------------------------------ |
| 1   | No filters (default rating)                                                                |
| 2   | Dense city: New Delhi, default rating                                                      |
| 3   | Gurgaon + North Indian + `minRating` 4, `sort=rating`                                      |
| 4   | Sparse city (the city with the fewest restaurants)                                         |
| 5   | Common cuisine (North Indian) vs rare cuisine (the rarest), `sort=cost` asc and desc (INR) |
| 6   | Near me (Cyber City, 5 km), distance                                                       |
| 7   | Near me, `sort=rating` and `sort=cost`                                                     |
| 8   | Gurgaon + Delhi coordinates (city + far coordinates, distance)                             |
| 9   | Name relevance: `name=pizza`; typo text "goli vada pao"                                    |
| 10  | Search: the three brief queries (as interpreted criteria)                                  |
| 11  | Page 1 vs page 2 (`searchAfter`) for shape 2                                               |

The output is pasted into a new ADR-003 section, "Measured performance (atlas-local)". The numbers are indicative (one laptop, one node), and the section says so.

## Decisions (agreed with the author, 2026-11-06)

Outcome: 1 pino _(author: "what is good for the MVP")_; 2 **changed: `q` is not logged at any level** (no debug variant); 3, 4, 5, 7 as proposed; 6 header only _(author: "best and easy to defend")_.

1. **Install `pino@^10.4.0`** (runtime; MIT; its own dependencies are small, pure JavaScript: `sonic-boom`, `thread-stream`, `pino-std-serializers`, `@pinojs/redact`, …).
   - **Why pino:** it's the standard Node.js JSON logger (Fastify's default). It's fast, with asynchronous writes off the request path. It gives levels, child loggers, a proper error serializer and redaction, and it is what ADR-004 named.
   - **The alternative**, a hand-written JSON logger (about 50 lines), would need its own error serialization, level handling and safe stringification of circular objects. That's exactly the code a library has already hardened.
   - **Not installed:** `pino-http` (our own 30-line middleware controls exactly which fields are logged) and `pino-pretty` (development convenience only).
2. **The raw `q` is not logged at `info`.** Free text can contain personal data ("near my house at 12 …"). The line has what the interpreter recognized (field names, sort), the number of notes and `qLength`. (Author's decision: no debug variant either; `q` is never logged.) Same for coordinates: only rounded to 2 decimals (ADR-004), and the raw query string is never logged.
3. **Probes are logged at `debug`.** Compose calls `/ready` every 10 s, so at `info` every log would be mostly healthchecks. A failing probe is still visible at `warn`, because the readiness 503 is logged.
4. **One line for every request**, not only list and search (ADR-004 names those two). Other requests get the common fields (method, route, status, duration, dbMs, error code); list and search add the `search` block. One consistent access log is easier to query than two formats.
5. **`SLOW_REQUEST_MS` (default 500 ms) → `warn`.** RFC §3.3 mentions a slow-query threshold. 500 ms is well above the measured latencies (tens of milliseconds) and below `QUERY_MAX_TIME_MS` (2,000), so it catches degradation before timeouts.
6. **The request id goes back in the `X-Request-Id` response header, not in the error body.** A client or support engineer can quote it, and the error envelope (an API contract) stays unchanged. A client-supplied id is reused only if it is short and safe, so log lines can't be forged.
7. **DB time is measured in the repository** (`timed()` around each call) **and gathered through `AsyncLocalStorage`.** This is explicit and testable. The alternative, the driver's command monitoring events, reports per-command times but needs to match events to requests, and command events are not reliably in the request's async context.

## Other decisions and trade-offs

- **Route template, not the raw URL** (`/v1/restaurants/:id`): bounded cardinality for log queries, and no query string by construction.
- **`err` on 5xx only:** 4xx are the client's problem and noisy at `error`; their `code` is still in the line (for example `VALIDATION_ERROR`, `CURSOR_INVALID`).
- **The seed script keeps `console`:** it is a CLI and its output is for a person (AGENTS.md §6).
- **Logs go to stdout only** (12-factor). Shipping, retention and alerting are the platform's job (ADR-004 Production mapping).
- **No metrics endpoint** in the MVP: the request line carries what metrics would (duration, dbMs, status, sort), and the platform can derive metrics from logs. Prometheus metrics are listed as a future enhancement.
- **Graceful shutdown** is unchanged: close the server, then the client. The logger is flushed last, and the vocabulary timer stopped first (already done).

## API docs

Every response gains an `X-Request-Id` header. It is documented once in the OpenAPI `info.description`, not as a header on every response. No endpoint changes.

## Tests

Unit (no database):

- [x] `request-id`: valid client ids reused; invalid (too long, bad characters, empty) replaced with a UUID; the header is always set.
- [x] `request-context`: `recordDbTime` adds up across awaits; isolated between concurrent requests; a no-op outside a request.
- [x] `log-safety`: coordinates rounded (and negative values); filter names only, no values; `q` never present, at any level.
- [x] Request logger (Supertest + `captureLogger`):
  - one line per request with the exact fields
  - a list line has the `search` block
  - the query string and raw coordinates are absent (the test searches the serialized line for the raw values)
  - `/health` at `debug`
  - a slow request (injected clock) at `warn`
  - a 4xx carries its code, a 5xx is at `error` with the cause class and code
  - the request id is in the line and the header
- [x] Error handler: a 121 rejection is logged with `errInfo`; driver text never reaches the client (existing tests moved from `console` spies to `captureLogger`).
- [x] `explain` helpers: the shapes build valid pipelines; the stats extraction parses a recorded explain document (a fixture copied from Atlas Local).

Integration (Atlas Local):

- [x] `runExplain` on the fixture tenant for two shapes: rows with matched documents > 0, times ≥ 0, and page 2 present.
- [x] dbMs > 0 in the line of a real list request, and less than or equal to durationMs.

## Milestones

| #   | Work                                                                                                                                                                                                                         | Check                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| M0  | Approve; install `pino`                                                                                                                                                                                                      | `npm ls pino`                                                                              |
| M1  | Logger, request context, request id, request logger, `captureLogger`; app wiring                                                                                                                                             | Unit tests                                                                                 |
| M2  | `timed()` in the repository; list/search summaries; error handler on the logger; `console` removed from `src` (except `scripts/`)                                                                                            | Unit + integration; `grep console src` shows only `scripts/`                               |
| M3  | `scripts/explain.ts`, `npm run explain`                                                                                                                                                                                      | Unit + integration; run on the seed; paste into ADR-003                                    |
| M4  | Docs: ADR-004 (what is logged, fields, levels), ADR-003 (measured performance), RFC §3.3, §9 (debugging path with `npm run explain` and a sample line), §10 (decisions 1–7), README, AGENTS.md §6, BUILD-PLAN, AI-usage line | —                                                                                          |
| M5  | Gates and manual check: `docker compose up --build`, `docker compose logs api` shows JSON lines with request ids; a slow request at `warn` (with `SLOW_REQUEST_MS=1`); a stopped mongot → `error` line with code 50          | `lint`, `typecheck`, `format:check`, `build`, `test`, `test:coverage`, Docker test profile |

## Out of scope

Metrics (Prometheus), tracing (OpenTelemetry), log shipping and retention, the database profiler (documented in the debugging path, not automated), the scale test and load test (stretch).

## Notes after implementation

- **Middleware order is driven by AsyncLocalStorage:**
  - `requestId` runs first and keeps the context on `res.locals`, so even a body that fails to parse gets an id and a line.
  - `express.json()` comes next.
  - `bindRequestContext` comes last, because ALS context does not reliably survive the body parser's stream callbacks. Everything after it (routes, services, the repository's `timed()`) sees the context.
- **One monotonic clock.** A flaky test showed `dbMs` (from `performance.now()`) exceeding `durationMs` (from `Date.now()`, whole milliseconds). Both now use `performance.now()`, which also cannot jump with the wall clock.
- **The error handler no longer logs.** It records `errorCode` and, for 5xx, the cause on the context, so the request line carries the outcome: exactly one line per request. pino's error serializer includes the driver error's `type`, `code` and `errInfo`.
- **Summaries are set by the service**, not the controller, because the service holds the final criteria. The summary carries names and counts only (`utils/log-safety.ts`).
- **Tests:** every `console` spy was replaced by `captureLogger()`, a real pino logger writing to memory. The assertions are now stronger: they check the line's level, `errorCode` and the driver error's class and code. `requestLines()` waits one event-loop turn, because the line is written on `finish`.
- **"Collected", not "matched", in the explain output.** For sorted queries Lucene skips documents that cannot reach the page, so the count can be below the match count (the unfiltered list collects 3,538 of 9,550).
- **`VOCABULARY_REFRESH_MS` (Step 6) and `SLOW_REQUEST_MS` added to `docker-compose.yml` and `.env.example`.** The first was missing from Compose.
- **Live checks** (rebuilt container):
  - Real lines, with generated and client-supplied ids, the rounded origin, `qLength` and no `q`, and `INVALID_ID` on a 400. Probes are hidden at `info`.
  - `SLOW_REQUEST_MS=1` → `warn` with `slow: true`.
  - Mongot paused → the client got 503 `SEARCH_TIMEOUT` with `Retry-After: 5` after 2,019 ms, and the line is at `error` with `MongoServerError` code 50.
- **Measured** (`npm run explain`, recorded in ADR-003): every shape has a median of 0.5–1.9 ms and a p95 of at most 3.8 ms; page 2 costs the same as page 1.
- **Verified:** lint, typecheck, format and build are clean. 716 tests pass (623 unit, 93 integration), also in Docker. 96.6% lines overall; `explain.ts`'s uncovered part is `main()`, which was exercised by real runs.

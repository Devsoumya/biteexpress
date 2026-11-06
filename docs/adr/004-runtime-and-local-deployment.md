# ADR-004: Runtime and local deployment

## Context

Anyone should be able to run everything with one command, without a cloud account, and small changes may be requested live, so rebuilds must be fast. The plain `mongo` image has no `mongot`, so it can't run `$search`.

## Decision

`docker compose up --build` runs three services:

| Service | What it does                                                                                                                      | Starts when        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `mongo` | `mongodb/mongodb-atlas-local:8.0`, pinned by digest: a single-node replica set with `mongot`, so Atlas Search works locally       | Immediately        |
| `seed`  | One-shot. Applies the validator and indexes, upserts the CSV, creates the search index and waits until it's queryable (about 2 s) | `mongo` is healthy |
| `api`   | The service; healthcheck on `/ready`                                                                                              | `seed` exits 0     |

- **No data volume.** Every `down`/`up` starts clean, which keeps demos deterministic. The seed is fast and idempotent.
- **The API never creates indexes or applies the validator.** The seed does, as a migration job would in production. Schema changes need elevated privileges and must not race across API replicas.
- **Connection strings always include `directConnection=true`.** It's required from the host, because the replica set advertises the hostname `mongo`. On Atlas, a `mongodb+srv://` URI replaces it with no code change.
- **All configuration comes from the environment**, validated by Zod at startup (`src/config/env.ts`; the full list is in the README). Tests have their own variable, `TEST_MONGODB_URI`.
- **A `test` profile** runs the whole Jest suite inside the same Compose network.

### Health

- `/health` is liveness, and never touches MongoDB, so a database blip doesn't make the orchestrator restart healthy pods.
- `/ready` checks the MongoDB ping, that the search index is queryable, and that the search vocabulary is loaded. It is cached for 5 s, failures included, so probes don't pile onto a struggling database.

### Observability

- **One JSON line per request** (pino, stdout), with:
  - request id, also echoed in the `X-Request-Id` header
  - method, path (never the query string) and status
  - `durationMs`, and `dbMs`: the time spent in MongoDB, summed across the request's calls
  - for 5xx, the cause, including the driver's error code
- **List and search add** the sort, the filter **names**, the origin rounded to 2 decimals (about 1 km), and the result count.
- **Never logged:** the search text and raw coordinates. Both can be personal data under DPDP and GDPR.
- **Levels:** slow requests (over 500 ms) at `warn`, 5xx at `error`, and the probes at `debug`, so health checks don't drown the log.
- **Debugging path:**
  1. Find the request's line by its id.
  2. Compare `dbMs` with `durationMs`.
  3. Check `/ready`.
  4. Run `npm run explain` for that query shape.
  5. Check the search index status, `$indexStats` and the profiler.

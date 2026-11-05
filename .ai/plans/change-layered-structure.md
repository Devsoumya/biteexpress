# Change: top-level layered structure

- **Status:** Done (layout and framing agreed in conversation, 2026-11-05)
- **Design:** `AGENTS.md` §3, §5; RFC-001 §3.1; ADR-002, ADR-003 file paths; assignment brief §2, §4, §6

## Goal

Reorganise `src/` into top-level layer folders (routes → controllers → services → repositories, interfaces in `models/`, plus `middlewares/`), and describe the project as **the restaurant discovery service, the first service carved out of the legacy monolith (strangler fig)** instead of a "modular monolith". No behavior change.

## Why

- The brief has one domain entity (restaurants) and four endpoints. Per-module folders would add nesting with no boundary behind it.
- The brief's long-term goal is "cloud-native", and BiteExpress today is a "multi-instance monolith". This repository is therefore best presented as one service extracted from it. Inside one service, layering is the standard shape. "General purpose for multiple businesses" comes from `tenantId` and the country/currency model, not from folders.

## Layout

```
src/
  app.ts              createApp(deps): builds controllers, mounts routes and middlewares
  server.ts           composition root: env → Mongo client → repositories → services → app
  config/             env.ts, database.ts
  routes/             index.ts (mounts all), health.routes.ts, restaurant.routes.ts
  controllers/        health.controller.ts            (later restaurant.controller.ts)
  services/           readiness.service.ts            (later restaurant.service.ts, query-interpreter.service.ts)
  repositories/       health.repository.ts            (later restaurant.repository.ts)
  models/             interfaces and types only: app.model.ts, health.model.ts, error.model.ts
                      (later restaurant.model.ts, search.model.ts)
  middlewares/        error-handler.ts, not-found-handler.ts   (later request-id.ts)
  utils/              application-error.ts, error-response.ts  (later normalize, geo, cursor,
                      restaurant-search.builder.ts)
  (later) validators/ restaurant.schema.ts             Zod request schemas (+ their z.infer types)
  (later) mappers/    restaurant.mapper.ts             document ⇄ API shapes
  (later) constants/  countries.ts, lexicon.ts
  (later) db/         restaurant.json-schema.ts, restaurant.search-index.ts (single sources)
  (later) scripts/    seed.ts, explain.ts
```

Rules:

- Routes map paths to controller methods only.
- Controllers parse and validate the request, call a service, and shape the response.
- Services hold the business rules; they know neither HTTP nor the driver.
- Repositories are the only code that talks to MongoDB.
- `models/` holds interfaces and types, with no logic. The exception is Zod-inferred types, which stay with their schema in `validators/`.
- Each seam a test substitutes has an interface in `models/` and a class implementing it (`HealthRepository` / `MongoHealthRepository`, `ReadinessService` / `CachedReadinessService`). `server.ts` wires the real ones.

## Current code mapping

| From                                                                          | To                                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/modules/health/readiness.ts`: `createReadinessCheck` (logic + 5 s cache) | `services/readiness.service.ts`: `class CachedReadinessService implements ReadinessService` with `check()` |
| `readiness.ts`: `mongoReadinessProbes` (ping, `listSearchIndexes`)            | `repositories/health.repository.ts`: `class MongoHealthRepository implements HealthRepository`             |
| `readiness.ts` + `health.routes.ts` types                                     | `models/health.model.ts`                                                                                   |
| `src/modules/health/health.routes.ts` handlers                                | `controllers/health.controller.ts` (`getHealth`, `getReady`) + `routes/health.routes.ts`                   |
| `src/modules/restaurants/restaurant.routes.ts`                                | `routes/restaurant.routes.ts`                                                                              |
| `AppDependencies` in `app.ts`                                                 | `models/app.model.ts` (`{ readinessService: ReadinessService }`)                                           |
| `src/middleware/*`                                                            | `src/middlewares/*`                                                                                        |
| `src/shared/errors/application-error.ts`, `error-response.ts`                 | `utils/`; the interfaces go to `models/error.model.ts`                                                     |
| `pingDatabase` in `config/database.ts`                                        | `MongoHealthRepository.ping()`; `server.ts` pings through the repository at startup                        |

Tests mirror the layout:

- `tests/unit/services/readiness.service.test.ts`
- `tests/unit/routes/health.routes.test.ts` (`/health`, `/ready` with a fake service, `/ready` with an unreachable real repository)
- `tests/integration/repositories/health.repository.test.ts` (ping; index missing on a missing collection)
- `tests/integration/routes/ready.api.test.ts`
- `tests/integration/database.test.ts`

## Docs

- **`AGENTS.md`:** §3 ("restaurant discovery service, layered"), §5 layout and rules, §8 unit description.
- **RFC-001 §3.1:** architecture paragraph: discovery service, strangler fig, layered.
- **ADR-002, ADR-003:** file paths.
- **`.ai/BUILD-PLAN.md`:** Steps 3–6 file paths; Status.
- **README:** new "Architecture" section: layers, and the migration-path answers (why one service, where to split next, what is deliberately not built).
- **Step 0 and 1 plans:** a one-line note that paths changed here; their history is otherwise left as written.

## Tests and verification

No new behavior, so the existing 27 tests are moved or adapted, not removed. Run `lint`, `typecheck`, `format:check`, `build`, `test:unit` (no database), `test:integration` and `test` (Atlas Local), and `docker compose up --build` with `api` healthy, `/health` 200 and `/ready` 503.

## Out of scope

Any behavior change, and the Step 2+ folders, which are created when their first file arrives.

## Notes after implementation

Done on 2026-11-05. No behavior change.

| Check                                         | Result                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lint`, `typecheck`, `format:check`, `build`  | all pass; `dist/` mirrors the new folders                                                      |
| `npm run test:unit`, nothing on 27017         | 22 tests passed                                                                                |
| `npm run test:integration` (Atlas Local)      | 7 tests passed                                                                                 |
| `npm test`, `npm run test:coverage`           | 29 tests passed; lines 83% over `src/`                                                         |
| `docker compose up --build`                   | `api` healthy in 10 s; `/health` 200, `/ready` 503 (`searchIndex: missing`), unknown route 404 |
| `docker compose --profile test run --rm test` | exit 0                                                                                         |

Differences from the plan:

- **Two new integration tests** in `tests/integration/repositories/health.repository.test.ts` (ping; missing index on a missing collection). The repository is now a named layer, so it is tested on its own against Atlas Local. That is why the total went from 27 to 29.
- `pingDatabase` was removed from `config/database.ts`. Startup pings through `MongoHealthRepository.ping()`, and `tests/integration/database.test.ts` runs the `ping` command directly.
- `routes/restaurant.routes.ts` now exports `createRestaurantRouter()` (still empty until Step 4), so every route module is built the same way.
- The Step 0 and Step 1 plans keep their original text, with a note at the top of their implementation notes pointing here.

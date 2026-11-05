# BiteExpress: restaurant discovery API

A REST API for finding restaurants, built on MongoDB with Atlas Search. It comes loaded with 9,550 restaurants from the Zomato dataset. Built with Node.js 22, TypeScript, Express 5 and the official MongoDB Node.js driver, as an MVP for a MongoDB Forward Deployed Engineer take-home.

| Endpoint                         | What it does                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /v1/restaurants`           | Add a restaurant                                                                          |
| `GET /v1/restaurants/{id}`       | Get one restaurant                                                                        |
| `GET /v1/restaurants`            | List restaurants, filtered by name, city, cuisine, rating, cost or distance, and sorted   |
| `GET /v1/restaurants/search?q=…` | Search in plain English, for example "Best restaurants in Gurgaon with South Indian Food" |
| `GET /health`, `GET /ready`      | Liveness and readiness                                                                    |
| `GET /swagger`                   | Interactive API docs (the OpenAPI document is at `/openapi.json`)                         |

## Run the application

### With Docker (recommended)

You need Docker with Compose. From the repository root:

```bash
docker compose up --build
```

This starts MongoDB (Atlas Local), loads the restaurants and builds the search index, then starts the API at **<http://localhost:3000>**. The first run downloads a 2 GB image, so it takes a few minutes (run `docker compose pull` beforehand to avoid the wait); after that it is ready in about 10 seconds.

Check that it is ready, then open the interactive docs:

```bash
curl localhost:3000/ready     # {"status":"ready","checks":{"mongo":"ok","searchIndex":"ok","vocabulary":"ok"}}
open http://localhost:3000/swagger
```

Swagger UI lists every endpoint, and "Try it out" calls the API from the browser. Stop with `docker compose down`; the next `up` starts again from a freshly loaded database.

### On your machine (for development)

You need Docker (for MongoDB) and Node.js 22+:

```bash
docker compose up -d mongo         # just the database
cp .env.example .env
set -a; . ./.env; set +a           # Node does not read .env by itself
npm ci
npm run seed                       # load the restaurants and the search index
npm run dev                        # API on http://localhost:3000, reloads on changes
```

### Run the tests

```bash
npm run test:unit                  # no database needed
npm run test:integration           # needs `docker compose up -d mongo` and the .env loaded as above
```

## Try it

```bash
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Best restaurants in Gurgaon with South Indian Food'
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Restaurants in Gurgaon under Rs. 1000 for two'
curl -G localhost:3000/v1/restaurants/search --data-urlencode 'q=Nearest place that serves Vada Pav' -d lat=28.495 -d lng=77.089
curl 'localhost:3000/v1/restaurants?city=Gurgaon&cuisine=north%20indian&minRating=4&sort=rating'
```

## Configuration

Environment variables, validated at startup in `src/config/env.ts`. The defaults work for local use; `.env.example` has the connection strings.

| Variable                | Default              | Purpose                                                          |
| ----------------------- | -------------------- | ---------------------------------------------------------------- |
| `MONGODB_URI`           | required             | Connection string (with `directConnection=true` for Atlas Local) |
| `PORT`                  | `3000`               | HTTP port                                                        |
| `TENANT_ID`             | `biteexpress`        | Tenant injected into every query                                 |
| `SEARCH_INDEX_NAME`     | `restaurants_search` | Atlas Search index                                               |
| `QUERY_MAX_TIME_MS`     | `2000`               | Server-side time limit on every read                             |
| `BEST_MIN_VOTES`        | `20`                 | Vote floor for "best" in search                                  |
| `VOCABULARY_REFRESH_MS` | `86400000`           | Search vocabulary refresh (24 hours)                             |
| `SLOW_REQUEST_MS`       | `500`                | Requests slower than this are logged at `warn`                   |
| `LOG_LEVEL`             | `info`               | `debug` also shows the `/health` and `/ready` probes             |
| `SEED_CSV_PATH`         | `zomato_data.csv`    | CSV the seed reads                                               |

## Troubleshooting

| Symptom                                     | Cause and fix                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first `up` takes minutes                | The 2 GB image is downloading: run `docker compose pull` beforehand                                                                                             |
| `port is already allocated` (3000 or 27017) | Another process uses the port: stop it, or set `PORT` / `MONGO_PORT` in `.env`                                                                                  |
| `ENOTFOUND mongo` from the host             | The connection string lacks `directConnection=true`. Without it the driver follows the replica set's advertised host `mongo`, which only resolves inside Docker |
| `/ready` is 503 with `searchIndex: missing` | The seed has not run (or ran against another database): `docker compose up seed`, or `npm run seed`                                                             |

## Documentation

- [RFC-001](docs/RFC-001-restaurant-discovery.md): the design, the API contract and the key decisions
- [ADRs](docs/adr/): data model, natural-language search, indexing, runtime, and testing

## AI usage

This project was built with **Claude Code** (Anthropic, model Claude Sonnet 5.5) as a pair programmer, as the brief allows and requires to be disclosed. The author set the scope, made the design decisions, reviewed every change, and can explain and modify all of it.

The work was phased through written plans in [`.ai/plans/`](.ai/plans/), following the build plan in [`.ai/BUILD-PLAN.md`](.ai/BUILD-PLAN.md): tooling, database runtime, domain helpers, seed, create and get, list, natural-language search, operations, and submission, plus a few cross-cutting changes (layered structure, OpenAPI docs, error codes, a code-quality refactor). Claude Code then wrote the code as per the plans

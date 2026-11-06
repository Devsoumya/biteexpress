# RFC-001: Restaurant discovery on MongoDB

## 1. Problem

BiteExpress runs a multi-instance monolith on relational databases in a Gurugram data centre. Discovery (browse, filter, "near me", search) is its most read-heavy, customer-facing path, and it degrades first at peak. The business wants reliability at peak now, and a cloud-native, international, compliant platform within 2–3 years.

This RFC proposes the first service carved out of the monolith: restaurant discovery on MongoDB, with Atlas Search as the query engine. It has to work as a proof of concept, and show a credible path to the long-term goals.

## 2. Goals and non-goals

Goals:

- The four endpoints from the brief: create, get by id, list with filters and sorts, natural-language search.
- Predictable latency under load: every read bounded and served by an index, and fast, explicit failure when a dependency is down.
- A data model that is honest about missing data, works across countries and currencies, and can host more than one business.
- One-command demo, API-level tests against real Atlas Search, and documented decisions.

Not in scope: a frontend, auth, orders, menus and reviews, a live availability store, sharding, the actual migration, an LLM or vector search, and a fallback path for search outages (considered and left out: ADR-003, Search failure).

## 3. Design

One stateless Node.js/TypeScript service (Express 5, the official MongoDB driver, Zod), layered as routes → controllers → services → repositories. Only the repository talks to MongoDB, and it injects the tenant into every query.

The key choice is to split the work between two engines in the same database:

| Request             | Served by                 | Why                                                                                       |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| `POST`, `GET /{id}` | The collection (`mongod`) | Point reads and writes; a client always sees its own write                                |
| List and search     | Atlas Search (`mongot`)   | One index handles any combination of filters and sorts, plus geo, text and typo tolerance |

Options for lists and search:

- **B-tree compound indexes only.** Seven compound indexes and three query paths, and several shapes still sort in memory: `$geoNear` must be first and can't sort by rating, and `$text` can't be combined with it. Rejected.
- **Atlas Search (chosen).** A single `$search` stage with a compound query covers every shape. List items are served from the index's stored source, so peak read traffic lands on the search tier, which scales separately from writes.
- **An external engine fed by CDC.** It works, but it's a second system to run and sync. Rejected.

The price is eventual consistency: the search index follows the collection by about 1 s (measured). That's acceptable for discovery, where writes come from partners and reads from consumers.

## 4. Data model

One document per restaurant (ADR-001):

```jsonc
{
  "_id": ObjectId, "tenantId": "biteexpress", "sourceId": 3400341,
  "name": "Goli Vada Pav No. 1",
  "address": { "line": "…", "locality": "Sector 29", "city": "Gurgaon" },
  "country": { "code": "IN", "name": "India" },
  "location": { "type": "Point", "coordinates": [77.0688, 28.4595] },   // omitted if unknown
  "cuisines": ["Street Food", "Fast Food"],
  "cost": { "averageForTwo": 300, "currency": "INR", "priceRange": 1 }, // amount omitted if unknown
  "rating": { "average": 3.6, "votes": 112 },                           // average omitted if unrated
  "norm": { "city": "gurgaon", "cuisines": ["street food", "fast food"] },
  "features": { … }, "createdAt": Date, "updatedAt": Date, "schemaVersion": 1
}
```

The rules that matter:

- **Absent means unknown.** The CSV uses 0 for "no rating", "no cost" and "no location" (2,148 unrated rows, 497 at 0,0). Storing 0 would corrupt sorts and put restaurants in the Atlantic, so unknown values are omitted, and the API returns `null`.
- **Currency comes from a country table, not the CSV**, whose currency column is ambiguous ("Dollar" for four countries) and wrong for the Philippines.
- **`norm.*` holds canonical filter keys** built by one `normalize()` (case, accents, aliases such as Gurugram → Gurgaon). Name matching is left to the search analyzers.
- **A `$jsonSchema` validator enforces all of this** for every writer, not just the API.

The seed cleans the CSV (one junk row skipped, 5 garbled names repaired, a systematic encoding bug fixed) and upserts on `{tenantId, sourceId}`, so it is idempotent: 9,550 restaurants in about 2 s.

## 5. API

| Endpoint                     | Behavior                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/restaurants`       | Validates (unknown keys rejected), derives country, currency and `norm.*`, inserts; **201** with `Location`                                                                 |
| `GET /v1/restaurants/{id}`   | The full detail; 400 for a malformed id; 404 if missing or another tenant's                                                                                                 |
| `GET /v1/restaurants`        | Filters `name`, `city`, `cuisine`, `minRating`, `minVotes`, cost range, `lat`/`lng`/`radiusKm`; sorts `distance`, `rating`, `cost`; keyset paging (`limit` ≤ 100, `cursor`) |
| `GET /v1/restaurants/search` | `q` in natural language plus every list parameter; returns `interpretation`                                                                                                 |
| `GET /health`, `/ready`      | Liveness (never touches MongoDB); readiness (MongoDB, search index, vocabulary)                                                                                             |

List behavior worth knowing:

- **Filters combine freely with every sort**, and `_id` breaks every tie, so paging is stable.
- **Default order:** relevance with a name, distance with coordinates, rating otherwise.
- **Missing values are placed, not faked:** unrated restaurants come last by default, and an explicit `sort=rating` excludes them. Restaurants without a location come last in a distance order.
- **Location:** without a city, coordinates mean a 5 km radius (50 km max). With a city, the city filters and the coordinates only order the results and add `distanceKm`.
- **Cost queries need a currency** (sent, or the city's). Rupees and dollars are never compared.
- **Items show what was filtered on:** besides name, address, city, country, cuisines and `averageRating`, each item carries `votes`, `ratingLabel`, `cost` (`averageForTwo`, `currency`, `priceRange`) and `features`, with `null` for unknown values, plus `distanceKm` with coordinates. GET by id adds `locality`, `location` and `sourceId`.

Errors use one envelope, `{ "error": { "code", "message", "details"? } }`, with a code for each situation, so clients can react without parsing messages:

| Status                | Codes                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 400                   | `VALIDATION_ERROR` (every field problem listed), `MALFORMED_JSON`, `INVALID_ID`, `CURSOR_INVALID`                                |
| 404 / 405 / 413 / 415 | `RESTAURANT_NOT_FOUND`, `ROUTE_NOT_FOUND` / `METHOD_NOT_ALLOWED` (with `Allow`) / `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 500                   | `INTERNAL_ERROR`: a server bug; the cause is logged, never returned                                                              |
| 503                   | `DATABASE_UNAVAILABLE`, `DATABASE_TIMEOUT`, `SEARCH_UNAVAILABLE`, `SEARCH_TIMEOUT`, with `Retry-After: 5`                        |

The live contract is OpenAPI 3.1 at `/swagger`, generated from the same Zod schemas that validate requests.

## 6. Reliability and operations

- **Bounded reads:** a page size cap, keyset paging, a radius cap, and `maxTimeMS` on every query. The driver's `timeoutMS` does not abort a hung `$search`; `maxTimeMS` does, at 2 s.
- **Failures are specific:**
  - **Search slow or down:** list and search return 503 quickly, while GET by id and POST keep working, because they never touch the search tier.
  - **A missing search index:** it returns empty results rather than an error, so `/ready` checks the index explicitly.
- **Observability:** one JSON log line per request, with a request id, status, total time and time spent in MongoDB, and the filter names. The search text and raw coordinates are never logged. `npm run explain` measures every query shape. On the seed, every shape runs in about 1–2 ms (median), and page 2 costs the same as page 1.

## 7. Running

See the README: one command (`docker compose up --build`), and Swagger at `/swagger`.

## 8. Key decisions

The decisions most worth discussing. The ADRs hold the rest, each with its reason, trade-off and evidence.

| Decision                                                                     | Why                                                                                                  | Trade-off                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Atlas Search for lists and search; the collection for point reads and writes | One index serves every filter × sort; read-your-writes where it matters                              | Lists lag writes by about 1 s                     |
| Absent means unknown, enforced by `$jsonSchema`                              | Zeros corrupt sorts and averages; the validator protects against every writer                        | The API returns `null` and clients handle it      |
| Tenant injected by the repository, from its constructor                      | No caller can choose or forget the tenant                                                            | A config constant until auth exists               |
| Every filter in `compound.filter`, never after `$search`                     | Later stages only see stored fields, so a `$match` silently fails (verified)                         | —                                                 |
| Keyset paging with cursors bound to their query                              | Deep pages are as cheap as page 1; reusing a cursor under another sort returns 400, not a wrong page | No total count, no page numbers                   |
| Unknown values placed last, never faked                                      | An honest order, nothing silently dropped                                                            | Explicit sorts by rating or cost exclude unknowns |
| Cost needs a currency; no INR default                                        | An INR default would make "near me" in Dubai return nothing                                          | Clients outside known cities send `currency`      |
| Rule-based natural-language interpreter, vocabulary from the database        | Deterministic, testable, no API key or network call                                                  | English only; dish matching is approximate        |
| Specific error codes; no fallback in the MVP                                 | Clients know when to retry; the fallback would double the query layer                                | Lists and search are down while search is down    |
| `maxTimeMS`, not the driver's `timeoutMS`                                    | Only `maxTimeMS` aborted a hung `$search` (verified)                                                 | —                                                 |
| Tests against real Atlas Local; no driver mocks                              | The query shapes are the riskiest part; a mock would test the mock                                   | Integration tests need Docker                     |

# ADR-003: Indexing and queries

## Context

The brief asks for filtering and sorting by name, distance, city, rating and cuisine, in any combination. The data shapes the problem:

- **Concentrated:** India is 90.6% of rows and New Delhi 57%.
- **Gaps:** 499 restaurants have no location and 2,147 are unrated.
- **Ties:** 65% of rated rows tie on rating and votes, and 578 restaurants share exact coordinates with another, so every sort needs a final tie-breaker.

## Options

| Option                                                                           | What it takes                                                                                                                                                                                                                                                                                                                                                            | Result     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| B-tree compound indexes only                                                     | A query uses one index, so seven filters × three sorts need seven compound indexes and three routing paths. `$geoNear` must be the first stage and orders only by distance, so "near me, by rating" reads the whole radius and sorts it in memory. `$text` can't be combined with `$geoNear`, so names fall back to anchored regex (prefix only, no typos, no relevance) | Rejected   |
| **Atlas Search for lists and search, the collection for point reads and writes** | One `$search` stage with a `compound` query covers every filter × sort, with geo, fuzzy text and autocomplete built in; point reads keep read-your-writes                                                                                                                                                                                                                | **Chosen** |
| A separate engine (Elasticsearch) fed by CDC                                     | Equivalent querying, but a second system to run, secure and keep in sync                                                                                                                                                                                                                                                                                                 | Rejected   |

## Decision

**Lists and search run on Atlas Search; POST and GET by id use the collection.** One `$search` stage with a `compound` query serves every combination of filters and sorts, with geo, fuzzy text and autocomplete built in. Point reads stay on `mongod`, so they see their own writes.

### The index

One search index, `restaurants_search`, with static mappings (`src/db/restaurant.search-index.ts`):

| Field                                                                     | Mapping                                  | Used for                                              |
| ------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `tenantId`, `norm.city`, `norm.cuisines`, `cost.currency`                 | token                                    | Exact filters                                         |
| `name`                                                                    | string (folding analyzer) + autocomplete | Name filter, typo tolerance, type-ahead, dish phrases |
| `rating.average`, `rating.votes`, `cost.averageForTwo`, `cost.priceRange` | number                                   | Range filters and sorts                               |
| `location`                                                                | geo                                      | Radius filter, distance order                         |
| `_id`                                                                     | objectId                                 | The final tie-breaker                                 |
| `cuisines`, `address.locality`                                            | string                                   | Relevance boosts in search                            |

`storedSource` keeps the list-item fields inside the index, and lists use `returnStoredSource`, so `mongot` serves a page without fetching documents from `mongod`.

The B-tree indexes are just `_id` and `uq_tenant_source` (unique per tenant on `sourceId`, for seed upserts). There is no 2dsphere index and no compound index, because none would be used.

### Query builder rules

One pure function, `buildSearchPipeline(criteria)`, built the same way for list and search:

1. **Every filter goes in `compound.filter`, never in a stage after `$search`.** With stored source, later stages only see stored fields, so a `$match` on `tenantId` silently matches nothing (verified). The tenant filter is always first.
2. **Sorts:**
   - **Distance:** `near` is the only scored clause.
   - **Rating:** `rating.average`, then `votes`.
   - **Cost:** `averageForTwo`, either direction.
   - **Relevance:** the score, then rating.

   `_id` is the final tie-breaker in every sort.

3. **Defaults:** relevance with a name or text, else distance with coordinates, else rating. `sort=distance` without coordinates is a 400.
4. **Name:** autocomplete OR fuzzy text (one edit). It goes in `must` for relevance and in `filter` for any other sort, so it narrows the set without reordering it.
5. **Radius:** coordinates without a city mean a 5 km circle (50 km max), which bounds how many documents Lucene scores. With a city, the city filters and the coordinates only order the results.
6. **Unknown values:**
   - **Rating and cost:** an explicit `sort=rating` or `sort=cost` adds an `exists` filter. The default rating order keeps unrated restaurants, last (`noData: "lowest"`).
   - **Location:** distance always keeps restaurants without a location, last. `near` is a `should` clause, so they still match, with score 0.
7. **Distance output:** `distanceKm` is a haversine computed in `$addFields` for the returned page only (earth radius 6378.1 km, the same as `$geoNear`).
8. **Paging:** keyset paging with `searchSequenceToken` and `searchAfter`. The cursor also carries a fingerprint of the query, so reusing it with other filters or another sort returns 400 instead of a silently wrong page. Default page size 20, maximum 100; one extra item is fetched to know if there's a next page. No total count.
9. **Timeouts:** `maxTimeMS` on every aggregate. Not the driver's `timeoutMS`, which didn't abort a hung `$search` (check 38).
10. **Tenancy:** the repository adds the tenant filter to every `$search` and the tenant predicate to every collection query.
11. **Currency:** cost amounts only compare within one currency. A cost filter or sort uses the `currency` sent, else the city's country currency (from the vocabulary). Otherwise the request is a 400. An INR default was rejected: a cost filter "near me" in Dubai would return nothing.

### Search failure

| Situation                                                   | Behavior                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `mongot` hung or slow                                       | 503 `SEARCH_TIMEOUT` with `Retry-After`, at about 2 s                                   |
| `mongot` unreachable                                        | 503 `SEARCH_UNAVAILABLE` with `Retry-After`                                             |
| Any other `$search` error (a malformed query: a server bug) | 500, logged with the driver code                                                        |
| Search index missing or not built                           | **Empty results, not an error**, so `/ready` checks `listSearchIndexes` for `queryable` |
| GET by id, POST                                             | Keep working: they never use the search tier                                            |

There is no circuit breaker or fallback in the MVP. On `atlas-local`, killing `mongot` takes `mongod` down with it (check 34), so a local fallback would have no database to fall back to. On Atlas, search availability is the job of dedicated Search Nodes with replicas. A fallback would double the query layer for a path the demo never exercises.

## Other alternatives

| Option                                                  | Why not                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Atlas Search plus a circuit breaker and B-tree fallback | Doubles the query layer and adds indexes no normal query uses; on Atlas, Search Nodes cover availability |
| Offset paging                                           | Cost grows with depth; `searchAfter` doesn't                                                             |
| Distance derived from the `near` score                  | Floats and boosts make it inexact; a haversine on 20 rows is cheap and exact                             |

## Consequences

- **Adding a filter is a mapping plus a clause**, not a new compound index.
- **Lists are eventually consistent** with writes (about 1 s). POST and GET by id are not affected.
- **The search tier is a dependency with its own failure mode**, handled explicitly (above) and checked by `/ready`.
- **Sharding:** if it's ever needed, use a hashed component (for example `{country.code: 1, _id: "hashed"}`) with zones per country, because a country or city key would create a hot shard.

## Verification

### Measured performance

`npm run explain` builds each shape with the production builder and times 20 runs. Single-node `atlas-local`, so indicative only.

| Shape                                       | Collected | Median ms | p95 ms |
| ------------------------------------------- | --------: | --------: | -----: |
| No filters (default rating)                 |     3,538 |      1.22 |   1.46 |
| Dense city: New Delhi (page 2: 1.06 ms)     |     3,630 |      1.04 |   1.13 |
| Gurgaon + North Indian + rating ≥ 4         |        41 |      1.21 |   1.51 |
| Near me 5 km, by distance (page 2: 1.40 ms) |       632 |      1.37 |   1.58 |
| Near me 5 km, by rating                     |       552 |      1.43 |   3.84 |
| Name "pizza" (relevance)                    |       248 |      1.15 |   1.49 |
| Brief query 1                               |        37 |      0.96 |   1.22 |
| Brief query 3 (Cyber City)                  |        35 |      1.42 |   1.59 |

Every shape is around 1–2 ms. Page 2 costs the same as page 1, which is the point of keyset paging. Both B-tree indexes show use in `$indexStats`.

# Step 6: Search endpoint (`GET /v1/restaurants/search`)

- **Status:** Done (2026-11-06)
- **Design:** ADR-002 (interpreter, passes, mapping to `$search`, rules, brief examples), ADR-003 (builder, Rules 1–11; the Step 5 decisions on unknown locations, currency and cursors), RFC-001 §5; AGENTS.md §7

## Goal

`GET /v1/restaurants/search?q=…` turns a natural-language query into the same criteria the list endpoint uses, runs it through the same `$search` builder, and returns the list response plus an `interpretation` that shows exactly what was understood, boosted, overridden and ignored. The three brief queries work end to end. The interpreter is a pure, deterministic function with no network call, so `docker compose up` needs nothing external and every rule is a row in a test table.

## Approach

### Request flow

```
GET /v1/restaurants/search?q=Nearest place that serves Vada Pav&lat=28.495&lng=77.089
  controller   searchRestaurantsQuerySchema.parse(query)              q required (1–200 chars) + every list parameter
  service      interpreter.interpret(q, { hasCoords })               → { criteria, notes }       (pure, no I/O)
               mergeExplicit(parsed, explicit params)                → explicit wins, with a note per override
               finalizeCriteria(merged)                              → currency rule, nearest-without-coords, defaults
               decodeCursor / repository.search / encodeCursor       exactly as the list endpoint
  controller   200 { data, nextCursor, interpretation }
```

### Interpreter passes (ADR-002 order; each removes the tokens it uses)

The text is normalized with the shared `normalize()`, then tokenized on whitespace and punctuation, keeping number forms (`1,000`, `1.5k`) and `₹`.

| #   | Pass               | Recognizes                                                                                                                                                                                                                                                                                                              | Produces                                                                                         |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Price              | `under\|below\|less than\|upto\|up to\|within\|max` N; `over\|above\|more than\|min` N; `between A and B`, `A to B`, `A-B`; amounts `1000`, `1,000`, `1k`, `1.5k`; currency words `rs`, `rs.`, `₹`, `inr`, `rupee(s)` → INR, `$`, `usd`, `dollar(s)` → USD; `for two` dropped. `cheap\|budget\|affordable\|inexpensive` | `maxCost` / `minCost`, `currency` if written; `maxPriceRange: 2`                                 |
| 2   | Intent             | `best\|top\|highest rated\|top rated` → rating + `minVotes: BEST_MIN_VOTES`; `nearest\|closest\|near me\|nearby` → distance; `cheapest\|lowest price` → cost asc                                                                                                                                                        | `sort`, `order`, `minVotes`                                                                      |
| 3   | Features           | `online delivery\|delivers\|delivery\|home delivery` → `onlineDelivery`; `table booking\|book a table\|reservation(s)` → `tableBooking`                                                                                                                                                                                 | `features`                                                                                       |
| 4   | City               | `in\|at\|around <city>` or a bare known city; longest phrase first (up to 4 words); aliases via `normalizeCity` (Gurugram, Delhi, Bengaluru, Bombay…)                                                                                                                                                                   | `city`; for `in <unknown>`: the unknown city (empty result) + a note, with a one-edit suggestion |
| 5   | Dishes             | the dish lexicon (`vada pav` → street food, `dosa`/`idli` → south indian, `biryani` → biryani, `momos` → tibetan + chinese, `chaat` → street food, …), matched as **phrases**                                                                                                                                           | `dishes: [{ phrase, cuisines }]`                                                                 |
| 6   | Cuisine            | the 145 cuisines of the data, longest first (32 are multi-word: `south indian`, `street food`, `fast food`…)                                                                                                                                                                                                            | `cuisines` (several → any, with a note)                                                          |
| 7   | Leftovers          | fillers dropped (`restaurant(s)`, `food`, `place(s)`, `serves`, `serving`, `with`, `in`, `for`, `the`, `a`, `that`, `and`, `of`, `some`, `me`); pure numbers dropped; the rest → boost terms                                                                                                                            | `boostTerms` (ranking only, never filters)                                                       |
| 8   | Nothing recognized | the whole query                                                                                                                                                                                                                                                                                                         | `text` (required fuzzy match on name, with autocomplete, plus cuisines and locality)             |

Every pass writes a note for anything it did that a user might not expect ("several cuisines: matching any", "boosting: cyber hub", "nearest needs lat/lng; showing best matches").

### Files

| File                                        | Contents                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/models/search.model.ts`                | `SearchCriteria` gains `features?`, `maxPriceRange?`, `dishes?: { phrase; cuisines }[]`, `text?`, `boostTerms?`. `QueryInterpreter`: `interpret(q, ctx): Interpretation`; `Interpretation` (`criteria`, `notes`); `SearchVocabulary` (`cities`, `cuisines`); `SearchRestaurantsResponse` (list response + `interpretation`)                                                      |
| `src/services/vocabulary.service.ts`        | `CachedVocabularyService(repository, { refreshMs, clock })`: `load()`, `snapshot()`, `refresh()` (after POST), timer started by `server.ts` and stopped on shutdown; keeps the last good snapshot on failure. `MongoRestaurantRepository.vocabulary()`: one aggregation (`$match tenantId`, `$facet` of distinct `{norm.city, country.code}` pairs and distinct `norm.cuisines`) |
| `src/constants/lexicon.ts`                  | Dish → cuisines map, price words, intent words, feature phrases, fillers. Data, not logic                                                                                                                                                                                                                                                                                        |
| `src/services/query-interpreter.service.ts` | `RuleBasedQueryInterpreter({ bestMinVotes })`, `interpret(q, { hasCoords, vocabulary })`: the 8 passes as small private functions over a token list. Pure: no I/O, no clock                                                                                                                                                                                                      |
| `src/utils/edit-distance.ts`                | `withinOneEdit(a, b)` (optimal string alignment, so a transposition counts as one edit: `gurgoan` → `gurgaon`) for the city suggestion                                                                                                                                                                                                                                           |
| `src/utils/restaurant-search.builder.ts`    | New clauses (table below); `resolveSort` also returns relevance for dishes, text and boost terms                                                                                                                                                                                                                                                                                 |
| `src/mappers/search-criteria.mapper.ts`     | `mergeExplicit(parsed, query)` + `finalizeCriteria(criteria, notes)`: explicit parameters override (note per override); the currency rule for parsed prices (decision 2); nearest without coordinates → relevance with a note                                                                                                                                                    |
| `src/validators/restaurant.schema.ts`       | `searchRestaurantsQuerySchema` = the list query fields + `q`. The list's cross-field checks are extracted into a shared function, so both endpoints apply the same rules to _explicit_ parameters                                                                                                                                                                                |
| `src/services/restaurant.service.ts`        | `search(query)`; the interpreter is injected through the constructor                                                                                                                                                                                                                                                                                                             |
| Controller, routes, server                  | `GET /search` registered **above** `/:id`; `server.ts` wires `RuleBasedQueryInterpreter` with `BEST_MIN_VOTES` from env                                                                                                                                                                                                                                                          |
| `src/openapi/*`                             | `GET /v1/restaurants/search`: `q` + the list parameters (generated from the schema); `SearchRestaurantsResponse` with `Interpretation`; 400 / 500 / 503; the three brief queries named in the description (no example values)                                                                                                                                                    |
| `tests/fixtures/search.fixture.ts`          | A second fixture tenant, `search-fixtures` (decision 6)                                                                                                                                                                                                                                                                                                                          |

### Criteria → `$search` (extends the Step 5 builder)

| Criteria        | Clause                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features.*`    | `filter`: `equals features.onlineDelivery true` (and so on)                                                                                                                                                                                           |
| `maxPriceRange` | `filter`: `range cost.priceRange lte` (a tier, no currency needed)                                                                                                                                                                                    |
| `dishes`        | one `compound.should` holding, per dish, `phrase` on `name` + `in` on `norm.cuisines`, `minimumShouldMatch: 1`. In `must` for relevance (a name match scores above a cuisine-only match), in `filter` otherwise (pure distance, rating or cost order) |
| `text`          | `compound.should [autocomplete name, text name fuzzy, text cuisines fuzzy, text address.locality fuzzy]`, `minimumShouldMatch: 1`; `must` for relevance, `filter` otherwise                                                                           |
| `boostTerms`    | `should`: `text` + fuzzy on `name`, `cuisines`, `address.locality`. **Only with relevance**; otherwise dropped with a note, so they never distort a distance, rating or cost order                                                                    |
| sort resolution | explicit `sort` > parsed intent > relevance if name, dishes, text or boost terms > distance with coordinates > rating                                                                                                                                 |

### Interpretation in the response

```jsonc
"interpretation": {
  "query": "Best restaurants in Gurgaon with South Indian Food",
  "city": "gurgaon", "cuisines": ["south indian"], "minVotes": 20,
  "sort": "rating",                 // the resolved order, including "relevance"
  "dishes": [], "boostTerms": [], "features": {},
  "notes": ["ignored: restaurants, with, food"]
}
```

Only the fields that were set appear, plus `sort` and `notes`. Values are the normalized forms the query used, so a client can show "Gurgaon · South Indian · best rated" chips.

## Decisions agreed with the author (2026-11-06)

1. **The vocabulary is loaded from the database (option B).** A `VocabularyService` keeps the tenant's distinct cities (each with its country) and cuisines in memory:
   - **Loaded at startup**, before the API listens.
   - **Refreshed every 5 minutes** (`VOCABULARY_REFRESH_MS`, default 300000; restaurants are not added daily).
   - **Refreshed right after a successful POST** on the instance that handled it.
   - **On a failed refresh**, the last good snapshot is kept and the error is logged.
   - **`/ready` reports `vocabulary`**, so an instance does not take search traffic before its first load.

   The interpreter stays pure: it receives the snapshot as a parameter. The same snapshot supplies each city's country for the currency rule, so Step 5's static `city-countries.ts` and its test are **removed**. The "currency required" check moves from the query schema to the service; it still answers 400 `VALIDATION_ERROR` on `currency`. Staleness across instances is up to 5 minutes. The refresh query scans the tenant's documents: a few milliseconds at 9,550; at about 1M, an index for that query or facets from the search index would replace it (ADR-002 scaling note).

2. **A price in `q` whose currency can't be resolved becomes a ranking preference, not a filter.** Restaurants at or under (or at or over) the amount come first, then the rest, each group in the usual order (distance, relevance or rating). It is built with a constant-score `should` clause that outranks the `near` or text score, and the sort starts with `score`. The amount is read in the restaurants' local currency, which is sound for a near-me radius (≤ 50 km, one country). Note: "no currency given: restaurants within the price first, then the rest; add Rs, $ or `currency=` to filter". When the currency _is_ known (written, a known city, or `currency=`), the price stays a strict filter. Explicit cost parameters still require a resolvable currency (400).
3. **Unknown words never empty the list.** Unrecognized words become boost terms. For `in|at <word>` that is not a known city:
   - **Exactly one known city is one typo away** (optimal string alignment, so a transposition counts as one edit): the search **uses that city**, with the note "showing results for 'gurgaon' (you typed 'gurgoan')".
   - **More than one is** (bangalore vs mangalore from "nangalore"): an empty list with "did you mean bangalore or mangalore?".
   - **None is:** an empty list with "no city 'atlantis'".
4. **Relevance ties break by rating, then `_id`.** The relevance sort becomes `score` desc, `rating.average` desc (`noData: 'lowest'`), `_id`, for the list's `name=` too. Distance, rating and cost sorts are unchanged.
5. **Several dishes or cuisines in one query match any of them**, with a note.
6. **The search tests get their own fixture tenant**, `search-fixtures`.

## Other decisions and trade-offs

- **Intent precedence:** an explicit `sort` beats everything. Otherwise, with coordinates, `nearest` beats `best` beats `cheapest`; each ignored intent gets a note. `best` always keeps its vote floor, so "best vada pav near me" is nearest first among restaurants with at least 20 votes. Without coordinates, `nearest` → relevance (then rating) with the ADR's note.
- **Explicit parameters win** (ADR-002), field by field, with a note such as "city: 'gurgaon' from the query, overridden by city=noida". An explicit `sort=distance` without coordinates is still a 400 on `/search`: explicit parameters are strict, parsed words are lenient.
- **Bare city words are cities** (ADR-002 Pass 4), so "gurgaon south indian" works. Known limit: 74 restaurant names contain "Delhi", 10 of them outside New Delhi, so "Delhi Darbar" filters to New Delhi and boosts "darbar". It still finds the New Delhi branch; the note says what happened, and the README lists it.
- **`goa` vs `goan`:** tokens match whole words only, so the city `goa` never consumes the cuisine `goan`. A test covers both.
- **Cursors** are bound to the _final_ merged criteria, so paging a search works like paging the list: repeat `q` and the same parameters, and add `cursor`.
- **Limits:** `q` is 1–200 characters after trimming (400 `VALIDATION_ERROR` otherwise), at most 10 dishes and 10 boost terms (extra ones are dropped with a note), so a pasted paragraph cannot build a huge query.
- **No LLM interpreter.** It is ADR-002's optional stretch; the `QueryInterpreter` interface leaves room for it.

## API docs

`GET /v1/restaurants/search`: `q` (required) plus every list parameter, generated from the schema with descriptions; `200 SearchRestaurantsResponse` (`data`, `nextCursor`, `interpretation` with every field described); `400` (`VALIDATION_ERROR`, `CURSOR_INVALID`); `500`; `503` (`SEARCH_UNAVAILABLE`, `SEARCH_TIMEOUT`, with `Retry-After`). The description names the three brief queries and says explicit parameters override the query. No example values. Route-coverage and response-contract tests are extended.

## Tests

Unit (no database):

- [x] Interpreter table (`test.each`, query → exact criteria + notes):
  - **Brief queries:** the three, each with and without coordinates.
  - **Prices:** under 1000, below Rs 1,000, ₹1000, 1k, 1.5k, between 500 and 1500, 500-1500, over 300, under $50, cheap, for two.
  - **Intent:** best (vote floor), top rated, nearest with and without coordinates, cheapest, best + nearest.
  - **Features:** online delivery, book a table.
  - **Cities:** aliases (Gurugram, Delhi, Bengaluru, Bombay); in Atlantis (unknown, empty); in gurgoan (corrected); in nangalore (ambiguous: two suggestions, empty); a bare city; a multi-word city (new delhi).
  - **Dishes:** vada pav (phrase + street food), momos (two cuisines), pav alone (not a dish, so a boost and never a prefix).
  - **Cuisines:** multi-word cuisines, several (any), goa vs goan.
  - **Leftovers:** fillers dropped, near cyber hub → boost terms, pure numbers dropped.
  - **Fallback:** "goli vada pao" → whole-query text.
  - **Edge cases:** empty after fillers ("restaurants") → text; limits on dishes and boosts.
- [x] Merge and finalize: each explicit parameter overrides with a note; explicit `sort` beats intent; currency from a written currency, from the city (snapshot), or the price as a ranking preference with a note (decision 2); explicit cost parameters without a resolvable currency → 400 on `currency`; boost terms dropped with a note when the sort isn't relevance.
- [x] Builder: features, `maxPriceRange`, dishes in `must` vs `filter`, text in `must` vs `filter`, boosts only with relevance, the relevance tie-break (decision 4), sort resolution with dishes, text and boosts.
- [x] `withinOneEdit`: insert, delete, substitute, transpose, two edits, empty strings.
- [x] Vocabulary service (fake repository + fake clock): load, refresh on the interval, refresh after POST, a failed refresh keeps the last snapshot, `snapshot()` before the first load. Repository `vocabulary()` against Atlas Local (integration).
- [x] Search query schema: `q` missing, empty, whitespace only, 201 characters; explicit-parameter rules shared with the list.
- [x] Routes (stub service): 400s; 503 with `Retry-After`; `/search` is not taken as an id.
- [x] OpenAPI: route coverage includes `/search`; contract for 200 (with `interpretation`), 400 and 503.

Integration (Atlas Local, `search-fixtures` tenant), each with `expectDocumentedResponse`:

- [x] Brief 1: Gurgaon South Indian restaurants with at least 20 votes, by rating; the 5-vote one is excluded; `interpretation` as expected.
- [x] Brief 2: Gurgaon at or under 1000 INR, default rating order; the 1,200 one and the USD one are excluded.
- [x] Brief 3 with Gurgaon coordinates: pure distance order over "name has vada pav OR street food". Without coordinates: the Goli Vada Pav branches first (name match scores higher), then street food by rating, plus the note.
- [x] "pav" alone never returns Summer Pavilion ahead of a real match (no prefix clause).
- [x] Typo "goli vada pao" → Goli Vada Pav No. 1 first.
- [x] Boost: "south indian near cyber hub" → the Cyber Hub restaurant first; nothing excluded.
- [x] Features: "online delivery in gurgaon" → only delivering restaurants.
- [x] Typo city "in gurgoan" → Gurgaon's restaurants with the correction note; "in atlantis" → empty with a note.
- [x] Price without a resolvable currency near the anchor → within-price restaurants first, then the rest.
- [x] A restaurant POSTed in a new city is recognized in `q` after the post-POST refresh.
- [x] Override: `q=best in gurgaon&city=new delhi` → New Delhi results plus the override note.
- [x] Paging a search with the cursor; a cursor reused with another `q` → 400 `CURSOR_INVALID`.
- [x] Validation: `q` missing or 201 characters → 400. Search failure (throwing executor) → 503.

### Search fixture set (tenant `search-fixtures`)

Gurgaon, near the Cyber City anchor (reusing `north()` from the Step 5 fixtures):

- **Vada Pav:** two Goli Vada Pav branches (Street Food, 0.4 km and 3 km).
- **Street Food:** three without a dish in the name (0.2 km, 1 km, 2 km, varied ratings).
- **Other cuisines:** Summer Pavilion (Chinese); one Chinese/Tibetan place for momos.
- **South Indian:** three, with 300, 25 and 5 votes (vote floor), one of them in the "Cyber Hub, DLF Cyber City" locality.
- **Cost:** 1,200 INR (over the brief-2 limit).
- **Features:** two with `onlineDelivery: true`, one with `tableBooking: true`.

New Delhi: "Delhi Darbar" (North Indian), and one South Indian (override test). Orlando: one USD restaurant at 800 (currency).

## Milestones

| #   | Work                                                                                                                                                                                                                                                                                                                    | Check                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Approve the plan; record decisions 1–6 in ADR-002 (and ADR-003 for the tie-break)                                                                                                                                                                                                                                       | —                                                                                                                                                               |
| M1  | Spike on Atlas Local: the dishes clause (`phrase` + `in` in `must`; name above cuisine-only); the score + rating tie-break sort with `searchSequenceToken`; a constant-score price preference added to `near` (price group first, distance order inside each group); the vocabulary aggregation's time on the full seed | Results added to the ADR-003 Verification table                                                                                                                 |
| M2  | Vocabulary service and repository query, lexicon, `withinOneEdit`, interpreter passes; currency check moved from the schema to the service; `city-countries.ts` removed                                                                                                                                                 | Interpreter unit table                                                                                                                                          |
| M3  | Builder extensions, merge/finalize                                                                                                                                                                                                                                                                                      | Unit tests; builder still at 100%                                                                                                                               |
| M4  | Schema, service, controller, route (above `/:id`), wiring, OpenAPI                                                                                                                                                                                                                                                      | Unit route and contract tests                                                                                                                                   |
| M5  | Search fixtures, integration tests                                                                                                                                                                                                                                                                                      | `npm run test:integration`                                                                                                                                      |
| M6  | README (search section, `curl` for the brief queries, known limits: English only, no negation, dish matching is approximate, vocabulary refresh lag up to 5 min across instances), ADR-002 updates, BUILD-PLAN, AI-usage line                                                                                           | —                                                                                                                                                               |
| M7  | Gates and manual check                                                                                                                                                                                                                                                                                                  | `lint`, `typecheck`, `format:check`, `build`, `test`, `test:coverage`, Docker test profile; the three brief queries and a few free-form ones on the seeded data |

## Out of scope

The LLM interpreter (stretch); synonyms and vector search (ADR-002 Growth path); negation and "and"-versus-"or" semantics; languages other than English; facets; request logging (Step 7).

## Notes after implementation

- **Price preference needs a different bonus per order (ADR-003 checks 41-42).** The spike showed a constant of 1000 next to `near` loses distance precision: Atlas Search scores are 32-bit floats, so 6 inversions appeared inside the within-price group. With 10 there were 0. Text-relevance scores reach about 44 on the seed, so relevance needs a larger bonus. `PRICE_PREFERENCE_SCORE`: distance 10, relevance 1000, rating/cost 1 (the only scored clause, with the sort starting with `score`).
- **The currency check moved from the query schema to the criteria mapper** (it needs the database vocabulary). Consequence: a request with other field errors gets those first; the currency error comes in a second 400 once the fields are valid. It is the same `VALIDATION_ERROR` shape with a detail on `currency`.
- **Explicit vs parsed:** `toSearchRequestCriteria` merges field by field. An explicit sort drops a parsed `order`; explicit cost parameters without a currency are a 400, while a parsed price becomes `pricePreference` and a parsed "cheapest" is dropped, each with a note. A currency without any cost use is dropped.
- **A blank `q=` is `required`**, by the existing "blank means not given" rule.
- **Startup loads the vocabulary before listening** and fails loudly if it can't; afterwards a failed refresh keeps the last snapshot (logged through an injected `onError`, `console.error` until Step 7). The readiness check takes the vocabulary as an optional dependency, so the existing readiness tests are unchanged.
- **The interpreter:**
  - **Words:** works on a `Words` list where each pass marks what it used.
  - **Fillers:** grew during testing: `eats`, `eatery`, `spot(s)`, `joint(s)`, `outlet(s)`. Without them, "cheap eats near me" boosted "eats", which switched the order to relevance and lost distance (found in the live check).
  - **After "in":** a word that starts a cuisine, dish, feature or intent, or a phrase such as "town" or "my area", is not taken as a place.
  - **Dish order:** dishes are listed in lexicon order.
  - **Unknown cuisines:** a dish's cuisines are filtered to the ones the vocabulary knows.
- **Fixtures:** the search tenant's ratings are deliberately not in `_id` order. The first version passed with the relevance tie-break removed, because `_id` order happened to equal rating order. After the change, the mutation fails the brief-3 test as it should. The price-bonus mutation fails the price-preference test.
- **`city-countries.ts` removed;** the currency rule reads the vocabulary snapshot (`currencyForCity(city, cities)`).
- **Verified:**
  - **Gates:** lint, typecheck, format and build are clean. 683 tests pass (593 unit, 90 integration).
  - **Coverage:** 98.1% lines overall; builder, vocabulary service, restaurant service and edit distance at 100%.
  - **Live on the full seed:** brief 1 → Zambar first; brief 2 → Gurgaon at or under 1000 INR by rating; brief 3 with Cyber City coordinates → Goli Vada Pav and street food in exact distance order; brief 3 without coordinates → Vada Pav names first, with the note; "gurgoan" corrected; "nangalore" ambiguous; Cyber Hub boosted first; `/ready` reports `vocabulary: ok`.

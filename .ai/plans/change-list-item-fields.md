# Change: filterable fields in list and search items

- **Status:** Done (2026-11-07; the author asked for the fields filters use in list and search items and approved this plan)
- **Design:** RFC-001 §5 (API contract), ADR-003 (search index `storedSource`), ADR-001 (absent means unknown)

## Goal

A list or search item shows every value the client can filter or sort on, so a client that asks for `maxCost=1000`, `minVotes=50`, `sort=cost` or "cheap places with online delivery" can see why each restaurant matched. Today an item has only `id`, `name`, `address`, `city`, `country`, `cuisines`, `averageRating` and `distanceKm`. Cost, votes, price range and features appear only on GET by id.

## Filter → field

| Filter or sort                                     | Field added to the item                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `minVotes`, `sort=rating` (votes break ties)       | `votes`                                                                                                  |
| `minRating` (already shown as `averageRating`)     | `ratingLabel` (derived, no storage)                                                                      |
| `minCost`, `maxCost`, `currency`, `sort=cost`      | `cost.averageForTwo`, `cost.currency`                                                                    |
| price words in `q` ("cheap" → `maxPriceRange`)     | `cost.priceRange`                                                                                        |
| feature words in `q` ("delivery", "table booking") | `features.onlineDelivery`, `features.tableBooking` (+ `deliveringNow`, so the object matches the detail) |

`name`, `city`, `cuisine`, `lat`/`lng`/`radiusKm` are already covered by `name`, `city`, `cuisines`, `distanceKm`.

## New item shape

Same names, nesting and null rules as the detail response, so the detail becomes "list item + `locality`, `location`, `sourceId`":

```json
{
  "id": "…",
  "name": "…",
  "address": "…",
  "city": "…",
  "country": { "code": "IN", "name": "India" },
  "cuisines": ["North Indian"],
  "averageRating": 4.1,
  "votes": 512,
  "ratingLabel": "Very Good",
  "cost": { "averageForTwo": 800, "currency": "INR", "priceRange": 2 },
  "features": {
    "tableBooking": false,
    "onlineDelivery": true,
    "deliveringNow": false
  },
  "distanceKm": 1.24
}
```

Unknown values are `null` (invariant 1); `distanceKm` stays omitted when not applicable. Purely additive: no field is renamed or removed.

## Approach

- **Search index `storedSource`** (`src/db/restaurant.search-index.ts`): `rating.average` → `rating` (adds `votes`), plus `cost` and `features`. Lists use `returnStoredSource`, so a field not stored is invisible to the page. This keeps pages served by `mongot` alone (no `$lookup`, no extra `find`). Cost: a few small fields per document in the index; the seed's `ensureSearchIndex` sees the changed definition and calls `updateSearchIndex`, then waits until queryable (a few seconds on 9,550 documents). No new B-tree index.
- **Models:** `RestaurantSearchHit` gains `rating.votes`, `cost?`, `features?`. `RestaurantListItem` gains `votes`, `ratingLabel`, `cost`, `features`; `RestaurantDetail` extends it with only `locality`, `location`, `sourceId`.
- **Mapper:** move the `cost`/`features`/`votes`/`ratingLabel` mapping from `toRestaurantDetail` into `toRestaurantListItem`; the detail reuses it.
- **OpenAPI:** move those fields from the detail schema into `listItemShape` in `response.schemas.ts`; the contract tests then check real responses against it.
- **Docs:** RFC-001 §5 list-item shape; ADR-003 `storedSource` paragraph and index definition (with the reason: items show the values they were filtered on); `docs/demo.md` sample output if it shows items.

## Tests

- [x] Mapper unit: a full document and a minimal one (no cost, no features, unrated) → exact list items with `null`s.
- [x] Integration list: an item carries `votes`, `cost` and `features` from the fixture; a fixture without cost shows `cost.averageForTwo: null`.
- [x] Integration search: "online delivery in gurgaon" result items all show `features.onlineDelivery: true`.
- [x] Stored index definition equals the code's (existing test, now with the new fields).
- [x] Response contract (`expectDocumentedResponse`) on list and search with the new schema.
- [x] Existing exact-output assertions updated.

## Out of scope

`locality`, `location` (lat/lng) and `sourceId` stay detail-only: no filter uses them. A `fields=` projection parameter.

## Notes after implementation

- **Detail is now the list item plus `locality`, `location`, `sourceId`.** `toRestaurantDetail` reuses `toRestaurantListItem` for everything else, so the two shapes can't drift apart. The OpenAPI `listItemShape` holds the shared fields, and the response-contract tests check real list, search and detail responses against it.
- **`storedSource` stores the whole `rating`, `cost` and `features` subdocuments**, not single paths. They are small, and the item uses every field in them.
- **Applying the index change:** the seed and the test `globalSetup` compare the stored definition with the code's and call `updateSearchIndex`, then wait until the index is queryable. A running stack keeps the old index until the seed runs again (`docker compose up --build`, or `npm run seed`). Until then, list items show `cost`/`features` as `null` and `votes` is missing.
- **The planned "cheap" search test was not added:** the search fixtures have no `priceRange`. The `cost.priceRange` mapping is covered by the mapper unit tests (both set and `null`).
- **Tests:** 626 unit, 96 integration, all passing.

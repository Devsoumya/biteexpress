# Change: rating and votes on create

- **Status:** Done (2026-11-07; the author asked for POST to accept votes and an average rating, chose rounding to one decimal over rejecting, and a 400 for a rating without votes)
- **Design:** RFC-001 §5 (POST contract), ADR-001 (document shape, Rule 2 "absent means unknown", `$jsonSchema` appendix)

## Goal

`POST /v1/restaurants` accepts an optional `averageRating` and `votes`, so a restaurant moved over from another system (for example, the legacy monolith) keeps its rating. Today the server always stores `rating: { votes: 0 }`, and any rating key in the body is a 400 for an unknown key.

## Request fields

Field names match the response (`averageRating`, `votes`), and the body stays flat like the rest of the request.

| Field           | Rule                                                                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `averageRating` | Optional JSON number, `> 0` and `≤ 5`, **rounded half-up to one decimal place** (as in the CSV): 4.45 → 4.5, 3.449 → 3.4. Omitted means unrated: no `rating.average` is stored (invariant 1). 0 is a 400 ("omit it when unrated"), the same as `averageCostForTwo`; a value that rounds to 0 (below 0.05) is a 400 too |
| `votes`         | Optional JSON integer, `0` to `2,147,483,647` (int32). Default `0`                                                                                                                                                                                                                                                     |
| Pairing         | `averageRating` requires `votes ≥ 1`: an average of no votes means nothing. A missing `votes` with a rating → 400 on `votes` ("Required when averageRating is given"). `votes` without `averageRating` is valid (1,054 CSV rows: 1–3 votes, not yet rated)                                                             |

Why the int32 cap: the driver stores a whole JS number as int32 when it fits, otherwise as a double. The validator allows only `int`/`long`, so a larger value would pass Zod and then fail the `$jsonSchema` validator (code 121, a 500). The cap turns that into a 400.

No minimum vote count for a rating (the source publishes one from 4 votes). That is the source system's rule, and it isn't needed for a correct order here.

## Approach

- **Validator** (`src/validators/restaurant.schema.ts`): add the two fields with `.describe()` text. The bounds are checked on the input (`abort`, so 0 gets one message), then `.overwrite()` rounds. `.overwrite()` keeps the type a number, so the generated JSON Schema still shows the bounds. Rounding happens at the edge, so the mapper, the stored document and the 201 body all hold the rounded value. Put the pairing check in the existing `superRefine`, next to the latitude/longitude check, so one 400 lists every problem.
- **Mapper** (`toRestaurantDraft`): `rating: { ...(averageRating && { average }), votes: body.votes ?? 0 }`. The "votes start at 0" comment changes.
- **No change** to the `$jsonSchema` validator (it already allows `average` in (0, 5] and `votes` ≥ 0), the search index (`rating` is already in `storedSource`), the builder, or the response shapes.
- **OpenAPI:** the request schema is generated from Zod, so it updates itself. The POST description in `openapi.document.ts` ("derives … `votes: 0`") is reworded.
- **Docs:**
  - RFC-001 §5 POST row.
  - ADR-001: a new rule saying rating is client-supplied on create, the pairing rule, the int32 cap, and the trade-off below.
  - RFC-001 §8: a row for this decision.
  - The Step 4 plan stays as history; this plan records the change.

## Trade-off (written into ADR-001)

Whoever can POST can now set a high rating and push a restaurant up in `sort=rating` and "best …" searches. That is acceptable in this MVP because there is no authentication: every caller is already trusted to create listings. With auth, `rating` would be limited to an import/admin role, or owned by a future ratings service that updates it from reviews. A rated POST shows up in rating-sorted lists once the search index catches up (~1 s, invariant 18), like any other write.

## Tests

- [x] Schema unit (`tests/unit/validators/restaurant.schema.test.ts`), `test.each`:
  - accepts: 4.1 with 120 votes; 5 with 1 vote; 0 votes alone; votes alone.
  - rounds: 4.45 → 4.5, 1.05 → 1.1, 3.449 → 3.4, 0.05 → 0.1, 4 → 4.
  - rejects with the `path` and message: 0, 5.1, -1 and 0.04 on `averageRating`; `"4.1"` (a string); 1.5, -1 and 2,147,483,648 on `votes`; a rating with `votes: 0`; a rating without `votes`. A body with several problems lists them all.
- [x] Mapper unit: a rating with votes → `rating: { average: 4.1, votes: 120 }`; votes only → `{ votes: 3 }`; neither → `{ votes: 0 }` (existing test).
- [x] Integration POST: a rated restaurant is stored with `rating.average` and `votes` (read back from the collection, so it passes the validator). The detail shows `averageRating`, `votes` and `ratingLabel: "Very Good"`. 400 on a rating without votes.
- [x] Integration list: after `waitForSearch`, a rated POST appears in `sort=rating` in the right place, and an unrated one doesn't.
- [x] Response contract (`expectDocumentedResponse`) on the new POST responses; the generated OpenAPI request schema includes both fields with no examples.

## Out of scope

Updating a rating after creation (no PUT/PATCH), recomputing averages from individual reviews, an idempotency key, and restricting rating to a role.

## Notes after implementation

- **Rounding at the edge:** `.gt`/`.lte` (with `abort`) check the value sent, `.overwrite()` rounds it, and a `refine` rejects a value that rounds to 0. The generated OpenAPI still shows `exclusiveMinimum: 0, maximum: 5`. Values from 5.0 to 5.04 can't occur, because the bound is checked before rounding.
- **Detail codes:** a rating without votes → `required` on `votes`; with `votes: 0` → `too_small` on `votes`; rounds to 0 → `too_small` on `averageRating`.
- **`fullCreateBody` now carries `averageRating: 4.1, votes: 120`**, so the main POST integration test proves that a rated document passes `$jsonSchema`. A whole-number rating (`4`, stored as int32) is tested separately.
- **The sort=rating test polls the default list** until all 3 posts are indexed. `searchCount` takes a `Collection<Document>`, and the default list includes unrated restaurants.
- **Docs:** ADR-001 Rule 14 (rules, int32 cap, trade-off), RFC-001 §5 POST row and a §8 row, and the OpenAPI POST description. README unchanged (it lists endpoints, not body fields).
- **Not done here:** the running API container still serves the old code until `docker compose up --build`.
- **Tests:** 681 unit, 101 integration, all passing; lint, typecheck and format clean (except your untracked `.ai/study/` notes).

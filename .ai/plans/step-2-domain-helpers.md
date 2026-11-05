# Step 2: Shared domain helpers (pure, unit-tested)

- **Status:** Done
- **Design:** ADR-001 Rules 2, 3, 4, 6, 12 (the rules JSON Schema cannot express); ADR-002 §City (aliases); ADR-003 rule 7 (distance output); AGENTS.md §5 (layout), §7 invariants 1–4

## Goal

Pure, dependency-free functions for:

- canonical text keys (`normalize`, `normalizeCity`, `normalizeCuisines`)
- the supported-markets table
- coordinate validation into GeoJSON
- haversine distance, both in TypeScript and as a MongoDB aggregation expression

Each one is the single source for its rule, is used unchanged by the seed, the API and the query builder, and is proven by table-driven tests.

## Approach

### Files (layered layout)

| File                             | Contents                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/models/geo.model.ts`        | `LatLng { lat; lng }`, `GeoPoint { type: 'Point'; coordinates: [lng: number, lat: number] }`, `CoordinatesResult` (discriminated union below)                                                                                     |
| `src/models/country.model.ts`    | `Country { isoCode; name; currency; seedCode }`                                                                                                                                                                                   |
| `src/models/restaurant.model.ts` | `NormalizedCuisines { display: string[]; norm: string[] }`. It starts here; Step 3/4 add the document types.                                                                                                                      |
| `src/constants/city-aliases.ts`  | `CITY_ALIASES: ReadonlyMap<string, string>`, keys and values already normalized: `gurugram→gurgaon`, `delhi→new delhi`, `bengaluru→bangalore`, `bombay→mumbai`, `calcutta→kolkata`, `madras→chennai`. Step 6's lexicon reuses it. |
| `src/constants/countries.ts`     | `COUNTRIES: readonly Country[]`, the 15 markets (data only)                                                                                                                                                                       |
| `src/utils/normalize.ts`         | `normalize`, `normalizeCity`, `splitCuisines`, `normalizeCuisines`                                                                                                                                                                |
| `src/utils/country.ts`           | `countryBySeedCode(code: number)`, `countryByIsoCode(code: string)` → `Country \| undefined`; maps built once from `COUNTRIES`                                                                                                    |
| `src/utils/geo.ts`               | `EARTH_RADIUS_KM = 6378.1`, `parseCoordinates`, `haversineKm`, `haversineDistanceKmExpression`                                                                                                                                    |

None of these import Express, the driver (except a `Document` type) or `process.env`.

### Function contracts

- **`normalize(value: string): string`**: NFD, strip combining marks (`/\p{M}/gu`), `toLowerCase()` (locale-independent, so Turkish locale bugs can't happen), collapse `\s+` to one space, trim.
  - Examples: `'  São   Paulo '` → `'sao paulo'`, `'İstanbul'` → `'istanbul'`, `'Brasília'` → `'brasilia'`.
- **`normalizeCity(value: string): string`**: `normalize`, then resolve through `CITY_ALIASES`.
  - Example: `'Gurugram'` → `'gurgaon'`.
  - Display `address.city` keeps the client's spelling; only `norm.city` is canonical.
- **`splitCuisines(raw: string): string[]`**: split on `,` and trim, dropping empty entries. Used by the seed (Step 3) on the CSV column.
- **`normalizeCuisines(values: readonly string[]): NormalizedCuisines`**:
  - trims display values, drops blanks;
  - de-duplicates by normalized key, keeping the **first** display spelling and the input order;
  - `norm[i] === normalize(display[i])`.
  - Example: `['North Indian', 'north indian ', 'Chinese']` → `display ['North Indian','Chinese']`, `norm ['north indian','chinese']`.
- **`parseCoordinates(lat: number, lng: number): CoordinatesResult`**, where
  ```ts
  type CoordinatesResult =
    | { kind: 'point'; point: GeoPoint } // valid → [lng, lat]
    | { kind: 'unknown' } // either axis exactly 0 (ADR-001 Rule 3)
    | { kind: 'invalid'; reason: string }; // NaN/Infinity, lat ∉ [-90,90], lng ∉ [-180,180]
  ```
  One function serves both callers, as ADR-001 Rule 3 requires:
  - the **seed** omits `location` for `unknown` and `invalid`;
  - **POST** (Step 4) omits it for `unknown` and returns 400 for `invalid`.
- **`haversineKm(a: LatLng, b: LatLng): number`**: `2R·asin(√(sin²(Δφ/2) + cos φ1 cos φ2 sin²(Δλ/2)))`, R = 6378.1.
- **`haversineDistanceKmExpression(origin: LatLng, coordinatesPath = '$location.coordinates'): Document`**: the same formula built with `$degreesToRadians`, `$sin`, `$cos`, `$asin`, `$sqrt`, `$pow` and `$arrayElemAt` (index 0 = lng, 1 = lat).
  - A document without `location` evaluates to `null`, so the mapper can omit `distanceKm` (Rule 2).
  - Rounding is the mapper's job (Step 5).

### Implementation order

1. Models and constants (no logic).
2. `normalize.ts` and its tests.
3. `country.ts` and its tests (including table-integrity tests).
4. `geo.ts`: `parseCoordinates` and `haversineKm` with unit tests, then the expression with its unit test and the one integration test.
5. Docs and gates.

Each check: `npm run test:unit -- --watch` while coding; `npm run lint && npm run typecheck`.

## Decisions and trade-offs

- **Discriminated union instead of `GeoPoint | undefined`.** Seed and POST must treat "unknown" (0) and "invalid" (out of range) differently: omit in both, but POST rejects invalid input. A boolean or `undefined` would lose that distinction, and the union makes the caller handle every case (exhaustive `switch`).
- **Aliases live in `constants/`, keyed by normalized form.** They're data, not logic, and Step 6's lexicon needs the same table. Two extra aliases beyond ADR-002 (`calcutta`, `madras`) are common spellings for cities that are in the data. **No alias for a city not in the data.**
- **Aliases resolve `norm.city` only.** The display city stays as the client sent it. This follows ADR-001 Rule 4: the canonical key is derived, the presentation is not rewritten.
- **First display spelling wins on duplicate cuisines**, keeping order. This is deterministic and keeps the client's casing.
- **Country names use ISO 3166-1 English short names** ("Türkiye", "United Kingdom", "United States", "United Arab Emirates"). The stored name is for analytics (ADR-001 Rule 6), so it should match a standard. `countryByIsoCode` is case-sensitive (uppercase); Zod uppercases at the edge in Step 4.
- **Distance is tested in two ways.**
  - `haversineKm` is unit-tested against known values. One degree of longitude on the equator is 6378.1·π/180 = 111.3195 km; antipodes are π·R = 20037.39 km; distance is symmetric; and a point to itself is 0.
  - The aggregation expression is unit-tested for its exact shape, **and** gets one integration test. It evaluates the expression in Atlas Local with `db.aggregate([{ $documents: [...] }, { $addFields: { d: expr } }])` (no collection or index needed) and checks the result against `haversineKm` to 1e-9 km, plus `null` for a document without `location`. A shape-only test can't catch a wrong formula, and this test runs in under 50 ms. It's the only Step 2 test that needs MongoDB.
- **No Unicode beyond NFD folding.** For example, Turkish dotless `ı` stays `ı`. None appear in the data. Input length is bounded by Zod at the edge (Step 4), so the regex work is bounded.
- **Garbled source text is not repaired here.** The repair maps (3 cities, 2 cuisines) are seed concerns (Step 3), because they fix one file's encoding damage and aren't a general rule.

## Tests

Unit (`tests/unit/utils/`, `tests/unit/constants/`; `test.each` tables, exact outputs):

- [x] `normalize.test.ts`
  - [x] `normalize`: case; accents (`São Paulo`, `Brasília`, `Döner`); `İstanbul`; internal and leading/trailing whitespace including tabs and NBSP; empty string; already-normalized input is unchanged (idempotent)
  - [x] `normalizeCity`: every alias, spelled with mixed case and spaces; non-alias cities unchanged; `New  Delhi` → `new delhi`; an alias target maps to itself
  - [x] `splitCuisines`: `'North Indian, Chinese'`; extra spaces; trailing comma; blank → `[]`
  - [x] `normalizeCuisines`: duplicate by case or whitespace (first spelling kept); order preserved; blanks dropped; `[]`; accented cuisine; property `norm[i] === normalize(display[i])` over a sample
- [x] `country.test.ts`
  - [x] each of the 15 seed codes → its ISO code and currency (`test.each` over the ADR-001 Rule 6 list; 162 → PH/PHP; the four "Dollar" countries → AUD/CAD/SGD/USD)
  - [x] ISO lookup returns the same entry
  - [x] unknown seed code, unknown ISO code and lowercase `in` → `undefined`
  - [x] table integrity: 15 entries, unique seed and ISO codes, currency matches `/^[A-Z]{3}$/`
- [x] `geo.test.ts`
  - [x] `parseCoordinates`:
    - valid point → `[lng, lat]` order
    - `(0,0)`, `(28.5,0)`, `(0,77.1)` → unknown
    - lat 90.0001 / -90.0001, lng 180.0001 / -180.0001 → invalid
    - boundaries ±90, ±180 → valid
    - `NaN` and `Infinity` → invalid
  - [x] `haversineKm`: the known values above; Gurgaon → Connaught Place (a sanity range, 25–30 km)
  - [x] `haversineDistanceKmExpression`: exact expression object for one origin, and the custom `coordinatesPath`

Integration (Atlas Local, `biteexpress_test`):

- [x] `tests/integration/utils/geo-expression.test.ts`: the expression equals `haversineKm` for 5 point pairs (including the antimeridian and near-pole cases) within 1e-9, and is `null` when `location` is absent

**Verification:**

```
npm run test:unit            # no database
docker compose up -d mongo && set -a && . ./.env.example && set +a
npm run test:integration && npm test && npm run test:coverage   # utils/normalize, country, geo at 100% lines
npm run lint && npm run typecheck && npm run format:check && npm run build
```

**Acceptance:**

- All of the above pass, with 100% line coverage on `normalize.ts`, `country.ts` and `geo.ts`.
- No I/O or `process.env` in the new files.
- BUILD-PLAN boxes ticked, these notes filled in, and an AI-usage line in the README.

## Out of scope

- CSV parsing and row mapping, plus the city and cuisine repair maps (Step 3)
- Zod schemas (Step 4)
- `distanceKm` rounding and the mapper (Step 5)
- The lexicon beyond aliases (Step 6)
- Cursor encoding (Step 5)

## Notes after implementation

Implemented and verified on 2026-11-05.

| Check                                         | Result                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:unit` (nothing on 27017)        | 131 tests passed (109 new: normalize 44, country 39, geo 26)                                                                                           |
| `npm run test:integration` (Atlas Local)      | 13 passed; the expression equals `haversineKm` to < 1e-9 km on all 5 pairs (including the antimeridian and near-pole cases); `null` without a location |
| `npm test` / `npm run test:coverage`          | 144 passed; `normalize.ts`, `country.ts`, `geo.ts`, `countries.ts`, `city-aliases.ts` at 100% lines and branches; 89% lines overall                    |
| `lint`, `typecheck`, `format:check`, `build`  | all pass                                                                                                                                               |
| `docker compose --profile test run --rm test` | exit 0, 144 passed                                                                                                                                     |
| Purity                                        | the new files import no Express, no `process.env`, and from `mongodb` only the `Document` type                                                         |

Differences from the plan:

- **`$isArray` guard in the expression.** The planned `null`-propagation was not enough: the clamp `$min: [1, …]` (needed because rounding can push the haversine term above 1 at antipodes, making `$asin` return NaN) ignores nulls and would have turned a missing location into a distance. The expression is wrapped in `$cond` on `$isArray`, and a comment explains why. `haversineKm` clamps the same way, with `Math.min`.
- **The origin is precomputed in radians in TypeScript** (constants in the expression) instead of `$degreesToRadians` on literals. It is the same value, the expression is smaller, and a unit test checks it.
- `parseCoordinates` checks range **before** the 0 rule, so `(0, 200)` is `invalid`, not `unknown`; a test covers this. `-0` counts as 0.
- Tests live in `tests/unit/utils/` only; the table-integrity checks sit in `country.test.ts` instead of a separate `tests/unit/constants/` folder.

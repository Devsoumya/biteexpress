# Change: OpenAPI document and Swagger UI

- **Status:** Done (2026-11-06; the author chose "always on" and delegated the UI choice)
- **Design:** RFC-001 §5 (API contract); AGENTS.md §5 (layers), §9 (definition of done)

## Goal

`http://localhost:3000/swagger` (and `/`, which redirects there) shows every endpoint with its request and response contracts, and can call them ("Try it out"). Every later step keeps it current, and tests fail when an endpoint is undocumented or the docs drift from real responses.

## Approach

| Piece            | Where                                                     | How                                                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request schemas  | `src/validators/*.schema.ts` (already exist)              | Converted with Zod 4's built-in `z.toJSONSchema(schema, { io: 'input' })`. The docs are the validators, so they cannot drift                                                                                                                                                 |
| Response schemas | `src/openapi/response.schemas.ts`                         | Zod `strictObject`s for the error envelope, health, readiness, list item and detail. Documentation only: they are not used at runtime; tests check real responses against them                                                                                               |
| Document         | `src/openapi/openapi.document.ts`                         | `buildOpenApiDocument()`: pure, OpenAPI **3.1** (its schema dialect is JSON Schema 2020-12, which Zod emits natively). No `servers`, so "Try it out" calls the host that served the page. No example values: Swagger UI shows each body as type placeholders from the schema |
| Serving          | `controllers/docs.controller.ts`, `routes/docs.routes.ts` | `GET /openapi.json`; `GET /swagger`, our own small HTML page; `/swagger/swagger-ui.css` and `/swagger/swagger-ui-bundle.js` are served from `swagger-ui-dist` by explicit routes (only those two files); `GET /` → 302 `/swagger`. Always on, no env flag (author's choice)  |
| Dependency       | `package.json`                                            | `swagger-ui-dist@^5` (runtime; static files only, no code runs in Node). It pulls `@scarf/scarf`, an install-time analytics ping, which is disabled with `"scarfSettings": { "enabled": false }`                                                                             |

## Keeping it current (enforcement)

1. **Route coverage test** (`tests/unit/openapi/route-coverage.test.ts`). It spies on `Router.prototype` (`get`, `post`, `put`, `patch`, `delete`, `use`) while `createApp` runs, rebuilds the full path of every route, and asserts that the set equals the document's operations. The only exceptions are the docs endpoints themselves. So adding a route without documenting it, or documenting a route that does not exist, fails `npm run test:unit`. (Express 5 does not keep route paths on its layers, so they are recorded as they are registered.)
2. **Response contract test** (`tests/unit/openapi/response-contract.test.ts`). For each documented response it can produce with stub services, it calls the real app and parses the body with the documented schema. A field added to the mapper but not to the docs fails.
3. **Process.** AGENTS.md §6 rule and §9 definition of done: "every endpoint is in `src/openapi/`". BUILD-PLAN Steps 5 and 6 each get an "OpenAPI" item. The plan template gains an "API docs" line.

## Tests

- [x] Document: valid shape (`openapi: 3.1.0`, every operation has responses); the request body schema equals `z.toJSONSchema(createRestaurantBodySchema)`.
- [x] Route coverage, as above.
- [x] Response contract, as above (201 and 200 detail, 400 with details, 400 `INVALID_ID`, 404, `/health`, `/ready` 200 and 503).
- [x] HTTP: `/openapi.json` 200 JSON; `/swagger` 200 HTML that references the bundle; `/swagger/swagger-ui-bundle.js` 200; `/` → 302 `/swagger`.

## Out of scope

Generating TypeScript types from the document; versioned docs; a production auth gate on `/swagger`.

## Notes after implementation

- **Two files, not `express.static`.** The first version used `express.static(..., { index: false })`. A test then showed that `index: false` only stops directory index pages: `/swagger/index.html` and `swagger-initializer.js` (the public petstore demo) were still served by name. Now only the two files the page needs are served, and a test checks that the others return 404.
- **Id pattern without the `i` flag.** `restaurantIdSchema` is now `/^[0-9a-fA-F]{24}$/`. JSON Schema patterns cannot carry regex flags, so the published pattern would otherwise have rejected uppercase ids that the API accepts. Behaviour is unchanged.
- **Field descriptions** were added to the request validator (`.describe()`), so Swagger shows them. The supported-country list is generated from the country table.
- **Mutation check.** Renaming `/ready` in the document made the route-coverage test fail with the exact diff; it passes again after the revert.
- **Install.** `"scarfSettings": { "enabled": false }` was added before `npm install`. npm also held back the `@scarf/scarf` postinstall script by default.
- **No example values (author's request).** The first version had realistic request and error examples. The author preferred to see the types (`"name": "string"`), which Swagger UI generates from the schema when no example is given, so every `example`/`examples` value was removed, and a unit test keeps them out. Field meaning comes from `.describe()`. With "Try it out", the generated body (for example `"countryCode": "string"`) must be edited before sending, or it returns 400.
- **Verified:** lint, typecheck, format and build are clean. 352 tests pass (302 unit, 50 integration). After `docker compose up -d --build api`: `/` → 302 `/swagger`, `/swagger` 200 HTML, the bundle 200, and `/openapi.json` lists all 4 operations.

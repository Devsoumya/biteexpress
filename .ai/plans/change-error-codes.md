# Change: error-code catalog

- **Status:** Done (2026-11-06; the author asked for specific error codes everywhere and agreed the catalog)
- **Design:** AGENTS.md §6 (errors), RFC-001 §5 (Errors), ADR-004 (Observability)

## Goal

Every failure returns the HTTP status and code that name what actually happened. A client can then react without parsing messages: retry on 503, fix a field on 400, give up on 404. Today several cases are wrong: a body over 100 kB returns 500, a database outage returns 500, and a wrong method returns 404.

## Catalog (`src/constants/error-codes.ts`, the single source)

| Code                     | Status | When                                                                       | Extra                                |
| ------------------------ | ------ | -------------------------------------------------------------------------- | ------------------------------------ |
| `VALIDATION_ERROR`       | 400    | Invalid fields in the body or query                                        | `details: [{ path, code, message }]` |
| `MALFORMED_JSON`         | 400    | Body is not parseable JSON                                                 | —                                    |
| `INVALID_ID`             | 400    | Path id is not a 24-hex ObjectId                                           | —                                    |
| `CURSOR_INVALID`         | 400    | Cursor is malformed, or belongs to a different query (Step 5)              | —                                    |
| `RESTAURANT_NOT_FOUND`   | 404    | Missing, or another tenant's                                               | —                                    |
| `ROUTE_NOT_FOUND`        | 404    | No such path                                                               | —                                    |
| `METHOD_NOT_ALLOWED`     | 405    | Path exists, method does not                                               | `Allow` header                       |
| `PAYLOAD_TOO_LARGE`      | 413    | Body over 100 kB                                                           | —                                    |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | A body that is not `application/json` on POST                              | —                                    |
| `INTERNAL_ERROR`         | 500    | Our bug, including a validator rejection (121) or a malformed search query | logged in full, never returned       |
| `DATABASE_UNAVAILABLE`   | 503    | MongoDB unreachable (network, server selection)                            | `Retry-After: 5`                     |
| `DATABASE_TIMEOUT`       | 503    | A collection read exceeded its time limit                                  | `Retry-After: 5`                     |
| `SEARCH_UNAVAILABLE`     | 503    | Atlas Search unreachable (Step 5)                                          | `Retry-After: 5`                     |
| `SEARCH_TIMEOUT`         | 503    | `$search` exceeded its time limit (Step 5)                                 | `Retry-After: 5`                     |

**Detail codes** (machine-readable, stable; mapped from Zod issue codes in `toValidationDetails`): `required`, `invalid_type`, `too_small`, `too_large`, `invalid_format`, `invalid_value`, `unknown_field`, `custom`. Messages stay human-readable and may change; codes do not.

## Approach

- `ApplicationError` takes a catalog code. Each code's status and whether it carries `Retry-After` come from the catalog, so a status and a code can never disagree.
- **Driver failures are classified in the repositories**, the only layer that knows the driver (`utils/mongo-errors.ts`, used only by repositories). Timeouts (`MongoOperationTimeoutError`, or a server error with code 50 `MaxTimeMSExpired`) → `*_TIMEOUT`. Network errors (`MongoNetworkError`, `MongoServerSelectionError`, …) → `*_UNAVAILABLE`. Anything else is rethrown unchanged → 500. Classification is by error class and code, never by message text.
- **Error handler:** body-parser `type`s → `MALFORMED_JSON` (`entity.parse.failed`), `PAYLOAD_TOO_LARGE` (`entity.too.large`). `Retry-After` is set from the catalog.
- **415:** a small middleware on `POST /v1/restaurants` rejects a body whose `Content-Type` is not JSON. A request with no body at all still reaches validation (400 "Body must be a JSON object").
- **405:** each router registers `router.all(path, methodNotAllowed(allowed))` after its real methods. The route-coverage test ignores these handlers.
- **OpenAPI:** `ErrorResponse.code` is the catalog enum. Each operation documents its reachable codes (404 → `RESTAURANT_NOT_FOUND`, 503 with `Retry-After`, 413, 415). A test checks that every catalog code appears in the document, and that every documented code is in the catalog.

## Tests

- [x] Catalog integrity: unique codes; statuses in the 4xx/5xx range; `Retry-After` only on 503.
- [x] Detail codes for each Zod issue kind.
- [x] HTTP (unit, stub services): malformed JSON → `MALFORMED_JSON`; 200 kB body → 413; `text/plain` → 415; `DELETE /v1/restaurants/{id}` → 405 with `Allow: GET`; `GET /nope` → `ROUTE_NOT_FOUND`; service `RESTAURANT_NOT_FOUND` → 404.
- [x] Classification (unit, with real driver error classes constructed in the test): timeout and code 50 → timeout; network and server selection → unavailable; validation 121 or other → rethrown.
- [x] Integration: GET and POST with an unreachable MongoDB (port 1) → 503 `DATABASE_UNAVAILABLE` + `Retry-After`.
- [x] OpenAPI: catalog ⇄ document test; response contract for 405, 413, 415 and 503.

## Out of scope

Localised messages; `Problem Details` (RFC 9457) format. The current `{ error: { code, message, details? } }` envelope stays.

## Notes after implementation

- **`ApplicationError(code, message, { details, cause })`.** The status and retryability come from the catalog. The old `(message, status, code)` signature is gone, so a mismatched pair cannot compile.
- **Detecting `required`.** It is detected with `reportInput` (the `parseRequest` helper): the issue's `input` is then `undefined` exactly when the field is missing. A first attempt that checked whether the `input` key exists was wrong (the key is always there); a unit test caught it. Without `reportInput`, the mapping safely answers `invalid_type`. Custom issues name their detail code in `params.detailCode` (for example "longitude is required with latitude" → `required`). A request with no body at all gets `required` on path `''`.
- **415 only when a non-JSON `Content-Type` is declared.** `request.is()` alone treats `Content-Length: 0` as a body, which turned "no body" into 415. Without a Content-Type, validation answers 400.
- **405 uses `router.route(path).<method>(...).all(methodNotAllowed)`.** `Allow` is read from the matched route, so it cannot drift; GET implies HEAD. The route-inventory test helper now records `Router.prototype.route` (calling through) and ignores `.all()`.
- **Driver errors found by tests:** an insert after a failed first connection throws `MongoTopologyClosedError`, not a selection error. The same class appears when a request races `client.close()` during shutdown. It is classified as unavailable (503). Classification is by class and server code; codes 50, 89 and 262 → timeout; 6, 7, 91, 189, 10107, 11600, 11602, 13435 and 13436 → unavailable; anything else (121, 11000, bugs) → 500.
- **5xx logging:** `ApplicationError`s with status ≥ 500 log their `cause` (the driver error); the client sees only the code and message.
- **OpenAPI:** each error response lists its codes in its description (`errorResponse()`), and every 503 documents `Retry-After`. `expectDocumentedResponse` now also fails when a real response carries a code its status does not list. A document test checks that every catalog code is mentioned, except `CURSOR_INVALID` and `SEARCH_*`, which become reachable in Step 5.
- **Verified:** lint, typecheck, format and build are clean. 413 tests pass (363 unit, 50 integration). Live on the rebuilt container: 405 with `Allow: GET, HEAD`, `ROUTE_NOT_FOUND`, `RESTAURANT_NOT_FOUND`, 415, `MALFORMED_JSON`, 413, and `VALIDATION_ERROR` with per-field codes.

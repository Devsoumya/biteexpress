# Requirements

This is the source of truth for what the project must deliver. It restates the take-home assignment brief, so no other copy is needed. Where the design documents say "the brief", they mean this file.

## Scenario

BiteExpress is a fast-growing food delivery platform in India. Its backend is a multi-instance monolith on several application and relational database instances (some with data sync between them), hosted on-premise in a Gurugram data centre, with third-party integrations such as payment processing. External systems include consumer mobile apps, a web portal, a restaurant-partner web portal, delivery-partner apps and internal analytics dashboards.

Goals:

- **Immediate (6-12 months):** improve platform reliability and performance during peak traffic hours, to prevent loss of revenue.
- **Long-term (2-3 years):** move to a cloud-native architecture, expand internationally, and comply with global data regulations.

Acting as a Forward Deployed Engineer for a MongoDB ISV partner, the task is to build an **MVP** (both a Proof of Concept and a Proof of Value) for the **customer-facing restaurant discovery** part of the app, using MongoDB. It should lay a foundation that is general purpose and could work for **multiple similar businesses**.

## Dataset

`zomato_data.csv` in the repository root (Zomato restaurants, 9,551 rows, ISO-8859-1). Fields:

- Restaurant ID: unique identifier
- Restaurant Name
- Country Code: numeric (for example, 1 = India)
- City, Address, Locality, Locality Verbose
- Longitude, Latitude: for location lookup and distance
- Cuisines: comma-separated
- Average Cost for two, Currency, Price range
- Has Table booking, Has Online delivery, Is delivering now, Switch to order menu
- Aggregate rating, Rating color, Rating text, Votes

The raw CSV needs cleanup before ingestion. The profiling results and cleanup rules are in ADR-001.

## API (REST, MongoDB as the operational datastore)

| Endpoint                     | Requirement                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /v1/restaurants`       | Add a restaurant and return the created entity                                                 |
| `GET /v1/restaurants/{id}`   | Return complete details for one restaurant, by its unique id                                   |
| `GET /v1/restaurants`        | General list endpoint with filtering and sorting (for example, powering a consumer mobile app) |
| `GET /v1/restaurants/search` | Everything the list endpoint does, plus natural-language query strings                         |

**List: supported filter and sort parameters:** Name, Distance (calculated from a latitude/longitude given in the request), City, Average Rating, Cuisines.

**List: required response attributes:** id, Name, Address, City, Country, Cuisines, Average Rating, and Distance (where applicable).

**Search: example natural-language queries that must work:**

1. "Best restaurants in Gurgaon with South Indian Food"
2. "Restaurants in Gurgaon under Rs. 1000 for two"
3. "Nearest place that serves Vada Pav"

**Automated tests:** API-level tests (unit, integration or end-to-end, whatever is most natural) that verify endpoint correctness.

Beyond CRUD: although the endpoints are mostly CRUD on the restaurant entity, the solution should think about the business goals above (reliability at peak, international expansion, compliance, general-purpose platform).

## Implementation guidelines

- **Stack:** any popular language and framework. MongoDB must be the primary datastore for operational data (other databases are allowed if necessary). This project uses Node.js, TypeScript, Express and the official MongoDB driver.
- **Code standards:** automated linting, code formatting and standard git practices (Conventional Commits) are expected.
- **Containerization:** easy to launch and demo live. Docker is used.

## Submission

- A **public GitHub repository** with the source code and setup instructions in `README.md`. No commits after the deadline (5 calendar days from receiving the brief).
- Expected effort: **3 to 5 hours**. Scope prioritization, engineering judgment and trade-offs are evaluated. Completing every requirement is neither required nor sufficient on its own.
- **Do not go overboard:** no frontend. Focus on robust solution design, solid MongoDB usage, and being able to defend the choices.
- **Integrity:** documentation, search engines, coding agents and LLM tools may be used, but **must be disclosed** in the submission (README). The work must be the candidate's own, and the candidate must be able to change, explain and defend it live.

## Scope decisions made against these requirements

Recorded in the ADRs and RFC; summarized here:

| Requirement                                     | Decision                                                                                                                                                                | Where               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Filter by name, city, rating, cuisine, distance | All are filters, combinable in any subset. Name is typo-tolerant with type-ahead. Location + radius filters; city + location is allowed (city filters, location orders) | ADR-003, RFC-001 §5 |
| Sort by the same fields                         | Sorts: `distance` (nearest first), `rating`, `cost` (both directions). Name, city and cuisine are filters only, with reasons documented                                 | ADR-003 Context     |
| Distance in the response                        | `distanceKm`, only when coordinates are sent                                                                                                                            | ADR-003 Rule 7      |
| Natural-language search                         | Deterministic rule-based interpreter → the same criteria as the list endpoint, on Atlas Search                                                                          | ADR-002             |
| Reliability at peak                             | Atlas Search for all lists, bounded queries (`maxTimeMS`, limits, radius cap), keyset paging, `/ready`. No circuit breaker or fallback in the MVP (503)                 | ADR-003, ADR-004    |
| Multiple businesses                             | `tenantId` on every document, index and query                                                                                                                           | ADR-001 Rule 9      |
| Tests                                           | Jest unit + integration (Supertest, real MongoDB with Atlas Search)                                                                                                     | ADR-005             |
| Containerization                                | `docker compose up --build`: `atlas-local` MongoDB, one-shot seed, API                                                                                                  | ADR-004             |

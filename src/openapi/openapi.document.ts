import type { Document } from 'mongodb';
import { type ZodType, z } from 'zod';
import {
  ERROR_CATALOG,
  type ErrorCode,
  RETRY_AFTER_SECONDS,
} from '../constants/error-codes';
import {
  createRestaurantBodySchema,
  listRestaurantsQuerySchema,
  restaurantIdSchema,
  searchRestaurantsQuerySchema,
} from '../validators/restaurant.schema';
import {
  errorResponseSchema,
  healthResponseSchema,
  listRestaurantsResponseSchema,
  readinessResponseSchema,
  restaurantDetailSchema,
  searchRestaurantsResponseSchema,
  restaurantListItemSchema,
} from './response.schemas';

/** A JSON object; the document is plain data served at /openapi.json. */
export type OpenApiDocument = Record<string, unknown>;

/**
 * Every named schema in the document. Tests use the same map to check real
 * responses against the documented schema for their status code.
 */
export const COMPONENT_SCHEMAS = {
  CreateRestaurantRequest: createRestaurantBodySchema,
  RestaurantListItem: restaurantListItemSchema,
  ListRestaurantsResponse: listRestaurantsResponseSchema,
  SearchRestaurantsResponse: searchRestaurantsResponseSchema,
  RestaurantDetail: restaurantDetailSchema,
  ErrorResponse: errorResponseSchema,
  HealthResponse: healthResponseSchema,
  ReadinessResponse: readinessResponseSchema,
} satisfies Record<string, ZodType>;

export type ComponentName = keyof typeof COMPONENT_SCHEMAS;

/**
 * OpenAPI 3.1 uses JSON Schema 2020-12, which is what Zod emits, so schemas
 * are used as generated; only the `$schema` marker is dropped. `io: 'input'`
 * describes what a client sends (before trimming and other transforms).
 */
function jsonSchema(schema: ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
  });
  return rest;
}

/**
 * One query parameter per field of the query schema, so the documented
 * parameters are exactly the accepted ones (types, bounds, defaults).
 */
function queryParameters(schema: z.ZodObject): Document[] {
  return Object.entries(schema.shape).map(([name, field]) => {
    const { description, ...fieldSchema } = jsonSchema(field as ZodType);
    return {
      name,
      in: 'query',
      // Required exactly when the schema rejects a missing value.
      required: !(field as ZodType).safeParse(undefined).success,
      ...(description !== undefined && { description }),
      schema: fieldSchema,
    };
  });
}

function ref(name: ComponentName): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

// No `example`/`examples` anywhere in the document: Swagger UI then renders
// each body from its schema as type placeholders ("name": "string"), so what
// readers see is the contract itself, not sample data.
function json(description: string, schemaName: ComponentName) {
  return {
    description,
    content: { 'application/json': { schema: ref(schemaName) } },
  };
}

/**
 * An error response. The codes it can carry are listed in the description,
 * where Swagger shows them and the response-contract test checks real
 * responses against them; 503s also document Retry-After.
 */
function errorResponse(description: string, codes: readonly ErrorCode[]) {
  const retryable = codes.some(
    (code) => (ERROR_CATALOG[code] as { retryable?: true }).retryable,
  );
  return {
    ...json(
      `${description}. Codes: ${codes.map((code) => `\`${code}\``).join(', ')}`,
      'ErrorResponse',
    ),
    ...(retryable && {
      headers: {
        'Retry-After': {
          description: `Seconds to wait before retrying (${RETRY_AFTER_SECONDS})`,
          schema: { type: 'integer' },
        },
      },
    }),
  };
}

const internalError = errorResponse('Unexpected server error', [
  'INTERNAL_ERROR',
]);
const databaseUnavailable = errorResponse('MongoDB unreachable or too slow', [
  'DATABASE_UNAVAILABLE',
  'DATABASE_TIMEOUT',
]);

/**
 * The API contract (RFC-001 §5) as OpenAPI 3.1. Request schemas come from the
 * validators, so the docs are exactly what the API accepts. Every route must
 * be listed here; tests/unit/openapi checks routes and responses against it.
 * There is no `servers` entry, so "Try it out" calls the host serving the page.
 */
export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'BiteExpress restaurant discovery API',
      version: '0.1.0',
      description:
        'Create, read, list and search restaurants. Unknown values are `null` in responses. Errors use `{ error: { code, message, details? } }`; each response below lists its codes. Any path also answers 404 `ROUTE_NOT_FOUND` when it does not exist, and 405 `METHOD_NOT_ALLOWED` (with `Allow`) for an unsupported method.',
    },
    tags: [
      { name: 'Restaurants', description: 'Business endpoints under /v1' },
      { name: 'Operations', description: 'Liveness and readiness probes' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Operations'],
          summary: 'Liveness (never touches MongoDB)',
          operationId: 'getHealth',
          responses: { '200': json('Process is up', 'HealthResponse') },
        },
      },
      '/ready': {
        get: {
          tags: ['Operations'],
          summary: 'Readiness: MongoDB ping and search index queryable',
          description: 'Cached server-side for 5 s; `Cache-Control: no-store`.',
          operationId: 'getReady',
          responses: {
            '200': json('Ready to serve traffic', 'ReadinessResponse'),
            '503': json('Not ready; `checks` says why', 'ReadinessResponse'),
          },
        },
      },
      '/v1/restaurants': {
        get: {
          tags: ['Restaurants'],
          summary: 'List restaurants: filter, sort, page',
          description:
            'Served by Atlas Search. Every filter combines with every sort. Default order: relevance with `name`, else distance with `lat`/`lng`, else rating. Unrated restaurants come last on the default order; restaurants without a location come last on a distance order. Paging: repeat the same parameters and add `cursor` from `nextCursor`. A restaurant created by POST appears here after about 1 s (the search index follows the collection).',
          operationId: 'listRestaurants',
          parameters: queryParameters(listRestaurantsQuerySchema),
          responses: {
            '200': json('One page of restaurants', 'ListRestaurantsResponse'),
            '400': errorResponse('Invalid parameters or cursor', [
              'VALIDATION_ERROR',
              'CURSOR_INVALID',
            ]),
            '500': internalError,
            '503': errorResponse('Atlas Search unreachable or too slow', [
              'SEARCH_UNAVAILABLE',
              'SEARCH_TIMEOUT',
            ]),
          },
        },
        post: {
          tags: ['Restaurants'],
          summary: 'Create a restaurant',
          description:
            'The server derives country name, currency, normalized city and cuisines, `votes: 0` and timestamps. Unknown keys are rejected.',
          operationId: 'createRestaurant',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: ref('CreateRestaurantRequest'),
              },
            },
          },
          responses: {
            '201': {
              ...json(
                'Created; the body is the stored restaurant',
                'RestaurantDetail',
              ),
              headers: {
                Location: {
                  description: 'URL of the new restaurant',
                  schema: { type: 'string' },
                },
              },
            },
            '400': errorResponse('Invalid body', [
              'VALIDATION_ERROR',
              'MALFORMED_JSON',
            ]),
            '413': errorResponse('Body over 100 kB', ['PAYLOAD_TOO_LARGE']),
            '415': errorResponse('Body is not JSON', [
              'UNSUPPORTED_MEDIA_TYPE',
            ]),
            '500': internalError,
            '503': databaseUnavailable,
          },
        },
      },
      '/v1/restaurants/search': {
        get: {
          tags: ['Restaurants'],
          summary: 'Search restaurants in natural language',
          description:
            'q is read by a rule-based interpreter (ADR-002) into the same filters and order the list uses: city (with aliases, and a city typo after "in" corrected when exactly one city is one edit away), cuisines, dishes (a name phrase OR the cuisine that serves it), price ("under Rs 1000"; without a resolvable currency, within-price restaurants come first), "best" (rating with a vote floor), "nearest" (distance; needs lat/lng), features ("online delivery"); leftover words only raise the rank. Every list parameter is accepted too, and an explicit parameter overrides what q says, with a note. The brief\'s queries: "Best restaurants in Gurgaon with South Indian Food", "Restaurants in Gurgaon under Rs. 1000 for two", "Nearest place that serves Vada Pav". `interpretation` shows what was understood.',
          operationId: 'searchRestaurants',
          parameters: queryParameters(searchRestaurantsQuerySchema),
          responses: {
            '200': json(
              'One page of restaurants, with the interpretation',
              'SearchRestaurantsResponse',
            ),
            '400': errorResponse('Invalid q, parameters or cursor', [
              'VALIDATION_ERROR',
              'CURSOR_INVALID',
            ]),
            '500': internalError,
            '503': errorResponse('Atlas Search unreachable or too slow', [
              'SEARCH_UNAVAILABLE',
              'SEARCH_TIMEOUT',
            ]),
          },
        },
      },
      '/v1/restaurants/{id}': {
        get: {
          tags: ['Restaurants'],
          summary: 'Get a restaurant by id',
          description:
            'Reads the collection, not the search index, so a restaurant is visible immediately after POST.',
          operationId: 'getRestaurantById',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: jsonSchema(restaurantIdSchema),
            },
          ],
          responses: {
            '200': json('The restaurant', 'RestaurantDetail'),
            '400': errorResponse('Malformed id', ['INVALID_ID']),
            '404': errorResponse("Not found, or another tenant's", [
              'RESTAURANT_NOT_FOUND',
            ]),
            '500': internalError,
            '503': databaseUnavailable,
          },
        },
      },
    },
    components: {
      schemas: Object.fromEntries(
        Object.entries(COMPONENT_SCHEMAS).map(([name, schema]) => [
          name,
          jsonSchema(schema),
        ]),
      ),
    },
  };
}

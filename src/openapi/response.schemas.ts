import { z } from 'zod';
import { DETAIL_CODES, ERROR_CODES } from '../constants/error-codes';

// Response shapes for the OpenAPI document. They are not used at runtime: the
// mappers and controllers build responses from the interfaces in models/, and
// tests parse real responses with these schemas, so the docs cannot drift
// from what the API actually returns. Strict objects: an undocumented field
// fails those tests.

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z
      .enum(ERROR_CODES)
      .describe('Stable code; the HTTP status follows from it (RFC-001 §5)'),
    message: z.string().describe('For people; may change'),
    details: z
      .array(
        z.strictObject({
          path: z
            .string()
            .describe('Dotted path of the field, e.g. features.tableBooking'),
          code: z.enum(DETAIL_CODES).describe('Stable reason for this field'),
          message: z.string(),
        }),
      )
      .optional()
      .describe('Present on VALIDATION_ERROR: every problem, in one list'),
  }),
});

export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
});

export const readinessResponseSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({
    mongo: z.enum(['ok', 'fail']),
    searchIndex: z.enum(['ok', 'missing', 'not_queryable', 'error', 'skipped']),
  }),
});

const listItemShape = {
  id: z.string().regex(/^[0-9a-f]{24}$/),
  name: z.string(),
  address: z.string(),
  city: z.string().describe('As entered; filters match aliases (Gurugram)'),
  country: z.strictObject({ code: z.string(), name: z.string() }),
  cuisines: z.array(z.string()),
  averageRating: z
    .number()
    .nullable()
    .describe('null when the restaurant is not rated yet'),
  votes: z.number().int(),
  ratingLabel: z.enum([
    'Not rated',
    'Poor',
    'Average',
    'Good',
    'Very Good',
    'Excellent',
  ]),
  cost: z.strictObject({
    averageForTwo: z
      .number()
      .nullable()
      .describe('In currency; what minCost, maxCost and sort=cost use'),
    currency: z
      .string()
      .nullable()
      .describe("ISO 4217, from the restaurant's country"),
    priceRange: z.number().int().nullable().describe('1 (cheap) to 4'),
  }),
  features: z.strictObject({
    tableBooking: z.boolean().nullable(),
    onlineDelivery: z.boolean().nullable(),
    deliveringNow: z.boolean().nullable(),
  }),
};

export const restaurantListItemSchema = z.strictObject({
  ...listItemShape,
  distanceKm: z
    .number()
    .optional()
    .describe(
      'Kilometres from lat/lng, 2 decimals; only with coordinates, and only for restaurants with a location',
    ),
});

export const listRestaurantsResponseSchema = z.strictObject({
  data: z.array(restaurantListItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      'Pass as cursor, with the same parameters, for the next page; null on the last page',
    ),
});

export const restaurantDetailSchema = z.strictObject({
  ...listItemShape,
  locality: z.string().nullable(),
  location: z
    .strictObject({ latitude: z.number(), longitude: z.number() })
    .nullable()
    .describe('null when unknown (no coordinates, or 0 on an axis)'),
  sourceId: z
    .number()
    .int()
    .nullable()
    .describe('Zomato ID for seeded restaurants; null when created via API'),
});

const dishSchema = z.strictObject({
  phrase: z.string().describe('Matched as a phrase in restaurant names'),
  cuisines: z
    .array(z.string())
    .describe('Cuisines that probably serve the dish (also matched)'),
});

export const interpretationSchema = z
  .strictObject({
    query: z.string().describe('q as sent'),
    sort: z
      .enum(['distance', 'rating', 'cost', 'relevance'])
      .describe('The order used; relevance ties break by rating'),
    city: z.string().optional().describe('Normalized city filter'),
    cuisines: z.array(z.string()).optional(),
    dishes: z.array(dishSchema).optional(),
    minRating: z.number().optional(),
    minVotes: z.number().optional().describe('"best" sets the vote floor'),
    minCost: z.number().optional(),
    maxCost: z.number().optional(),
    currency: z.string().optional(),
    pricePreference: z
      .strictObject({
        minCost: z.number().optional(),
        maxCost: z.number().optional(),
      })
      .optional()
      .describe(
        'A price from q whose currency could not be resolved: restaurants within it first, then the rest',
      ),
    maxPriceRange: z.number().optional().describe('"cheap" → price tier ≤ 2'),
    features: z
      .strictObject({
        onlineDelivery: z.boolean().optional(),
        tableBooking: z.boolean().optional(),
      })
      .optional(),
    boostTerms: z
      .array(z.string())
      .optional()
      .describe('Leftover words: raise the rank, never exclude'),
    text: z
      .string()
      .optional()
      .describe('Nothing structured was recognized: typo-tolerant text match'),
    notes: z
      .array(z.string())
      .describe('What was ignored, boosted, overridden or corrected'),
  })
  .describe('What the search understood (ADR-002)');

export const searchRestaurantsResponseSchema = z.strictObject({
  data: z.array(restaurantListItemSchema),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      'Pass as cursor, with the same q and parameters, for the next page',
    ),
  interpretation: interpretationSchema,
});

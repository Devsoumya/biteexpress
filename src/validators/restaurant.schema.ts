import { z } from 'zod';
import { COUNTRIES } from '../constants/countries';
import {
  DEFAULT_LIMIT,
  DEFAULT_RADIUS_KM,
  MAX_LIMIT,
  MAX_RADIUS_KM,
} from '../constants/search';
import { SUPPORTED_CURRENCIES, countryByIsoCode } from '../utils/country';
import { splitCuisines } from '../utils/normalize';

// Zod's default for a missing field is "Invalid input: expected string,
// received undefined"; clients get a plainer message for the common case.
function requiredString() {
  return z.string({
    error: (issue) =>
      issue.input === undefined ? 'Required' : 'Must be a string',
  });
}

function text(max: number) {
  return requiredString()
    .trim()
    .min(1, 'Must not be empty')
    .max(max, `Must be at most ${max} characters`);
}

// The country table is the whole rule: no separate length check, so "IND"
// gets one message, not two.
const countryCode = requiredString()
  .trim()
  .toUpperCase()
  .refine((code) => countryByIsoCode(code) !== undefined, {
    error: 'Unsupported country code',
    params: { detailCode: 'invalid_value' },
  })
  .describe(
    `ISO 3166-1 alpha-2, any case. Supported: ${COUNTRIES.map((c) => c.isoCode).join(', ')}`,
  );

// JSON numbers only: a body is typed, so "28.4" is a client bug, not input to
// coerce (query strings, which are always text, are coerced in Step 5).
const latitude = z
  .number('Must be a number')
  .min(-90, 'Must be between -90 and 90')
  .max(90, 'Must be between -90 and 90');

const longitude = z
  .number('Must be a number')
  .min(-180, 'Must be between -180 and 180')
  .max(180, 'Must be between -180 and 180');

// Bounds are checked on the value sent, then it is rounded half-up to one
// decimal, like the source data. `abort` gives 0 a single message.
// `.overwrite` (not `.transform`) keeps the bounds in the generated OpenAPI.
const averageRating = z
  .number('Must be a number')
  .gt(0, { error: 'Must be greater than 0; omit it when unrated', abort: true })
  .lte(5, { error: 'Must be at most 5', abort: true })
  .overwrite((value) => Math.round(value * 10) / 10)
  .refine((value) => value > 0, {
    error: 'Rounds to 0; omit it when unrated',
    params: { detailCode: 'too_small' },
  });

// int32: the driver stores a larger whole number as a double, which the
// $jsonSchema validator (int or long) would reject as a 500.
const MAX_VOTES = 2_147_483_647;

const votes = z
  .number('Must be a number')
  .int('Must be a whole number')
  .min(0, 'Must be 0 or more')
  .max(MAX_VOTES, `Must be at most ${MAX_VOTES}`);

const features = z.strictObject({
  tableBooking: z.boolean('Must be a boolean').optional(),
  onlineDelivery: z.boolean('Must be a boolean').optional(),
  deliveringNow: z.boolean('Must be a boolean').optional(),
});

/**
 * POST /v1/restaurants (RFC-001 §5). Only client-set fields: country name,
 * currency, `norm.*`, timestamps and tenant are derived server-side. A rating
 * may be carried over from another system (ADR-001 Rule 14).
 * Exactly 0 on a coordinate is valid input meaning "unknown" (ADR-001 Rule 3);
 * the mapper omits the location.
 */
export const createRestaurantBodySchema = z
  .strictObject(
    {
      name: text(200),
      address: text(500),
      city: text(100),
      countryCode,
      locality: text(200).optional(),
      cuisines: z
        .array(text(50), 'Must be an array of strings')
        .max(20, 'At most 20 cuisines')
        .optional()
        .describe('Duplicates (any case or accents) are removed'),
      latitude: latitude
        .optional()
        .describe('With longitude, or neither. 0 means unknown: not stored'),
      longitude: longitude.optional().describe('With latitude, or neither'),
      averageCostForTwo: z
        .number('Must be a number')
        .positive('Must be greater than 0; omit it when unknown')
        .optional(),
      priceRange: z
        .number('Must be a number')
        .int('Must be an integer from 1 to 4')
        .min(1, 'Must be an integer from 1 to 4')
        .max(4, 'Must be an integer from 1 to 4')
        .optional(),
      features: features.optional(),
      averageRating: averageRating
        .optional()
        .describe(
          'Out of 5, rounded to one decimal. Omit when unrated. Requires votes of at least 1',
        ),
      votes: votes.optional().describe('Number of ratings. Default 0'),
    },
    'Body must be a JSON object',
  )
  .superRefine(
    (body, context) => {
      // An average of no votes means nothing.
      if (body.averageRating !== undefined && body.votes === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['votes'],
          message: 'Required when averageRating is given',
          params: { detailCode: 'required' },
        });
      }
      if (body.averageRating !== undefined && body.votes === 0) {
        context.addIssue({
          code: 'custom',
          path: ['votes'],
          message: 'Must be at least 1 when averageRating is given',
          params: { detailCode: 'too_small' },
        });
      }
      // Issue on the missing half, which is the field the client must add.
      if (body.latitude !== undefined && body.longitude === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['longitude'],
          message: 'Required when latitude is given',
          params: { detailCode: 'required' },
        });
      }
      if (body.longitude !== undefined && body.latitude === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['latitude'],
          message: 'Required when longitude is given',
          params: { detailCode: 'required' },
        });
      }
    },
    {
      // Zod skips object refinements once a field is missing; run this one
      // for any object, so a single 400 lists every problem. It only checks
      // whether the two keys are present, which is safe on a partly invalid
      // body.
      when: ({ value }) => typeof value === 'object' && value !== null,
    },
  );

export type CreateRestaurantBody = z.infer<typeof createRestaurantBodySchema>;

/**
 * A hex ObjectId. `ObjectId.isValid` is not used: it also accepts any
 * 12-character string, which would reach the database as a 12-byte id.
 */
// Written without the i flag because JSON Schema patterns cannot carry flags,
// and this regex is also published in the OpenAPI document.
export const restaurantIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);

// ---- GET /v1/restaurants query (ADR-003, RFC-001 §5) ----

const MAX_CUISINES = 10;

// Query values are text; a repeated parameter arrives as an array.
function queryText(min: number, max: number) {
  return z
    .string('Must be a single value')
    .trim()
    .min(min, `Must be at least ${min} characters`)
    .max(max, `Must be at most ${max} characters`);
}

// z.coerce turns "4.5" into 4.5; a repeated parameter (an array) becomes NaN
// and is rejected. Blank values were already dropped (withoutBlankValues).
function queryNumber() {
  return z.coerce.number('Must be a single number');
}

const cuisineList = queryText(1, 500)
  .refine((value) => splitCuisines(value).length <= MAX_CUISINES, {
    error: `At most ${MAX_CUISINES} cuisines`,
    params: { detailCode: 'too_large' },
  })
  .refine((value) => splitCuisines(value).every((c) => c.length <= 50), {
    error: 'Each cuisine must be at most 50 characters',
    params: { detailCode: 'too_large' },
  })
  .refine((value) => splitCuisines(value).length > 0, {
    error: 'Must list at least one cuisine',
    params: { detailCode: 'too_small' },
  });

const currencyCode = queryText(3, 3)
  .toUpperCase()
  .refine((code) => SUPPORTED_CURRENCIES.includes(code), {
    error: 'Unsupported currency',
    params: { detailCode: 'invalid_value' },
  })
  .describe(
    `ISO 4217, any case. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
  );

type QueryIssueContext = z.RefinementCtx;

function addIssue(
  context: QueryIssueContext,
  path: string,
  message: string,
  detailCode: 'required' | 'invalid_value',
): void {
  context.addIssue({
    code: 'custom',
    path: [path],
    message,
    params: { detailCode },
  });
}

/** The list parameters; `/search` accepts them all, plus `q`. */
const listQueryShape = {
  name: queryText(2, 100)
    .optional()
    .describe(
      'Type-ahead and one-typo-tolerant name match, case and accent insensitive',
    ),
  city: queryText(1, 100)
    .optional()
    .describe('Case-insensitive; aliases resolve (Gurugram → Gurgaon)'),
  cuisine: cuisineList
    .optional()
    .describe(
      `Comma-separated, up to ${MAX_CUISINES}; a restaurant matches if it lists the cuisine`,
    ),
  cuisineMatch: z
    .enum(['any', 'all'], 'Must be any or all')
    .optional()
    .describe('With cuisine: any (default) or all of the listed cuisines'),
  minRating: queryNumber()
    .min(0, 'Must be between 0 and 5')
    .max(5, 'Must be between 0 and 5')
    .optional()
    .describe('Average rating floor; excludes unrated restaurants'),
  minVotes: queryNumber()
    .int('Must be a whole number')
    .min(0, 'Must be 0 or more')
    .optional(),
  minCost: queryNumber()
    .positive('Must be greater than 0')
    .optional()
    .describe('Average cost for two, in `currency`'),
  maxCost: queryNumber()
    .positive('Must be greater than 0')
    .optional()
    .describe('Average cost for two, in `currency`'),
  currency: currencyCode
    .optional()
    .describe(
      'Required with minCost, maxCost or sort=cost unless city is a known city (its currency is used)',
    ),
  lat: queryNumber()
    .min(-90, 'Must be between -90 and 90')
    .max(90, 'Must be between -90 and 90')
    .optional()
    .describe('With lng; orders by distance and adds distanceKm'),
  lng: queryNumber()
    .min(-180, 'Must be between -180 and 180')
    .max(180, 'Must be between -180 and 180')
    .optional()
    .describe('With lat'),
  radiusKm: queryNumber()
    .positive('Must be greater than 0')
    .max(MAX_RADIUS_KM, `Must be at most ${MAX_RADIUS_KM}`)
    .optional()
    .describe(
      `Needs lat/lng. Without a city the default is ${DEFAULT_RADIUS_KM} km; with a city no radius applies unless given`,
    ),
  sort: z
    .enum(['distance', 'rating', 'cost'], 'Must be distance, rating or cost')
    .optional()
    .describe(
      'Default: relevance with name, else distance with lat/lng, else rating. distance needs lat/lng; rating and cost exclude restaurants without that value',
    ),
  order: z
    .enum(['asc', 'desc'], 'Must be asc or desc')
    .optional()
    .describe(
      'Only with sort=rating (default desc) or sort=cost (default asc)',
    ),
  cursor: queryText(1, 2000)
    .optional()
    .describe('nextCursor from the previous page; repeat the same parameters'),
  limit: queryNumber()
    .int('Must be a whole number')
    .min(1, `Must be between 1 and ${MAX_LIMIT}`)
    .max(MAX_LIMIT, `Must be between 1 and ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
};

type ListQueryValues = z.output<z.ZodObject<typeof listQueryShape>>;

/**
 * Cross-field rules for explicit parameters, shared by the list and search
 * endpoints. The currency rule is not here: it needs the city vocabulary,
 * which comes from the database (mappers/search-criteria.mapper.ts).
 */
function checkListQuery(
  query: ListQueryValues,
  context: QueryIssueContext,
): void {
  const hasLat = query.lat !== undefined;
  const hasLng = query.lng !== undefined;
  if (hasLat && !hasLng)
    addIssue(context, 'lng', 'Required when lat is given', 'required');
  if (hasLng && !hasLat)
    addIssue(context, 'lat', 'Required when lng is given', 'required');
  const hasOrigin = hasLat && hasLng;

  if (query.radiusKm !== undefined && !hasOrigin) {
    addIssue(context, 'radiusKm', 'Requires lat and lng', 'invalid_value');
  }
  if (query.sort === 'distance' && !hasOrigin) {
    addIssue(
      context,
      'sort',
      'sort=distance requires lat and lng',
      'invalid_value',
    );
  }
  if (
    query.order !== undefined &&
    query.sort !== 'rating' &&
    query.sort !== 'cost'
  ) {
    addIssue(
      context,
      'order',
      'order requires sort=rating or sort=cost',
      'invalid_value',
    );
  }
  if (query.cuisineMatch !== undefined && query.cuisine === undefined) {
    addIssue(context, 'cuisineMatch', 'Requires cuisine', 'invalid_value');
  }
  if (
    typeof query.minCost === 'number' &&
    typeof query.maxCost === 'number' &&
    query.minCost > query.maxCost
  ) {
    addIssue(context, 'minCost', 'Must not exceed maxCost', 'invalid_value');
  }
}

// As for the POST body: run on a partly invalid query too, so one 400 lists
// every problem. The checks read only presence and already-typed values.
const evenWhenPartlyInvalid = {
  when: ({ value }: { value: unknown }) =>
    typeof value === 'object' && value !== null,
};

/**
 * GET /v1/restaurants. Every filter combines with every sort. Cross-field
 * rules are checked together, so one 400 lists every problem.
 */
export const listRestaurantsQuerySchema = z
  .strictObject(listQueryShape)
  .superRefine(checkListQuery, evenWhenPartlyInvalid);

export type ListRestaurantsQuery = z.infer<typeof listRestaurantsQuerySchema>;

/**
 * GET /v1/restaurants/search: `q` plus every list parameter. Explicit
 * parameters are checked as strictly as on the list; what `q` says is read
 * leniently by the interpreter (ADR-002).
 */
export const searchRestaurantsQuerySchema = z
  .strictObject({
    q: z
      .string({
        error: (issue) =>
          issue.input === undefined ? 'Required' : 'Must be a single value',
      })
      .trim()
      .min(1, 'Must not be empty')
      .max(200, 'Must be at most 200 characters')
      .describe(
        'Natural language, e.g. "best south indian in gurgaon", "under rs 1000", "nearest vada pav"',
      ),
    ...listQueryShape,
  })
  .superRefine(checkListQuery, evenWhenPartlyInvalid);

export type SearchRestaurantsQuery = z.infer<
  typeof searchRestaurantsQuerySchema
>;

import { toValidationDetails } from '../../../src/utils/validation-details';
import {
  createRestaurantBodySchema,
  restaurantIdSchema,
} from '../../../src/validators/restaurant.schema';
import {
  fullCreateBody,
  minimalCreateBody,
} from '../../helpers/restaurant-fixtures';

function fullDetailsFor(body: unknown) {
  const result = createRestaurantBodySchema.safeParse(body, {
    reportInput: true,
  });
  if (result.success) throw new Error('expected the body to be rejected');
  return toValidationDetails(result.error);
}

// Most tests check paths and messages; detail codes have their own table.
function detailsFor(body: unknown) {
  return fullDetailsFor(body).map(({ path, message }) => ({ path, message }));
}

describe('createRestaurantBodySchema', () => {
  it('accepts a full body, trimming strings and uppercasing the country code', () => {
    const result = createRestaurantBodySchema.parse({
      ...fullCreateBody(),
      name: '  Goli Vada Pav No. 1 ',
      countryCode: ' in ',
    });

    expect(result).toEqual({ ...fullCreateBody(), countryCode: 'IN' });
  });

  it('accepts a body with only the required fields', () => {
    expect(createRestaurantBodySchema.parse(minimalCreateBody())).toEqual(
      minimalCreateBody(),
    );
  });

  it.each(['name', 'address', 'city', 'countryCode'])(
    'rejects a missing %s as Required',
    (field) => {
      const { [field]: _removed, ...body } = minimalCreateBody();

      expect(detailsFor(body)).toEqual([{ path: field, message: 'Required' }]);
    },
  );

  it.each<[string, Record<string, unknown>, string, string]>([
    ['empty name', { name: '' }, 'name', 'Must not be empty'],
    ['whitespace-only name', { name: '   ' }, 'name', 'Must not be empty'],
    [
      'a 201-character name',
      { name: 'x'.repeat(201) },
      'name',
      'Must be at most 200 characters',
    ],
    ['a numeric name', { name: 42 }, 'name', 'Must be a string'],
    [
      'an unsupported country',
      { countryCode: 'XX' },
      'countryCode',
      'Unsupported country code',
    ],
    [
      'an alpha-3 country code',
      { countryCode: 'IND' },
      'countryCode',
      'Unsupported country code',
    ],
    [
      'latitude above 90',
      { latitude: 90.0001, longitude: 77 },
      'latitude',
      'Must be between -90 and 90',
    ],
    [
      'longitude below -180',
      { latitude: 28, longitude: -180.0001 },
      'longitude',
      'Must be between -180 and 180',
    ],
    [
      'latitude as a numeric string (no coercion)',
      { latitude: '28.4', longitude: 77 },
      'latitude',
      'Must be a number',
    ],
    [
      'cost 0 (unknown is omitted, not 0)',
      { averageCostForTwo: 0 },
      'averageCostForTwo',
      'Must be greater than 0; omit it when unknown',
    ],
    [
      'negative cost',
      { averageCostForTwo: -5 },
      'averageCostForTwo',
      'Must be greater than 0; omit it when unknown',
    ],
    [
      'priceRange 0',
      { priceRange: 0 },
      'priceRange',
      'Must be an integer from 1 to 4',
    ],
    [
      'priceRange 5',
      { priceRange: 5 },
      'priceRange',
      'Must be an integer from 1 to 4',
    ],
    [
      'priceRange 2.5',
      { priceRange: 2.5 },
      'priceRange',
      'Must be an integer from 1 to 4',
    ],
    [
      'more than 20 cuisines',
      { cuisines: Array.from({ length: 21 }, (_, i) => `Cuisine ${i}`) },
      'cuisines',
      'At most 20 cuisines',
    ],
    [
      'an empty cuisine',
      { cuisines: ['Cafe', ' '] },
      'cuisines.1',
      'Must not be empty',
    ],
    [
      'a non-boolean feature',
      { features: { tableBooking: 'yes' } },
      'features.tableBooking',
      'Must be a boolean',
    ],
  ])('rejects %s', (_case, override, path, message) => {
    expect(detailsFor({ ...minimalCreateBody(), ...override })).toEqual([
      { path, message },
    ]);
  });

  it('rejects unknown keys at the root and inside features, one detail per key', () => {
    expect(
      detailsFor({
        ...minimalCreateBody(),
        tenantId: 'other',
        norm: {},
        features: { valet: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { path: 'tenantId', message: 'Unknown field' },
        { path: 'norm', message: 'Unknown field' },
        { path: 'features.valet', message: 'Unknown field' },
      ]),
    );
  });

  it('requires longitude when latitude is given, and the reverse', () => {
    expect(detailsFor({ ...minimalCreateBody(), latitude: 28.4 })).toEqual([
      { path: 'longitude', message: 'Required when latitude is given' },
    ]);
    expect(detailsFor({ ...minimalCreateBody(), longitude: 77 })).toEqual([
      { path: 'latitude', message: 'Required when longitude is given' },
    ]);
  });

  it('accepts exactly 0 on a coordinate (valid input meaning unknown)', () => {
    expect(
      createRestaurantBodySchema.safeParse({
        ...minimalCreateBody(),
        latitude: 0,
        longitude: 0,
      }).success,
    ).toBe(true);
  });

  it('reports every issue in one response', () => {
    expect(
      detailsFor({ name: '', city: 'Gurgaon', countryCode: 'XX', latitude: 1 }),
    ).toEqual([
      { path: 'name', message: 'Must not be empty' },
      { path: 'address', message: 'Required' },
      { path: 'countryCode', message: 'Unsupported country code' },
      { path: 'longitude', message: 'Required when latitude is given' },
    ]);
  });

  it.each([null, [], 'text'])(
    'rejects a body that is not an object: %j',
    (body) => {
      expect(detailsFor(body)).toEqual([
        { path: '', message: 'Body must be a JSON object' },
      ]);
    },
  );
});

describe('detail codes', () => {
  it.each<[string, Record<string, unknown>, string, string]>([
    ['a missing field', { name: undefined }, 'name', 'required'],
    ['a wrong type', { name: 42 }, 'name', 'invalid_type'],
    ['an empty string', { name: '' }, 'name', 'too_small'],
    ['a long string', { name: 'x'.repeat(201) }, 'name', 'too_large'],
    ['an unknown key', { rating: 5 }, 'rating', 'unknown_field'],
    [
      'an unsupported country',
      { countryCode: 'XX' },
      'countryCode',
      'invalid_value',
    ],
    ['latitude without longitude', { latitude: 1 }, 'longitude', 'required'],
  ])('%s → %s at %s', (_case, override, path, code) => {
    expect(fullDetailsFor({ ...minimalCreateBody(), ...override })).toEqual([
      expect.objectContaining({ path, code }),
    ]);
  });
});

describe('restaurantIdSchema', () => {
  it.each(['5f1d7c3e9b1e8a0012345678', '5F1D7C3E9B1E8A0012345678'])(
    'accepts the hex ObjectId %s',
    (id) => {
      expect(restaurantIdSchema.safeParse(id).success).toBe(true);
    },
  );

  it.each([
    ['23 characters', '5f1d7c3e9b1e8a001234567'],
    ['25 characters', '5f1d7c3e9b1e8a00123456789'],
    ['a non-hex character', '5f1d7c3e9b1e8a001234567g'],
    ['a 12-character string (ObjectId.isValid accepts it)', 'abcdefghijkl'],
    ['search', 'search'],
  ])('rejects %s', (_case, id) => {
    expect(restaurantIdSchema.safeParse(id).success).toBe(false);
  });
});

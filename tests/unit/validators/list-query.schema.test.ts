import { toValidationDetails } from '../../../src/utils/validation-details';
import { withoutBlankValues } from '../../../src/validators/parse-request';
import { listRestaurantsQuerySchema } from '../../../src/validators/restaurant.schema';

function parse(query: Record<string, unknown>) {
  return listRestaurantsQuerySchema.safeParse(query, { reportInput: true });
}

function details(query: Record<string, unknown>) {
  const result = parse(query);
  if (result.success) throw new Error('expected the query to be rejected');
  return toValidationDetails(result.error).map(({ path, code, message }) => ({
    path,
    code,
    message,
  }));
}

describe('listRestaurantsQuerySchema', () => {
  it('defaults limit to 20 and coerces numbers from query strings', () => {
    expect(listRestaurantsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      listRestaurantsQuerySchema.parse({
        lat: '28.49',
        lng: '77.08',
        limit: '5',
      }),
    ).toEqual({ lat: 28.49, lng: 77.08, limit: 5 });
  });

  it('accepts every parameter together', () => {
    expect(
      parse({
        name: 'goli',
        city: 'Gurgaon',
        cuisine: 'Street Food, Chinese',
        cuisineMatch: 'all',
        minRating: '3.5',
        minVotes: '20',
        minCost: '100',
        maxCost: '1000',
        currency: 'inr',
        lat: '28.49',
        lng: '77.08',
        radiusKm: '10',
        sort: 'cost',
        order: 'desc',
        cursor: 'abc',
        limit: '100',
      }).success,
    ).toBe(true);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ['a 1-character name', { name: 'g' }, 'name', 'too_small'],
    ['minRating above 5', { minRating: '5.1' }, 'minRating', 'too_large'],
    [
      'a non-numeric minRating',
      { minRating: 'high' },
      'minRating',
      'invalid_type',
    ],
    ['a fractional minVotes', { minVotes: '2.5' }, 'minVotes', 'invalid_type'],
    ['limit 0', { limit: '0' }, 'limit', 'too_small'],
    ['limit 101', { limit: '101' }, 'limit', 'too_large'],
    [
      'radiusKm above 50',
      { lat: '1', lng: '1', radiusKm: '50.1' },
      'radiusKm',
      'too_large',
    ],
    ['an unknown sort', { sort: 'relevance' }, 'sort', 'invalid_value'],
    ['sort=name (not offered)', { sort: 'name' }, 'sort', 'invalid_value'],
    [
      'an unknown order',
      { sort: 'cost', order: 'up', currency: 'INR' },
      'order',
      'invalid_value',
    ],
    [
      'an unsupported currency',
      { currency: 'EUR' },
      'currency',
      'invalid_value',
    ],
    [
      'more than 10 cuisines',
      { cuisine: 'a,b,c,d,e,f,g,h,i,j,k' },
      'cuisine',
      'too_large',
    ],
    [
      'a cuisine list of only commas',
      { cuisine: ', ,' },
      'cuisine',
      'too_small',
    ],
    ['an unknown parameter', { cusine: 'cafe' }, 'cusine', 'unknown_field'],
    ['a repeated text parameter', { city: ['a', 'b'] }, 'city', 'invalid_type'],
    [
      'a repeated number parameter',
      { minRating: ['1', '2'] },
      'minRating',
      'invalid_type',
    ],
  ])('rejects %s', (_case, query, path, code) => {
    expect(details(query)).toEqual([expect.objectContaining({ path, code })]);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ['lat without lng', { lat: '28' }, 'lng', 'Required when lat is given'],
    ['lng without lat', { lng: '77' }, 'lat', 'Required when lng is given'],
    [
      'radiusKm without coordinates',
      { radiusKm: '3' },
      'radiusKm',
      'Requires lat and lng',
    ],
    [
      'sort=distance without coordinates',
      { sort: 'distance' },
      'sort',
      'sort=distance requires lat and lng',
    ],
    [
      'order without a sort',
      { order: 'asc' },
      'order',
      'order requires sort=rating or sort=cost',
    ],
    [
      'order with sort=distance',
      { sort: 'distance', lat: '1', lng: '1', order: 'asc' },
      'order',
      'order requires sort=rating or sort=cost',
    ],
    [
      'cuisineMatch without cuisine',
      { cuisineMatch: 'all' },
      'cuisineMatch',
      'Requires cuisine',
    ],
    [
      'minCost above maxCost',
      { minCost: '500', maxCost: '100', currency: 'INR' },
      'minCost',
      'Must not exceed maxCost',
    ],
  ])('rejects %s', (_case, query, path, message) => {
    expect(details(query)).toEqual([
      expect.objectContaining({ path, message }),
    ]);
  });

  // The currency rule needs the city vocabulary (from the database), so it is
  // checked by the criteria mapper, not here: see search-criteria.mapper.test.
  it('leaves the currency rule to the criteria mapper', () => {
    expect(parse({ maxCost: '500' }).success).toBe(true);
  });

  it('reports every problem in one response', () => {
    expect(
      details({ name: 'x', lat: '1', sort: 'distance', bogus: '1' }).map(
        (d) => d.path,
      ),
    ).toEqual(['name', 'bogus', 'lng', 'sort']);
  });
});

describe('withoutBlankValues', () => {
  it('drops blank values, so ?minRating= means "not given", not 0', () => {
    expect(
      withoutBlankValues({ minRating: '', city: ' ', name: 'goli' }),
    ).toEqual({
      name: 'goli',
    });
  });
});

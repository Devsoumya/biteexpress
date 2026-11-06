import { staticVocabulary } from '../../helpers/vocabulary';
import { toSearchCriteria } from '../../../src/mappers/search-criteria.mapper';
import { listRestaurantsQuerySchema } from '../../../src/validators/restaurant.schema';

const criteria = (query: Record<string, unknown>) =>
  toSearchCriteria(
    listRestaurantsQuerySchema.parse(query),
    staticVocabulary().snapshot(),
  );

describe('toSearchCriteria', () => {
  it('normalizes the city through the alias table', () => {
    expect(criteria({ city: '  GURUGRAM ' })).toEqual({
      city: 'gurgaon',
      cuisineMatch: 'any',
    });
  });

  it('normalizes cuisines: case, accents, blanks and duplicates', () => {
    expect(
      criteria({ cuisine: 'Döner, , döner,Street  Food' }).cuisines,
    ).toEqual(['doner', 'street food']);
  });

  it('builds the origin from lat and lng, and keeps radius, sort and order', () => {
    expect(
      criteria({
        lat: '28.5',
        lng: '77.1',
        radiusKm: '3',
        sort: 'rating',
        order: 'asc',
      }),
    ).toEqual({
      origin: { lat: 28.5, lng: 77.1 },
      radiusKm: 3,
      sort: 'rating',
      order: 'asc',
      cuisineMatch: 'any',
    });
  });

  it("resolves the currency from the city's country for cost queries", () => {
    expect(criteria({ city: 'Orlando', maxCost: '50' }).currency).toBe('USD');
    expect(criteria({ city: 'Gurgaon', sort: 'cost' }).currency).toBe('INR');
  });

  it('prefers an explicit currency', () => {
    expect(
      criteria({ city: 'Gurgaon', maxCost: '50', currency: 'usd' }).currency,
    ).toBe('USD');
  });

  it('sets no currency when cost is not involved', () => {
    expect(criteria({ city: 'Gurgaon', currency: 'USD' })).not.toHaveProperty(
      'currency',
    );
  });

  it.each([
    ['maxCost near me, no city', { maxCost: '500', lat: '25.2', lng: '55.3' }],
    ['sort=cost with no city', { sort: 'cost' }],
    [
      'minCost in a city the vocabulary does not know',
      { minCost: '10', city: 'Atlantis' },
    ],
  ])('requires currency (400 on currency) for %s', (_case, query) => {
    let error: unknown;
    try {
      criteria(query);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: [{ path: 'currency', code: 'required' }],
    });
  });

  it.each([
    ['a known city (alias too)', { maxCost: '500', city: 'Gurugram' }],
    ['an explicit currency', { sort: 'cost', currency: 'usd' }],
  ])('accepts %s without asking for currency', (_case, query) => {
    expect(() => criteria(query)).not.toThrow();
  });
});

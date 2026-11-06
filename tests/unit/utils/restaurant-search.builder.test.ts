import type { Document } from 'mongodb';
import type { SearchCriteria } from '../../../src/models/search.model';
import { haversineDistanceKmExpression } from '../../../src/utils/geo';
import { buildSearchPipeline } from '../../../src/utils/restaurant-search.builder';

const OPTIONS = {
  tenantId: 'biteexpress',
  indexName: 'restaurants_search',
  limit: 20,
};
const TENANT = { equals: { path: 'tenantId', value: 'biteexpress' } };
const ORIGIN = { lat: 28.495, lng: 77.089 };
const POINT = { type: 'Point', coordinates: [77.089, 28.495] };
const BY_SCORE = { score: { $meta: 'searchScore', order: -1 }, _id: 1 };
// Relevance ties break by rating (Step 6 decision), then _id.
const BY_RELEVANCE = {
  score: { $meta: 'searchScore', order: -1 },
  'rating.average': { order: -1, noData: 'lowest' },
  _id: 1,
};
const BY_RATING = {
  'rating.average': { order: -1, noData: 'lowest' },
  'rating.votes': -1,
  _id: 1,
};
const NAME_GOLI = {
  compound: {
    should: [
      { autocomplete: { path: 'name', query: 'goli' } },
      {
        text: {
          path: 'name',
          query: 'goli',
          fuzzy: { maxEdits: 1, prefixLength: 2 },
        },
      },
    ],
    minimumShouldMatch: 1,
  },
};
const NEAR = { near: { path: 'location', origin: POINT, pivot: 1000 } };

function criteria(extra: Partial<SearchCriteria> = {}): SearchCriteria {
  return { cuisineMatch: 'any', ...extra };
}

function search(
  c: SearchCriteria,
  options: Partial<typeof OPTIONS> & { searchAfter?: string } = {},
): Document {
  const [stage] = buildSearchPipeline(c, { ...OPTIONS, ...options });
  return (stage as { $search: Document }).$search;
}

function filters(c: SearchCriteria): Document[] {
  return search(c)['compound'].filter as Document[];
}

describe('buildSearchPipeline', () => {
  it('builds the default list: tenant only, rating order, stored source, limit + 1', () => {
    expect(buildSearchPipeline(criteria(), OPTIONS)).toEqual([
      {
        $search: {
          index: 'restaurants_search',
          compound: { filter: [TENANT] },
          sort: BY_RATING,
          returnStoredSource: true,
        },
      },
      { $limit: 21 },
      { $addFields: { paginationToken: { $meta: 'searchSequenceToken' } } },
    ]);
  });

  it('always puts the tenant filter first (Rule 1, invariant 5)', () => {
    expect(filters(criteria({ city: 'gurgaon', minRating: 4 }))[0]).toEqual(
      TENANT,
    );
  });

  it('never filters after $search (invariant 8)', () => {
    const pipeline = buildSearchPipeline(
      criteria({ city: 'gurgaon', origin: ORIGIN }),
      OPTIONS,
    );

    expect(pipeline.slice(1).some((stage) => '$match' in stage)).toBe(false);
  });

  describe('filters (Rules 1, 2, 3)', () => {
    it.each<[string, Partial<SearchCriteria>, Document]>([
      [
        'city',
        { city: 'gurgaon' },
        { equals: { path: 'norm.city', value: 'gurgaon' } },
      ],
      [
        'cuisine any',
        { cuisines: ['cafe', 'bakery'] },
        { in: { path: 'norm.cuisines', value: ['cafe', 'bakery'] } },
      ],
      [
        'minRating',
        { minRating: 4 },
        { range: { path: 'rating.average', gte: 4 } },
      ],
      [
        'minVotes',
        { minVotes: 20 },
        { range: { path: 'rating.votes', gte: 20 } },
      ],
    ])('%s', (_case, extra, clause) => {
      expect(filters(criteria(extra))).toEqual([TENANT, clause]);
    });

    it('cuisine all: one equals per cuisine', () => {
      expect(
        filters(
          criteria({ cuisines: ['cafe', 'bakery'], cuisineMatch: 'all' }),
        ),
      ).toEqual([
        TENANT,
        { equals: { path: 'norm.cuisines', value: 'cafe' } },
        { equals: { path: 'norm.cuisines', value: 'bakery' } },
      ]);
    });

    it('a cost range always comes with its currency (Rule 11)', () => {
      expect(
        filters(criteria({ minCost: 100, maxCost: 500, currency: 'INR' })),
      ).toEqual([
        TENANT,
        { range: { path: 'cost.averageForTwo', gte: 100, lte: 500 } },
        { equals: { path: 'cost.currency', value: 'INR' } },
      ]);
    });

    it('a cost floor or ceiling alone', () => {
      expect(filters(criteria({ maxCost: 500, currency: 'USD' }))[1]).toEqual({
        range: { path: 'cost.averageForTwo', lte: 500 },
      });
    });
  });

  describe('sorts (Rules 2, 6, invariant 9)', () => {
    it('explicit rating: exists filter, rating then votes then _id', () => {
      const stage = search(criteria({ sort: 'rating' }));

      expect(stage['compound'].filter).toEqual([
        TENANT,
        { exists: { path: 'rating.average' } },
      ]);
      expect(stage['sort']).toEqual(BY_RATING);
    });

    it('rating order asc flips only the primary key', () => {
      expect(
        search(criteria({ sort: 'rating', order: 'asc' }))['sort'],
      ).toEqual({
        ...BY_RATING,
        'rating.average': { order: 1, noData: 'lowest' },
      });
    });

    it('default rating: no exists filter, so unrated restaurants stay, last', () => {
      expect(search(criteria())['compound'].filter).toEqual([TENANT]);
      expect(search(criteria())['sort']['rating.average'].noData).toBe(
        'lowest',
      );
    });

    it.each<[('asc' | 'desc') | undefined, number]>([
      [undefined, 1],
      ['asc', 1],
      ['desc', -1],
    ])('cost order %s → %d, with exists and currency', (order, direction) => {
      const stage = search(
        criteria({ sort: 'cost', currency: 'INR', ...(order && { order }) }),
      );

      expect(stage['sort']).toEqual({
        'cost.averageForTwo': direction,
        _id: 1,
      });
      expect(stage['compound'].filter).toEqual([
        TENANT,
        { equals: { path: 'cost.currency', value: 'INR' } },
        { exists: { path: 'cost.averageForTwo' } },
      ]);
    });

    it('distance: near is the only scored clause, in should (unknown locations last)', () => {
      const stage = search(criteria({ origin: ORIGIN, sort: 'distance' }));

      expect(stage['compound'].should).toEqual([NEAR]);
      expect(stage['compound']).not.toHaveProperty('must');
      expect(stage['sort']).toEqual(BY_SCORE);
    });

    it('the default distance order is built exactly like the explicit one', () => {
      expect(search(criteria({ origin: ORIGIN }))).toEqual(
        search(criteria({ origin: ORIGIN, sort: 'distance' })),
      );
    });

    it('refuses a distance sort without coordinates (the schema prevents it)', () => {
      expect(() =>
        buildSearchPipeline(criteria({ sort: 'distance' }), OPTIONS),
      ).toThrow();
    });
  });

  describe('name (Rule 4)', () => {
    it('relevance: the name clause is in must, ordered by score then rating', () => {
      const stage = search(criteria({ name: 'goli' }));

      expect(stage['compound']).toEqual({
        filter: [TENANT],
        must: [NAME_GOLI],
      });
      expect(stage['sort']).toEqual(BY_RELEVANCE);
    });

    it.each<[string, Partial<SearchCriteria>]>([
      ['cost', { sort: 'cost', currency: 'INR' }],
      ['rating', { sort: 'rating' }],
      ['distance', { sort: 'distance', origin: ORIGIN }],
    ])(
      'with sort=%s the name moves to filter, so it narrows without reordering',
      (_case, extra) => {
        const stage = search(criteria({ name: 'goli', ...extra }));

        expect(stage['compound'].filter).toContainEqual(NAME_GOLI);
        expect(stage['compound']).not.toHaveProperty('must');
      },
    );
  });

  describe('radius (Rule 5, invariant 13)', () => {
    const circle = (km: number) => ({
      geoWithin: {
        path: 'location',
        circle: { center: POINT, radius: km * 1000 },
      },
    });

    it('coordinates without a city: 5 km by default', () => {
      expect(filters(criteria({ origin: ORIGIN }))).toEqual([
        TENANT,
        circle(5),
      ]);
    });

    it('coordinates without a city: radiusKm when given', () => {
      expect(filters(criteria({ origin: ORIGIN, radiusKm: 12 }))).toEqual([
        TENANT,
        circle(12),
      ]);
    });

    it('coordinates with a city: no radius, the city filters', () => {
      expect(filters(criteria({ origin: ORIGIN, city: 'gurgaon' }))).toEqual([
        TENANT,
        { equals: { path: 'norm.city', value: 'gurgaon' } },
      ]);
    });

    it('coordinates with a city: radiusKm applies only when given', () => {
      expect(
        filters(criteria({ origin: ORIGIN, city: 'gurgaon', radiusKm: 2 })),
      ).toContainEqual(circle(2));
    });

    it('coordinates with a city still order by distance by default', () => {
      expect(
        search(criteria({ origin: ORIGIN, city: 'gurgaon' }))['compound']
          .should,
      ).toEqual([NEAR]);
    });
  });

  describe('page (Rules 7, 8, invariants 14, 15)', () => {
    it('adds distanceKm for the page only, after $limit', () => {
      const pipeline = buildSearchPipeline(criteria({ origin: ORIGIN }), {
        ...OPTIONS,
        limit: 5,
      });

      expect(pipeline.slice(1)).toEqual([
        { $limit: 6 },
        {
          $addFields: {
            paginationToken: { $meta: 'searchSequenceToken' },
            distanceKm: haversineDistanceKmExpression(ORIGIN),
          },
        },
      ]);
    });

    it('passes searchAfter through when continuing', () => {
      expect(search(criteria(), { searchAfter: 'tok' })['searchAfter']).toBe(
        'tok',
      );
    });

    it('omits searchAfter on the first page', () => {
      expect(search(criteria())).not.toHaveProperty('searchAfter');
    });
  });

  it('combines everything: brief example 1 (city, cuisine, vote floor, rating)', () => {
    expect(
      search(
        criteria({
          city: 'gurgaon',
          cuisines: ['south indian'],
          minVotes: 20,
          sort: 'rating',
        }),
      ),
    ).toEqual({
      index: 'restaurants_search',
      compound: {
        filter: [
          TENANT,
          { equals: { path: 'norm.city', value: 'gurgaon' } },
          { in: { path: 'norm.cuisines', value: ['south indian'] } },
          { range: { path: 'rating.votes', gte: 20 } },
          { exists: { path: 'rating.average' } },
        ],
      },
      sort: BY_RATING,
      returnStoredSource: true,
    });
  });
  describe('Step 6 clauses (ADR-002)', () => {
    const VADA_PAV = { phrase: 'vada pav', cuisines: ['street food'] };
    const DISH_CLAUSE = {
      compound: {
        should: [
          { phrase: { path: 'name', query: 'vada pav' } },
          { in: { path: 'norm.cuisines', value: ['street food'] } },
        ],
        minimumShouldMatch: 1,
      },
    };

    it('a dish is a must clause for relevance (name phrase OR cuisine)', () => {
      const stage = search(criteria({ dishes: [VADA_PAV] }));

      expect(stage['compound']).toEqual({
        filter: [TENANT],
        must: [DISH_CLAUSE],
      });
      expect(stage['sort']).toEqual(BY_RELEVANCE);
    });

    it('a dish is a filter for distance, so the order is pure distance', () => {
      const stage = search(
        criteria({ dishes: [VADA_PAV], origin: ORIGIN, sort: 'distance' }),
      );

      expect(stage['compound'].filter).toContainEqual(DISH_CLAUSE);
      expect(stage['compound'].should).toEqual([NEAR]);
      expect(stage['compound']).not.toHaveProperty('must');
    });

    it('several dishes: one should with every phrase and the union of cuisines', () => {
      const stage = search(
        criteria({
          dishes: [
            { phrase: 'dosa', cuisines: ['south indian'] },
            { phrase: 'momos', cuisines: ['tibetan', 'chinese'] },
            { phrase: 'idli', cuisines: ['south indian'] },
          ],
        }),
      );

      expect(stage['compound'].must).toEqual([
        {
          compound: {
            should: [
              { phrase: { path: 'name', query: 'dosa' } },
              { phrase: { path: 'name', query: 'momos' } },
              { phrase: { path: 'name', query: 'idli' } },
              {
                in: {
                  path: 'norm.cuisines',
                  value: ['south indian', 'tibetan', 'chinese'],
                },
              },
            ],
            minimumShouldMatch: 1,
          },
        },
      ]);
    });

    it('a dish without known cuisines matches names only', () => {
      expect(
        search(criteria({ dishes: [{ phrase: 'xyz', cuisines: [] }] }))[
          'compound'
        ].must,
      ).toEqual([
        {
          compound: {
            should: [{ phrase: { path: 'name', query: 'xyz' } }],
            minimumShouldMatch: 1,
          },
        },
      ]);
    });

    it('text: a required fuzzy match on name (with autocomplete), cuisines and locality', () => {
      const fuzzy = { maxEdits: 1, prefixLength: 2 };
      expect(
        search(criteria({ text: 'goli vada pao' }))['compound'].must,
      ).toEqual([
        {
          compound: {
            should: [
              { autocomplete: { path: 'name', query: 'goli vada pao' } },
              { text: { path: 'name', query: 'goli vada pao', fuzzy } },
              { text: { path: 'cuisines', query: 'goli vada pao', fuzzy } },
              {
                text: {
                  path: 'address.locality',
                  query: 'goli vada pao',
                  fuzzy,
                },
              },
            ],
            minimumShouldMatch: 1,
          },
        },
      ]);
    });

    it('text moves to filter with an explicit sort', () => {
      const stage = search(criteria({ text: 'goli', sort: 'rating' }));

      expect(stage['compound']).not.toHaveProperty('must');
      expect(stage['compound'].filter).toHaveLength(3);
    });

    it('boost terms are should clauses with relevance, never filters', () => {
      const stage = search(
        criteria({ cuisines: ['south indian'], boostTerms: ['cyber hub'] }),
      );

      expect(stage['compound'].should).toEqual([
        {
          text: {
            path: ['name', 'cuisines', 'address.locality'],
            query: ['cyber hub'],
            fuzzy: { maxEdits: 1 },
          },
        },
      ]);
      expect(stage['compound']).not.toHaveProperty('must');
    });

    it('boost terms are ignored by distance, rating and cost orders', () => {
      expect(
        search(criteria({ boostTerms: ['cyber hub'], sort: 'rating' }))[
          'compound'
        ],
      ).not.toHaveProperty('should');
    });

    it('features and the price tier are filters', () => {
      expect(
        filters(
          criteria({
            features: { onlineDelivery: true, tableBooking: true },
            maxPriceRange: 2,
          }),
        ),
      ).toEqual([
        TENANT,
        { equals: { path: 'features.onlineDelivery', value: true } },
        { equals: { path: 'features.tableBooking', value: true } },
        { range: { path: 'cost.priceRange', lte: 2 } },
      ]);
    });

    describe('price preference (no resolvable currency)', () => {
      const preference = (value: number) => ({
        range: {
          path: 'cost.averageForTwo',
          lte: 500,
          score: { constant: { value } },
        },
      });

      it('distance: near plus a constant of 10, never a filter', () => {
        const stage = search(
          criteria({ origin: ORIGIN, pricePreference: { maxCost: 500 } }),
        );

        expect(stage['compound'].should).toEqual([NEAR, preference(10)]);
        expect(JSON.stringify(stage['compound'].filter)).not.toContain(
          'averageForTwo',
        );
        expect(stage['sort']).toEqual(BY_SCORE);
      });

      it('relevance: a constant of 1000', () => {
        expect(
          search(
            criteria({ text: 'pizza', pricePreference: { maxCost: 500 } }),
          )['compound'].should,
        ).toEqual([preference(1000)]);
      });

      it('rating: a constant of 1, and the sort starts with the score', () => {
        const stage = search(criteria({ pricePreference: { maxCost: 500 } }));

        expect(stage['compound'].should).toEqual([preference(1)]);
        expect(stage['sort']).toEqual({
          score: { $meta: 'searchScore', order: -1 },
          ...BY_RATING,
        });
      });

      it('cost: the sort starts with the score too', () => {
        expect(
          search(
            criteria({
              sort: 'cost',
              currency: 'INR',
              pricePreference: { minCost: 100 },
            }),
          )['sort'],
        ).toEqual({
          score: { $meta: 'searchScore', order: -1 },
          'cost.averageForTwo': 1,
          _id: 1,
        });
      });

      it('a floor as well as a ceiling', () => {
        expect(
          search(criteria({ pricePreference: { minCost: 100, maxCost: 500 } }))[
            'compound'
          ].should,
        ).toEqual([
          {
            range: {
              path: 'cost.averageForTwo',
              gte: 100,
              lte: 500,
              score: { constant: { value: 1 } },
            },
          },
        ]);
      });
    });
  });
});

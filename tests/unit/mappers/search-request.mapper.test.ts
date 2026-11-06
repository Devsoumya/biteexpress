import {
  toInterpretationBody,
  toSearchRequestCriteria,
} from '../../../src/mappers/search-criteria.mapper';
import type { Interpretation } from '../../../src/models/search.model';
import { searchRestaurantsQuerySchema } from '../../../src/validators/restaurant.schema';
import { staticVocabulary } from '../../helpers/vocabulary';

const vocabulary = staticVocabulary().snapshot();

function finalize(
  criteria: Interpretation['criteria'],
  raw: Record<string, unknown> = {},
) {
  return toSearchRequestCriteria(
    { criteria, notes: [] },
    searchRestaurantsQuerySchema.parse({ q: 'x', ...raw }),
    vocabulary,
  );
}

describe('toSearchRequestCriteria', () => {
  it('keeps parsed criteria and adds cuisineMatch any', () => {
    expect(finalize({ city: 'gurgaon', cuisines: ['cafe'] })).toEqual({
      criteria: { cuisineMatch: 'any', city: 'gurgaon', cuisines: ['cafe'] },
      notes: [],
    });
  });

  it('an explicit parameter overrides the parsed value, with a note', () => {
    expect(finalize({ city: 'gurgaon' }, { city: 'New Delhi' })).toEqual({
      criteria: { cuisineMatch: 'any', city: 'new delhi' },
      notes: ["city: 'gurgaon' from the query, overridden by city=new delhi"],
    });
  });

  it('no note when the explicit value equals the parsed one', () => {
    expect(finalize({ city: 'gurgaon' }, { city: 'Gurugram' }).notes).toEqual(
      [],
    );
  });

  it('an explicit sort replaces the parsed sort and its order', () => {
    expect(
      finalize(
        { sort: 'cost', order: 'asc', city: 'gurgaon' },
        { sort: 'rating' },
      ).criteria,
    ).toEqual({ cuisineMatch: 'any', city: 'gurgaon', sort: 'rating' });
  });

  it('explicit coordinates and cuisines are named by their parameters in notes', () => {
    const { notes } = finalize({ cuisines: ['cafe'] }, { cuisine: 'chinese' });
    expect(notes).toEqual([
      "cuisines: 'cafe' from the query, overridden by cuisine=chinese",
    ]);
  });

  describe('currency', () => {
    it('a parsed price with a written currency stays a filter', () => {
      expect(
        finalize({ maxCost: 1000, currency: 'INR' }).criteria,
      ).toMatchObject({
        maxCost: 1000,
        currency: 'INR',
      });
    });

    it("a parsed price takes the city's currency", () => {
      expect(finalize({ maxCost: 50, city: 'orlando' }).criteria).toMatchObject(
        {
          maxCost: 50,
          currency: 'USD',
        },
      );
    });

    it('an explicit currency resolves a parsed price', () => {
      expect(
        finalize({ maxCost: 100 }, { currency: 'aed' }).criteria,
      ).toMatchObject({
        maxCost: 100,
        currency: 'AED',
      });
    });

    it('a parsed price without a resolvable currency becomes a preference, with a note', () => {
      expect(finalize({ maxCost: 500 }, { lat: '25.2', lng: '55.27' })).toEqual(
        {
          criteria: {
            cuisineMatch: 'any',
            origin: { lat: 25.2, lng: 55.27 },
            pricePreference: { maxCost: 500 },
          },
          notes: [
            'no currency given: restaurants within the price first, then the rest; add Rs, $ or currency= to filter',
          ],
        },
      );
    });

    it('a parsed "cheapest" without a currency is dropped, with a note', () => {
      expect(finalize({ sort: 'cost', order: 'asc' })).toEqual({
        criteria: { cuisineMatch: 'any' },
        notes: [
          'cheapest needs a currency or a known city; showing best matches',
        ],
      });
    });

    it('explicit cost parameters without a resolvable currency are a 400, as on the list', () => {
      expect(() => finalize({}, { maxCost: '500' })).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    });

    it('a currency without any cost filter or sort is dropped', () => {
      expect(
        finalize({ currency: 'INR', city: 'gurgaon' }).criteria,
      ).not.toHaveProperty('currency');
    });
  });

  it('boost terms are dropped with a note when the order is not relevance', () => {
    expect(
      finalize({ boostTerms: ['cyber hub'], sort: 'rating', minVotes: 20 }),
    ).toEqual({
      criteria: { cuisineMatch: 'any', sort: 'rating', minVotes: 20 },
      notes: ['boost terms ignored with sort=rating: cyber hub'],
    });
  });

  it('boost terms stay with relevance', () => {
    expect(finalize({ boostTerms: ['cyber hub'] }).criteria.boostTerms).toEqual(
      ['cyber hub'],
    );
  });
});

describe('toInterpretationBody', () => {
  it('shows the normalized values, the resolved order and the notes, not internals', () => {
    expect(
      toInterpretationBody(
        'Best in Gurgaon',
        {
          cuisineMatch: 'any',
          city: 'gurgaon',
          minVotes: 20,
          sort: 'rating',
          origin: { lat: 1, lng: 2 },
        },
        ['ignored: in'],
      ),
    ).toEqual({
      query: 'Best in Gurgaon',
      city: 'gurgaon',
      minVotes: 20,
      sort: 'rating',
      notes: ['ignored: in'],
    });
  });

  it('reports relevance when there is a dish and no sort', () => {
    expect(
      toInterpretationBody(
        'vada pav',
        { cuisineMatch: 'any', dishes: [{ phrase: 'vada pav', cuisines: [] }] },
        [],
      ).sort,
    ).toBe('relevance');
  });
});

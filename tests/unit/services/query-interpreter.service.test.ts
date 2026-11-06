import type { SearchVocabulary } from '../../../src/models/search.model';
import {
  RuleBasedQueryInterpreter,
  parseAmount,
  tokenize,
} from '../../../src/services/query-interpreter.service';

// A small vocabulary with the data's real collisions: goa (city) vs goan
// (cuisine), bangalore vs mangalore (one edit apart), multi-word cuisines
// containing "food".
export const VOCABULARY: SearchVocabulary = {
  cities: new Map([
    ['gurgaon', 'IN'],
    ['new delhi', 'IN'],
    ['noida', 'IN'],
    ['bangalore', 'IN'],
    ['mangalore', 'IN'],
    ['mumbai', 'IN'],
    ['goa', 'IN'],
    ['orlando', 'US'],
    ['dubai', 'AE'],
  ]),
  cuisines: new Set([
    'south indian',
    'north indian',
    'street food',
    'fast food',
    'chinese',
    'tibetan',
    'goan',
    'cafe',
    'pizza',
    'biryani',
  ]),
};

const interpreter = new RuleBasedQueryInterpreter({ bestMinVotes: 20 });
const read = (q: string, hasCoords = false) =>
  interpreter.interpret(q, { hasCoords, vocabulary: VOCABULARY });

describe('RuleBasedQueryInterpreter', () => {
  describe('the three brief queries', () => {
    it('Best restaurants in Gurgaon with South Indian Food', () => {
      expect(
        read('Best restaurants in Gurgaon with South Indian Food'),
      ).toEqual({
        criteria: {
          city: 'gurgaon',
          cuisines: ['south indian'],
          sort: 'rating',
          minVotes: 20,
        },
        notes: ['ignored: restaurants, with, food'],
      });
    });

    it('Restaurants in Gurgaon under Rs. 1000 for two', () => {
      expect(read('Restaurants in Gurgaon under Rs. 1000 for two')).toEqual({
        criteria: { city: 'gurgaon', maxCost: 1000, currency: 'INR' },
        notes: ['ignored: restaurants, for, two'],
      });
    });

    it('Nearest place that serves Vada Pav (with coordinates)', () => {
      expect(read('Nearest place that serves Vada Pav', true)).toEqual({
        criteria: {
          dishes: [{ phrase: 'vada pav', cuisines: ['street food'] }],
          sort: 'distance',
        },
        notes: ['ignored: place, that, serves'],
      });
    });

    it('Nearest place that serves Vada Pav (no coordinates): relevance, with a note', () => {
      expect(read('Nearest place that serves Vada Pav')).toEqual({
        criteria: {
          dishes: [{ phrase: 'vada pav', cuisines: ['street food'] }],
        },
        notes: [
          'nearest needs lat/lng; showing best matches',
          'ignored: place, that, serves',
        ],
      });
    });
  });

  describe('price (pass 1)', () => {
    it.each<[string, Record<string, unknown>]>([
      ['under 1000', { maxCost: 1000 }],
      ['below Rs 1,000', { maxCost: 1000, currency: 'INR' }],
      ['under ₹1000', { maxCost: 1000, currency: 'INR' }],
      ['less than 1k', { maxCost: 1000 }],
      ['up to 1.5k rupees', { maxCost: 1500, currency: 'INR' }],
      ['over 300', { minCost: 300 }],
      ['more than $20', { minCost: 20, currency: 'USD' }],
      ['between 500 and 1500', { minCost: 500, maxCost: 1500 }],
      ['500-1500', { minCost: 500, maxCost: 1500 }],
      ['1500 to 500', { minCost: 500, maxCost: 1500 }],
      ['under 50 dollars', { maxCost: 50, currency: 'USD' }],
      ['cheap', { maxPriceRange: 2 }],
      ['budget friendly', { maxPriceRange: 2, boostTerms: ['friendly'] }],
    ])('%s', (q, expected) => {
      expect(read(q).criteria).toEqual(expected);
    });

    it('a number without a price word is not a price (top 10)', () => {
      expect(read('top 10 pizza').criteria).toEqual({
        cuisines: ['pizza'],
        sort: 'rating',
        minVotes: 20,
      });
    });
  });

  describe('intent (pass 2) and precedence', () => {
    it.each<[string, boolean, Record<string, unknown>]>([
      [
        'top rated cafe',
        false,
        { cuisines: ['cafe'], sort: 'rating', minVotes: 20 },
      ],
      [
        'highest rated cafe',
        false,
        { cuisines: ['cafe'], sort: 'rating', minVotes: 20 },
      ],
      ['cafe near me', true, { cuisines: ['cafe'], sort: 'distance' }],
      ['closest cafe', true, { cuisines: ['cafe'], sort: 'distance' }],
      [
        'cheapest cafe',
        false,
        { cuisines: ['cafe'], sort: 'cost', order: 'asc' },
      ],
    ])('%s (coords: %s)', (q, hasCoords, expected) => {
      expect(read(q, hasCoords).criteria).toEqual(expected);
    });

    it('nearest beats best with coordinates; best keeps its vote floor', () => {
      expect(read('best cafe near me', true)).toEqual({
        criteria: { cuisines: ['cafe'], sort: 'distance', minVotes: 20 },
        notes: ['best: nearest first among restaurants with at least 20 votes'],
      });
    });

    it('best beats cheapest, with a note', () => {
      expect(read('best cheapest pizza')).toEqual({
        criteria: { cuisines: ['pizza'], sort: 'rating', minVotes: 20 },
        notes: ['cheapest ignored: sorted by rating'],
      });
    });
  });

  describe('features (pass 3)', () => {
    it.each([
      ['pizza with online delivery', { onlineDelivery: true }],
      ['pizza delivery', { onlineDelivery: true }],
      ['book a table for chinese', { tableBooking: true }],
      [
        'chinese with delivery and table booking',
        { onlineDelivery: true, tableBooking: true },
      ],
    ])('%s', (q, features) => {
      expect(read(q).criteria.features).toEqual(features);
    });
  });

  describe('city (pass 4)', () => {
    it.each<[string, string]>([
      ['cafe in gurugram', 'gurgaon'],
      ['cafe in Delhi', 'new delhi'],
      ['cafe in bengaluru', 'bangalore'],
      ['cafe in Bombay', 'mumbai'],
      ['cafe in new delhi', 'new delhi'],
      ['gurgaon cafe', 'gurgaon'],
      ['NEW DELHI chinese', 'new delhi'],
    ])('%s → %s', (q, city) => {
      expect(read(q).criteria.city).toBe(city);
    });

    it('corrects a typo when exactly one city is one edit away', () => {
      expect(read('cafe in gurgoan')).toEqual({
        criteria: { city: 'gurgaon', cuisines: ['cafe'] },
        notes: ["showing results for 'gurgaon' (you typed 'gurgoan')"],
      });
    });

    it('does not correct when two cities are one edit away', () => {
      expect(read('cafe in nangalore')).toEqual({
        criteria: { city: 'nangalore', cuisines: ['cafe'] },
        notes: ["no city 'nangalore'; did you mean bangalore or mangalore?"],
      });
    });

    it('keeps an unknown city after "in", so the list is empty, with a note', () => {
      expect(read('cafe in atlantis')).toEqual({
        criteria: { city: 'atlantis', cuisines: ['cafe'] },
        notes: ["no city 'atlantis'"],
      });
    });

    it.each(['best cafe in town', 'chinese in my area'])(
      'does not take "%s" as a city',
      (q) => {
        expect(read(q).criteria).not.toHaveProperty('city');
      },
    );

    it('does not take a cuisine after "in" as a city', () => {
      expect(read('restaurants in south indian style').criteria).toEqual({
        cuisines: ['south indian'],
        boostTerms: ['style'],
      });
    });

    it('goa (city) and goan (cuisine) are different words', () => {
      expect(read('goan food in goa').criteria).toEqual({
        city: 'goa',
        cuisines: ['goan'],
      });
      expect(read('goan').criteria).toEqual({ cuisines: ['goan'] });
    });

    it('a bare city word inside a name is still the city (known limit)', () => {
      expect(read('Delhi Darbar').criteria).toEqual({
        city: 'new delhi',
        boostTerms: ['darbar'],
      });
    });
  });

  describe('dishes (pass 5) and cuisines (pass 6)', () => {
    it('a dish maps to a name phrase OR its cuisines (only those that exist)', () => {
      expect(read('momos').criteria).toEqual({
        dishes: [{ phrase: 'momos', cuisines: ['tibetan', 'chinese'] }],
      });
      expect(read('dosa').criteria.dishes).toEqual([
        { phrase: 'dosa', cuisines: ['south indian'] },
      ]);
    });

    it('"pav" alone is not a dish: never a prefix clause, only text', () => {
      expect(read('pav').criteria).toEqual({ text: 'pav' });
    });

    it('several dishes or cuisines match any, with a note', () => {
      expect(read('dosa or biryani')).toEqual({
        criteria: {
          dishes: [
            { phrase: 'dosa', cuisines: ['south indian'] },
            { phrase: 'biryani', cuisines: ['biryani'] },
          ],
        },
        notes: ['several dishes: matching any of them', 'ignored: or'],
      });
      expect(read('chinese pizza').notes).toContain(
        'several cuisines: matching any of them',
      );
    });

    it('a multi-word cuisine wins over the filler "food"', () => {
      expect(read('street food').criteria).toEqual({
        cuisines: ['street food'],
      });
    });
  });

  describe('leftovers (pass 7) and fallback (pass 8)', () => {
    it('unknown words become boost phrases, never filters', () => {
      expect(read('south indian near cyber hub')).toEqual({
        criteria: { cuisines: ['south indian'], boostTerms: ['cyber hub'] },
        notes: ['ignored: near', 'boosting: cyber hub'],
      });
    });

    it('nothing recognized → the meaningful words become text (typo-tolerant names)', () => {
      expect(read('Goli Vada Pao restaurant')).toEqual({
        criteria: { text: 'goli vada pao' },
        notes: [
          'ignored: restaurant',
          "searching names, cuisines and localities for 'goli vada pao'",
        ],
      });
    });

    it('everyday words for "place" are fillers, so near me keeps its distance order', () => {
      expect(read('cheap eats near me', true).criteria).toEqual({
        maxPriceRange: 2,
        sort: 'distance',
      });
    });

    it('only fillers → the default list, with a note', () => {
      expect(read('restaurants')).toEqual({
        criteria: {},
        notes: [
          'ignored: restaurants',
          'nothing to search for; showing the default list',
        ],
      });
    });

    it('caps boost terms at 10', () => {
      const q =
        'pizza ' + Array.from({ length: 12 }, (_, i) => `w${i} x`).join(' x ');
      expect(read(q).criteria.boostTerms?.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('tokenize and parseAmount', () => {
  it('folds case and accents, rewrites currency symbols and ranges', () => {
    expect(tokenize('Café under ₹1,000; 500-900 $')).toEqual([
      'cafe',
      'under',
      'rs',
      '1,000',
      '500',
      'to',
      '900',
      'usd',
    ]);
  });

  it.each<[string, number | undefined]>([
    ['1000', 1000],
    ['1,000', 1000],
    ['1k', 1000],
    ['1.5k', 1500],
    ['abc', undefined],
    ['k', undefined],
  ])('parseAmount(%s) = %s', (word, amount) => {
    expect(parseAmount(word)).toBe(amount);
  });
});

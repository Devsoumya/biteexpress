import type { SearchCriteria } from '../../../src/models/search.model';
import { resolveSort } from '../../../src/utils/search-sort';

const ORIGIN = { lat: 28.495, lng: 77.089 };
const VADA_PAV = { phrase: 'vada pav', cuisines: ['street food'] };

function criteria(extra: Partial<SearchCriteria> = {}): SearchCriteria {
  return { cuisineMatch: 'any', ...extra };
}

describe('resolveSort (Rule 3)', () => {
  it.each<[string, Partial<SearchCriteria>, string]>([
    ['nothing', {}, 'rating'],
    ['a name', { name: 'goli' }, 'relevance'],
    ['coordinates', { origin: ORIGIN }, 'distance'],
    ['a name and coordinates', { name: 'goli', origin: ORIGIN }, 'relevance'],
    [
      'an explicit sort over a name',
      { name: 'goli', sort: 'cost', currency: 'INR' },
      'cost',
    ],
  ])('%s → %s', (_case, extra, expected) => {
    expect(resolveSort(criteria(extra))).toBe(expected);
  });

  it('dishes, text and boost terms default to relevance', () => {
    expect(resolveSort(criteria({ dishes: [VADA_PAV] }))).toBe('relevance');
    expect(resolveSort(criteria({ text: 'goli' }))).toBe('relevance');
    expect(resolveSort(criteria({ boostTerms: ['cyber hub'] }))).toBe(
      'relevance',
    );
  });
});

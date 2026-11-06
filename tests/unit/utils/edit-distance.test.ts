import { withinOneEdit } from '../../../src/utils/edit-distance';

describe('withinOneEdit', () => {
  it.each<[string, string, boolean]>([
    ['gurgaon', 'gurgaon', true],
    ['gurgoan', 'gurgaon', true], // adjacent swap
    ['gurgaun', 'gurgaon', true], // substitution
    ['gurgon', 'gurgaon', true], // deletion
    ['gurgaaon', 'gurgaon', true], // insertion
    ['bangalor', 'bangalore', true],
    ['nangalore', 'bangalore', true],
    ['nangalore', 'mangalore', true],
    ['bangalore', 'mangalore', true],
    ['grugaon', 'gurgaon', true], // one adjacent swap (r and u)
    ['gurgn', 'gurgaon', false], // two deletions
    ['gurgaonxx', 'gurgaon', false],
    ['abcd', 'badc', false], // two swaps
    ['', 'a', true],
    ['', 'ab', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(withinOneEdit(a, b)).toBe(expected);
    expect(withinOneEdit(b, a)).toBe(expected);
  });
});

import {
  editDistanceWithin,
  typoAllowance,
  withinOneEdit,
} from '../../../src/utils/edit-distance';

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

describe('editDistanceWithin', () => {
  it.each<[string, string, number, number | undefined]>([
    ['chinese', 'chinese', 1, 0],
    ['chineese', 'chinese', 1, 1], // insertion
    ['chinse', 'chinese', 1, 1], // deletion
    ['chinece', 'chinese', 1, 1], // substitution
    ['indain', 'indian', 1, 1], // adjacent swap
    ['chineeze', 'chinese', 1, undefined], // two edits, one allowed
    ['chineeze', 'chinese', 2, 2],
    ['mediteranaen', 'mediterranean', 2, 2], // deletion + swap
    ['pizza', 'pasta', 2, undefined], // three substitutions
    ['dosa', 'dosaaa', 1, undefined], // length gap alone exceeds max
    ['', 'ab', 2, 2],
    ['abcd', 'badc', 2, 2], // two swaps
  ])('%s vs %s within %i → %s', (a, b, max, expected) => {
    expect(editDistanceWithin(a, b, max)).toBe(expected);
    expect(editDistanceWithin(b, a, max)).toBe(expected);
  });
});

describe('typoAllowance', () => {
  it.each<[string, number]>([
    ['thai', 0],
    ['dosaa', 1],
    ['chineese', 1],
    ['italiano', 1],
    ['contnental', 2],
    ['mediteranaen', 2],
  ])('%s → %i', (word, expected) => {
    expect(typoAllowance(word)).toBe(expected);
  });
});

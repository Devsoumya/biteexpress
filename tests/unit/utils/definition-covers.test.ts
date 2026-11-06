import { definitionCovers } from '../../../src/db/restaurant-collection.setup';

describe('definitionCovers', () => {
  it('accepts server defaults and a different key order', () => {
    const stored = {
      mappings: {
        fields: { name: { analyzer: 'folding', type: 'string', store: true } },
        dynamic: false,
      },
    };
    const expected = {
      mappings: {
        dynamic: false,
        fields: { name: { type: 'string', analyzer: 'folding' } },
      },
    };

    expect(definitionCovers(stored, expected)).toBe(true);
  });

  it('ignores the order of set-like arrays, as the server reorders them', () => {
    const stored = {
      storedSource: { include: ['address', 'name'] },
      name: [{ type: 'autocomplete', minGrams: 2 }, { type: 'string' }],
    };
    const expected = {
      storedSource: { include: ['name', 'address'] },
      name: [{ type: 'string' }, { type: 'autocomplete', minGrams: 2 }],
    };

    expect(definitionCovers(stored, expected)).toBe(true);
  });

  it('keeps the order of analyzer filter chains, where order matters', () => {
    const stored = {
      tokenFilters: [{ type: 'icuFolding' }, { type: 'lowercase' }],
    };
    const expected = {
      tokenFilters: [{ type: 'lowercase' }, { type: 'icuFolding' }],
    };

    expect(definitionCovers(stored, expected)).toBe(false);
  });

  it('matches each expected item to a different stored item', () => {
    expect(
      definitionCovers(
        { a: [{ t: 'x' }, { t: 'y' }] },
        { a: [{ t: 'x' }, { t: 'x' }] },
      ),
    ).toBe(false);
  });

  it.each([
    ['a changed value', { a: { b: 1 } }, { a: { b: 2 } }],
    ['a missing key', { a: {} }, { a: { b: 1 } }],
    ['an array of a different length', { a: [1, 2] }, { a: [1] }],
    ['an array item that differs', { a: [{ x: 1 }] }, { a: [{ x: 2 }] }],
    ['a scalar where an object is expected', { a: 1 }, { a: { b: 1 } }],
    ['null where an object is expected', { a: null }, { a: { b: 1 } }],
    ['a scalar where an array is expected', { a: 'x' }, { a: ['x'] }],
  ])('rejects %s', (_case, stored, expected) => {
    expect(definitionCovers(stored, expected)).toBe(false);
  });
});

import { CITY_ALIASES } from '../../../src/constants/city-aliases';
import {
  normalize,
  normalizeCity,
  normalizeCuisines,
  splitCuisines,
} from '../../../src/utils/normalize';

describe('normalize', () => {
  it.each([
    ['lowercases', 'GURGAON', 'gurgaon'],
    ['folds accents', 'São Paulo', 'sao paulo'],
    ['folds accents', 'Brasília', 'brasilia'],
    ['folds accents', 'Döner', 'doner'],
    ['folds dotted capital I', 'İstanbul', 'istanbul'],
    ['collapses inner whitespace', 'New   Delhi', 'new delhi'],
    ['trims', '  Noida  ', 'noida'],
    ['treats tabs and newlines as spaces', '\tNew\nDelhi ', 'new delhi'],
    ['treats non-breaking spaces as spaces', 'New Delhi', 'new delhi'],
    ['keeps punctuation', 'Cedar Rapids/Iowa City', 'cedar rapids/iowa city'],
    ['returns empty for blank', '   ', ''],
    ['returns empty for empty', '', ''],
  ])('%s: %j → %j', (_rule, input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it.each(['gurgaon', 'sao paulo', 'new delhi', 'street food'])(
    'is idempotent for %j',
    (value) => {
      expect(normalize(normalize(value))).toBe(normalize(value));
    },
  );
});

describe('normalizeCity', () => {
  it.each([
    ['Gurugram', 'gurgaon'],
    ['  GURUGRAM ', 'gurgaon'],
    ['Delhi', 'new delhi'],
    ['Bengaluru', 'bangalore'],
    ['Bombay', 'mumbai'],
    ['Calcutta', 'kolkata'],
    ['Madras', 'chennai'],
  ])('resolves the alias %j → %j', (input, expected) => {
    expect(normalizeCity(input)).toBe(expected);
  });

  it.each([
    ['Gurgaon', 'gurgaon'],
    ['New  Delhi', 'new delhi'],
    ['İstanbul', 'istanbul'],
    ['Makati City', 'makati city'],
  ])('leaves a non-alias city normalized: %j → %j', (input, expected) => {
    expect(normalizeCity(input)).toBe(expected);
  });

  it('maps every alias target to itself, so resolving is stable', () => {
    for (const target of CITY_ALIASES.values()) {
      expect(normalizeCity(target)).toBe(target);
    }
  });

  it('stores alias keys and targets in normalized form', () => {
    for (const [alias, target] of CITY_ALIASES) {
      expect(normalize(alias)).toBe(alias);
      expect(normalize(target)).toBe(target);
    }
  });
});

describe('splitCuisines', () => {
  it.each([
    ['North Indian, Chinese', ['North Indian', 'Chinese']],
    ['  North Indian ,  Chinese  ', ['North Indian', 'Chinese']],
    ['Cafe,', ['Cafe']],
    ['Cafe,, Bakery', ['Cafe', 'Bakery']],
    ['', []],
    ['   ', []],
  ])('splits %j → %j', (input, expected) => {
    expect(splitCuisines(input)).toEqual(expected);
  });
});

describe('normalizeCuisines', () => {
  it('de-duplicates by canonical key, keeping the first spelling', () => {
    expect(
      normalizeCuisines(['North Indian', 'north indian ', 'Chinese']),
    ).toEqual({
      display: ['North Indian', 'Chinese'],
      norm: ['north indian', 'chinese'],
    });
  });

  it('keeps input order', () => {
    expect(normalizeCuisines(['Pizza', 'Cafe', 'Bakery'])).toEqual({
      display: ['Pizza', 'Cafe', 'Bakery'],
      norm: ['pizza', 'cafe', 'bakery'],
    });
  });

  it('drops blank entries and trims display values', () => {
    expect(normalizeCuisines(['  Cafe ', '', '   '])).toEqual({
      display: ['Cafe'],
      norm: ['cafe'],
    });
  });

  it('returns empty arrays for no cuisines', () => {
    expect(normalizeCuisines([])).toEqual({ display: [], norm: [] });
  });

  it('folds accents in the key but keeps them in the display value', () => {
    expect(normalizeCuisines(['Döner', 'Doner'])).toEqual({
      display: ['Döner'],
      norm: ['doner'],
    });
  });

  it('keeps display and norm index-aligned', () => {
    const { display, norm } = normalizeCuisines([
      'Street Food',
      'STREET  FOOD',
      'South Indian',
      'Börek',
      'Fast Food',
    ]);

    expect(norm).toEqual(display.map(normalize));
  });
});

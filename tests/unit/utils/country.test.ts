import { COUNTRIES } from '../../../src/constants/countries';
import {
  countryByIsoCode,
  countryBySeedCode,
} from '../../../src/utils/country';

// The seed mapping from ADR-001 Rule 6.
const SEED_MAPPING: [number, string, string][] = [
  [1, 'IN', 'INR'],
  [14, 'AU', 'AUD'],
  [30, 'BR', 'BRL'],
  [37, 'CA', 'CAD'],
  [94, 'ID', 'IDR'],
  [148, 'NZ', 'NZD'],
  [162, 'PH', 'PHP'],
  [166, 'QA', 'QAR'],
  [184, 'SG', 'SGD'],
  [189, 'ZA', 'ZAR'],
  [191, 'LK', 'LKR'],
  [208, 'TR', 'TRY'],
  [214, 'AE', 'AED'],
  [215, 'GB', 'GBP'],
  [216, 'US', 'USD'],
];

describe('countryBySeedCode', () => {
  it.each(SEED_MAPPING)(
    'maps seed code %i to %s with currency %s',
    (seedCode, isoCode, currency) => {
      expect(countryBySeedCode(seedCode)).toMatchObject({
        seedCode,
        isoCode,
        currency,
      });
    },
  );

  it('maps 162 to the Philippines, not the CSV label "Botswana Pula"', () => {
    expect(countryBySeedCode(162)).toEqual({
      seedCode: 162,
      isoCode: 'PH',
      name: 'Philippines',
      currency: 'PHP',
    });
  });

  it('gives each "Dollar($)" country its own currency', () => {
    expect(
      [14, 37, 184, 216].map((c) => countryBySeedCode(c)?.currency),
    ).toEqual(['AUD', 'CAD', 'SGD', 'USD']);
  });

  it.each([0, 2, 999])('returns undefined for unknown code %i', (code) => {
    expect(countryBySeedCode(code)).toBeUndefined();
  });
});

describe('countryByIsoCode', () => {
  it.each(SEED_MAPPING)(
    'returns the same entry as seed code %i for %s',
    (seedCode, isoCode) => {
      expect(countryByIsoCode(isoCode)).toBe(countryBySeedCode(seedCode));
    },
  );

  it.each(['in', 'XX', '', 'IND'])(
    'returns undefined for %j (uppercase alpha-2 only)',
    (code) => {
      expect(countryByIsoCode(code)).toBeUndefined();
    },
  );
});

describe('COUNTRIES table', () => {
  it('has the 15 supported markets', () => {
    expect(COUNTRIES).toHaveLength(15);
  });

  it('has unique seed and ISO codes', () => {
    expect(new Set(COUNTRIES.map((c) => c.seedCode)).size).toBe(15);
    expect(new Set(COUNTRIES.map((c) => c.isoCode)).size).toBe(15);
  });

  it('uses ISO formats for codes and currencies', () => {
    for (const country of COUNTRIES) {
      expect(country.isoCode).toMatch(/^[A-Z]{2}$/);
      expect(country.currency).toMatch(/^[A-Z]{3}$/);
      expect(country.name.length).toBeGreaterThan(0);
    }
  });
});

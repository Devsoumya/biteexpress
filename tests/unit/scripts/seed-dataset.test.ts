import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapCsvRows } from '../../../src/mappers/restaurant-csv.mapper';
import type { SeedRestaurant } from '../../../src/models/restaurant.model';
import { decodeUtf8Strict, parseCsvRecords } from '../../../src/utils/csv';

// Maps the real seed file in memory (no database). The counts are the ones
// profiled in ADR-001, so any change to the file or the rules shows up here.
describe('mapping zomato_data.csv', () => {
  const csvPath = join(__dirname, '../../../zomato_data.csv');
  const rows = parseCsvRecords(decodeUtf8Strict(readFileSync(csvPath)));
  const { restaurants, skips } = mapCsvRows(rows);

  const count = (predicate: (r: SeedRestaurant) => boolean) =>
    restaurants.filter(predicate).length;

  it('reads every row and skips only the test row', () => {
    expect(rows).toHaveLength(9551);
    expect(restaurants).toHaveLength(9550);
    expect(skips).toEqual([
      { skip: true, sourceId: 18419884, reason: 'test row' },
    ]);
  });

  it('omits unknown values instead of storing 0', () => {
    expect(count((r) => r.location === undefined)).toBe(499);
    expect(count((r) => r.rating.average === undefined)).toBe(2147);
    expect(count((r) => r.cost?.averageForTwo === undefined)).toBe(18);
    expect(count((r) => r.cuisines.length === 0)).toBe(9);
  });

  it('has unique source IDs that fit the validator', () => {
    const ids = restaurants.map((r) => r.sourceId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(2 ** 31);
  });

  it('leaves no damaged text in cities or cuisines', () => {
    const cities = new Set(restaurants.map((r) => r.address.city));
    const cuisines = new Set(restaurants.flatMap((r) => r.cuisines));

    expect(cities.size).toBe(141);
    expect([...cities].filter((c) => c.includes('�'))).toEqual([]);
    expect([...cuisines].filter((c) => c.includes('�'))).toEqual([]);
    expect([...cities]).toEqual(
      expect.arrayContaining(['Brasília', 'São Paulo', 'İstanbul']),
    );
  });

  it('replaces every misencoded dotless i', () => {
    expect(JSON.stringify(restaurants)).not.toContain('۱');
  });

  it('covers the 15 markets with currencies from the country table', () => {
    const currencyByCountry = new Map(
      restaurants.map((r) => [r.country.code, r.cost?.currency]),
    );

    expect(currencyByCountry.size).toBe(15);
    expect(currencyByCountry.get('PH')).toBe('PHP');
  });

  it('keeps norm.cuisines aligned with cuisines', () => {
    expect(count((r) => r.norm.cuisines.length !== r.cuisines.length)).toBe(0);
  });
});

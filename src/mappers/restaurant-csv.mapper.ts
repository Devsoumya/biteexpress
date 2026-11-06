import { RESTAURANT_SCHEMA_VERSION } from '../constants/restaurant';
import {
  DOTLESS_I,
  MISENCODED_DOTLESS_I,
  SKIPPED_SOURCE_IDS,
  SOURCE_TEXT_REPAIRS,
} from '../constants/seed-repairs';
import type { SeedRestaurant } from '../models/restaurant.model';
import type { CsvRow, SeedSkip } from '../models/seed.model';
import { countryBySeedCode } from '../utils/country';
import { parseCoordinates } from '../utils/geo';
import {
  normalizeCity,
  normalizeCuisines,
  splitCuisines,
} from '../utils/normalize';

function field(row: CsvRow, name: string): string {
  const value = row[name];
  if (value === undefined) throw new Error(`CSV row has no "${name}" column`);
  return value;
}

/** Fixes the source file's encoding damage and collapses whitespace runs. */
function cleanText(value: string): string {
  const fixed = value
    .replace(MISENCODED_DOTLESS_I, DOTLESS_I)
    .replace(/\s+/g, ' ')
    .trim();
  return SOURCE_TEXT_REPAIRS.get(fixed) ?? fixed;
}

function yesNo(value: string): boolean {
  return value.trim() === 'Yes';
}

/**
 * Maps one Zomato CSV row to a restaurant document, or to a skip with a
 * reason (ADR-001 Rules 1-11). Pure: no I/O, no clock.
 */
export function mapCsvRow(row: CsvRow): SeedRestaurant | SeedSkip {
  const sourceId = Number(field(row, 'Restaurant ID'));
  if (SKIPPED_SOURCE_IDS.has(sourceId)) {
    return { skip: true, sourceId, reason: 'test row' };
  }

  const country = countryBySeedCode(Number(field(row, 'Country Code')));
  if (!country) {
    return { skip: true, sourceId, reason: 'unknown country code' };
  }

  const city = cleanText(field(row, 'City'));
  const locality = cleanText(field(row, 'Locality'));
  const cuisines = normalizeCuisines(
    splitCuisines(field(row, 'Cuisines')).map(cleanText),
  );
  const coordinates = parseCoordinates(
    Number(field(row, 'Latitude')),
    Number(field(row, 'Longitude')),
  );
  const averageForTwo = Number(field(row, 'Average Cost for two'));
  const priceRange = Number(field(row, 'Price range'));
  const ratingAverage = Number(field(row, 'Aggregate rating'));

  // Unknown values are omitted, never stored as 0 (ADR-001 Rule 2): the CSV
  // uses 0 for "no location", "no cost" and "not rated".
  return {
    sourceId,
    name: cleanText(field(row, 'Restaurant Name')),
    address: {
      line: cleanText(field(row, 'Address')),
      ...(locality && { locality }),
      city,
    },
    country: { code: country.isoCode, name: country.name },
    ...(coordinates.kind === 'point' && { location: coordinates.point }),
    cuisines: cuisines.display,
    cost: {
      ...(averageForTwo > 0 && { averageForTwo }),
      // From the country table, never the CSV's Currency column (Rule 6).
      currency: country.currency,
      ...(priceRange >= 1 && priceRange <= 4 && { priceRange }),
    },
    features: {
      tableBooking: yesNo(field(row, 'Has Table booking')),
      onlineDelivery: yesNo(field(row, 'Has Online delivery')),
      deliveringNow: yesNo(field(row, 'Is delivering now')),
    },
    rating: {
      ...(ratingAverage > 0 && { average: ratingAverage }),
      votes: Number(field(row, 'Votes')),
    },
    norm: { city: normalizeCity(city), cuisines: cuisines.norm },
    schemaVersion: RESTAURANT_SCHEMA_VERSION,
  };
}

export function isSeedSkip(
  result: SeedRestaurant | SeedSkip,
): result is SeedSkip {
  return 'skip' in result;
}

export interface MappedCsv {
  restaurants: SeedRestaurant[];
  skips: SeedSkip[];
}

export function mapCsvRows(rows: readonly CsvRow[]): MappedCsv {
  const restaurants: SeedRestaurant[] = [];
  const skips: SeedSkip[] = [];
  for (const row of rows) {
    const result = mapCsvRow(row);
    if (isSeedSkip(result)) skips.push(result);
    else restaurants.push(result);
  }
  return { restaurants, skips };
}

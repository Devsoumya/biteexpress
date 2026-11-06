import { mapCsvRow } from '../../src/mappers/restaurant-csv.mapper';
import type { SeedRestaurant } from '../../src/models/restaurant.model';

/**
 * A valid seed restaurant, as the CSV mapper builds it. It has no tenant: the
 * repository adds one, and tests that insert directly add their own.
 */
export function seedRestaurant(
  sourceId: number,
  overrides: Partial<SeedRestaurant> = {},
): SeedRestaurant {
  const mapped = mapCsvRow({
    'Restaurant ID': String(sourceId),
    'Restaurant Name': `Test Restaurant ${sourceId}`,
    'Country Code': '1',
    City: 'Gurgaon',
    Address: 'Sector 29 Market',
    Locality: 'Sector 29',
    'Locality Verbose': 'Sector 29, Gurgaon',
    Longitude: '77.0688',
    Latitude: '28.4595',
    Cuisines: 'Street Food',
    'Average Cost for two': '300',
    Currency: 'Indian Rupees(Rs.)',
    'Has Table booking': 'No',
    'Has Online delivery': 'Yes',
    'Is delivering now': 'No',
    'Switch to order menu': 'No',
    'Price range': '1',
    'Aggregate rating': '3.6',
    'Rating color': 'Yellow',
    'Rating text': 'Good',
    Votes: '112',
  });
  if ('skip' in mapped) throw new Error('fixture row was skipped');
  return { ...mapped, ...overrides };
}

/** A POST /v1/restaurants body with every optional field set. */
export function fullCreateBody(): Record<string, unknown> {
  return {
    name: 'Goli Vada Pav No. 1',
    address: 'Shop 12, Sector 29 Market',
    locality: 'Sector 29',
    city: 'Gurugram',
    countryCode: 'IN',
    cuisines: ['Street Food', 'street food', 'Fast Food'],
    latitude: 28.4595,
    longitude: 77.0688,
    averageCostForTwo: 300,
    priceRange: 1,
    features: { tableBooking: false, onlineDelivery: true },
  };
}

/** A POST body with only the required fields. */
export function minimalCreateBody(): Record<string, unknown> {
  return {
    name: 'Corner Cafe',
    address: '1 Main Street',
    city: 'Makati City',
    countryCode: 'PH',
  };
}

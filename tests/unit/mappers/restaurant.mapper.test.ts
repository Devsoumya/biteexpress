import { ObjectId } from 'mongodb';
import {
  ratingLabel,
  toRestaurantDetail,
  toRestaurantDraft,
  toRestaurantListItem,
} from '../../../src/mappers/restaurant.mapper';
import type { Country } from '../../../src/models/country.model';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import { countryByIsoCode } from '../../../src/utils/country';
import { parseCoordinates } from '../../../src/utils/geo';
import {
  type CreateRestaurantBody,
  createRestaurantBodySchema,
} from '../../../src/validators/restaurant.schema';
import {
  fullCreateBody,
  minimalCreateBody,
} from '../../helpers/restaurant-fixtures';

function country(code: string): Country {
  const found = countryByIsoCode(code);
  if (!found) throw new Error(`no country ${code}`);
  return found;
}

function body(raw: Record<string, unknown>): CreateRestaurantBody {
  return createRestaurantBodySchema.parse(raw);
}

describe('toRestaurantDraft', () => {
  it('builds the full document shape from a full body', () => {
    expect(toRestaurantDraft(body(fullCreateBody()), country('IN'))).toEqual({
      name: 'Goli Vada Pav No. 1',
      address: {
        line: 'Shop 12, Sector 29 Market',
        locality: 'Sector 29',
        city: 'Gurugram',
      },
      country: { code: 'IN', name: 'India' },
      location: { type: 'Point', coordinates: [77.0688, 28.4595] },
      cuisines: ['Street Food', 'Fast Food'],
      cost: { averageForTwo: 300, currency: 'INR', priceRange: 1 },
      features: { tableBooking: false, onlineDelivery: true },
      rating: { votes: 0 },
      norm: { city: 'gurgaon', cuisines: ['street food', 'fast food'] },
      schemaVersion: 1,
    });
  });

  it('omits every unknown value for a minimal body, keeping the currency', () => {
    expect(toRestaurantDraft(body(minimalCreateBody()), country('PH'))).toEqual(
      {
        name: 'Corner Cafe',
        address: { line: '1 Main Street', city: 'Makati City' },
        country: { code: 'PH', name: 'Philippines' },
        cuisines: [],
        cost: { currency: 'PHP' },
        rating: { votes: 0 },
        norm: { city: 'makati city', cuisines: [] },
        schemaVersion: 1,
      },
    );
  });

  it.each([
    [0, 0],
    [28.4595, 0],
    [0, 77.0688],
  ])(
    'omits the location for %d,%d (0 means unknown)',
    (latitude, longitude) => {
      const draft = toRestaurantDraft(
        body({ ...minimalCreateBody(), latitude, longitude }),
        country('IN'),
      );

      expect(draft).not.toHaveProperty('location');
    },
  );

  it('omits features when the client sent an empty object', () => {
    const draft = toRestaurantDraft(
      body({ ...minimalCreateBody(), features: {} }),
      country('IN'),
    );

    expect(draft).not.toHaveProperty('features');
  });

  it('never produces a key whose value is undefined (the driver would store null)', () => {
    const draft = toRestaurantDraft(body(minimalCreateBody()), country('IN'));
    const undefinedKeys: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === undefined) undefinedKeys.push(path);
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          walk(child, path ? `${path}.${key}` : key);
        }
      }
    };
    walk(draft, '');

    expect(undefinedKeys).toEqual([]);
  });
});

// The request schema and parseCoordinates both check the ranges; they must
// agree, or the mapper's "invalid" guard could fire on accepted input.
describe('coordinate ranges', () => {
  it.each([
    [90, 77],
    [-90, 77],
    [90.0001, 77],
    [-90.0001, 77],
    [28, 180],
    [28, -180],
    [28, 180.0001],
    [28, -180.0001],
  ])('schema and parseCoordinates agree on %d,%d', (latitude, longitude) => {
    const acceptedBySchema = createRestaurantBodySchema.safeParse({
      ...minimalCreateBody(),
      latitude,
      longitude,
    }).success;
    const validForDomain =
      parseCoordinates(latitude, longitude).kind !== 'invalid';

    expect(acceptedBySchema).toBe(validForDomain);
  });
});

describe('ratingLabel', () => {
  it.each<[number | undefined, string]>([
    [undefined, 'Not rated'],
    [1.8, 'Poor'],
    [2.4, 'Poor'],
    [2.5, 'Average'],
    [3.4, 'Average'],
    [3.5, 'Good'],
    [3.9, 'Good'],
    [4.0, 'Very Good'],
    [4.4, 'Very Good'],
    [4.5, 'Excellent'],
    [4.9, 'Excellent'],
  ])('labels %s as %s', (average, label) => {
    expect(ratingLabel(average)).toBe(label);
  });
});

const ID = new ObjectId('5f1d7c3e9b1e8a0012345678');
const NOW = new Date('2026-11-06T00:00:00Z');

const seededDocument: RestaurantDocument = {
  _id: ID,
  tenantId: 'biteexpress',
  sourceId: 308322,
  name: 'Goli Vada Pav No. 1',
  address: {
    line: 'Shop 12, Sector 29 Market',
    locality: 'Sector 29',
    city: 'Gurgaon',
  },
  country: { code: 'IN', name: 'India' },
  location: { type: 'Point', coordinates: [77.0688, 28.4595] },
  cuisines: ['Street Food', 'Fast Food'],
  cost: { averageForTwo: 300, currency: 'INR', priceRange: 1 },
  features: { tableBooking: false, onlineDelivery: true, deliveringNow: false },
  rating: { average: 3.6, votes: 112 },
  norm: { city: 'gurgaon', cuisines: ['street food', 'fast food'] },
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
};

const minimalDocument: RestaurantDocument = {
  _id: ID,
  tenantId: 'biteexpress',
  name: 'Corner Cafe',
  address: { line: '1 Main Street', city: 'Makati City' },
  country: { code: 'PH', name: 'Philippines' },
  cuisines: [],
  cost: { currency: 'PHP' },
  rating: { votes: 0 },
  norm: { city: 'makati city', cuisines: [] },
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
};

describe('toRestaurantListItem', () => {
  it('maps a document to the list shape, with the fields filters use', () => {
    expect(toRestaurantListItem(seededDocument)).toEqual({
      id: '5f1d7c3e9b1e8a0012345678',
      name: 'Goli Vada Pav No. 1',
      address: 'Shop 12, Sector 29 Market',
      city: 'Gurgaon',
      country: { code: 'IN', name: 'India' },
      cuisines: ['Street Food', 'Fast Food'],
      averageRating: 3.6,
      votes: 112,
      ratingLabel: 'Good',
      cost: { averageForTwo: 300, currency: 'INR', priceRange: 1 },
      features: {
        tableBooking: false,
        onlineDelivery: true,
        deliveringNow: false,
      },
    });
  });

  it('keeps every key and uses null for unknown cost, features and rating', () => {
    expect(toRestaurantListItem(minimalDocument)).toEqual({
      id: '5f1d7c3e9b1e8a0012345678',
      name: expect.any(String),
      address: expect.any(String),
      city: 'Makati City',
      country: { code: 'PH', name: 'Philippines' },
      cuisines: [],
      averageRating: null,
      votes: 0,
      ratingLabel: 'Not rated',
      cost: { averageForTwo: null, currency: 'PHP', priceRange: null },
      features: {
        tableBooking: null,
        onlineDelivery: null,
        deliveringNow: null,
      },
    });
  });

  it('adds distanceKm rounded to 2 decimals when the pipeline computed one', () => {
    expect(
      toRestaurantListItem({ ...seededDocument, distanceKm: 1.23456 })
        .distanceKm,
    ).toBe(1.23);
  });

  it('omits distanceKm when there were no coordinates or no location (null)', () => {
    expect(toRestaurantListItem(seededDocument)).not.toHaveProperty(
      'distanceKm',
    );
    expect(
      toRestaurantListItem({ ...seededDocument, distanceKm: null }),
    ).not.toHaveProperty('distanceKm');
  });

  it('returns averageRating null for an unrated restaurant', () => {
    expect(toRestaurantListItem(minimalDocument).averageRating).toBeNull();
  });
});

describe('toRestaurantDetail', () => {
  it('adds locality, location as latitude/longitude and sourceId to the list item', () => {
    expect(toRestaurantDetail(seededDocument)).toEqual({
      ...toRestaurantListItem(seededDocument),
      locality: 'Sector 29',
      location: { latitude: 28.4595, longitude: 77.0688 },
      sourceId: 308322,
    });
  });

  it('keeps every key and uses null for unknown values', () => {
    expect(toRestaurantDetail(minimalDocument)).toEqual({
      id: '5f1d7c3e9b1e8a0012345678',
      name: 'Corner Cafe',
      address: '1 Main Street',
      city: 'Makati City',
      country: { code: 'PH', name: 'Philippines' },
      cuisines: [],
      averageRating: null,
      locality: null,
      location: null,
      cost: { averageForTwo: null, currency: 'PHP', priceRange: null },
      features: {
        tableBooking: null,
        onlineDelivery: null,
        deliveringNow: null,
      },
      votes: 0,
      ratingLabel: 'Not rated',
      sourceId: null,
    });
  });

  it('returns a null currency only if a document has no cost at all', () => {
    const { cost: _cost, ...withoutCost } = minimalDocument;

    expect(toRestaurantDetail(withoutCost).cost).toEqual({
      averageForTwo: null,
      currency: null,
      priceRange: null,
    });
  });
});

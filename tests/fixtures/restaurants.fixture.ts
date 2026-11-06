import { ObjectId } from 'mongodb';
import { RESTAURANT_SCHEMA_VERSION } from '../../src/constants/restaurant';
import type { GeoPoint, LatLng } from '../../src/models/geo.model';
import type { RestaurantDocument } from '../../src/models/restaurant.model';
import { countryByIsoCode } from '../../src/utils/country';
import { EARTH_RADIUS_KM } from '../../src/utils/geo';
import { normalizeCity, normalizeCuisines } from '../../src/utils/normalize';

// The list and search tests' data (ADR-005): small, hand-built, each document
// chosen for a test. Its own tenant, so tests that write (in other tenants)
// never disturb it. Inserted once by the integration globalSetup.
export const FIXTURE_TENANT = 'fixtures';
export const OTHER_FIXTURE_TENANT = 'fixtures-other';

/** Cyber City, Gurgaon: the anchor for distance tests. */
export const ANCHOR: LatLng = { lat: 28.495, lng: 77.089 };

/**
 * A point `km` due north of the anchor. Along a meridian the haversine
 * distance is exactly R·Δlat, so the API's distanceKm equals `km`.
 */
export function north(km: number, from: LatLng = ANCHOR): LatLng {
  return {
    lat: from.lat + (km / EARTH_RADIUS_KM) * (180 / Math.PI),
    lng: from.lng,
  };
}

function point({ lat, lng }: LatLng): GeoPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

export interface FixtureSpec {
  /** Last two hex digits of the _id; ids order the fixtures for tie-breaks. */
  id: string;
  name: string;
  city: string;
  countryCode: string;
  cuisines: string[];
  at?: LatLng;
  rating?: number;
  votes: number;
  cost?: number;
  tenantId?: string;
  locality?: string;
  features?: { onlineDelivery?: boolean; tableBooking?: boolean };
}

export function fixtureId(id: string): ObjectId {
  return new ObjectId(`6f0000000000000000000a${id}`);
}

export function restaurant(spec: FixtureSpec): RestaurantDocument {
  const country = countryByIsoCode(spec.countryCode);
  if (!country) throw new Error(`unknown country ${spec.countryCode}`);
  const cuisines = normalizeCuisines(spec.cuisines);
  const now = new Date('2026-11-01T00:00:00Z');
  return {
    _id: fixtureId(spec.id),
    tenantId: spec.tenantId ?? FIXTURE_TENANT,
    name: spec.name,
    address: {
      line: `${spec.name} Road`,
      ...(spec.locality !== undefined && { locality: spec.locality }),
      city: spec.city,
    },
    country: { code: country.isoCode, name: country.name },
    ...(spec.at && { location: point(spec.at) }),
    cuisines: cuisines.display,
    cost: {
      ...(spec.cost !== undefined && { averageForTwo: spec.cost }),
      currency: country.currency,
    },
    ...(spec.features && { features: spec.features }),
    rating: {
      ...(spec.rating !== undefined && { average: spec.rating }),
      votes: spec.votes,
    },
    norm: { city: normalizeCity(spec.city), cuisines: cuisines.norm },
    createdAt: now,
    updatedAt: now,
    schemaVersion: RESTAURANT_SCHEMA_VERSION,
  };
}

const TWIN_POINT = north(2);

/** Gurgaon, at known distances north of the anchor. */
export const GURGAON = {
  goliVadaPav: restaurant({
    id: '01',
    name: 'Goli Vada Pav No. 1',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(0.2),
    rating: 3.6,
    votes: 112,
    cost: 200,
  }),
  summerPavilion: restaurant({
    id: '02',
    name: 'Summer Pavilion',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Chinese'],
    at: north(0.5),
    rating: 4.2,
    votes: 300,
    cost: 800,
  }),
  // Ties summerPavilion on rating, votes and cost: _id decides.
  chaatCorner: restaurant({
    id: '03',
    name: 'Chaat Corner',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(1),
    rating: 4.2,
    votes: 300,
    cost: 800,
  }),
  cyberCafe: restaurant({
    id: '04',
    name: 'Cyber Cafe',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Cafe'],
    at: north(3),
    rating: 3.9,
    votes: 50,
    cost: 500,
  }),
  // Outside the default 5 km radius.
  farDhaba: restaurant({
    id: '05',
    name: 'Far Dhaba',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: north(6),
    rating: 4.5,
    votes: 900,
    cost: 1200,
  }),
  // Two at one point, tied on everything: _id decides.
  twinTikkaA: restaurant({
    id: '06',
    name: 'Twin Tikka A',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: TWIN_POINT,
    rating: 4.0,
    votes: 40,
    cost: 600,
  }),
  twinTikkaB: restaurant({
    id: '07',
    name: 'Twin Tikka B',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: TWIN_POINT,
    rating: 4.0,
    votes: 40,
    cost: 600,
  }),
  unrated: restaurant({
    id: '08',
    name: 'New Spot',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Cafe'],
    at: north(1.5),
    votes: 2,
    cost: 300,
  }),
  noLocation: restaurant({
    id: '09',
    name: 'Hidden Kitchen',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['North Indian', 'Street Food'],
    rating: 4.4,
    votes: 120,
    cost: 700,
  }),
  noCost: restaurant({
    id: '10',
    name: 'Free Samples',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Bakery'],
    at: north(2.5),
    rating: 3.0,
    votes: 10,
  }),
};

/** New Delhi, 18-25 km north of the anchor. */
export const NEW_DELHI = {
  saravana: restaurant({
    id: '11',
    name: 'Saravana Bhavan',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['South Indian'],
    at: north(18),
    rating: 4.3,
    votes: 2000,
    cost: 600,
  }),
  darbar: restaurant({
    id: '12',
    name: 'Delhi Darbar',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: north(20),
    rating: 3.8,
    votes: 500,
    cost: 900,
  }),
  connaught: restaurant({
    id: '13',
    name: 'Connaught Cafe',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['Cafe'],
    at: north(22),
    rating: 4.1,
    votes: 700,
    cost: 1100,
  }),
  paratha: restaurant({
    id: '14',
    name: 'Old Delhi Paratha',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['North Indian', 'Street Food'],
    at: north(25),
    rating: 4.6,
    votes: 1500,
    cost: 300,
  }),
};

const ORLANDO_CENTRE: LatLng = { lat: 28.5383, lng: -81.3792 };

/** Orlando, USD: the currency rule (900 USD must never match an INR filter). */
export const ORLANDO = {
  diner: restaurant({
    id: '15',
    name: 'Orlando Diner',
    city: 'Orlando',
    countryCode: 'US',
    cuisines: ['American'],
    at: ORLANDO_CENTRE,
    rating: 3.9,
    votes: 80,
    cost: 30,
  }),
  lakeGrill: restaurant({
    id: '16',
    name: 'Lake Grill',
    city: 'Orlando',
    countryCode: 'US',
    cuisines: ['American'],
    at: north(1, ORLANDO_CENTRE),
    rating: 4.0,
    votes: 60,
    cost: 900,
  }),
};

/** Another tenant, identical to goliVadaPav, at the same point: isolation. */
export const OTHER_TENANT_TWIN = restaurant({
  id: '99',
  name: 'Goli Vada Pav No. 1',
  city: 'Gurgaon',
  countryCode: 'IN',
  cuisines: ['Street Food'],
  at: north(0.2),
  rating: 3.6,
  votes: 112,
  cost: 200,
  tenantId: OTHER_FIXTURE_TENANT,
});

export const FIXTURES: RestaurantDocument[] = [
  ...Object.values(GURGAON),
  ...Object.values(NEW_DELHI),
  ...Object.values(ORLANDO),
];

export const ALL_FIXTURES: RestaurantDocument[] = [
  ...FIXTURES,
  OTHER_TENANT_TWIN,
];

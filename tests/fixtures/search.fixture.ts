import type { RestaurantDocument } from '../../src/models/restaurant.model';
import { north, restaurant } from './restaurants.fixture';

// The search tests' data (Build Step 6), in its own tenant so the list
// fixtures' exact-order assertions stay untouched. Distances are due north
// of the Cyber City anchor, as in the list fixtures.
export const SEARCH_FIXTURE_TENANT = 'search-fixtures';

const at = (spec: Parameters<typeof restaurant>[0]) =>
  restaurant({ ...spec, tenantId: SEARCH_FIXTURE_TENANT });

export const S = {
  // Vada pav by name (two branches) and street food without it in the name.
  // Ratings are deliberately not in _id order, so a missing rating
  // tie-break in relevance order would fail the tests.
  goliNear: at({
    id: 'b1',
    name: 'Goli Vada Pav No. 1',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(0.4),
    rating: 3.4,
    votes: 80,
    cost: 200,
    features: { onlineDelivery: true },
  }),
  goliFar: at({
    id: 'b2',
    name: 'Goli Vada Pav No. 1',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(3),
    rating: 3.6,
    votes: 40,
    cost: 200,
  }),
  chaatStreet: at({
    id: 'b3',
    name: 'Chaat Street',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(0.2),
    rating: 4.1,
    votes: 150,
    cost: 300,
  }),
  tikkiPoint: at({
    id: 'b4',
    name: 'Tikki Point',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(1),
    rating: 3.8,
    votes: 60,
    cost: 250,
  }),
  bhelJunction: at({
    id: 'b5',
    name: 'Bhel Junction',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Street Food'],
    at: north(2),
    rating: 4.3,
    votes: 30,
    cost: 150,
  }),
  // "pav" as a prefix: autocomplete reaches it, a phrase never does.
  summerPavilion: at({
    id: 'b6',
    name: 'Summer Pavilion',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Chinese'],
    at: north(0.6),
    rating: 4.2,
    votes: 300,
    cost: 1500,
  }),
  yetiMomos: at({
    id: 'b7',
    name: 'Yeti Kitchen',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['Tibetan', 'Chinese'],
    at: north(1.5),
    rating: 3.9,
    votes: 70,
    cost: 600,
  }),
  // South Indian on both sides of the "best" vote floor (20); one at Cyber Hub.
  sagarRatna: at({
    id: 'b8',
    name: 'Sagar Ratna',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['South Indian'],
    at: north(2.5),
    rating: 4.0,
    votes: 300,
    cost: 500,
    features: { tableBooking: true },
  }),
  dakshin: at({
    id: 'b9',
    name: 'Dakshin Cafe',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['South Indian'],
    at: north(0.8),
    rating: 3.7,
    votes: 25,
    cost: 700,
    locality: 'Cyber Hub, DLF Cyber City',
    features: { onlineDelivery: true },
  }),
  idliCorner: at({
    id: 'ba',
    name: 'Idli Corner',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['South Indian'],
    at: north(1.2),
    rating: 4.5,
    votes: 5,
    cost: 200,
  }),
  grandGrill: at({
    id: 'bb',
    name: 'Grand Grill',
    city: 'Gurgaon',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: north(4),
    rating: 4.4,
    votes: 500,
    cost: 1200,
  }),
  // New Delhi (override test, and a city word inside a name).
  delhiDarbar: at({
    id: 'bc',
    name: 'Delhi Darbar',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['North Indian'],
    at: north(20),
    rating: 3.8,
    votes: 500,
    cost: 900,
  }),
  saravana: at({
    id: 'bd',
    name: 'Saravana Bhavan',
    city: 'New Delhi',
    countryCode: 'IN',
    cuisines: ['South Indian'],
    at: north(18),
    rating: 4.3,
    votes: 2000,
    cost: 600,
  }),
  // USD: never inside an INR price.
  orlandoDiner: at({
    id: 'be',
    name: 'Orlando Diner',
    city: 'Orlando',
    countryCode: 'US',
    cuisines: ['American'],
    at: { lat: 28.5383, lng: -81.3792 },
    rating: 3.9,
    votes: 80,
    cost: 800,
  }),
};

export const SEARCH_FIXTURES: RestaurantDocument[] = Object.values(S);

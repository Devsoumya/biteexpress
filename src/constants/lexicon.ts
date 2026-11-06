// Words the query interpreter recognizes (ADR-002). Data, not logic: adding a
// dish or a phrasing is an entry here plus a row in the interpreter's test
// table. All entries are in normalize()d form (lowercase, accents folded).

/**
 * Dish phrase → cuisines that "probably serve" it. Matched as a phrase in
 * names (so "pav" alone never matches "Pavilion") OR any of the cuisines.
 * Cuisines missing from the tenant's vocabulary are dropped at match time.
 */
export const DISHES: ReadonlyMap<string, readonly string[]> = new Map([
  ['vada pav', ['street food']],
  ['pav bhaji', ['street food']],
  ['chaat', ['street food']],
  ['pani puri', ['street food']],
  ['golgappa', ['street food']],
  ['dosa', ['south indian']],
  ['masala dosa', ['south indian']],
  ['idli', ['south indian']],
  ['uttapam', ['south indian']],
  ['biryani', ['biryani']],
  ['momos', ['tibetan', 'chinese']],
  ['momo', ['tibetan', 'chinese']],
  ['kebab', ['kebab', 'mughlai']],
  ['kebabs', ['kebab', 'mughlai']],
  ['shawarma', ['lebanese', 'middle eastern', 'arabian']],
  ['noodles', ['chinese']],
  ['dim sum', ['chinese']],
  ['butter chicken', ['north indian']],
  ['paratha', ['north indian']],
]);

/** A price ceiling: "under 1000", "less than Rs 500". */
export const MAX_PRICE_WORDS: readonly string[] = [
  'less than',
  'up to',
  'under',
  'below',
  'upto',
  'within',
  'max',
  'maximum',
];

/** A price floor: "over 300", "more than 500". */
export const MIN_PRICE_WORDS: readonly string[] = [
  'more than',
  'over',
  'above',
  'min',
  'minimum',
];

/** Currency words, after normalize(); ₹ and $ are rewritten to rs / usd. */
export const CURRENCY_WORDS: ReadonlyMap<string, string> = new Map([
  ['rs', 'INR'],
  ['inr', 'INR'],
  ['rupee', 'INR'],
  ['rupees', 'INR'],
  ['usd', 'USD'],
  ['dollar', 'USD'],
  ['dollars', 'USD'],
]);

/** Budget words: a price tier ceiling (1-4 scale), no currency needed. */
export const CHEAP_WORDS: readonly string[] = [
  'inexpensive',
  'affordable',
  'budget',
  'cheap',
];
export const CHEAP_MAX_PRICE_RANGE = 2;

export type Intent = 'best' | 'nearest' | 'cheapest';

export const INTENT_PHRASES: ReadonlyMap<string, Intent> = new Map([
  ['highest rated', 'best'],
  ['top rated', 'best'],
  ['best', 'best'],
  ['top', 'best'],
  ['near me', 'nearest'],
  ['nearest', 'nearest'],
  ['closest', 'nearest'],
  ['nearby', 'nearest'],
  ['lowest price', 'cheapest'],
  ['cheapest', 'cheapest'],
]);

export type Feature = 'onlineDelivery' | 'tableBooking';

export const FEATURE_PHRASES: ReadonlyMap<string, Feature> = new Map([
  ['online delivery', 'onlineDelivery'],
  ['home delivery', 'onlineDelivery'],
  ['delivers', 'onlineDelivery'],
  ['delivery', 'onlineDelivery'],
  ['table booking', 'tableBooking'],
  ['book a table', 'tableBooking'],
  ['reservations', 'tableBooking'],
  ['reservation', 'tableBooking'],
]);

/** Words that introduce a place: "in Gurgaon", "at Cyber Hub". */
export const PLACE_PREPOSITIONS: readonly string[] = ['in', 'at', 'around'];

/** After a preposition, these are not places: "best in town". */
export const NOT_PLACES: readonly string[] = [
  'town',
  'city',
  'area',
  'my area',
  'here',
  'the city',
  'the area',
];

/** Dropped without effect (ADR-002 Pass 7). */
export const FILLERS: readonly string[] = [
  'restaurants',
  'restaurant',
  'places',
  'place',
  'food',
  'foods',
  'serves',
  'serving',
  'serve',
  'that',
  'with',
  'some',
  'near',
  'for',
  'two',
  'the',
  'and',
  'or',
  'of',
  'in',
  'at',
  'around',
  'a',
  'an',
  'me',
  'i',
  'want',
  'show',
  'find',
  'good',
  'great',
  'options',
  'eat',
  'eats',
  'eatery',
  'eateries',
  'spot',
  'spots',
  'joint',
  'joints',
  'outlet',
  'outlets',
  'to',
  // Meals: "dinner" is one typo from the cuisine "diner" (Pass 6b).
  'dinner',
  'lunch',
  'meal',
  'meals',
  'dining',
];

import type {
  Interpretation,
  InterpretationBody,
  SearchCriteria,
  SearchVocabulary,
} from '../models/search.model';
import { ApplicationError } from '../utils/application-error';
import { currencyForCity } from '../utils/country';
import { normalize, normalizeCity, splitCuisines } from '../utils/normalize';
import { resolveSort } from '../utils/search-sort';
import type {
  ListRestaurantsQuery,
  SearchRestaurantsQuery,
} from '../validators/restaurant.schema';

export const CURRENCY_REQUIRED_MESSAGE =
  'Required with minCost, maxCost or sort=cost unless city is a known city';

/** 400 on `currency`, in the same shape as the schema's field errors. */
export function currencyRequiredError(): ApplicationError {
  return new ApplicationError('VALIDATION_ERROR', 'Invalid request', {
    details: [
      {
        path: 'currency',
        code: 'required',
        message: CURRENCY_REQUIRED_MESSAGE,
      },
    ],
  });
}

// ------------------------------------------------------------ list (Step 5)

/**
 * List query → criteria. Pure. City and cuisines go through the same
 * normalize() that built `norm.*` (invariant 3). With a cost filter or cost
 * sort, the currency is the given one, else the city's from the vocabulary
 * snapshot; otherwise 400 on `currency` (invariant 12). It is checked here,
 * not in the schema, because the city list comes from the database.
 */
export function toSearchCriteria(
  query: ListRestaurantsQuery,
  vocabulary: SearchVocabulary,
): SearchCriteria {
  const criteria: SearchCriteria = {
    cuisineMatch: 'any',
    ...explicitCriteria(query),
  };
  if (!usesCost(criteria)) {
    // A currency only means something with a cost filter or sort.
    delete criteria.currency;
    return criteria;
  }
  const currency = currencyFor(criteria, vocabulary);
  if (currency === undefined) throw currencyRequiredError();
  criteria.currency = currency;
  return criteria;
}

// ---------------------------------------------------------- search (Step 6)

export interface SearchRequestCriteria {
  criteria: SearchCriteria;
  notes: string[];
}

/**
 * What `q` said, merged with the explicit parameters, then made executable
 * (ADR-002). Three steps, each adding its notes in order:
 * 1. explicit parameters win over what `q` said, with a note per override;
 * 2. the currency rule: a cost filter or sort needs a currency (written in
 *    `q`, sent, or the city's). Explicit cost parameters without one are a
 *    400, as on the list; a price read from `q` becomes a ranking preference
 *    instead, and a parsed "cheapest" is dropped (decision 2, Build Step 6);
 * 3. boost terms only rank by relevance; with any other order they are
 *    dropped with a note.
 */
export function toSearchRequestCriteria(
  interpretation: Interpretation,
  query: SearchRestaurantsQuery,
  vocabulary: SearchVocabulary,
): SearchRequestCriteria {
  const explicit = explicitCriteria(query);
  // `criteria` is a fresh object owned by this function; the steps below
  // refine it in place and return what they want to tell the client.
  const { criteria, notes } = mergeExplicitOverParsed(
    interpretation.criteria,
    explicit,
  );
  notes.push(...applyCurrencyRule(criteria, usesCost(explicit), vocabulary));
  notes.push(...dropBoostTermsUnlessRelevance(criteria));
  return { criteria, notes };
}

/** The query parameter a criteria field came from, for override notes. */
const PARAMETER_OF: Partial<Record<keyof SearchCriteria, string>> = {
  cuisines: 'cuisine',
  origin: 'lat/lng',
};

/** Step 1: parsed criteria, overwritten field by field by explicit ones. */
function mergeExplicitOverParsed(
  parsed: Interpretation['criteria'],
  explicit: Partial<SearchCriteria>,
): SearchRequestCriteria {
  const notes: string[] = [];
  const criteria: SearchCriteria = { cuisineMatch: 'any', ...parsed };

  for (const [key, value] of Object.entries(explicit) as [
    keyof SearchCriteria,
    unknown,
  ][]) {
    const fromQuery = parsed[key as keyof typeof parsed];
    if (fromQuery !== undefined && display(fromQuery) !== display(value)) {
      notes.push(
        `${key}: '${display(fromQuery)}' from the query, overridden by ${PARAMETER_OF[key] ?? key}=${display(value)}`,
      );
    }
    Object.assign(criteria, { [key]: value });
  }
  // An explicit sort brings its own order (or the default for it), never
  // the order `q` implied for a different sort.
  if (explicit.sort !== undefined && explicit.order === undefined) {
    delete criteria.order;
  }
  return { criteria, notes };
}

/** Step 2: resolve the currency, or degrade a parsed price (invariant 12). */
function applyCurrencyRule(
  criteria: SearchCriteria,
  explicitCost: boolean,
  vocabulary: SearchVocabulary,
): string[] {
  if (!usesCost(criteria)) {
    // A currency only means something with a cost filter or sort.
    delete criteria.currency;
    return [];
  }
  const currency = currencyFor(criteria, vocabulary);
  if (currency !== undefined) {
    criteria.currency = currency;
    return [];
  }
  if (explicitCost) throw currencyRequiredError();

  // Only `q` asked for a cost: rank within the price first instead of
  // filtering, and drop a parsed "cheapest", which cannot sort without one.
  const notes: string[] = [];
  if (criteria.minCost !== undefined || criteria.maxCost !== undefined) {
    criteria.pricePreference = {
      ...(criteria.minCost !== undefined && { minCost: criteria.minCost }),
      ...(criteria.maxCost !== undefined && { maxCost: criteria.maxCost }),
    };
    delete criteria.minCost;
    delete criteria.maxCost;
    notes.push(
      'no currency given: restaurants within the price first, then the rest; add Rs, $ or currency= to filter',
    );
  }
  if (criteria.sort === 'cost') {
    delete criteria.sort;
    delete criteria.order;
    notes.push(
      'cheapest needs a currency or a known city; showing best matches',
    );
  }
  return notes;
}

/** Step 3: boost terms would distort any order other than relevance. */
function dropBoostTermsUnlessRelevance(criteria: SearchCriteria): string[] {
  const sort = resolveSort(criteria);
  if ((criteria.boostTerms?.length ?? 0) === 0 || sort === 'relevance') {
    return [];
  }
  const note = `boost terms ignored with sort=${sort}: ${criteria.boostTerms?.join(', ')}`;
  delete criteria.boostTerms;
  return [note];
}

/** What the search understood, for the response (ADR-002 Response). */
export function toInterpretationBody(
  q: string,
  criteria: SearchCriteria,
  notes: string[],
): InterpretationBody {
  // The response lists the filters and preferences used plus the resolved
  // sort (ADR-002 Response); these request fields are not returned.
  const {
    cuisineMatch: _match,
    origin: _origin,
    radiusKm: _radius,
    name: _name,
    order: _order,
    ...fields
  } = criteria;
  return {
    query: q,
    ...fields,
    sort: resolveSort(criteria),
    notes,
  };
}

// ------------------------------------------------------------------ shared

/**
 * The explicit list parameters as criteria fields, normalized. Absent
 * parameters are absent keys (never `undefined` values), so a merge only
 * overrides what the client actually sent.
 */
function explicitCriteria(
  query: ListRestaurantsQuery,
): Partial<SearchCriteria> {
  return {
    ...(query.name !== undefined && { name: query.name }),
    ...(query.city !== undefined && { city: normalizeCity(query.city) }),
    ...(query.cuisine !== undefined && {
      cuisines: [...new Set(splitCuisines(query.cuisine).map(normalize))],
    }),
    ...(query.cuisineMatch !== undefined && {
      cuisineMatch: query.cuisineMatch,
    }),
    ...(query.minRating !== undefined && { minRating: query.minRating }),
    ...(query.minVotes !== undefined && { minVotes: query.minVotes }),
    ...(query.minCost !== undefined && { minCost: query.minCost }),
    ...(query.maxCost !== undefined && { maxCost: query.maxCost }),
    ...(query.currency !== undefined && { currency: query.currency }),
    ...(query.lat !== undefined &&
      query.lng !== undefined && {
        origin: { lat: query.lat, lng: query.lng },
      }),
    ...(query.radiusKm !== undefined && { radiusKm: query.radiusKm }),
    ...(query.sort !== undefined && { sort: query.sort }),
    ...(query.order !== undefined && { order: query.order }),
  };
}

/** A cost filter or a cost sort: the cases that need a currency (Rule 11). */
function usesCost(criteria: Partial<SearchCriteria>): boolean {
  return (
    criteria.minCost !== undefined ||
    criteria.maxCost !== undefined ||
    criteria.sort === 'cost'
  );
}

/** The given currency, else the currency of the city's country, if known. */
function currencyFor(
  criteria: SearchCriteria,
  vocabulary: SearchVocabulary,
): string | undefined {
  if (criteria.currency !== undefined) return criteria.currency;
  if (criteria.city === undefined) return undefined;
  return currencyForCity(criteria.city, vocabulary.cities);
}

/** A criteria value as it appears in an override note. */
function display(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

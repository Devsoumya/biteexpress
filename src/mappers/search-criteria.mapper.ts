import type {
  Interpretation,
  InterpretationBody,
  SearchCriteria,
  SearchVocabulary,
} from '../models/search.model';
import { ApplicationError } from '../utils/application-error';
import { currencyForCity } from '../utils/country';
import { normalize, normalizeCity, splitCuisines } from '../utils/normalize';
import { resolveSort } from '../utils/restaurant-search.builder';
import type {
  ListRestaurantsQuery,
  SearchRestaurantsQuery,
} from '../validators/restaurant.schema';

function usesCost(query: ListRestaurantsQuery): boolean {
  return (
    query.minCost !== undefined ||
    query.maxCost !== undefined ||
    query.sort === 'cost'
  );
}

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

/**
 * List query → criteria (ADR-002 shape, shared with Step 6). Pure. City and
 * cuisines go through the same normalize() that built `norm.*` (invariant 3).
 * With a cost filter or cost sort, the currency is the given one, else the
 * city's from the vocabulary snapshot; otherwise 400 on `currency` (ADR-003
 * Rule 11). It is checked here, not in the schema, because the city list
 * comes from the database.
 */
export function toSearchCriteria(
  query: ListRestaurantsQuery,
  vocabulary: SearchVocabulary,
): SearchCriteria {
  const city = query.city === undefined ? undefined : normalizeCity(query.city);
  const cuisines =
    query.cuisine === undefined
      ? undefined
      : [...new Set(splitCuisines(query.cuisine).map(normalize))];

  let currency: string | undefined;
  if (usesCost(query)) {
    currency =
      query.currency ??
      (city === undefined
        ? undefined
        : currencyForCity(city, vocabulary.cities));
    if (currency === undefined) throw currencyRequiredError();
  }

  return {
    ...(query.name !== undefined && { name: query.name }),
    ...(city !== undefined && { city }),
    ...(cuisines !== undefined && { cuisines }),
    cuisineMatch: query.cuisineMatch ?? 'any',
    ...(query.minRating !== undefined && { minRating: query.minRating }),
    ...(query.minVotes !== undefined && { minVotes: query.minVotes }),
    ...(query.minCost !== undefined && { minCost: query.minCost }),
    ...(query.maxCost !== undefined && { maxCost: query.maxCost }),
    ...(currency !== undefined && { currency }),
    ...(query.lat !== undefined &&
      query.lng !== undefined && {
        origin: { lat: query.lat, lng: query.lng },
      }),
    ...(query.radiusKm !== undefined && { radiusKm: query.radiusKm }),
    ...(query.sort !== undefined && { sort: query.sort }),
    ...(query.order !== undefined && { order: query.order }),
  };
}

/** The explicit list parameters as criteria fields, normalized. */
function explicitFields(query: ListRestaurantsQuery): Partial<SearchCriteria> {
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

function display(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/** The query parameter a criteria field came from, for override notes. */
const PARAMETER_OF: Partial<Record<keyof SearchCriteria, string>> = {
  cuisines: 'cuisine',
  origin: 'lat/lng',
};

export interface SearchRequestCriteria {
  criteria: SearchCriteria;
  notes: string[];
}

/**
 * What `q` said, merged with the explicit parameters (which win, with a note,
 * ADR-002), then made executable:
 * - a cost filter or sort needs a currency: written in `q`, sent, or the
 *   city's. Explicit cost parameters without one are a 400, as on the list;
 *   a price read from `q` becomes a ranking preference instead, and a parsed
 *   "cheapest" is dropped (decision 2, Build Step 6).
 * - boost terms only rank by relevance; with any other order they are
 *   dropped with a note.
 */
export function toSearchRequestCriteria(
  interpretation: Interpretation,
  query: SearchRestaurantsQuery,
  vocabulary: SearchVocabulary,
): SearchRequestCriteria {
  const notes: string[] = [];
  const parsed = interpretation.criteria;
  const explicit = explicitFields(query);
  const merged: SearchCriteria = { cuisineMatch: 'any', ...parsed };

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
    Object.assign(merged, { [key]: value });
  }
  // An explicit sort brings its own order (or the default for it).
  if (explicit.sort !== undefined && explicit.order === undefined)
    delete merged.order;

  const explicitCost =
    explicit.minCost !== undefined ||
    explicit.maxCost !== undefined ||
    explicit.sort === 'cost';
  const anyCost =
    merged.minCost !== undefined ||
    merged.maxCost !== undefined ||
    merged.sort === 'cost';
  if (anyCost) {
    const currency =
      merged.currency ??
      (merged.city === undefined
        ? undefined
        : currencyForCity(merged.city, vocabulary.cities));
    if (currency !== undefined) {
      merged.currency = currency;
    } else if (explicitCost) {
      throw currencyRequiredError();
    } else {
      if (merged.minCost !== undefined || merged.maxCost !== undefined) {
        merged.pricePreference = {
          ...(merged.minCost !== undefined && { minCost: merged.minCost }),
          ...(merged.maxCost !== undefined && { maxCost: merged.maxCost }),
        };
        delete merged.minCost;
        delete merged.maxCost;
        notes.push(
          'no currency given: restaurants within the price first, then the rest; add Rs, $ or currency= to filter',
        );
      }
      if (merged.sort === 'cost') {
        delete merged.sort;
        delete merged.order;
        notes.push(
          'cheapest needs a currency or a known city; showing best matches',
        );
      }
    }
  } else {
    // A currency only means something with a cost filter or sort.
    delete merged.currency;
  }

  const sort = resolveSort(merged);
  if ((merged.boostTerms?.length ?? 0) > 0 && sort !== 'relevance') {
    notes.push(
      `boost terms ignored with sort=${sort}: ${merged.boostTerms?.join(', ')}`,
    );
    delete merged.boostTerms;
  }
  return { criteria: merged, notes };
}

/** What the search understood, for the response (ADR-002 Response). */
export function toInterpretationBody(
  q: string,
  criteria: SearchCriteria,
  notes: string[],
): InterpretationBody {
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

import type { Document } from 'mongodb';
import type {
  ResolvedSort,
  SearchCriteria,
  SortOrder,
} from '../models/search.model';
import { DEFAULT_RADIUS_KM } from '../constants/search';
import { haversineDistanceKmExpression } from './geo';
import { resolveSort } from './search-sort';

/** `near` scores pivot / (pivot + distance): 0.5 at 1 km (ADR-003). */
export const NEAR_PIVOT_METERS = 1000;

/**
 * The price preference's constant score, per order (ADR-003 checks 41-42):
 * above any `near` score (≤ 1) and small enough to keep float precision for
 * distance; above any realistic text score (max seen 44) for relevance; for
 * rating and cost it is the only scored clause.
 */
export const PRICE_PREFERENCE_SCORE: Record<ResolvedSort, number> = {
  distance: 10,
  relevance: 1000,
  rating: 1,
  cost: 1,
};

/** One typo allowed, after the first two letters (ADR-003 Rule 4). */
const FUZZY = { maxEdits: 1, prefixLength: 2 };

const BY_SCORE = { score: { $meta: 'searchScore', order: -1 } };
const RATING_DESC_UNRATED_LAST = { order: -1, noData: 'lowest' };

export interface SearchPipelineOptions {
  tenantId: string;
  indexName: string;
  /** Page size; the pipeline fetches one more to know if a next page exists. */
  limit: number;
  searchAfter?: string;
}

/**
 * Criteria → the list aggregation (ADR-003 query builder, Rules 1-11). Pure:
 * no I/O, so every rule is unit-tested on its exact output. The tenant filter
 * comes first and is always present (invariant 5). No stage after $search
 * filters: with returnStoredSource, later stages see only stored fields
 * (invariant 8).
 *
 * The compound has three parts:
 * - `filter`: restrictions that never change the order (Rule 1);
 * - `must`: the text clauses, only when ranking by relevance;
 * - `should`: clauses that only raise the score (distance, boosts, price).
 */
export function buildSearchPipeline(
  criteria: SearchCriteria,
  options: SearchPipelineOptions,
): Document[] {
  const sort = resolveSort(criteria);
  // The request schema rejects sort=distance without lat/lng; reaching this
  // is a bug, not input.
  if (sort === 'distance' && !criteria.origin) {
    throw new Error('distance sort without coordinates reached the builder');
  }

  const must = sort === 'relevance' ? matchClauses(criteria) : [];
  const should = scoreClauses(criteria, sort);
  const compound: Document = {
    filter: [
      { equals: { path: 'tenantId', value: options.tenantId } },
      ...filters(criteria, sort),
    ],
    ...(must.length > 0 && { must }),
    ...(should.length > 0 && { should }),
  };

  return [
    {
      $search: {
        index: options.indexName,
        compound,
        sort: sortSpec(criteria, sort),
        returnStoredSource: true,
        ...(options.searchAfter !== undefined && {
          searchAfter: options.searchAfter,
        }),
      },
    },
    { $limit: options.limit + 1 },
    {
      $addFields: {
        paginationToken: { $meta: 'searchSequenceToken' },
        // Rule 7: distance for the returned page only.
        ...(criteria.origin && {
          distanceKm: haversineDistanceKmExpression(criteria.origin),
        }),
      },
    },
  ];
}

// ---------------------------------------------------------------- filters

/**
 * Rule 1: every restriction is a filter, so it never changes the order. The
 * groups are concatenated in a fixed order, so equal criteria always give an
 * identical pipeline (the builder tests assert exact arrays).
 */
function filters(criteria: SearchCriteria, sort: ResolvedSort): Document[] {
  return [
    ...attributeFilters(criteria),
    ...costFilters(criteria),
    ...sortExistsFilters(criteria),
    ...radiusFilter(criteria),
    ...interpretedFilters(criteria),
    // Rule 4 (and ADR-002): a name, dish or text narrows any non-relevance
    // order without changing it.
    ...(sort === 'relevance' ? [] : matchClauses(criteria)),
  ];
}

/** City, cuisines (any or all), minimum rating and votes. */
function attributeFilters(criteria: SearchCriteria): Document[] {
  const { city, cuisines, cuisineMatch, minRating, minVotes } = criteria;
  const clauses: Document[] = [];
  if (city !== undefined) {
    clauses.push({ equals: { path: 'norm.city', value: city } });
  }
  if (cuisines !== undefined) {
    // `all`: one equals per cuisine (AND); `any`: one `in` (OR).
    if (cuisineMatch === 'all') {
      for (const value of cuisines) {
        clauses.push({ equals: { path: 'norm.cuisines', value } });
      }
    } else {
      clauses.push({ in: { path: 'norm.cuisines', value: cuisines } });
    }
  }
  if (minRating !== undefined) {
    clauses.push({ range: { path: 'rating.average', gte: minRating } });
  }
  if (minVotes !== undefined) {
    clauses.push({ range: { path: 'rating.votes', gte: minVotes } });
  }
  return clauses;
}

/** A cost range, and Rule 11: costs compare only within one currency. */
function costFilters(criteria: SearchCriteria): Document[] {
  const { minCost, maxCost, currency } = criteria;
  const clauses: Document[] = [];
  if (minCost !== undefined || maxCost !== undefined) {
    clauses.push({
      range: {
        path: 'cost.averageForTwo',
        ...(minCost !== undefined && { gte: minCost }),
        ...(maxCost !== undefined && { lte: maxCost }),
      },
    });
  }
  if (currency !== undefined) {
    clauses.push({ equals: { path: 'cost.currency', value: currency } });
  }
  return clauses;
}

/**
 * Rule 6: an explicit rating or cost sort excludes unknown values. The
 * default (implicit) rating order keeps unrated restaurants, last.
 */
function sortExistsFilters(criteria: SearchCriteria): Document[] {
  if (criteria.sort === 'rating') {
    return [{ exists: { path: 'rating.average' } }];
  }
  if (criteria.sort === 'cost') {
    return [{ exists: { path: 'cost.averageForTwo' } }];
  }
  return [];
}

/** Rule 5: a circle around the origin, when a radius applies. */
function radiusFilter(criteria: SearchCriteria): Document[] {
  const radius = radiusKm(criteria);
  if (radius === undefined) return [];
  return [
    {
      geoWithin: {
        path: 'location',
        circle: { center: geoPoint(criteria), radius: radius * 1000 },
      },
    },
  ];
}

/**
 * Rule 5: without a city, coordinates bound the set (default radius); with
 * a city, the city filters and a radius applies only if asked for.
 */
function radiusKm(criteria: SearchCriteria): number | undefined {
  if (!criteria.origin) return undefined;
  if (criteria.city === undefined) {
    return criteria.radiusKm ?? DEFAULT_RADIUS_KM;
  }
  return criteria.radiusKm;
}

/** Feature flags and the price-tier ceiling, read from `q` (ADR-002). */
function interpretedFilters(criteria: SearchCriteria): Document[] {
  const clauses: Document[] = [];
  if (criteria.features?.onlineDelivery) {
    clauses.push({ equals: { path: 'features.onlineDelivery', value: true } });
  }
  if (criteria.features?.tableBooking) {
    clauses.push({ equals: { path: 'features.tableBooking', value: true } });
  }
  if (criteria.maxPriceRange !== undefined) {
    clauses.push({
      range: { path: 'cost.priceRange', lte: criteria.maxPriceRange },
    });
  }
  return clauses;
}

// ----------------------------------------------------------- text clauses

/**
 * Clauses that must match: in `must` for relevance (they score), else in
 * `filter` (they only narrow).
 */
function matchClauses(criteria: SearchCriteria): Document[] {
  const dishes = dishesClause(criteria);
  return [
    ...(criteria.name !== undefined ? [nameClause(criteria.name)] : []),
    ...(dishes ? [dishes] : []),
    ...(criteria.text !== undefined ? [textClause(criteria.text)] : []),
  ];
}

/** Rule 4: type-ahead or one typo; either is enough. */
function nameClause(name: string): Document {
  return {
    compound: {
      should: [
        { autocomplete: { path: 'name', query: name } },
        { text: { path: 'name', query: name, fuzzy: FUZZY } },
      ],
      minimumShouldMatch: 1,
    },
  };
}

/** ADR-002: a dish matches a name phrase OR a cuisine that serves it. */
function dishesClause(criteria: SearchCriteria): Document | undefined {
  const dishes = criteria.dishes ?? [];
  if (dishes.length === 0) return undefined;
  const cuisines = [...new Set(dishes.flatMap((dish) => dish.cuisines))];
  return {
    compound: {
      should: [
        ...dishes.map((dish) => ({
          phrase: { path: 'name', query: dish.phrase },
        })),
        ...(cuisines.length > 0
          ? [{ in: { path: 'norm.cuisines', value: cuisines } }]
          : []),
      ],
      minimumShouldMatch: 1,
    },
  };
}

/** ADR-002 Pass 8: the whole query, typo-tolerant, over name, cuisines, locality. */
function textClause(text: string): Document {
  return {
    compound: {
      should: [
        { autocomplete: { path: 'name', query: text } },
        { text: { path: 'name', query: text, fuzzy: FUZZY } },
        { text: { path: 'cuisines', query: text, fuzzy: FUZZY } },
        { text: { path: 'address.locality', query: text, fuzzy: FUZZY } },
      ],
      minimumShouldMatch: 1,
    },
  };
}

// ---------------------------------------------------------- score clauses

/** Clauses that only raise the score: they never exclude anything. */
function scoreClauses(
  criteria: SearchCriteria,
  sort: ResolvedSort,
): Document[] {
  const clauses: Document[] = [];
  const origin = geoPoint(criteria);
  // `near` is the only distance-scored clause: located restaurants score by
  // distance; those without a location still match, score 0 and come last
  // (Rule 6, verified on the full seed).
  if (sort === 'distance' && origin) {
    clauses.push({
      near: { path: 'location', origin, pivot: NEAR_PIVOT_METERS },
    });
  }
  // Boost terms rank only by relevance; elsewhere they would distort the order.
  if (sort === 'relevance' && (criteria.boostTerms?.length ?? 0) > 0) {
    clauses.push({
      text: {
        path: ['name', 'cuisines', 'address.locality'],
        query: criteria.boostTerms,
        fuzzy: { maxEdits: 1 },
      },
    });
  }
  // A price from `q` without a currency: restaurants within it rank first
  // (ADR-002 Pass 1), nothing is excluded.
  const preference = criteria.pricePreference;
  if (preference) {
    clauses.push({
      range: {
        path: 'cost.averageForTwo',
        ...(preference.minCost !== undefined && { gte: preference.minCost }),
        ...(preference.maxCost !== undefined && { lte: preference.maxCost }),
        score: { constant: { value: PRICE_PREFERENCE_SCORE[sort] } },
      },
    });
  }
  return clauses;
}

/** The request's origin as GeoJSON (`[lng, lat]`, invariant 2). */
function geoPoint(criteria: SearchCriteria): Document | undefined {
  return (
    criteria.origin && {
      type: 'Point',
      coordinates: [criteria.origin.lng, criteria.origin.lat],
    }
  );
}

// ------------------------------------------------------------------- sort

/**
 * Rule 2; `_id` is the final tie-breaker in every sort (invariant 9). With a
 * price preference, rating and cost orders start with the score, so the
 * within-price group comes first (ADR-002 Pass 1).
 */
function sortSpec(criteria: SearchCriteria, sort: ResolvedSort): Document {
  const spec = fieldSortSpec(criteria, sort);
  return criteria.pricePreference && (sort === 'rating' || sort === 'cost')
    ? { ...BY_SCORE, ...spec }
    : spec;
}

function fieldSortSpec(criteria: SearchCriteria, sort: ResolvedSort): Document {
  switch (sort) {
    case 'rating':
      return {
        // noData set explicitly: on the default list, unrated come last.
        'rating.average': {
          order: direction(criteria.order ?? 'desc'),
          noData: 'lowest',
        },
        'rating.votes': -1,
        _id: 1,
      };
    case 'cost':
      return {
        'cost.averageForTwo': direction(criteria.order ?? 'asc'),
        _id: 1,
      };
    case 'distance':
      return { ...BY_SCORE, _id: 1 };
    case 'relevance':
      // Equally relevant results ordered by rating (author's decision).
      return {
        ...BY_SCORE,
        'rating.average': RATING_DESC_UNRATED_LAST,
        _id: 1,
      };
  }
}

function direction(order: SortOrder): 1 | -1 {
  return order === 'asc' ? 1 : -1;
}

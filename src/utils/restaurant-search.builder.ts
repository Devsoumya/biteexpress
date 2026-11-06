import type { Document } from 'mongodb';
import type {
  ResolvedSort,
  SearchCriteria,
  SortOrder,
} from '../models/search.model';
import { DEFAULT_RADIUS_KM } from '../constants/search';
import { haversineDistanceKmExpression } from './geo';

/** `near` scores pivot / (pivot + distance): 0.5 at 1 km (ADR-003). */
export const NEAR_PIVOT_METERS = 1000;

export interface SearchPipelineOptions {
  tenantId: string;
  indexName: string;
  /** Page size; the pipeline fetches one more to know if a next page exists. */
  limit: number;
  searchAfter?: string;
}

/**
 * ADR-003 Rule 3: relevance when a name is given, else distance with
 * coordinates, else rating. An explicit sort always wins.
 */
export function resolveSort(criteria: SearchCriteria): ResolvedSort {
  if (criteria.sort) return criteria.sort;
  if (hasTextClauses(criteria)) return 'relevance';
  if (criteria.origin) return 'distance';
  return 'rating';
}

/** Name, dishes, whole-query text or boost terms: relevance is the default. */
function hasTextClauses(criteria: SearchCriteria): boolean {
  return (
    criteria.name !== undefined ||
    criteria.text !== undefined ||
    (criteria.dishes?.length ?? 0) > 0 ||
    (criteria.boostTerms?.length ?? 0) > 0
  );
}

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

const FUZZY = { maxEdits: 1, prefixLength: 2 };

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

/** Pass 8: the whole query, typo-tolerant, over name, cuisines, locality. */
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

/** Clauses that must match: in `must` for relevance, else in `filter`. */
function matchClauses(criteria: SearchCriteria): Document[] {
  const dishes = dishesClause(criteria);
  return [
    ...(criteria.name !== undefined ? [nameClause(criteria.name)] : []),
    ...(dishes ? [dishes] : []),
    ...(criteria.text !== undefined ? [textClause(criteria.text)] : []),
  ];
}

/** Clauses that only raise the score: never exclude anything. */
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

function geoPoint(criteria: SearchCriteria): Document | undefined {
  return (
    criteria.origin && {
      type: 'Point',
      coordinates: [criteria.origin.lng, criteria.origin.lat],
    }
  );
}

/** Rule 4: type-ahead or one typo; either is enough. */
function nameClause(name: string): Document {
  return {
    compound: {
      should: [
        { autocomplete: { path: 'name', query: name } },
        {
          text: {
            path: 'name',
            query: name,
            fuzzy: { maxEdits: 1, prefixLength: 2 },
          },
        },
      ],
      minimumShouldMatch: 1,
    },
  };
}

/** Rule 5: without a city, coordinates bound the set; with one, only if asked. */
function radiusKm(criteria: SearchCriteria): number | undefined {
  if (!criteria.origin) return undefined;
  if (criteria.city === undefined)
    return criteria.radiusKm ?? DEFAULT_RADIUS_KM;
  return criteria.radiusKm;
}

/** Rule 1: every restriction is a filter: it never changes the order. */
function filters(criteria: SearchCriteria, sort: ResolvedSort): Document[] {
  const clauses: Document[] = [];
  const { city, cuisines, minRating, minVotes, minCost, maxCost } = criteria;

  if (city !== undefined) {
    clauses.push({ equals: { path: 'norm.city', value: city } });
  }
  if (cuisines !== undefined) {
    if (criteria.cuisineMatch === 'all') {
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
  if (minCost !== undefined || maxCost !== undefined) {
    clauses.push({
      range: {
        path: 'cost.averageForTwo',
        ...(minCost !== undefined && { gte: minCost }),
        ...(maxCost !== undefined && { lte: maxCost }),
      },
    });
  }
  // Rule 11: costs compare only within one currency.
  if (criteria.currency !== undefined) {
    clauses.push({
      equals: { path: 'cost.currency', value: criteria.currency },
    });
  }
  // Rule 6: an explicit rating or cost sort excludes unknown values.
  if (criteria.sort === 'rating') {
    clauses.push({ exists: { path: 'rating.average' } });
  }
  if (criteria.sort === 'cost') {
    clauses.push({ exists: { path: 'cost.averageForTwo' } });
  }
  const radius = radiusKm(criteria);
  if (radius !== undefined) {
    clauses.push({
      geoWithin: {
        path: 'location',
        circle: { center: geoPoint(criteria), radius: radius * 1000 },
      },
    });
  }
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
  // Rule 4 (and ADR-002): a name, dish or text narrows any non-relevance
  // order without changing it.
  if (sort !== 'relevance') clauses.push(...matchClauses(criteria));
  return clauses;
}

function direction(order: SortOrder): 1 | -1 {
  return order === 'asc' ? 1 : -1;
}

const BY_SCORE = { score: { $meta: 'searchScore', order: -1 } };
const RATING_DESC_UNRATED_LAST = { order: -1, noData: 'lowest' };

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

/**
 * Criteria → the list aggregation (ADR-003 query builder, Rules 1-11). Pure:
 * no I/O, so every rule is unit-tested on its exact output. The tenant filter
 * comes first and is always present (invariant 5). No stage after $search
 * filters: with returnStoredSource, later stages see only stored fields
 * (invariant 8).
 */
export function buildSearchPipeline(
  criteria: SearchCriteria,
  options: SearchPipelineOptions,
): Document[] {
  const sort = resolveSort(criteria);
  const origin = geoPoint(criteria);
  if (sort === 'distance' && !origin) {
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

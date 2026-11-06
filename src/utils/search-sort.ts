import type { ResolvedSort, SearchCriteria } from '../models/search.model';

/**
 * The order a list or search runs in (ADR-003 Rule 3, invariant 10): an
 * explicit sort always wins; otherwise relevance when there is text to rank
 * by, else distance with coordinates, else rating.
 *
 * A domain rule, not MongoDB syntax: the criteria mapper, the log summary and
 * the pipeline builder all need it, so it lives apart from the builder.
 */
export function resolveSort(criteria: SearchCriteria): ResolvedSort {
  if (criteria.sort) return criteria.sort;
  if (hasTextClauses(criteria)) return 'relevance';
  if (criteria.origin) return 'distance';
  return 'rating';
}

/** Name, dishes, whole-query text or boost terms: something to rank by. */
function hasTextClauses(criteria: SearchCriteria): boolean {
  return (
    criteria.name !== undefined ||
    criteria.text !== undefined ||
    (criteria.dishes?.length ?? 0) > 0 ||
    (criteria.boostTerms?.length ?? 0) > 0
  );
}

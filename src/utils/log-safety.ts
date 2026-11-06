import type { LatLng } from '../models/geo.model';
import type {
  InterpretationBody,
  SearchCriteria,
} from '../models/search.model';
import { resolveSort } from './search-sort';

/**
 * 2 decimals is about 1 km: enough to tell areas apart, not enough to locate
 * a person. A consumer's location is personal data (DPDP, GDPR; ADR-004).
 */
export function roundCoordinates({ lat, lng }: LatLng): LatLng {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

/**
 * What a list or search asked for, safe to log: filter **names** (never
 * their values), the resolved order, the rounded origin and the page size.
 */
export function summarizeCriteria(
  criteria: SearchCriteria,
  limit: number,
): Record<string, unknown> {
  const {
    cuisineMatch: _match,
    origin,
    sort: _sort,
    order,
    radiusKm,
    ...rest
  } = criteria;
  return {
    sort: resolveSort(criteria),
    ...(order !== undefined && { order }),
    filters: Object.keys(rest).sort(),
    ...(origin && { origin: roundCoordinates(origin) }),
    ...(radiusKm !== undefined && { radiusKm }),
    limit,
  };
}

/**
 * For search: what the interpreter recognized, as field names, plus the
 * query's length. The text itself is never logged (author's decision).
 */
export function summarizeInterpretation(
  interpretation: InterpretationBody,
): Record<string, unknown> {
  const { query, notes, sort: _sort, ...recognized } = interpretation;
  return {
    qLength: query.length,
    recognized: Object.keys(recognized).sort(),
    notesCount: notes.length,
  };
}

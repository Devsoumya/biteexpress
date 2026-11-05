import { CITY_ALIASES } from '../constants/city-aliases';
import type { NormalizedCuisines } from '../models/restaurant.model';

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE_RUN = /\s+/g;

/**
 * Canonical form for exact-match keys (`norm.*`) and for query values compared
 * with them: diacritics folded, lowercase, whitespace collapsed, trimmed.
 * Decomposing before lowercasing also folds `İ` to `i`; `toLowerCase` is
 * locale-independent, so results do not depend on the server's locale.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** `normalize`, then resolve alternative spellings (Gurugram → gurgaon). */
export function normalizeCity(value: string): string {
  const key = normalize(value);
  return CITY_ALIASES.get(key) ?? key;
}

/** Splits the CSV's comma-separated cuisine column; blank entries dropped. */
export function splitCuisines(raw: string): string[] {
  return raw
    .split(',')
    .map((cuisine) => cuisine.trim())
    .filter((cuisine) => cuisine.length > 0);
}

/**
 * De-duplicates by canonical key, keeping the first spelling seen and the
 * input order, so `display` and `norm` stay index-aligned.
 */
export function normalizeCuisines(
  values: readonly string[],
): NormalizedCuisines {
  const display: string[] = [];
  const norm: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalize(trimmed);
    if (key.length === 0 || norm.includes(key)) continue;
    display.push(trimmed);
    norm.push(key);
  }
  return { display, norm };
}

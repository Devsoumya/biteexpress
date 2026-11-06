import { COUNTRIES } from '../constants/countries';
import type { Country } from '../models/country.model';

const BY_SEED_CODE = new Map(COUNTRIES.map((c) => [c.seedCode, c]));
const BY_ISO_CODE = new Map(COUNTRIES.map((c) => [c.isoCode, c]));

export function countryBySeedCode(code: number): Country | undefined {
  return BY_SEED_CODE.get(code);
}

/** Expects uppercase ISO alpha-2; request validation uppercases at the edge. */
export function countryByIsoCode(code: string): Country | undefined {
  return BY_ISO_CODE.get(code);
}

/**
 * Currency of a normalized city's country, from the vocabulary snapshot (the
 * tenant's cities with their country); undefined when the city is not known,
 * and the caller must then require `currency` (ADR-003 Rule 11).
 */
export function currencyForCity(
  normalizedCity: string,
  cities: ReadonlyMap<string, string>,
): string | undefined {
  const isoCode = cities.get(normalizedCity);
  return isoCode === undefined ? undefined : BY_ISO_CODE.get(isoCode)?.currency;
}

/** ISO 4217 codes of the supported markets. */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  ...new Set(COUNTRIES.map((c) => c.currency)),
];

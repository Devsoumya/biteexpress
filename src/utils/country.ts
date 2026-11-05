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

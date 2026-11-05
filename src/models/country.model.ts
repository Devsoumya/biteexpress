/** A supported market (ADR-001 Rule 6). */
export interface Country {
  /** ISO 3166-1 alpha-2, as clients send it. */
  isoCode: string;
  /** ISO 3166-1 English short name; stored because analytics read the database. */
  name: string;
  /** ISO 4217. Never taken from the CSV's Currency column. */
  currency: string;
  /** Numeric `Country Code` in the Zomato seed CSV. */
  seedCode: number;
}

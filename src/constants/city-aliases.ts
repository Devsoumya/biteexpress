// Alternative spellings → the city name used in the data, both already in
// normalize() form. The data itself contains none of these spellings; they
// serve input (POST bodies, query values, natural-language queries). Only
// cities that exist in the data get an alias.
export const CITY_ALIASES: ReadonlyMap<string, string> = new Map([
  ['gurugram', 'gurgaon'],
  ['delhi', 'new delhi'],
  ['bengaluru', 'bangalore'],
  ['bombay', 'mumbai'],
  ['calcutta', 'kolkata'],
  ['madras', 'chennai'],
]);

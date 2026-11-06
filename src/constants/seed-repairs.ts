// Repairs for damage in zomato_data.csv that happened before we received it.
// U+FFFD is lossy, so only these exact, known strings are restored; restaurant
// names containing it are left as they are (ADR-001 Rule 11).
export const SOURCE_TEXT_REPAIRS: ReadonlyMap<string, string> = new Map([
  ['Bras�_lia', 'Brasília'],
  ['S��o Paulo', 'São Paulo'],
  ['��stanbul', 'İstanbul'],
  ['D�_ner', 'Döner'],
  ['B�_rek', 'Börek'],
]);

// Turkish dotless ı is stored as U+06F1 (an Arabic-Indic digit) throughout
// the file (52 times, e.g. "Sofras۱"): one systematic, one-to-one mistake.
export const MISENCODED_DOTLESS_I = /۱/g;
export const DOTLESS_I = 'ı';

/** Rows that are not restaurants: 18419884 is "Test Restaruants for Medio". */
export const SKIPPED_SOURCE_IDS: ReadonlySet<number> = new Set([18419884]);

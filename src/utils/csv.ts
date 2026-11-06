import { parse } from 'csv-parse/sync';
import type { CsvRow } from '../models/seed.model';

/**
 * Parses CSV text with a header row into records. The only place that uses
 * csv-parse. Options are strict: a row with a different number of fields, or
 * a stray quote, throws instead of silently shifting columns. Values are not
 * trimmed here; the row mapper owns text cleanup.
 */
export function parseCsvRecords(text: string): CsvRow[] {
  return parse<CsvRow>(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: false,
    relax_quotes: false,
  });
}

/**
 * Decodes file bytes as UTF-8, throwing on invalid sequences, so a file saved
 * in another encoding fails loudly instead of producing mojibake.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

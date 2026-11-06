/** One CSV record, keyed by the header row. */
export type CsvRow = Record<string, string>;

export interface SeedSkip {
  skip: true;
  sourceId: number;
  reason: string;
}

export type SearchIndexChange = 'created' | 'updated' | 'unchanged';

export interface SeedSummary {
  rows: number;
  mapped: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  inserted: number;
  updated: number;
  searchIndex: SearchIndexChange;
  durationMs: number;
}

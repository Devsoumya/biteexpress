import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from 'mongodb';
import {
  percentile,
  summarizeExplain,
  toMarkdown,
} from '../../../src/scripts/explain';

// A real explain('executionStats') of a $search on atlas-local, trimmed to
// the parts the script reads (Gurgaon + North Indian, sort=rating).
const SAMPLE = JSON.parse(
  readFileSync(
    join(__dirname, '../../fixtures/search-explain.sample.json'),
    'utf8',
  ),
) as Document;

describe('explain script helpers', () => {
  it('extracts collected documents and the time spent in each phase', () => {
    const stats = summarizeExplain(SAMPLE);

    expect(stats.collected).toBe(387);
    expect(stats.queryMs).toBeGreaterThan(0);
    expect(stats.collectMs).toBeGreaterThan(0);
    expect(stats.materializeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns zeros for an explain without a search stage', () => {
    expect(summarizeExplain({ stages: [] })).toEqual({
      collected: 0,
      queryMs: 0,
      collectMs: 0,
      materializeMs: 0,
    });
  });

  it.each([
    [[5, 1, 3, 2, 4], 50, 3],
    [[5, 1, 3, 2, 4], 95, 5],
    [[7], 95, 7],
    [[], 50, 0],
  ])('percentile(%j, %d) = %d', (values, p, expected) => {
    expect(percentile(values, p)).toBe(expected);
  });

  it('renders one Markdown row per shape, with a dash for no page 2', () => {
    expect(
      toMarkdown([
        {
          shape: 's',
          collected: 3,
          results: 2,
          queryMs: 1,
          collectMs: 0.5,
          materializeMs: 0.1,
          medianMs: 2,
          p95Ms: 3,
        },
      ]).split('\n')[2],
    ).toBe('| s | 3 | 2 | 1 | 0.5 | 0.1 | 2 | 3 | — |');
  });
});

import type { Collection, Document } from 'mongodb';
import { TEST_SEARCH_INDEX_NAME } from './test-database';

/**
 * Polls until `check` passes: the search index follows writes by about 1 s
 * (ADR-003), so a test that writes and then lists must wait for it. Polling
 * with a deadline, never a fixed sleep (invariant 18).
 */
export async function waitForSearch(
  check: () => Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 100, what = 'search index' } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) {
      throw new Error(`${what} did not catch up within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** How many of a tenant's documents the search index can see right now. */
export async function searchCount(
  collection: Collection<Document>,
  tenantId: string,
): Promise<number> {
  const [meta] = await collection
    .aggregate<{ count: { total: number } }>([
      {
        $searchMeta: {
          index: TEST_SEARCH_INDEX_NAME,
          equals: { path: 'tenantId', value: tenantId },
          count: { type: 'total' },
        },
      },
    ])
    .toArray();
  return meta?.count.total ?? 0;
}

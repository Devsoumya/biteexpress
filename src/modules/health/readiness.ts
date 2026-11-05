import type { Db } from 'mongodb';
import { pingDatabase } from '../../config/database';

export type ProbedIndexState = 'ok' | 'missing' | 'not_queryable';
export type SearchIndexState = ProbedIndexState | 'error' | 'skipped';

export interface ReadinessChecks {
  mongo: 'ok' | 'fail';
  searchIndex: SearchIndexState;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessChecks;
}

export interface ReadinessProbes {
  ping(): Promise<void>;
  searchIndexState(): Promise<ProbedIndexState>;
}

export type ReadinessCheck = () => Promise<ReadinessResult>;

export interface ReadinessCheckOptions {
  /** How long a result (pass or fail) is reused. Default 5000 ms. */
  ttlMs?: number;
  /** Clock, injectable so tests need no timers. Default Date.now. */
  now?: () => number;
}

interface CachedResult {
  result: ReadinessResult;
  checkedAt: number;
}

const DEFAULT_TTL_MS = 5000;

async function probe(probes: ReadinessProbes): Promise<ReadinessResult> {
  try {
    await probes.ping();
  } catch {
    return { ready: false, checks: { mongo: 'fail', searchIndex: 'skipped' } };
  }

  let searchIndex: SearchIndexState;
  try {
    searchIndex = await probes.searchIndexState();
  } catch {
    searchIndex = 'error';
  }
  return { ready: searchIndex === 'ok', checks: { mongo: 'ok', searchIndex } };
}

// Failures are cached too, so probes during an outage do not pile onto a
// struggling database; recovery is visible within one TTL.
export function createReadinessCheck(
  probes: ReadinessProbes,
  options: ReadinessCheckOptions = {},
): ReadinessCheck {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: CachedResult | undefined;

  return async () => {
    if (cached && now() - cached.checkedAt < ttlMs) return cached.result;
    const result = await probe(probes);
    cached = { result, checkedAt: now() };
    return result;
  };
}

export function mongoReadinessProbes(
  db: Db,
  collectionName: string,
  indexName: string,
): ReadinessProbes {
  return {
    ping: () => pingDatabase(db),
    async searchIndexState() {
      const indexes = await db
        .collection(collectionName)
        .listSearchIndexes(indexName)
        .toArray();
      const index = indexes[0];
      if (!index) return 'missing';
      // The driver types results as { name }; `queryable` is server-reported.
      return 'queryable' in index && index.queryable === true
        ? 'ok'
        : 'not_queryable';
    },
  };
}

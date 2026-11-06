import type { Db } from 'mongodb';
import type {
  HealthRepository,
  ProbedIndexState,
} from '../models/health.model';

/**
 * The MongoDB checks behind /ready (never /health, which must not touch the
 * database). Read-only: it never creates the collection or the index.
 */
export class MongoHealthRepository implements HealthRepository {
  constructor(
    private readonly db: Db,
    private readonly collectionName: string,
    private readonly indexName: string,
  ) {}

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  // A missing index (or collection) makes $search return empty results rather
  // than an error, which is why readiness checks it explicitly.
  async searchIndexState(): Promise<ProbedIndexState> {
    const indexes = await this.db
      .collection(this.collectionName)
      .listSearchIndexes(this.indexName)
      .toArray();
    const index = indexes[0];
    if (!index) return 'missing';
    // The driver types results as { name }; `queryable` is server-reported.
    return 'queryable' in index && index.queryable === true
      ? 'ok'
      : 'not_queryable';
  }
}

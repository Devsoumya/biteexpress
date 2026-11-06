import type { Collection, Document } from 'mongodb';
import type { SearchExecutor } from '../models/search.model';

/**
 * Runs a list pipeline. A separate seam so a test can substitute an executor
 * that fails, to prove the 503 path while the collection still works.
 * `maxTimeMS`, not the driver's `timeoutMS`: on a hung mongot only the server
 * limit aborted the query (ADR-003 Verification, check 38).
 */
export class MongoSearchExecutor implements SearchExecutor {
  constructor(private readonly collection: Collection<Document>) {}

  aggregate(
    pipeline: Document[],
    options: { maxTimeMS: number },
  ): Promise<Document[]> {
    return this.collection
      .aggregate(pipeline, { maxTimeMS: options.maxTimeMS })
      .toArray();
  }
}

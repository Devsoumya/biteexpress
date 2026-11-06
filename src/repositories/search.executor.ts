import type { Collection, Document } from 'mongodb';
import type { RestaurantDocument } from '../models/restaurant.model';
import type { SearchExecutor } from '../models/search.model';

/**
 * Runs a list pipeline. A separate seam so a test can substitute an executor
 * that fails, to prove the 503 path while the collection still works.
 * `maxTimeMS`, not the driver's `timeoutMS`: on a hung mongot only the server
 * limit aborted the query (ADR-003 Verification, check 38).
 */
export class MongoSearchExecutor implements SearchExecutor {
  constructor(private readonly collection: Collection<RestaurantDocument>) {}

  aggregate(
    pipeline: Document[],
    options: { maxTimeMS: number },
  ): Promise<Document[]> {
    // Typed as plain documents: a $search pipeline returns stored-source
    // fields plus $addFields, not whole RestaurantDocuments.
    return this.collection
      .aggregate<Document>(pipeline, { maxTimeMS: options.maxTimeMS })
      .toArray();
  }
}

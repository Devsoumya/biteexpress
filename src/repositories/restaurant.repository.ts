import {
  type AnyBulkWriteOperation,
  type Collection,
  type Document,
  ObjectId,
} from 'mongodb';
import type {
  RestaurantDocument,
  RestaurantDraft,
  RestaurantRepository,
  RestaurantRepositoryOptions,
  SeedRestaurant,
  UpsertResult,
} from '../models/restaurant.model';
import type {
  RestaurantSearchHit,
  SearchCriteria,
  SearchExecutor,
  SearchPage,
  SearchResult,
  SearchVocabulary,
} from '../models/search.model';
import { ApplicationError } from '../utils/application-error';
import { failureCode } from '../utils/mongo-errors';
import { timed } from '../utils/request-context';
import { buildSearchPipeline } from '../utils/restaurant-search.builder';
import { MongoSearchExecutor } from './search.executor';

const FAILURE_MESSAGES = {
  DATABASE_TIMEOUT: 'The database did not answer in time; retry shortly',
  DATABASE_UNAVAILABLE: 'The database is unavailable; retry shortly',
  SEARCH_TIMEOUT: 'Search did not answer in time; retry shortly',
  SEARCH_UNAVAILABLE: 'Search is unavailable; retry shortly',
} as const;

/**
 * Runs a request-path operation, measures it, and turns an outage or a timeout into its
 * catalog error (503). Any other error (a bug, a validator rejection) is
 * rethrown unchanged and becomes a 500.
 */
async function withFailureCodes<T>(
  engine: 'database' | 'search',
  operation: () => Promise<T>,
): Promise<T> {
  try {
    // Timed into the current request's dbMs (its log line, ADR-004).
    return await timed(operation);
  } catch (error) {
    const code = failureCode(error, engine);
    if (code !== undefined && code in FAILURE_MESSAGES) {
      const known = code as keyof typeof FAILURE_MESSAGES;
      throw new ApplicationError(known, FAILURE_MESSAGES[known], {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Scoped to one tenant at construction: `tenantId` goes into every filter and
 * every write here, and nowhere else (ADR-001 Rule 9).
 */
export class MongoRestaurantRepository implements RestaurantRepository {
  private readonly tenantId: string;
  private readonly maxTimeMS: number;
  private readonly searchIndexName: string;
  private readonly searchExecutor: SearchExecutor;

  constructor(
    private readonly collection: Collection<RestaurantDocument>,
    { tenantId, maxTimeMS, searchIndexName }: RestaurantRepositoryOptions,
    // Injectable so a test can simulate a search outage (ADR-005).
    searchExecutor?: SearchExecutor,
  ) {
    this.tenantId = tenantId;
    this.maxTimeMS = maxTimeMS;
    this.searchIndexName = searchIndexName;
    this.searchExecutor =
      searchExecutor ??
      new MongoSearchExecutor(collection as unknown as Collection<Document>);
  }

  /**
   * Upserts on {tenantId, sourceId}, so _id and createdAt stay stable across
   * re-seeds. Unordered: one bad document does not stop the others, and the
   * bulk error lists every failure.
   */
  async upsertManyBySourceId(
    restaurants: readonly SeedRestaurant[],
    now: Date,
  ): Promise<UpsertResult> {
    if (restaurants.length === 0) return { inserted: 0, updated: 0 };

    const operations: AnyBulkWriteOperation<RestaurantDocument>[] =
      restaurants.map((restaurant) => ({
        updateOne: {
          filter: { tenantId: this.tenantId, sourceId: restaurant.sourceId },
          // $set replaces each top-level field, so a value that became unknown
          // (for example location) must be $unset to keep "absent = unknown".
          update: {
            $set: { ...restaurant, tenantId: this.tenantId, updatedAt: now },
            $setOnInsert: { createdAt: now },
            ...unsetAbsentOptionalFields(restaurant),
          },
          upsert: true,
        },
      }));

    const result = await this.collection.bulkWrite(operations, {
      ordered: false,
    });
    return { inserted: result.upsertedCount, updated: result.matchedCount };
  }

  /**
   * Returns the document it built rather than reading it back: the validator
   * rejects anything it does not describe, and the server stores the rest
   * unchanged, so this is exactly what is stored. `insert` has no maxTimeMS;
   * serverSelectionTimeoutMS bounds the wait for a server.
   */
  async insert(draft: RestaurantDraft, now: Date): Promise<RestaurantDocument> {
    const document: RestaurantDocument = {
      _id: new ObjectId(),
      tenantId: this.tenantId,
      ...draft,
      createdAt: now,
      updatedAt: now,
    };
    await withFailureCodes('database', () =>
      this.collection.insertOne(document),
    );
    return document;
  }

  /** Collection read on the primary, not $search: sees its own writes at once. */
  async findById(id: string): Promise<RestaurantDocument | null> {
    return withFailureCodes('database', () =>
      this.collection.findOne(
        { _id: ObjectId.createFromHexString(id), tenantId: this.tenantId },
        { maxTimeMS: this.maxTimeMS },
      ),
    );
  }

  /**
   * Atlas Search, never the collection (invariant 7). The builder adds this
   * repository's tenant as the first filter. Fetches limit + 1 to know
   * whether a next page exists.
   */
  async search(
    criteria: SearchCriteria,
    page: SearchPage,
  ): Promise<SearchResult> {
    const pipeline = buildSearchPipeline(criteria, {
      tenantId: this.tenantId,
      indexName: this.searchIndexName,
      limit: page.limit,
      ...(page.searchAfter !== undefined && { searchAfter: page.searchAfter }),
    });
    const documents = await withFailureCodes('search', () =>
      this.searchExecutor.aggregate(pipeline, { maxTimeMS: this.maxTimeMS }),
    );
    // The pipeline's stored source and $addFields define this shape.
    const hits = documents as RestaurantSearchHit[];
    return {
      hits: hits.slice(0, page.limit),
      hasMore: hits.length > page.limit,
    };
  }

  /**
   * One pass over the tenant's documents: distinct (city, country) pairs and
   * distinct cuisines. 17 ms on 9,550 documents (ADR-003 check 43); at about
   * 1M, an index for this query or $searchMeta facets would replace the scan.
   */
  async vocabulary(): Promise<SearchVocabulary> {
    const [result] = await withFailureCodes('database', () =>
      this.collection
        .aggregate<{
          cities: { _id: { city: string; country: string } }[];
          cuisines: { _id: string }[];
        }>(
          [
            { $match: { tenantId: this.tenantId } },
            {
              $facet: {
                cities: [
                  {
                    $group: {
                      _id: { city: '$norm.city', country: '$country.code' },
                    },
                  },
                ],
                cuisines: [
                  { $unwind: '$norm.cuisines' },
                  { $group: { _id: '$norm.cuisines' } },
                ],
              },
            },
          ],
          { maxTimeMS: this.maxTimeMS },
        )
        .toArray(),
    );
    return {
      cities: new Map(
        (result?.cities ?? []).map(({ _id }) => [_id.city, _id.country]),
      ),
      cuisines: new Set((result?.cuisines ?? []).map(({ _id }) => _id)),
    };
  }
}

const OPTIONAL_TOP_LEVEL_FIELDS = ['location', 'cost', 'features'] as const;

function unsetAbsentOptionalFields(restaurant: SeedRestaurant): {
  $unset?: Record<string, ''>;
} {
  const absent = OPTIONAL_TOP_LEVEL_FIELDS.filter(
    (field) => restaurant[field] === undefined,
  );
  if (absent.length === 0) return {};
  return { $unset: Object.fromEntries(absent.map((field) => [field, ''])) };
}

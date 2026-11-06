import { performance } from 'node:perf_hooks';
import type { Collection, Document } from 'mongodb';
import { RESTAURANTS_COLLECTION, createMongoClient } from '../config/database';
import { loadEnv } from '../config/env';
import { toSearchRequestCriteria } from '../mappers/search-criteria.mapper';
import type { RestaurantDocument } from '../models/restaurant.model';
import type { SearchCriteria, SearchVocabulary } from '../models/search.model';
import { MongoRestaurantRepository } from '../repositories/restaurant.repository';
import { RuleBasedQueryInterpreter } from '../services/query-interpreter.service';
import { buildSearchPipeline } from '../utils/restaurant-search.builder';
import { searchRestaurantsQuerySchema } from '../validators/restaurant.schema';

// Measures every list/search request shape against the seeded data (ADR-003
// "Still to do"), with the production query builder, so the numbers are for
// exactly the queries the API runs. Output: a Markdown table for ADR-003.
// Numbers from atlas-local on one machine are indicative only.

export interface ExplainShape {
  name: string;
  criteria: SearchCriteria;
  limit?: number;
  /** Also time page 2 (searchAfter), to show deep pages cost the same. */
  secondPage?: boolean;
}

export interface ExplainStats {
  /**
   * Documents Lucene collected. For a sorted query it skips documents that
   * cannot reach the top of the page, so this can be below the match count.
   */
  collected: number;
  queryMs: number;
  collectMs: number;
  materializeMs: number;
}

export interface ExplainRow extends ExplainStats {
  shape: string;
  results: number;
  medianMs: number;
  p95Ms: number;
  page2MedianMs?: number;
}

const ANCHOR = { lat: 28.495, lng: 77.089 }; // Cyber City, Gurgaon
const DELHI = { lat: 28.6315, lng: 77.2167 }; // Connaught Place

function milliseconds(node: unknown): number {
  const stats = (node as { stats?: Record<string, { millisElapsed?: number }> })
    ?.stats;
  if (!stats) return 0;
  return Object.values(stats).reduce(
    (sum, stage) => sum + (stage.millisElapsed ?? 0),
    0,
  );
}

/** The numbers that matter from a `$search` explain('executionStats'). */
export function summarizeExplain(plan: Document): ExplainStats {
  const stage = (plan['stages'] as Document[] | undefined)?.[0];
  const explain = stage?.['$_internalSearchMongotRemote']?.explain as
    Document | undefined;
  const collectors = explain?.['collectors']?.['allCollectorStats'] as
    | { millisElapsed?: number; invocationCounts?: { collect?: number } }
    | undefined;
  return {
    collected: collectors?.invocationCounts?.collect ?? 0,
    queryMs: round(milliseconds(explain?.['query'])),
    collectMs: round(collectors?.millisElapsed ?? 0),
    materializeMs: round(
      explain?.['resultMaterialization']?.['stats']?.['millisElapsed'] ?? 0,
    ),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return round(sorted[Math.max(0, index)] ?? 0);
}

async function timeRuns(
  collection: Collection<Document>,
  pipeline: Document[],
  runs: number,
): Promise<number[]> {
  for (let i = 0; i < 3; i++) await collection.aggregate(pipeline).toArray(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await collection.aggregate(pipeline).toArray();
    times.push(performance.now() - start);
  }
  return times;
}

export interface ExplainOptions {
  tenantId: string;
  indexName: string;
  runs: number;
}

/** Explains and times each shape; one row per shape. */
export async function runExplain(
  collection: Collection<Document>,
  shapes: readonly ExplainShape[],
  { tenantId, indexName, runs }: ExplainOptions,
): Promise<ExplainRow[]> {
  const rows: ExplainRow[] = [];
  for (const shape of shapes) {
    const limit = shape.limit ?? 20;
    const pipeline = buildSearchPipeline(shape.criteria, {
      tenantId,
      indexName,
      limit,
    });
    const plan = await collection.aggregate(pipeline).explain('executionStats');
    const firstPage = await collection.aggregate(pipeline).toArray();
    const times = await timeRuns(collection, pipeline, runs);
    const row: ExplainRow = {
      shape: shape.name,
      ...summarizeExplain(plan),
      results: Math.min(firstPage.length, limit),
      medianMs: percentile(times, 50),
      p95Ms: percentile(times, 95),
    };
    const token = firstPage[limit - 1]?.['paginationToken'] as
      string | undefined;
    if (shape.secondPage && token !== undefined && firstPage.length > limit) {
      const page2 = buildSearchPipeline(shape.criteria, {
        tenantId,
        indexName,
        limit,
        searchAfter: token,
      });
      row.page2MedianMs = percentile(
        await timeRuns(collection, page2, runs),
        50,
      );
    }
    rows.push(row);
  }
  return rows;
}

export function toMarkdown(rows: readonly ExplainRow[]): string {
  const header =
    '| Shape | Collected | Returned | Lucene query ms | Collect ms | Materialize ms | Median ms | p95 ms | Page 2 median ms |\n' +
    '| --- | --: | --: | --: | --: | --: | --: | --: | --: |';
  const lines = rows.map(
    (r) =>
      `| ${r.shape} | ${r.collected} | ${r.results} | ${r.queryMs} | ${r.collectMs} | ${r.materializeMs} | ${r.medianMs} | ${r.p95Ms} | ${r.page2MedianMs ?? '—'} |`,
  );
  return [header, ...lines].join('\n');
}

/** The city and cuisine with the fewest restaurants: the sparse shapes. */
async function rarest(
  collection: Collection<Document>,
  tenantId: string,
): Promise<{ city: string; cuisine: string }> {
  const [result] = await collection
    .aggregate<{ city: { _id: string }[]; cuisine: { _id: string }[] }>([
      { $match: { tenantId } },
      {
        $facet: {
          city: [
            { $group: { _id: '$norm.city', n: { $sum: 1 } } },
            { $sort: { n: 1, _id: 1 } },
            { $limit: 1 },
          ],
          cuisine: [
            { $unwind: '$norm.cuisines' },
            { $group: { _id: '$norm.cuisines', n: { $sum: 1 } } },
            { $sort: { n: 1, _id: 1 } },
            { $limit: 1 },
          ],
        },
      },
    ])
    .toArray();
  return {
    city: result?.city[0]?._id ?? 'gurgaon',
    cuisine: result?.cuisine[0]?._id ?? 'cafe',
  };
}

/** The brief's queries as the search endpoint interprets them. */
function interpreted(
  q: string,
  vocabulary: SearchVocabulary,
  origin?: typeof ANCHOR,
): SearchCriteria {
  const query = searchRestaurantsQuerySchema.parse({
    q,
    ...(origin && { lat: String(origin.lat), lng: String(origin.lng) }),
  });
  const interpretation = new RuleBasedQueryInterpreter({
    bestMinVotes: 20,
  }).interpret(q, {
    hasCoords: origin !== undefined,
    vocabulary,
  });
  return toSearchRequestCriteria(interpretation, query, vocabulary).criteria;
}

export async function defaultShapes(
  collection: Collection<Document>,
  tenantId: string,
  vocabulary: SearchVocabulary,
): Promise<ExplainShape[]> {
  const sparse = await rarest(collection, tenantId);
  const any = { cuisineMatch: 'any' as const };
  return [
    { name: 'no filters (default rating)', criteria: { ...any } },
    {
      name: 'dense city: new delhi',
      criteria: { ...any, city: 'new delhi' },
      secondPage: true,
    },
    {
      name: 'gurgaon + north indian + minRating 4, sort=rating',
      criteria: {
        ...any,
        city: 'gurgaon',
        cuisines: ['north indian'],
        minRating: 4,
        sort: 'rating',
      },
    },
    {
      name: `sparse city: ${sparse.city}`,
      criteria: { ...any, city: sparse.city },
    },
    {
      name: 'common cuisine: north indian, sort=cost asc',
      criteria: {
        ...any,
        cuisines: ['north indian'],
        sort: 'cost',
        currency: 'INR',
      },
    },
    {
      name: 'common cuisine: north indian, sort=cost desc',
      criteria: {
        ...any,
        cuisines: ['north indian'],
        sort: 'cost',
        order: 'desc',
        currency: 'INR',
      },
    },
    {
      name: `rare cuisine: ${sparse.cuisine}`,
      criteria: { ...any, cuisines: [sparse.cuisine] },
    },
    {
      name: 'near me 5 km, distance',
      criteria: { ...any, origin: ANCHOR },
      secondPage: true,
    },
    {
      name: 'near me 5 km, sort=rating',
      criteria: { ...any, origin: ANCHOR, sort: 'rating' },
    },
    {
      name: 'near me 5 km, sort=cost',
      criteria: { ...any, origin: ANCHOR, sort: 'cost', currency: 'INR' },
    },
    {
      name: 'gurgaon + delhi coordinates, distance',
      criteria: { ...any, city: 'gurgaon', origin: DELHI },
    },
    { name: 'name=pizza (relevance)', criteria: { ...any, name: 'pizza' } },
    {
      name: 'text "goli vada pao" (typo)',
      criteria: { ...any, text: 'goli vada pao' },
    },
    {
      name: 'brief 1: best south indian in gurgaon',
      criteria: interpreted(
        'Best restaurants in Gurgaon with South Indian Food',
        vocabulary,
      ),
    },
    {
      name: 'brief 2: gurgaon under rs 1000',
      criteria: interpreted(
        'Restaurants in Gurgaon under Rs. 1000 for two',
        vocabulary,
      ),
    },
    {
      name: 'brief 3: nearest vada pav (cyber city)',
      criteria: interpreted(
        'Nearest place that serves Vada Pav',
        vocabulary,
        ANCHOR,
      ),
    },
  ];
}

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createMongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection(RESTAURANTS_COLLECTION);
    const restaurants = db.collection<RestaurantDocument>(
      RESTAURANTS_COLLECTION,
    );
    const vocabulary = await new MongoRestaurantRepository(restaurants, {
      tenantId: env.TENANT_ID,
      maxTimeMS: env.QUERY_MAX_TIME_MS,
      searchIndexName: env.SEARCH_INDEX_NAME,
    }).vocabulary();
    const shapes = await defaultShapes(collection, env.TENANT_ID, vocabulary);
    const rows = await runExplain(collection, shapes, {
      tenantId: env.TENANT_ID,
      indexName: env.SEARCH_INDEX_NAME,
      runs: 20,
    });
    console.info(toMarkdown(rows));

    const indexStats = await collection
      .aggregate([{ $indexStats: {} }])
      .toArray();
    console.info(
      '\nB-tree index use since start:',
      indexStats
        .map((s) => `${String(s['name'])}=${String(s['accesses']?.ops)}`)
        .join(', '),
    );
    const [searchIndex] = (await collection
      .listSearchIndexes(env.SEARCH_INDEX_NAME)
      .toArray()) as Document[];
    console.info(
      `Search index ${env.SEARCH_INDEX_NAME}: ${String(searchIndex?.['status'])}, queryable=${String(searchIndex?.['queryable'])}`,
    );
  } catch (error) {
    console.error('[explain] failed', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

// Run only as a CLI, so tests can import the functions without side effects.
if (require.main === module) {
  void main();
}

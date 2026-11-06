import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Db, MongoBulkWriteError } from 'mongodb';
import { RESTAURANTS_COLLECTION, createMongoClient } from '../config/database';
import { loadEnv } from '../config/env';
import {
  applyValidator,
  ensureIndexes,
  ensureSearchIndex,
  waitForSearchIndex,
} from '../db/restaurant-collection.setup';
import { RESTAURANT_SEARCH_INDEX_DEFINITION } from '../db/restaurant.search-index';
import { mapCsvRows } from '../mappers/restaurant-csv.mapper';
import type { RestaurantDocument } from '../models/restaurant.model';
import type { SeedSummary } from '../models/seed.model';
import { MongoRestaurantRepository } from '../repositories/restaurant.repository';
import { decodeUtf8Strict, parseCsvRecords } from '../utils/csv';

export interface SeedOptions {
  tenantId: string;
  /** Repository read limit; the seed itself only writes. */
  maxTimeMS: number;
  indexName: string;
  csvPath: string;
  log: (message: string) => void;
}

function countByReason(reasons: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

/**
 * Idempotent seed in ADR order: validator, unique index, CSV upsert, search
 * index, wait until queryable. Safe to run again: it inserts nothing new.
 */
export async function runSeed(
  db: Db,
  { tenantId, maxTimeMS, indexName, csvPath, log }: SeedOptions,
): Promise<SeedSummary> {
  const startedAt = Date.now();

  await applyValidator(db, RESTAURANTS_COLLECTION);
  const collection = db.collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
  await ensureIndexes(collection);
  log('validator and unique index applied');

  const rows = parseCsvRecords(decodeUtf8Strict(await readFile(csvPath)));
  const { restaurants, skips } = mapCsvRows(rows);
  log(
    `${rows.length} rows read, ${restaurants.length} mapped, ${skips.length} skipped`,
  );

  const repository = new MongoRestaurantRepository(collection, {
    tenantId,
    maxTimeMS,
    searchIndexName: indexName,
  });
  const { inserted, updated } = await repository.upsertManyBySourceId(
    restaurants,
    new Date(),
  );
  log(`${inserted} inserted, ${updated} updated`);

  const searchIndex = await ensureSearchIndex(
    collection,
    indexName,
    RESTAURANT_SEARCH_INDEX_DEFINITION,
  );
  await waitForSearchIndex(collection, indexName);
  log(`search index "${indexName}" ${searchIndex} and queryable`);

  return {
    rows: rows.length,
    mapped: restaurants.length,
    skipped: skips.length,
    skippedByReason: countByReason(skips.map((s) => s.reason)),
    inserted,
    updated,
    searchIndex,
    durationMs: Date.now() - startedAt,
  };
}

/** Validator rejections carry errInfo, which names the failing rule (ADR-004). */
export function describeSeedError(error: unknown): string {
  if (error instanceof MongoBulkWriteError) {
    const writeErrors = Array.isArray(error.writeErrors)
      ? error.writeErrors
      : [error.writeErrors];
    const first = writeErrors.slice(0, 5).map((writeError) =>
      JSON.stringify({
        index: writeError.index,
        code: writeError.code,
        message: writeError.errmsg,
        errInfo: writeError.errInfo,
      }),
    );
    return `${writeErrors.length} write errors; first ${first.length}:\n${first.join('\n')}`;
  }
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createMongoClient(env.MONGODB_URI);
  try {
    await client.connect();
    const summary = await runSeed(client.db(), {
      tenantId: env.TENANT_ID,
      maxTimeMS: env.QUERY_MAX_TIME_MS,
      indexName: env.SEARCH_INDEX_NAME,
      csvPath: resolve(env.SEED_CSV_PATH),
      log: (message) => console.info(`[seed] ${message}`),
    });
    console.info(`[seed] done ${JSON.stringify(summary)}`);
  } catch (error) {
    console.error(`[seed] failed: ${describeSeedError(error)}`);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

// Run only as a CLI, so tests can import runSeed without side effects.
if (require.main === module) {
  void main();
}

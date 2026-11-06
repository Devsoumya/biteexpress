import type { Server } from 'node:http';
import { createApp } from './app';
import { RESTAURANTS_COLLECTION, createMongoClient } from './config/database';
import { loadEnv } from './config/env';
import { createLogger } from './utils/logger';
import type { RestaurantDocument } from './models/restaurant.model';
import { MongoHealthRepository } from './repositories/health.repository';
import { MongoRestaurantRepository } from './repositories/restaurant.repository';
import { RuleBasedQueryInterpreter } from './services/query-interpreter.service';
import { CachedReadinessService } from './services/readiness.service';
import { DefaultRestaurantService } from './services/restaurant.service';
import { CachedVocabularyService } from './services/vocabulary.service';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function start(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });
  const client = createMongoClient(env.MONGODB_URI);

  try {
    await client.connect();
    const healthRepository = new MongoHealthRepository(
      client.db(),
      RESTAURANTS_COLLECTION,
      env.SEARCH_INDEX_NAME,
    );
    await healthRepository.ping();

    const restaurantRepository = new MongoRestaurantRepository(
      client.db().collection<RestaurantDocument>(RESTAURANTS_COLLECTION),
      {
        tenantId: env.TENANT_ID,
        maxTimeMS: env.QUERY_MAX_TIME_MS,
        searchIndexName: env.SEARCH_INDEX_NAME,
      },
    );

    // Loaded before listening, so search never runs without its vocabulary;
    // a failure here fails startup loudly (ADR-002 Pass 4).
    const vocabulary = new CachedVocabularyService(restaurantRepository, {
      refreshMs: env.VOCABULARY_REFRESH_MS,
      onError: (error) =>
        logger.error({ err: error }, 'vocabulary refresh failed'),
    });
    await vocabulary.load();
    vocabulary.start();

    const app = createApp({
      readinessService: new CachedReadinessService(healthRepository, {
        vocabulary,
      }),
      logger,
      slowRequestMs: env.SLOW_REQUEST_MS,
      restaurantService: new DefaultRestaurantService(restaurantRepository, {
        vocabulary,
        interpreter: new RuleBasedQueryInterpreter({
          bestMinVotes: env.BEST_MIN_VOTES,
        }),
      }),
    });

    const server = app.listen(env.PORT);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    logger.info({ port: env.PORT }, 'API listening');

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'shutting down');
      vocabulary.stop();
      try {
        await closeServer(server);
      } catch (error) {
        logger.error({ err: error }, 'HTTP shutdown failed');
        process.exitCode = 1;
      }
      try {
        await client.close();
      } catch (error) {
        logger.error({ err: error }, 'MongoDB shutdown failed');
        process.exitCode = 1;
      }
      logger.flush();
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    await client.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  // The configured logger may not exist (an invalid environment fails first),
  // so startup failures get a default one.
  createLogger({ level: 'info' }).fatal({ err: error }, 'startup failed');
  process.exitCode = 1;
});

import type { Server } from 'node:http';
import type { Express } from 'express';
import type { MongoClient } from 'mongodb';
import { createApp } from './app';
import { RESTAURANTS_COLLECTION, createMongoClient } from './config/database';
import { type Env, loadEnv } from './config/env';
import { type Logger, createLogger } from './utils/logger';
import type { RestaurantDocument } from './models/restaurant.model';
import { MongoHealthRepository } from './repositories/health.repository';
import { MongoRestaurantRepository } from './repositories/restaurant.repository';
import { RuleBasedQueryInterpreter } from './services/query-interpreter.service';
import { CachedReadinessService } from './services/readiness.service';
import { DefaultRestaurantService } from './services/restaurant.service';
import { CachedVocabularyService } from './services/vocabulary.service';

/**
 * The composition root: the only place that builds real implementations and
 * connects them (env → logger → Mongo client → repositories → vocabulary →
 * services → app). Everything below receives its dependencies, so tests can
 * substitute any of them.
 */
async function start(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL });
  const client = createMongoClient(env.MONGODB_URI);

  try {
    await client.connect();
    const { app, vocabulary } = await wireApp(env, logger, client);
    const server = await listen(app, env.PORT);
    logger.info({ port: env.PORT }, 'API listening');
    registerShutdown({ server, client, vocabulary, logger });
  } catch (error) {
    await client.close();
    throw error;
  }
}

/** Builds repositories, services and the app on a connected client. */
async function wireApp(
  env: Env,
  logger: Logger,
  client: MongoClient,
): Promise<{ app: Express; vocabulary: CachedVocabularyService }> {
  const healthRepository = new MongoHealthRepository(
    client.db(),
    RESTAURANTS_COLLECTION,
    env.SEARCH_INDEX_NAME,
  );
  // Fail startup on bad credentials or an unreachable server, rather than
  // listening and answering every request with 503.
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
  return { app, vocabulary };
}

/** Resolves once the port is bound; rejects if it cannot be (EADDRINUSE). */
async function listen(app: Express, port: number): Promise<Server> {
  const server = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

/**
 * SIGTERM/SIGINT: stop the refresh timer, finish in-flight requests, then
 * close MongoDB. Each step runs even if the previous one failed, and any
 * failure sets a non-zero exit code. Runs once, however many signals arrive.
 */
function registerShutdown({
  server,
  client,
  vocabulary,
  logger,
}: {
  server: Server;
  client: MongoClient;
  vocabulary: CachedVocabularyService;
  logger: Logger;
}): void {
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
}

/** server.close() as a promise: resolves when open connections have ended. */
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

void start().catch((error: unknown) => {
  // The configured logger may not exist (an invalid environment fails first),
  // so startup failures get a default one.
  createLogger({ level: 'info' }).fatal({ err: error }, 'startup failed');
  process.exitCode = 1;
});

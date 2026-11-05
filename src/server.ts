import type { Server } from 'node:http';
import { createApp } from './app';
import { RESTAURANTS_COLLECTION, createMongoClient } from './config/database';
import { loadEnv } from './config/env';
import { MongoHealthRepository } from './repositories/health.repository';
import { CachedReadinessService } from './services/readiness.service';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function start(): Promise<void> {
  const env = loadEnv();
  const client = createMongoClient(env.MONGODB_URI);

  try {
    await client.connect();
    const healthRepository = new MongoHealthRepository(
      client.db(),
      RESTAURANTS_COLLECTION,
      env.SEARCH_INDEX_NAME,
    );
    await healthRepository.ping();

    const app = createApp({
      readinessService: new CachedReadinessService(healthRepository),
    });

    const server = app.listen(env.PORT);
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    console.info(`API listening on port ${env.PORT}`);

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.info(`Received ${signal}; shutting down`);
      try {
        await closeServer(server);
      } catch (error) {
        console.error('HTTP shutdown failed', error);
        process.exitCode = 1;
      }
      try {
        await client.close();
      } catch (error) {
        console.error('MongoDB shutdown failed', error);
        process.exitCode = 1;
      }
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    await client.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  console.error('Startup failed', error);
  process.exitCode = 1;
});

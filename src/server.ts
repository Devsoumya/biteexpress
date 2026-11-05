import type { Server } from 'node:http';
import { app } from './app';
import {
  closeDatabase,
  connectToDatabase,
  pingDatabase,
} from './config/database';
import { loadEnv } from './config/env';

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function start(): Promise<void> {
  const env = loadEnv();
  await connectToDatabase(env.MONGODB_URI);

  try {
    await pingDatabase();
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
        await closeDatabase();
      } catch (error) {
        console.error('MongoDB shutdown failed', error);
        process.exitCode = 1;
      }
    };

    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    await closeDatabase();
    throw error;
  }
}

void start().catch((error: unknown) => {
  console.error('Startup failed', error);
  process.exitCode = 1;
});

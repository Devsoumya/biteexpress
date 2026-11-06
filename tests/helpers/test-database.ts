import { MongoClient } from 'mongodb';

// Tests only ever touch this database, by name. Setup and teardown drop it,
// so it must never be the application's database.
export const TEST_DB_NAME = 'biteexpress_test';

/** Same name the API uses by default (SEARCH_INDEX_NAME). */
export const TEST_SEARCH_INDEX_NAME = 'restaurants_search';

// The one place tests read the environment (AGENTS.md §6).
export function testMongoUri(): string {
  const uri = process.env['TEST_MONGODB_URI'];
  if (!uri) {
    throw new Error(
      'TEST_MONGODB_URI is not set; start "docker compose up -d mongo" and export it (see .env.example)',
    );
  }
  return uri;
}

// Constructing a MongoClient only parses the URI; nothing connects until
// connect(). The database check therefore runs before any network I/O.
export async function connectTestClient(): Promise<MongoClient> {
  const client = new MongoClient(testMongoUri(), {
    appName: 'biteexpress-tests',
    serverSelectionTimeoutMS: 5000,
  });
  if (client.options.dbName !== TEST_DB_NAME) {
    throw new Error(
      `TEST_MONGODB_URI must name the database "${TEST_DB_NAME}", got "${client.options.dbName}"`,
    );
  }

  try {
    await client.connect();
    await client.db(TEST_DB_NAME).command({ ping: 1 });
  } catch (error) {
    await client.close();
    throw new Error(
      'MongoDB is not reachable at TEST_MONGODB_URI; run "docker compose up -d mongo"',
      { cause: error },
    );
  }
  return client;
}

/**
 * Deletes every document in the test database but keeps collections,
 * validators and indexes. Dropping is avoided on purpose: on atlas-local, a
 * search index recreated right after its database was dropped can be lost
 * (created, then never listed), which made the next run's setup time out.
 */
export async function clearTestDatabase(client: MongoClient): Promise<void> {
  const db = client.db(TEST_DB_NAME);
  for (const { name } of await db.listCollections().toArray()) {
    await db.collection(name).deleteMany({});
  }
}

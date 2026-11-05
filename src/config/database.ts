import { type Db, MongoClient } from 'mongodb';

export const RESTAURANTS_COLLECTION = 'restaurants';

// One client per process; server.ts owns its lifecycle (connect and close).
export function createMongoClient(uri: string): MongoClient {
  return new MongoClient(uri, {
    appName: 'biteexpress-api',
    serverSelectionTimeoutMS: 5000,
  });
}

export async function pingDatabase(db: Db): Promise<void> {
  await db.command({ ping: 1 });
}

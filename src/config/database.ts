import { Db, MongoClient } from 'mongodb';

let client: MongoClient | undefined;

export async function connectToDatabase(uri: string): Promise<void> {
  if (client) return;

  const candidate = new MongoClient(uri);
  try {
    await candidate.connect();
    client = candidate;
  } catch (error) {
    await candidate.close();
    throw error;
  }
}

export function getDatabase(): Db {
  if (!client) throw new Error('MongoDB is not connected');
  return client.db();
}

export async function pingDatabase(): Promise<void> {
  await getDatabase().admin().ping();
}

export async function closeDatabase(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.close();
}

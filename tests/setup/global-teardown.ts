import { clearTestDatabase, connectTestClient } from '../helpers/test-database';

// Leaves no test documents behind; keeps the schema and indexes (see
// clearTestDatabase for why the database is not dropped).
export default async function globalTeardown(): Promise<void> {
  const client = await connectTestClient();
  try {
    await clearTestDatabase(client);
  } finally {
    await client.close();
  }
}

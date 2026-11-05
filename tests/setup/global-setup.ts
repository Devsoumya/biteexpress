import { connectTestClient, dropTestDatabase } from '../helpers/test-database';

// Fails the whole integration run early, with a clear message, when the test
// database is misconfigured or unreachable. Starts every run from empty.
export default async function globalSetup(): Promise<void> {
  const client = await connectTestClient();
  try {
    await dropTestDatabase(client);
  } finally {
    await client.close();
  }
}

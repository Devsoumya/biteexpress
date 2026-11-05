import { connectTestClient, dropTestDatabase } from '../helpers/test-database';

export default async function globalTeardown(): Promise<void> {
  const client = await connectTestClient();
  try {
    await dropTestDatabase(client);
  } finally {
    await client.close();
  }
}

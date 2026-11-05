import type { MongoClient } from 'mongodb';
import { pingDatabase } from '../../src/config/database';
import { TEST_DB_NAME, connectTestClient } from '../helpers/test-database';

describe('test database connection', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await connectTestClient();
  });

  afterAll(() => client.close());

  it('pings through TEST_MONGODB_URI with directConnection=true', async () => {
    await expect(pingDatabase(client.db(TEST_DB_NAME))).resolves.toBe(
      undefined,
    );
  });

  it('uses the biteexpress_test database', () => {
    expect(client.options.dbName).toBe('biteexpress_test');
    expect(client.db(TEST_DB_NAME).databaseName).toBe('biteexpress_test');
  });

  it('talks to a replica set (Atlas Local), not a standalone mongod', async () => {
    const hello = await client.db(TEST_DB_NAME).command({ hello: 1 });

    expect(typeof hello['setName']).toBe('string');
  });
});

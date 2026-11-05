import type { MongoClient } from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import { MongoHealthRepository } from '../../../src/repositories/health.repository';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

describe('MongoHealthRepository against Atlas Local', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await connectTestClient();
  });

  afterAll(() => client.close());

  function repositoryFor(indexName: string) {
    return new MongoHealthRepository(
      client.db(TEST_DB_NAME),
      RESTAURANTS_COLLECTION,
      indexName,
    );
  }

  it('pings the database', async () => {
    await expect(
      repositoryFor('restaurants_search').ping(),
    ).resolves.toBeUndefined();
  });

  // Step 1 has no seed: the collection does not exist, and listSearchIndexes
  // returns an empty cursor rather than an error.
  it('reports a missing index when the collection does not exist', async () => {
    await expect(
      repositoryFor('restaurants_search').searchIndexState(),
    ).resolves.toBe('missing');
  });
});

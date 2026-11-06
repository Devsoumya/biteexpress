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

  it('reports ok for the queryable index the global setup built', async () => {
    await expect(
      repositoryFor('restaurants_search').searchIndexState(),
    ).resolves.toBe('ok');
  });

  // listSearchIndexes on a collection that does not exist returns an empty
  // cursor rather than an error.
  it('reports a missing index when the collection does not exist', async () => {
    const repository = new MongoHealthRepository(
      client.db(TEST_DB_NAME),
      'no_such_collection',
      'restaurants_search',
    );

    await expect(repository.searchIndexState()).resolves.toBe('missing');
  });
});

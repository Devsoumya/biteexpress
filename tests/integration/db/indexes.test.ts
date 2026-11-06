import type { Collection, Document, MongoClient } from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import {
  UNIQUE_SOURCE_INDEX,
  applyValidator,
  definitionCovers,
  ensureIndexes,
  ensureSearchIndex,
} from '../../../src/db/restaurant-collection.setup';
import { RESTAURANT_SEARCH_INDEX_DEFINITION } from '../../../src/db/restaurant.search-index';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  connectTestClient,
} from '../../helpers/test-database';

// Index-regression tests (ADR-005): an unexpected, missing or changed index
// fails here. The global setup built everything with the seed's functions.
describe('restaurants indexes', () => {
  let client: MongoClient;
  let collection: Collection;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client.db(TEST_DB_NAME).collection(RESTAURANTS_COLLECTION);
  });

  afterAll(() => client.close());

  it('has exactly _id_ and uq_tenant_source', async () => {
    const indexes = await collection.indexes();

    expect(indexes.map((index) => index.name).sort()).toEqual([
      '_id_',
      UNIQUE_SOURCE_INDEX,
    ]);
    expect(indexes.find((i) => i.name === UNIQUE_SOURCE_INDEX)).toMatchObject({
      key: { tenantId: 1, sourceId: 1 },
      unique: true,
      partialFilterExpression: { sourceId: { $exists: true } },
    });
  });

  it('stores the search index definition from the code, ready and queryable', async () => {
    // The driver types listings as { name }; the server returns more fields.
    const [index]: Document[] = await collection
      .listSearchIndexes(TEST_SEARCH_INDEX_NAME)
      .toArray();

    expect(index).toMatchObject({ status: 'READY', queryable: true });
    expect(
      definitionCovers(
        index?.['latestDefinition'],
        RESTAURANT_SEARCH_INDEX_DEFINITION,
      ),
    ).toBe(true);
  });

  it('has the validator in strict error mode', async () => {
    const [info] = await client
      .db(TEST_DB_NAME)
      .listCollections({ name: RESTAURANTS_COLLECTION })
      .toArray();

    expect(info).toMatchObject({
      options: { validationLevel: 'strict', validationAction: 'error' },
    });
  });

  it('can run every setup step again without changes', async () => {
    await applyValidator(client.db(TEST_DB_NAME), RESTAURANTS_COLLECTION);
    await ensureIndexes(collection);

    await expect(
      ensureSearchIndex(
        collection,
        TEST_SEARCH_INDEX_NAME,
        RESTAURANT_SEARCH_INDEX_DEFINITION,
      ),
    ).resolves.toBe('unchanged');
    expect(await collection.indexes()).toHaveLength(2);
  });
});

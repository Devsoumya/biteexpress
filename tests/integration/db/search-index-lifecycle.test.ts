import type { Collection, MongoClient } from 'mongodb';
import {
  ensureSearchIndex,
  waitForSearchIndex,
} from '../../../src/db/restaurant-collection.setup';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

// A scratch collection and a unique index name per run: recreating a search
// index under a name that was just dropped is unreliable on atlas-local.
describe('search index lifecycle', () => {
  const indexName = `lifecycle_${Date.now()}`;
  let client: MongoClient;
  let scratch: Collection;

  beforeAll(async () => {
    client = await connectTestClient();
    scratch = client.db(TEST_DB_NAME).collection('search_index_lifecycle');
    await scratch.insertOne({ name: 'probe' });
  });

  afterAll(async () => {
    await scratch.dropSearchIndex(indexName).catch(() => undefined);
    await client.close();
  });

  const first = {
    mappings: { dynamic: false, fields: { name: { type: 'string' } } },
  };
  const second = {
    mappings: {
      dynamic: false,
      fields: { name: { type: 'string' }, tenantId: { type: 'token' } },
    },
  };

  it('creates, then updates a changed definition, then leaves it unchanged', async () => {
    await expect(ensureSearchIndex(scratch, indexName, first)).resolves.toBe(
      'created',
    );
    await waitForSearchIndex(scratch, indexName);

    await expect(ensureSearchIndex(scratch, indexName, second)).resolves.toBe(
      'updated',
    );
    await waitForSearchIndex(scratch, indexName);

    await expect(ensureSearchIndex(scratch, indexName, second)).resolves.toBe(
      'unchanged',
    );
  });

  it('times out with the last status when an index never becomes queryable', async () => {
    await expect(
      waitForSearchIndex(scratch, 'never_created', {
        timeoutMs: 300,
        intervalMs: 50,
      }),
    ).rejects.toThrow(
      'Search index "never_created" not queryable after 300 ms (last: not listed)',
    );
  });
});

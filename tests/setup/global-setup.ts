import { RESTAURANTS_COLLECTION } from '../../src/config/database';
import {
  applyValidator,
  ensureIndexes,
  ensureSearchIndex,
  waitForSearchIndex,
} from '../../src/db/restaurant-collection.setup';
import { RESTAURANT_SEARCH_INDEX_DEFINITION } from '../../src/db/restaurant.search-index';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  clearTestDatabase,
  connectTestClient,
} from '../helpers/test-database';
import {
  ALL_FIXTURES,
  FIXTURES,
  FIXTURE_TENANT,
} from '../fixtures/restaurants.fixture';
import {
  SEARCH_FIXTURES,
  SEARCH_FIXTURE_TENANT,
} from '../fixtures/search.fixture';
import { searchCount, waitForSearch } from '../helpers/wait-for-search';

// Fails the whole integration run early, with a clear message, when the test
// database is misconfigured or unreachable. Builds the schema and indexes with
// the seed's own (idempotent) functions, then starts every run with only
// the fixture set (tests/fixtures). The collection and search index persist between runs, so an
// unchanged definition is not rebuilt.
export default async function globalSetup(): Promise<void> {
  const client = await connectTestClient();
  try {
    const db = client.db(TEST_DB_NAME);
    await applyValidator(db, RESTAURANTS_COLLECTION);
    const collection = db.collection(RESTAURANTS_COLLECTION);
    await ensureIndexes(collection);
    await clearTestDatabase(client);
    await ensureSearchIndex(
      collection,
      TEST_SEARCH_INDEX_NAME,
      RESTAURANT_SEARCH_INDEX_DEFINITION,
    );
    await waitForSearchIndex(collection, TEST_SEARCH_INDEX_NAME);

    // The fixture set (ADR-005), inserted through the validator, then waited
    // for until the search index sees all of it.
    await collection.insertMany([...ALL_FIXTURES, ...SEARCH_FIXTURES]);
    await waitForSearch(
      async () =>
        (await searchCount(collection, FIXTURE_TENANT)) === FIXTURES.length &&
        (await searchCount(collection, SEARCH_FIXTURE_TENANT)) ===
          SEARCH_FIXTURES.length,
      { timeoutMs: 15000, what: 'fixture indexing' },
    );
  } finally {
    await client.close();
  }
}

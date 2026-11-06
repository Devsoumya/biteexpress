import type { Collection, Document, MongoClient } from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { defaultShapes, runExplain } from '../../../src/scripts/explain';
import { ANCHOR, FIXTURE_TENANT } from '../../fixtures/restaurants.fixture';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  connectTestClient,
} from '../../helpers/test-database';

describe('runExplain against Atlas Local (fixtures)', () => {
  let client: MongoClient;
  let collection: Collection<Document>;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client.db(TEST_DB_NAME).collection(RESTAURANTS_COLLECTION);
  });
  afterAll(() => client.close());

  it('explains and times each shape with the production builder, including page 2', async () => {
    const rows = await runExplain(
      collection,
      [
        {
          name: 'gurgaon',
          criteria: { cuisineMatch: 'any', city: 'gurgaon' },
          limit: 3,
          secondPage: true,
        },
        { name: 'near me', criteria: { cuisineMatch: 'any', origin: ANCHOR } },
      ],
      { tenantId: FIXTURE_TENANT, indexName: TEST_SEARCH_INDEX_NAME, runs: 2 },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        shape: 'gurgaon',
        results: 3,
        collected: expect.any(Number),
      }),
      expect.objectContaining({ shape: 'near me', results: 8 }),
    ]);
    expect(rows[0]?.collected).toBeGreaterThan(0);
    expect(rows[0]?.page2MedianMs).toBeGreaterThanOrEqual(0);
    expect(rows[1]).not.toHaveProperty('page2MedianMs');
    for (const row of rows)
      expect(row.p95Ms).toBeGreaterThanOrEqual(row.medianMs);
  });

  it('builds and runs every default shape (sparse picks, interpreted brief queries)', async () => {
    const vocabulary = await new MongoRestaurantRepository(
      collection as never,
      {
        tenantId: FIXTURE_TENANT,
        maxTimeMS: 2000,
        searchIndexName: TEST_SEARCH_INDEX_NAME,
      },
    ).vocabulary();
    const shapes = await defaultShapes(collection, FIXTURE_TENANT, vocabulary);

    expect(shapes.map((shape) => shape.name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^sparse city: /),
        expect.stringMatching(/^rare cuisine: /),
        'brief 1: best south indian in gurgaon',
      ]),
    );
    const rows = await runExplain(collection, shapes, {
      tenantId: FIXTURE_TENANT,
      indexName: TEST_SEARCH_INDEX_NAME,
      runs: 1,
    });
    expect(rows).toHaveLength(shapes.length);
  });
});

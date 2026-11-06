import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { createTestApp } from '../../helpers/app';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import { MongoHealthRepository } from '../../../src/repositories/health.repository';
import { CachedReadinessService } from '../../../src/services/readiness.service';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

describe('GET /ready against Atlas Local', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await connectTestClient();
  });

  afterAll(() => client.close());

  function appForIndex(indexName: string) {
    const repository = new MongoHealthRepository(
      client.db(TEST_DB_NAME),
      RESTAURANTS_COLLECTION,
      indexName,
    );
    return createTestApp({
      readinessService: new CachedReadinessService(repository),
    });
  }

  it('returns 200 once the search index is queryable', async () => {
    const response = await request(appForIndex('restaurants_search')).get(
      '/ready',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: { mongo: 'ok', searchIndex: 'ok' },
    });
  });

  // A missing index makes $search return empty results, hence the 503.
  it('returns 503 with searchIndex: missing for an index that does not exist', async () => {
    const response = await request(appForIndex('does_not_exist')).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { mongo: 'ok', searchIndex: 'missing' },
    });
  });
});

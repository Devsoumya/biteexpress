import type { MongoClient } from 'mongodb';
import request from 'supertest';
import { createApp } from '../../../src/app';
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
    return createApp({
      readinessService: new CachedReadinessService(repository),
    });
  }

  // A missing index makes $search return empty results, hence the 503.
  it.each(['restaurants_search', 'does_not_exist'])(
    'returns 503 with searchIndex: missing when %s does not exist',
    async (indexName) => {
      const response = await request(appForIndex(indexName)).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        checks: { mongo: 'ok', searchIndex: 'missing' },
      });
    },
  );
});

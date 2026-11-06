import { captureLogger, requestLines } from '../../helpers/logger';
import { serviceDependencies } from '../../helpers/vocabulary';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { createTestApp } from '../../helpers/app';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';
import { minimalCreateBody } from '../../helpers/restaurant-fixtures';

// No database needed: the real repository against a port that refuses
// connections shows the whole path from driver error to 503.
describe('restaurant endpoints with MongoDB unreachable', () => {
  const client = new MongoClient(
    'mongodb://127.0.0.1:1/biteexpress?directConnection=true',
    { serverSelectionTimeoutMS: 200 },
  );
  const captured = captureLogger();
  const app = createTestApp({
    logger: captured.logger,
    restaurantService: new DefaultRestaurantService(
      new MongoRestaurantRepository(
        client.db().collection<RestaurantDocument>('restaurants'),
        {
          tenantId: 'biteexpress',
          maxTimeMS: 2000,
          searchIndexName: 'restaurants_search',
        },
      ),
      serviceDependencies(),
    ),
  });
  afterAll(() => client.close());

  it('GET by id returns 503 DATABASE_UNAVAILABLE with Retry-After', async () => {
    const response = await request(app).get(
      '/v1/restaurants/5f1d7c3e9b1e8a0012345678',
    );

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/{id}');
  });

  it('POST returns 503 DATABASE_UNAVAILABLE, and the driver error is logged', async () => {
    const response = await request(app)
      .post('/v1/restaurants')
      .send(minimalCreateBody());

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toMatch(
      /127\\.0\\.0\\.1|ECONNREFUSED/,
    );
    const line = (await requestLines(captured)).at(-1);
    expect(line).toMatchObject({
      level: 'error',
      errorCode: 'DATABASE_UNAVAILABLE',
      err: { type: expect.stringMatching(/^Mongo/) },
    });
    expectDocumentedResponse(response, 'POST', '/v1/restaurants');
  });
});

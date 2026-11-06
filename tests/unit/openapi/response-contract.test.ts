import { ObjectId } from 'mongodb';
import request from 'supertest';
import type {
  ReadinessResult,
  ReadinessService,
} from '../../../src/models/health.model';
import type {
  RestaurantDocument,
  RestaurantService,
} from '../../../src/models/restaurant.model';
import { ApplicationError } from '../../../src/utils/application-error';
import { createTestApp } from '../../helpers/app';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';
import {
  minimalCreateBody,
  seedRestaurant,
} from '../../helpers/restaurant-fixtures';

const NOW = new Date('2026-11-06T00:00:00Z');
const ID = '5f1d7c3e9b1e8a0012345678';

// One fully populated (seeded) and one minimal (API-created) document, so
// both the values and the nulls are checked against the documented schema.
const seeded: RestaurantDocument = {
  _id: new ObjectId(ID),
  tenantId: 'biteexpress',
  ...seedRestaurant(308322),
  createdAt: NOW,
  updatedAt: NOW,
};
const minimal: RestaurantDocument = {
  _id: new ObjectId(ID),
  tenantId: 'biteexpress',
  name: 'Corner Cafe',
  address: { line: '1 Main Street', city: 'Makati City' },
  country: { code: 'PH', name: 'Philippines' },
  cuisines: [],
  cost: { currency: 'PHP' },
  rating: { votes: 0 },
  norm: { city: 'makati city', cuisines: [] },
  createdAt: NOW,
  updatedAt: NOW,
  schemaVersion: 1,
};

function restaurantService(
  getById: RestaurantService['getById'],
): RestaurantService {
  return {
    create: () => Promise.resolve(minimal),
    getById,
    list: () => Promise.reject(new Error('not used')),
    search: () => Promise.reject(new Error('not used')),
  };
}

function readiness(result: ReadinessResult): ReadinessService {
  return { check: () => Promise.resolve(result) };
}

describe('responses match the OpenAPI document', () => {
  it('GET /health 200', async () => {
    const response = await request(createTestApp({})).get('/health');
    expectDocumentedResponse(response, 'GET', '/health');
  });

  it.each<ReadinessResult>([
    { ready: true, checks: { mongo: 'ok', searchIndex: 'ok' } },
    { ready: false, checks: { mongo: 'fail', searchIndex: 'skipped' } },
  ])('GET /ready %#', async (result) => {
    const app = createTestApp({ readinessService: readiness(result) });
    const response = await request(app).get('/ready');
    expectDocumentedResponse(response, 'GET', '/ready');
  });

  it('POST /v1/restaurants 201', async () => {
    const app = createTestApp({
      restaurantService: restaurantService(() => Promise.resolve(minimal)),
    });
    const response = await request(app)
      .post('/v1/restaurants')
      .send(minimalCreateBody());
    expect(response.status).toBe(201);
    expectDocumentedResponse(response, 'POST', '/v1/restaurants');
  });

  it('POST /v1/restaurants 400 with details', async () => {
    const response = await request(createTestApp({}))
      .post('/v1/restaurants')
      .send({ name: '', extra: true });
    expect(response.status).toBe(400);
    expectDocumentedResponse(response, 'POST', '/v1/restaurants');
  });

  it('POST /v1/restaurants 500', async () => {
    const app = createTestApp({
      restaurantService: {
        create: () => Promise.reject(new Error('boom')),
        getById: () => Promise.resolve(minimal),
        list: () => Promise.reject(new Error('not used')),
        search: () => Promise.reject(new Error('not used')),
      },
    });
    const response = await request(app)
      .post('/v1/restaurants')
      .send(minimalCreateBody());
    expect(response.status).toBe(500);
    expectDocumentedResponse(response, 'POST', '/v1/restaurants');
  });

  it.each([
    ['seeded', seeded],
    ['minimal', minimal],
  ])('GET /v1/restaurants/{id} 200 (%s)', async (_case, document) => {
    const app = createTestApp({
      restaurantService: restaurantService(() => Promise.resolve(document)),
    });
    const response = await request(app).get(`/v1/restaurants/${ID}`);
    expect(response.status).toBe(200);
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/{id}');
  });

  it('GET /v1/restaurants/{id} 400 and 404', async () => {
    const app = createTestApp({
      restaurantService: restaurantService(() =>
        Promise.reject(
          new ApplicationError('RESTAURANT_NOT_FOUND', 'Restaurant not found'),
        ),
      ),
    });
    const invalid = await request(app).get('/v1/restaurants/abc');
    const missing = await request(app).get(`/v1/restaurants/${ID}`);
    expect([invalid.status, missing.status]).toEqual([400, 404]);
    expectDocumentedResponse(invalid, 'GET', '/v1/restaurants/{id}');
    expectDocumentedResponse(missing, 'GET', '/v1/restaurants/{id}');
  });

  it.each([
    [
      'MALFORMED_JSON',
      () =>
        request(createTestApp({}))
          .post('/v1/restaurants')
          .set('Content-Type', 'application/json')
          .send('{'),
    ],
    [
      'UNSUPPORTED_MEDIA_TYPE',
      () =>
        request(createTestApp({}))
          .post('/v1/restaurants')
          .set('Content-Type', 'text/plain')
          .send('x'),
    ],
    [
      'PAYLOAD_TOO_LARGE',
      () =>
        request(createTestApp({}))
          .post('/v1/restaurants')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ name: 'x'.repeat(200_000) })),
    ],
  ])('POST /v1/restaurants %s', async (code, send) => {
    const response = await send();
    expect(response.body.error.code).toBe(code);
    expectDocumentedResponse(response, 'POST', '/v1/restaurants');
  });

  it('rejects a code the documentation does not list for that status', async () => {
    const response = await request(createTestApp({})).get(
      '/v1/restaurants/abc',
    );
    response.body = { error: { code: 'RESTAURANT_NOT_FOUND', message: 'x' } };
    expect(() =>
      expectDocumentedResponse(response, 'GET', '/v1/restaurants/{id}'),
    ).toThrow('does not list');
  });

  it('rejects an undocumented field (the check is strict)', async () => {
    const app = createTestApp({});
    const response = await request(app).get('/health');
    response.body = { ...response.body, extra: 1 };
    expect(() => expectDocumentedResponse(response, 'GET', '/health')).toThrow(
      'does not match HealthResponse',
    );
  });
});

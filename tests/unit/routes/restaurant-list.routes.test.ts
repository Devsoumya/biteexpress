import {
  captureLogger,
  requestLines,
  silentLogger,
} from '../../helpers/logger';
import { serviceDependencies } from '../../helpers/vocabulary';
import { MongoNetworkError, MongoServerError, ObjectId } from 'mongodb';
import request from 'supertest';
import type { SearchExecutor } from '../../../src/models/search.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { createTestApp } from '../../helpers/app';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';

// The real service and repository with a substituted search executor: the
// whole path from query string to pipeline to response, without a database.
function appWith(executor: SearchExecutor, logger = silentLogger()) {
  const repository = new MongoRestaurantRepository(
    {} as never, // the collection is not touched by search() when an executor is given
    {
      tenantId: 'biteexpress',
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    },
    executor,
  );
  return createTestApp({
    logger,
    restaurantService: new DefaultRestaurantService(
      repository,
      serviceDependencies(),
    ),
  });
}

function hit(id: string, extra: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(id),
    name: `Restaurant ${id.slice(-2)}`,
    address: { line: 'Sector 29', city: 'Gurgaon' },
    country: { code: 'IN', name: 'India' },
    cuisines: ['Cafe'],
    rating: { average: 4.1 },
    paginationToken: `token-${id.slice(-2)}`,
    ...extra,
  };
}

const IDS = [
  '5f1d7c3e9b1e8a0012345601',
  '5f1d7c3e9b1e8a0012345602',
  '5f1d7c3e9b1e8a0012345603',
];

describe('GET /v1/restaurants', () => {
  it('returns a page with nextCursor when more exist, and documents it', async () => {
    const aggregate = jest.fn().mockResolvedValue(IDS.map((id) => hit(id)));
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants?limit=2',
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(typeof response.body.nextCursor).toBe('string');
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
    // The executor got the builder's pipeline with the server time limit.
    expect(aggregate).toHaveBeenCalledWith(expect.any(Array), {
      maxTimeMS: 2000,
    });
  });

  it('returns distanceKm only for restaurants with a location, rounded', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValue([
        hit(IDS[0] ?? '', { distanceKm: 0.48321 }),
        hit(IDS[1] ?? '', { distanceKm: null }),
      ]);
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants?city=Gurgaon&lat=28.495&lng=77.089',
    );

    expect(response.body.data[0].distanceKm).toBe(0.48);
    expect(response.body.data[1]).not.toHaveProperty('distanceKm');
    expect(response.body.nextCursor).toBeNull();
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
  });

  it('returns 400 VALIDATION_ERROR with details and never searches', async () => {
    const aggregate = jest.fn();
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants?sort=distance&maxCost=500&limit=500',
    );

    expect(response.status).toBe(400);
    expect(
      response.body.error.details.map((d: { path: string }) => d.path).sort(),
    ).toEqual(['limit', 'sort']);
    expect(aggregate).not.toHaveBeenCalled();
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
  });

  // The currency rule needs the city vocabulary, so it is checked once the
  // fields are valid: a second 400, not part of the first one.
  it('returns 400 on currency for a cost filter without a resolvable currency', async () => {
    const aggregate = jest.fn();
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants?maxCost=500&lat=25.2&lng=55.27',
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      {
        path: 'currency',
        code: 'required',
        message:
          'Required with minCost, maxCost or sort=cost unless city is a known city',
      },
    ]);
    expect(aggregate).not.toHaveBeenCalled();
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
  });

  it('returns 400 CURSOR_INVALID for a cursor from another query', async () => {
    const aggregate = jest.fn().mockResolvedValue(IDS.map((id) => hit(id)));
    const app = appWith({ aggregate });
    const first = await request(app).get(
      '/v1/restaurants?city=Gurgaon&limit=2',
    );

    const response = await request(app).get(
      `/v1/restaurants?city=Mumbai&limit=2&cursor=${first.body.nextCursor}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CURSOR_INVALID');
    expect(aggregate).toHaveBeenCalledTimes(1);
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
  });

  describe('when Atlas Search fails', () => {
    it.each([
      [
        'unreachable',
        new MongoNetworkError('connection reset'),
        503,
        'SEARCH_UNAVAILABLE',
      ],
      [
        'too slow (code 50)',
        new MongoServerError({
          message: 'operation exceeded time limit',
          code: 50,
        }),
        503,
        'SEARCH_TIMEOUT',
      ],
      [
        'a bad query (our bug)',
        new MongoServerError({ message: 'unknown operator', code: 2 }),
        500,
        'INTERNAL_ERROR',
      ],
    ])('%s', async (_case, error, status, code) => {
      const captured = captureLogger();
      const response = await request(
        appWith({ aggregate: () => Promise.reject(error) }, captured.logger),
      ).get('/v1/restaurants');

      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
      expect(JSON.stringify(response.body)).not.toMatch(
        /connection reset|exceeded|unknown operator/,
      );
      if (status === 503) expect(response.headers['retry-after']).toBe('5');
      // The request's one line carries the code and the driver error.
      const [line] = await requestLines(captured);
      expect(line).toMatchObject({
        level: 'error',
        status,
        errorCode: code,
        err: { type: error.constructor.name },
      });
      expectDocumentedResponse(response, 'GET', '/v1/restaurants');
    });
  });
});

describe('GET /v1/restaurants/search', () => {
  it('returns the page with interpretation, and documents it', async () => {
    const aggregate = jest.fn().mockResolvedValue(IDS.map((id) => hit(id)));
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants/search?q=Best restaurants in Gurgaon with South Indian Food&limit=2',
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.interpretation).toMatchObject({
      city: 'gurgaon',
      cuisines: ['south indian'],
      sort: 'rating',
      minVotes: 20,
    });
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/search');
  });

  it('is not taken as a restaurant id', async () => {
    const aggregate = jest.fn().mockResolvedValue([]);
    const response = await request(appWith({ aggregate })).get(
      '/v1/restaurants/search?q=cafe',
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ['missing q', '', 'required'],
    // A blank value means "not given" (withoutBlankValues), so it is required.
    ['blank q', 'q=%20%20', 'required'],
    ['q over 200 characters', `q=${'a'.repeat(201)}`, 'too_large'],
  ])('returns 400 for %s', async (_case, query, code) => {
    const aggregate = jest.fn();
    const response = await request(appWith({ aggregate })).get(
      `/v1/restaurants/search?${query}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toMatchObject({ path: 'q', code });
    expect(aggregate).not.toHaveBeenCalled();
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/search');
  });

  it('explicit parameters are strict: sort=distance without coordinates is a 400', async () => {
    const response = await request(appWith({ aggregate: jest.fn() })).get(
      '/v1/restaurants/search?q=cafe&sort=distance',
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details[0]).toMatchObject({ path: 'sort' });
  });

  it('parsed words are lenient: "nearest" without coordinates is a 200 with a note', async () => {
    const response = await request(
      appWith({ aggregate: jest.fn().mockResolvedValue([]) }),
    ).get('/v1/restaurants/search?q=nearest vada pav');

    expect(response.status).toBe(200);
    expect(response.body.interpretation.notes).toContain(
      'nearest needs lat/lng; showing best matches',
    );
  });

  it('503 SEARCH_TIMEOUT with Retry-After when Atlas Search is too slow', async () => {
    const response = await request(
      appWith({
        aggregate: () =>
          Promise.reject(
            new MongoServerError({
              message: 'operation exceeded time limit',
              code: 50,
            }),
          ),
      }),
    ).get('/v1/restaurants/search?q=cafe');

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body.error.code).toBe('SEARCH_TIMEOUT');
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/search');
  });
});

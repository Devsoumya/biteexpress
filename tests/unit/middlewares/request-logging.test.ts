import { ObjectId } from 'mongodb';
import request from 'supertest';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import type { SearchExecutor } from '../../../src/models/search.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import {
  currentContext,
  recordDbTime,
  runWithContext,
  timed,
} from '../../../src/utils/request-context';
import { createTestApp } from '../../helpers/app';
import { captureLogger, requestLines } from '../../helpers/logger';
import { serviceDependencies } from '../../helpers/vocabulary';

const ID = '5f1d7c3e9b1e8a0012345678';

function listApp(aggregate: SearchExecutor['aggregate'], slowRequestMs = 500) {
  const captured = captureLogger();
  const repository = new MongoRestaurantRepository(
    {} as never, // search() uses the given executor, never the collection
    {
      tenantId: 'biteexpress',
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    },
    { aggregate },
  );
  const app = createTestApp({
    logger: captured.logger,
    slowRequestMs,
    restaurantService: new DefaultRestaurantService(
      repository,
      serviceDependencies(),
    ),
  });
  return { app, captured };
}

const oneHit = () =>
  Promise.resolve([
    {
      _id: new ObjectId(ID),
      name: 'Cafe',
      address: { line: 'x', city: 'Gurgaon' },
      country: { code: 'IN', name: 'India' },
      cuisines: ['Cafe'],
      rating: { average: 4 },
      paginationToken: 't',
      distanceKm: 1.2,
    },
  ]);

describe('X-Request-Id', () => {
  it('generates a UUID when none is sent, and echoes it', async () => {
    const response = await request(createTestApp({})).get('/health');

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('reuses a safe client id', async () => {
    const response = await request(createTestApp({}))
      .get('/health')
      .set('X-Request-Id', 'mobile-app.42_x');

    expect(response.headers['x-request-id']).toBe('mobile-app.42_x');
  });

  it.each([
    ['too long', 'a'.repeat(129)],
    ['spaces', 'two words'],
    ['a forged log line', 'x\n{"level":"info"}'],
    ['quotes', 'a"b'],
  ])('replaces an unsafe client id (%s)', async (_case, id) => {
    const response = await request(createTestApp({}))
      .get('/health')
      .set('X-Request-Id', id.replace(/\n/g, ' '));

    expect(response.headers['x-request-id']).not.toBe(id);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('request context', () => {
  const context = () => ({ requestId: 'r', startedAt: 0, dbMs: 0 });

  it('adds database time across awaits', async () => {
    const ctx = context();
    await runWithContext(ctx, async () => {
      await timed(() => new Promise((resolve) => setTimeout(resolve, 5)));
      recordDbTime(3);
    });

    expect(ctx.dbMs).toBeGreaterThanOrEqual(7);
  });

  it('keeps concurrent requests apart', async () => {
    const a = context();
    const b = context();
    await Promise.all([
      runWithContext(a, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        recordDbTime(10);
      }),
      runWithContext(b, async () => {
        recordDbTime(1);
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(currentContext()).toBe(b);
      }),
    ]);

    expect([a.dbMs, b.dbMs]).toEqual([10, 1]);
  });

  it('is a no-op outside a request', async () => {
    expect(currentContext()).toBeUndefined();
    await expect(timed(() => Promise.resolve(1))).resolves.toBe(1);
  });

  it('times a failing call too', async () => {
    const ctx = context();
    await runWithContext(ctx, () =>
      timed(() => Promise.reject(new Error('x'))).catch(() => undefined),
    );

    expect(ctx.dbMs).toBeGreaterThanOrEqual(0);
  });
});

describe('the request line', () => {
  it('has the common fields and, for a list, a summary with names only', async () => {
    const { app, captured } = listApp(oneHit);

    const response = await request(app).get(
      '/v1/restaurants?city=Gurgaon&cuisine=cafe&minRating=4&lat=28.49512&lng=77.08931&limit=5',
    );

    const [line] = await requestLines(captured);
    expect(line).toEqual({
      level: 'info',
      time: expect.any(String),
      service: 'biteexpress-api',
      requestId: response.headers['x-request-id'],
      method: 'GET',
      path: '/v1/restaurants',
      route: '/',
      status: 200,
      durationMs: expect.any(Number),
      dbMs: expect.any(Number),
      search: {
        sort: 'distance',
        filters: ['city', 'cuisines', 'minRating'],
        origin: { lat: 28.5, lng: 77.09 },
        limit: 5,
        resultCount: 1,
        hasNextPage: false,
      },
      msg: 'request',
    });
  });

  it('never contains the query string, filter values or raw coordinates', async () => {
    const { app, captured } = listApp(oneHit);

    await request(app).get(
      '/v1/restaurants?city=Gurgaon&cuisine=cafe&lat=28.49512&lng=77.08931',
    );
    await requestLines(captured);

    expect(captured.text()).not.toMatch(
      /Gurgaon|gurgaon|cafe|28\.49512|77\.08931|\?/,
    );
  });

  it('for search: what was recognized and the length of q, never q itself', async () => {
    const { app, captured } = listApp(oneHit);

    await request(app).get(
      '/v1/restaurants/search?q=best%20south%20indian%20near%20my%20house%20at%20Ashok%20Vihar',
    );

    const [line] = await requestLines(captured);
    expect(line?.['search']).toMatchObject({
      sort: 'rating',
      qLength: 46,
      // "at Ashok Vihar" is read as a place (in|at <unknown>), so `city`.
      recognized: ['city', 'cuisines', 'minVotes'],
      notesCount: expect.any(Number),
    });
    expect(captured.text()).not.toMatch(/ashok|vihar|house|south indian/i);
  });

  it('a 4xx carries its code at info, without a stack', async () => {
    const { app, captured } = listApp(oneHit);

    await request(app).get('/v1/restaurants?sort=bogus');

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({
      level: 'info',
      status: 400,
      errorCode: 'VALIDATION_ERROR',
    });
    expect(line).not.toHaveProperty('err');
  });

  it('a body that is not valid JSON is still logged with an id', async () => {
    const captured = captureLogger();
    await request(createTestApp({ logger: captured.logger }))
      .post('/v1/restaurants')
      .set('Content-Type', 'application/json')
      .send('{');

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({
      status: 400,
      errorCode: 'MALFORMED_JSON',
      requestId: expect.any(String),
    });
  });

  it('a slow request is logged at warn', async () => {
    const { app, captured } = listApp(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5)),
      1,
    );

    await request(app).get('/v1/restaurants');

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({ level: 'warn', slow: true });
  });

  it('probes are logged at debug, a failing probe at warn', async () => {
    const ok = captureLogger();
    await request(createTestApp({ logger: ok.logger })).get('/health');
    expect((await requestLines(ok))[0]).toMatchObject({
      level: 'debug',
      path: '/health',
    });

    const failing = captureLogger();
    await request(
      createTestApp({
        logger: failing.logger,
        readinessService: {
          check: () =>
            Promise.resolve({
              ready: false,
              checks: { mongo: 'fail', searchIndex: 'skipped' },
            }),
        },
      }),
    ).get('/ready');
    expect((await requestLines(failing))[0]).toMatchObject({
      level: 'warn',
      status: 503,
    });
  });

  it('an unknown path is logged without a route', async () => {
    const captured = captureLogger();
    await request(createTestApp({ logger: captured.logger })).get(
      '/nothing?x=1',
    );

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({
      path: '/nothing',
      status: 404,
      errorCode: 'ROUTE_NOT_FOUND',
    });
    expect(line).not.toHaveProperty('route');
  });

  it('includes the database time measured by the repository', async () => {
    const { app, captured } = listApp(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 20)),
    );

    await request(app).get('/v1/restaurants');

    const [line] = await requestLines(captured);
    expect(line?.['dbMs']).toBeGreaterThanOrEqual(15);
    expect(line?.['dbMs']).toBeLessThanOrEqual(line?.['durationMs'] as number);
  });
});

describe('a get by id line', () => {
  it('has no search block', async () => {
    const captured = captureLogger();
    const document = { _id: new ObjectId(ID) } as unknown as RestaurantDocument;
    await request(
      createTestApp({
        logger: captured.logger,
        restaurantService: {
          create: () => Promise.reject(new Error('not used')),
          getById: () =>
            Promise.reject(Object.assign(new Error('x'), { document })),
          list: () => Promise.reject(new Error('not used')),
          search: () => Promise.reject(new Error('not used')),
        },
      }),
    ).get(`/v1/restaurants/${ID}`);

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({ route: '/:id', status: 500, level: 'error' });
    expect(line).not.toHaveProperty('search');
  });
});

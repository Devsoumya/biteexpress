import { captureLogger, requestLines } from '../../helpers/logger';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import type {
  RestaurantDocument,
  RestaurantService,
} from '../../../src/models/restaurant.model';
import { ApplicationError } from '../../../src/utils/application-error';
import { createTestApp } from '../../helpers/app';
import { minimalCreateBody } from '../../helpers/restaurant-fixtures';

const ID = '5f1d7c3e9b1e8a0012345678';
const NOW = new Date('2026-11-06T00:00:00Z');

const stored: RestaurantDocument = {
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

function stubService(
  overrides: Partial<RestaurantService> = {},
): jest.Mocked<RestaurantService> {
  return {
    create: jest.fn(() => Promise.resolve(stored)),
    getById: jest.fn(() => Promise.resolve(stored)),
    list: jest.fn(() => Promise.resolve({ data: [], nextCursor: null })),
    ...overrides,
  } as jest.Mocked<RestaurantService>;
}

describe('POST /v1/restaurants', () => {
  it('returns 201 with the detail and a Location header', async () => {
    const restaurantService = stubService();
    const app = createTestApp({ restaurantService });

    const response = await request(app)
      .post('/v1/restaurants')
      .send(minimalCreateBody());

    expect(response.status).toBe(201);
    expect(response.headers['location']).toBe(`/v1/restaurants/${ID}`);
    expect(response.body).toMatchObject({ id: ID, ratingLabel: 'Not rated' });
    expect(restaurantService.create).toHaveBeenCalledWith(minimalCreateBody());
  });

  it.each<
    [
      string,
      Record<string, unknown>,
      { path: string; code: string; message: string }[],
    ]
  >([
    [
      'a missing required field',
      { ...minimalCreateBody(), name: undefined },
      [{ path: 'name', code: 'required', message: 'Required' }],
    ],
    [
      'an unknown key',
      { ...minimalCreateBody(), tenantId: 'other' },
      [{ path: 'tenantId', code: 'unknown_field', message: 'Unknown field' }],
    ],
    [
      'latitude without longitude',
      { ...minimalCreateBody(), latitude: 28.4 },
      [
        {
          path: 'longitude',
          code: 'required',
          message: 'Required when latitude is given',
        },
      ],
    ],
    [
      'an unsupported country',
      { ...minimalCreateBody(), countryCode: 'XX' },
      [
        {
          path: 'countryCode',
          code: 'invalid_value',
          message: 'Unsupported country code',
        },
      ],
    ],
  ])(
    'returns 400 VALIDATION_ERROR with details for %s',
    async (_case, body, details) => {
      const restaurantService = stubService();
      const app = createTestApp({ restaurantService });

      const response = await request(app).post('/v1/restaurants').send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details,
        },
      });
      expect(restaurantService.create).not.toHaveBeenCalled();
    },
  );

  it('returns 400 MALFORMED_JSON for a body that is not valid JSON', async () => {
    const app = createTestApp({ restaurantService: stubService() });

    const response = await request(app)
      .post('/v1/restaurants')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'MALFORMED_JSON',
        message: 'Request body is not valid JSON',
      },
    });
  });

  it('returns 415 UNSUPPORTED_MEDIA_TYPE for a body that is not JSON', async () => {
    const restaurantService = stubService();
    const app = createTestApp({ restaurantService });

    const response = await request(app)
      .post('/v1/restaurants')
      .set('Content-Type', 'text/plain')
      .send('name=Cafe');

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json',
      },
    });
    expect(restaurantService.create).not.toHaveBeenCalled();
  });

  it('returns 415 for a JSON body in an unsupported charset', async () => {
    const app = createTestApp({ restaurantService: stubService() });

    const response = await request(app)
      .post('/v1/restaurants')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('returns 400 VALIDATION_ERROR when there is no body at all', async () => {
    const app = createTestApp({ restaurantService: stubService() });

    const response = await request(app).post('/v1/restaurants');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      details: [
        { path: '', code: 'required', message: 'Body must be a JSON object' },
      ],
    });
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over 100 kB', async () => {
    const app = createTestApp({ restaurantService: stubService() });

    const response = await request(app)
      .post('/v1/restaurants')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(200_000) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 503 DATABASE_UNAVAILABLE with Retry-After, and logs the cause', async () => {
    const captured = captureLogger();
    const cause = new Error('connect ECONNREFUSED');
    const app = createTestApp({
      logger: captured.logger,
      restaurantService: stubService({
        create: () =>
          Promise.reject(
            new ApplicationError(
              'DATABASE_UNAVAILABLE',
              'The database is unavailable; retry shortly',
              { cause },
            ),
          ),
      }),
    });

    const response = await request(app)
      .post('/v1/restaurants')
      .send(minimalCreateBody());

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.body).toEqual({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is unavailable; retry shortly',
      },
    });
    const [line] = await requestLines(captured);
    expect(line).toMatchObject({
      level: 'error',
      status: 503,
      errorCode: 'DATABASE_UNAVAILABLE',
      err: { message: 'connect ECONNREFUSED' },
    });
  });

  describe('when the database validator rejects the document (code 121)', () => {
    it('returns a generic 500 and logs errInfo, without leaking driver text', async () => {
      const errInfo = { failingDocumentId: 'x', details: { rule: 'norm' } };
      const driverError = Object.assign(
        new Error('Document failed validation'),
        { code: 121, errInfo },
      );
      const captured = captureLogger();
      const app = createTestApp({
        logger: captured.logger,
        restaurantService: stubService({
          create: () => Promise.reject(driverError),
        }),
      });

      const response = await request(app)
        .post('/v1/restaurants')
        .send(minimalCreateBody());

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      // errInfo names the failing rule (ADR-004); it is in the log only.
      const [line] = await requestLines(captured);
      expect(line).toMatchObject({
        level: 'error',
        errorCode: 'INTERNAL_ERROR',
        err: { code: 121, errInfo },
      });
    });
  });
});

describe('GET /v1/restaurants/:id', () => {
  it('returns 200 with the detail', async () => {
    const restaurantService = stubService();
    const app = createTestApp({ restaurantService });

    const response = await request(app).get(`/v1/restaurants/${ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: ID, name: 'Corner Cafe' });
    expect(restaurantService.getById).toHaveBeenCalledWith(ID);
  });

  it.each(['abc', 'abcdefghijkl', `${ID}0`])(
    'returns 400 INVALID_ID for %s without calling the service',
    async (id) => {
      const restaurantService = stubService();
      const app = createTestApp({ restaurantService });

      const response = await request(app).get(`/v1/restaurants/${id}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_ID',
          message: 'Restaurant id must be a 24-character hex string',
        },
      });
      expect(restaurantService.getById).not.toHaveBeenCalled();
    },
  );

  it('returns 404 RESTAURANT_NOT_FOUND when the service reports it', async () => {
    const app = createTestApp({
      restaurantService: stubService({
        getById: () =>
          Promise.reject(
            new ApplicationError(
              'RESTAURANT_NOT_FOUND',
              'Restaurant not found',
            ),
          ),
      }),
    });

    const response = await request(app).get(`/v1/restaurants/${ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'RESTAURANT_NOT_FOUND', message: 'Restaurant not found' },
    });
  });
});

describe('unknown paths and methods', () => {
  const app = createTestApp({});

  it('returns 404 ROUTE_NOT_FOUND for a path that does not exist', async () => {
    const response = await request(app).get('/v2/nothing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' },
    });
  });

  it.each([
    ['DELETE', `/v1/restaurants/${ID}`, 'GET, HEAD'],
    ['PUT', '/v1/restaurants', 'GET, POST, HEAD'],
    ['POST', '/health', 'GET, HEAD'],
  ])(
    'returns 405 METHOD_NOT_ALLOWED for %s %s, with Allow: %s',
    async (method, path, allow) => {
      const response =
        await request(app)[method.toLowerCase() as 'delete' | 'put' | 'post'](
          path,
        );

      expect(response.status).toBe(405);
      expect(response.headers['allow']).toBe(allow);
      expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
    },
  );
});

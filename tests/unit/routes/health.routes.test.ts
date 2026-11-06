import { MongoClient } from 'mongodb';
import request from 'supertest';
import { createTestApp } from '../../helpers/app';
import type {
  ReadinessResult,
  ReadinessService,
} from '../../../src/models/health.model';
import { MongoHealthRepository } from '../../../src/repositories/health.repository';
import { CachedReadinessService } from '../../../src/services/readiness.service';

function serviceReturning(result: ReadinessResult): ReadinessService {
  return { check: () => Promise.resolve(result) };
}

describe('GET /health', () => {
  it('reports liveness without consulting readiness or MongoDB', async () => {
    const readinessService = { check: jest.fn() };
    const app = createTestApp({ readinessService });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(readinessService.check).not.toHaveBeenCalled();
  });
});

describe('GET /ready', () => {
  it('returns 200 with the checks when ready', async () => {
    const checks = { mongo: 'ok', searchIndex: 'ok' } as const;
    const app = createTestApp({
      readinessService: serviceReturning({ ready: true, checks }),
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 with the checks when not ready', async () => {
    const checks = { mongo: 'ok', searchIndex: 'missing' } as const;
    const app = createTestApp({
      readinessService: serviceReturning({ ready: false, checks }),
    });

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', checks });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  describe('with the real repository and an unreachable MongoDB', () => {
    // Port 1 refuses connections at once. The short selection timeout is an
    // option because createMongoClient's explicit 5 s would override the URI.
    const client = new MongoClient(
      'mongodb://127.0.0.1:1/biteexpress?directConnection=true',
      { serverSelectionTimeoutMS: 200 },
    );

    afterAll(() => client.close());

    it('returns 503 with mongo: fail', async () => {
      const repository = new MongoHealthRepository(
        client.db(),
        'restaurants',
        'restaurants_search',
      );
      const app = createTestApp({
        readinessService: new CachedReadinessService(repository),
      });

      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        checks: { mongo: 'fail', searchIndex: 'skipped' },
      });
    });
  });
});

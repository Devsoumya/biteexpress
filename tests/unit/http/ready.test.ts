import { MongoClient } from 'mongodb';
import request from 'supertest';
import { createApp } from '../../../src/app';
import {
  createReadinessCheck,
  mongoReadinessProbes,
  type ReadinessResult,
} from '../../../src/modules/health/readiness';

function appWith(result: ReadinessResult) {
  return createApp({ checkReadiness: () => Promise.resolve(result) });
}

describe('GET /ready', () => {
  it('returns 200 with the checks when ready', async () => {
    const checks = { mongo: 'ok', searchIndex: 'ok' } as const;

    const response = await request(appWith({ ready: true, checks })).get(
      '/ready',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 with the checks when not ready', async () => {
    const checks = { mongo: 'ok', searchIndex: 'missing' } as const;

    const response = await request(appWith({ ready: false, checks })).get(
      '/ready',
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', checks });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  describe('with real probes and an unreachable MongoDB', () => {
    // Port 1 refuses connections at once. The short selection timeout keeps
    // the test fast; it is passed as an option because createMongoClient's
    // explicit 5 s would override a value in the URI.
    const client = new MongoClient(
      'mongodb://127.0.0.1:1/biteexpress?directConnection=true',
      { serverSelectionTimeoutMS: 200 },
    );

    afterAll(() => client.close());

    it('returns 503 with mongo: fail', async () => {
      const checkReadiness = createReadinessCheck(
        mongoReadinessProbes(client.db(), 'restaurants', 'restaurants_search'),
      );

      const response = await request(createApp({ checkReadiness })).get(
        '/ready',
      );

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        checks: { mongo: 'fail', searchIndex: 'skipped' },
      });
    });
  });
});

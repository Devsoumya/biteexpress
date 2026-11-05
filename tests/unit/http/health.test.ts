import request from 'supertest';
import { createApp } from '../../../src/app';

describe('GET /health', () => {
  it('reports liveness without consulting readiness or MongoDB', async () => {
    const checkReadiness = jest.fn();
    const app = createApp({ checkReadiness });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(checkReadiness).not.toHaveBeenCalled();
  });
});

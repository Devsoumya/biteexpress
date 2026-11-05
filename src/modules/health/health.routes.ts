import { Router } from 'express';
import type { ReadinessCheck, ReadinessChecks } from './readiness';

export interface HealthRouterDependencies {
  checkReadiness: ReadinessCheck;
}

export interface HealthResponseBody {
  status: 'ok';
}

export interface ReadinessResponseBody {
  status: 'ready' | 'not_ready';
  checks: ReadinessChecks;
}

export function createHealthRouter(deps: HealthRouterDependencies): Router {
  const router = Router();

  // Liveness only: never touches MongoDB, so a database blip does not make an
  // orchestrator restart healthy API processes.
  router.get('/health', (_request, response) => {
    const body: HealthResponseBody = { status: 'ok' };
    response.status(200).json(body);
  });

  router.get('/ready', async (_request, response) => {
    const { ready, checks } = await deps.checkReadiness();
    const body: ReadinessResponseBody = {
      status: ready ? 'ready' : 'not_ready',
      checks,
    };
    response
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(body);
  });

  return router;
}

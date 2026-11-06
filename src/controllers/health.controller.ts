import type { Request, Response } from 'express';
import type {
  HealthResponseBody,
  ReadinessResponseBody,
  ReadinessService,
} from '../models/health.model';

/** Liveness (/health) and readiness (/ready) for the orchestrator (ADR-004). */
export class HealthController {
  constructor(private readonly readinessService: ReadinessService) {}

  // Liveness only: never touches MongoDB, so a database blip does not make an
  // orchestrator restart healthy API processes. Arrow properties keep `this`
  // bound when Express calls them.
  getHealth = (_request: Request, response: Response): void => {
    const body: HealthResponseBody = { status: 'ok' };
    response.status(200).json(body);
  };

  getReady = async (_request: Request, response: Response): Promise<void> => {
    const { ready, checks } = await this.readinessService.check();
    const body: ReadinessResponseBody = {
      status: ready ? 'ready' : 'not_ready',
      checks,
    };
    response
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json(body);
  };
}

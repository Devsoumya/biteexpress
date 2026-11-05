import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/health', controller.getHealth);
  router.get('/ready', controller.getReady);
  return router;
}

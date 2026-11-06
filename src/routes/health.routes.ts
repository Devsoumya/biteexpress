import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import { methodNotAllowed } from '../middlewares/method-not-allowed';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.route('/health').get(controller.getHealth).all(methodNotAllowed);
  router.route('/ready').get(controller.getReady).all(methodNotAllowed);
  return router;
}

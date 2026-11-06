import { Router } from 'express';
import type { DocsController } from '../controllers/docs.controller';
import type { HealthController } from '../controllers/health.controller';
import {
  RESTAURANTS_PATH,
  type RestaurantController,
} from '../controllers/restaurant.controller';
import { createDocsRouter } from './docs.routes';
import { createHealthRouter } from './health.routes';
import { createRestaurantRouter } from './restaurant.routes';

export interface Controllers {
  docs: DocsController;
  health: HealthController;
  restaurant: RestaurantController;
}

/**
 * Mounts every router. Paths and verbs only: parsing, validation and
 * responses live in the controllers. `route-coverage.test.ts` checks that
 * each route mounted here is in the OpenAPI document, and the reverse.
 */
export function createRoutes(controllers: Controllers): Router {
  const router = Router();
  router.use(createDocsRouter(controllers.docs));
  router.use(createHealthRouter(controllers.health));
  router.use(RESTAURANTS_PATH, createRestaurantRouter(controllers.restaurant));
  return router;
}

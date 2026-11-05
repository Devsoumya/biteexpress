import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller';
import { createHealthRouter } from './health.routes';
import { createRestaurantRouter } from './restaurant.routes';

export interface Controllers {
  health: HealthController;
}

export function createRoutes(controllers: Controllers): Router {
  const router = Router();
  router.use(createHealthRouter(controllers.health));
  router.use('/v1/restaurants', createRestaurantRouter());
  return router;
}

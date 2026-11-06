import { Router } from 'express';
import type { RestaurantController } from '../controllers/restaurant.controller';
import { methodNotAllowed } from '../middlewares/method-not-allowed';
import { requireJson } from '../middlewares/require-json';

// Each path is one route(): its real methods, then all() → 405 with Allow.
export function createRestaurantRouter(
  controller: RestaurantController,
): Router {
  const router = Router();
  router
    .route('/')
    .get(controller.list)
    .post(requireJson, controller.create)
    .all(methodNotAllowed);
  // Static paths must be registered above /:id, or "search" is taken as an id.
  router.route('/search').get(controller.search).all(methodNotAllowed);
  router.route('/:id').get(controller.getById).all(methodNotAllowed);
  return router;
}

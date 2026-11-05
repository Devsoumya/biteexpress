import express, { type Express } from 'express';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found-handler';
import { createHealthRouter } from './modules/health/health.routes';
import type { ReadinessCheck } from './modules/health/readiness';
import { restaurantRouter } from './modules/restaurants/restaurant.routes';

export interface AppDependencies {
  checkReadiness: ReadinessCheck;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(createHealthRouter({ checkReadiness: deps.checkReadiness }));
  app.use('/v1/restaurants', restaurantRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

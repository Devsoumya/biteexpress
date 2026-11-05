import express, { type Express } from 'express';
import { HealthController } from './controllers/health.controller';
import { errorHandler } from './middlewares/error-handler';
import { notFoundHandler } from './middlewares/not-found-handler';
import type { AppDependencies } from './models/app.model';
import { createRoutes } from './routes';

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(
    createRoutes({ health: new HealthController(deps.readinessService) }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

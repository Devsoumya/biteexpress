import express, { type Express } from 'express';
import { DocsController } from './controllers/docs.controller';
import { HealthController } from './controllers/health.controller';
import { RestaurantController } from './controllers/restaurant.controller';
import { errorHandler } from './middlewares/error-handler';
import { notFoundHandler } from './middlewares/not-found-handler';
import { bindRequestContext, requestId } from './middlewares/request-id';
import { requestLogger } from './middlewares/request-logger';
import type { AppDependencies } from './models/app.model';
import { buildOpenApiDocument } from './openapi/openapi.document';
import { createRoutes } from './routes';

/**
 * Builds the Express app from injected dependencies. No I/O and no module
 * state: each test builds its own app with fakes or a real repository, and
 * server.ts builds the production one.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Order matters: the request id and its log line first, so even a body
  // that fails to parse is logged with an id; then the body parser; then the
  // async context, which must start after it (see bindRequestContext).
  app.use(requestId());
  app.use(
    requestLogger({ logger: deps.logger, slowRequestMs: deps.slowRequestMs }),
  );
  app.use(express.json());
  app.use(bindRequestContext);
  app.use(
    createRoutes({
      docs: new DocsController(buildOpenApiDocument()),
      health: new HealthController(deps.readinessService),
      restaurant: new RestaurantController(deps.restaurantService),
    }),
  );
  // Last: an unmatched path becomes a 404, and every error (thrown or
  // rejected) is shaped by one handler into { error: { code, message } }.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

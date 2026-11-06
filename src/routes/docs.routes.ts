import { Router } from 'express';
import { methodNotAllowed } from '../middlewares/method-not-allowed';
import {
  type DocsController,
  OPENAPI_PATH,
  SWAGGER_ASSETS,
  SWAGGER_PATH,
} from '../controllers/docs.controller';

export function createDocsRouter(controller: DocsController): Router {
  const router = Router();
  router.route('/').get(controller.redirectToSwagger).all(methodNotAllowed);
  router.route(OPENAPI_PATH).get(controller.getOpenApi).all(methodNotAllowed);
  router
    .route(SWAGGER_PATH)
    .get(controller.getSwaggerPage)
    .all(methodNotAllowed);
  router
    .route(`${SWAGGER_PATH}/${SWAGGER_ASSETS.css}`)
    .get(controller.getSwaggerCss)
    .all(methodNotAllowed);
  router
    .route(`${SWAGGER_PATH}/${SWAGGER_ASSETS.js}`)
    .get(controller.getSwaggerJs)
    .all(methodNotAllowed);
  return router;
}

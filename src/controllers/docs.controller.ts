import { dirname, join } from 'node:path';
import type { Request, Response } from 'express';
import type { OpenApiDocument } from '../openapi/openapi.document';

export const OPENAPI_PATH = '/openapi.json';
export const SWAGGER_PATH = '/swagger';

// swagger-ui-dist ships only static browser files; nothing from it runs in
// Node. Resolved through package.json because the package has no types. Only
// the two files the page needs are served, never the whole folder: its
// index.html would load the public petstore demo.
const SWAGGER_UI_DIR = dirname(require.resolve('swagger-ui-dist/package.json'));
export const SWAGGER_ASSETS = {
  css: 'swagger-ui.css',
  js: 'swagger-ui-bundle.js',
} as const;

const SWAGGER_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BiteExpress API</title>
    <link rel="stylesheet" href="${SWAGGER_PATH}/${SWAGGER_ASSETS.css}" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_PATH}/${SWAGGER_ASSETS.js}"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '${OPENAPI_PATH}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
      });
    </script>
  </body>
</html>
`;

export class DocsController {
  constructor(private readonly document: OpenApiDocument) {}

  getOpenApi = (_request: Request, response: Response): void => {
    response.status(200).json(this.document);
  };

  getSwaggerPage = (_request: Request, response: Response): void => {
    response.status(200).type('html').send(SWAGGER_PAGE);
  };

  getSwaggerCss = (_request: Request, response: Response): void => {
    response.sendFile(join(SWAGGER_UI_DIR, SWAGGER_ASSETS.css));
  };

  getSwaggerJs = (_request: Request, response: Response): void => {
    response.sendFile(join(SWAGGER_UI_DIR, SWAGGER_ASSETS.js));
  };

  redirectToSwagger = (_request: Request, response: Response): void => {
    response.redirect(302, SWAGGER_PATH);
  };
}

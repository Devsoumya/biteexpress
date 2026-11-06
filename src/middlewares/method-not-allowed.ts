import type { RequestHandler } from 'express';
import { ApplicationError } from '../utils/application-error';

/**
 * Registered with `.all()` after a path's real methods, so a known path with
 * an unsupported method answers 405 with `Allow`, not a misleading 404.
 * `Allow` is read from the matched route, so it cannot drift from the router.
 */
export const methodNotAllowed: RequestHandler = (request, response) => {
  const methods = Object.keys(
    (request.route as { methods: Record<string, boolean> }).methods,
  )
    .filter((method) => method !== '_all')
    .map((method) => method.toUpperCase());
  // Express answers HEAD with the GET handler.
  if (methods.includes('GET')) methods.push('HEAD');
  response.set('Allow', methods.join(', '));
  throw new ApplicationError(
    'METHOD_NOT_ALLOWED',
    `${request.method} is not supported here; use ${methods.join(', ')}`,
  );
};

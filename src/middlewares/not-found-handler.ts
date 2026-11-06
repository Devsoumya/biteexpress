import type { RequestHandler } from 'express';
import { ApplicationError } from '../utils/application-error';

/**
 * Mounted after every router: a path no route matched. Forwarded to the
 * error handler so a 404 has the same body shape as every other error.
 */
export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApplicationError('ROUTE_NOT_FOUND', 'Route not found'));
};

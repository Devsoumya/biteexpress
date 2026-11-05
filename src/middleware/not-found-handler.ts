import type { RequestHandler } from 'express';
import { ApplicationError } from '../shared/errors/application-error';

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApplicationError('Route not found', 404, 'NOT_FOUND'));
};

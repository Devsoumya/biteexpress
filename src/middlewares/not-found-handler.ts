import type { RequestHandler } from 'express';
import { ApplicationError } from '../utils/application-error';

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApplicationError('ROUTE_NOT_FOUND', 'Route not found'));
};

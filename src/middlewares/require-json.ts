import type { RequestHandler } from 'express';
import { ApplicationError } from '../utils/application-error';

/**
 * 415 when the client declares a body type other than JSON. Without a
 * Content-Type there is nothing to reject: express.json() leaves the body
 * undefined and validation answers 400 "Body must be a JSON object".
 * (`request.is()` alone would treat `Content-Length: 0` as a body.)
 */
export const requireJson: RequestHandler = (request, _response, next) => {
  if (request.get('Content-Type') !== undefined && !request.is('json')) {
    throw new ApplicationError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json',
    );
  }
  next();
};
